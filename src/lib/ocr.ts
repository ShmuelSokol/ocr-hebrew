import Anthropic from "@anthropic-ai/sdk";
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
import { prisma } from "./prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface OCRLineResult {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  text: string;
  words: string[];
}

export async function detectLines(imageBuffer: Buffer): Promise<{ yTop: number; yBottom: number }[]> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Calculate ink density per row
  const rowDensity: number[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 160) dark++;
    }
    rowDensity.push(dark / width);
  }

  // Find text line regions
  const lines: { yTop: number; yBottom: number }[] = [];
  let inText = false;
  let start = 0;
  const threshold = 0.015;

  for (let y = 0; y < height; y++) {
    if (rowDensity[y] > threshold && !inText) {
      start = y;
      inText = true;
    } else if (rowDensity[y] <= threshold && inText) {
      if (y - start > 15) {
        lines.push({ yTop: Math.max(0, start - 5), yBottom: Math.min(height, y + 5) });
      }
      inText = false;
    }
  }
  if (inText && height - start > 15) {
    lines.push({ yTop: Math.max(0, start - 5), yBottom: height });
  }

  return lines;
}

/**
 * Detect skew angle of handwritten text by analyzing the tilt of text lines.
 * Returns angle in degrees (positive = clockwise tilt, negative = counter-clockwise).
 */
export async function detectSkew(imageBuffer: Buffer): Promise<number> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const darkThreshold = 160;

  // Detect line regions first
  const rowDensity: number[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < darkThreshold) dark++;
    }
    rowDensity.push(dark / width);
  }

  const lineRegions: { yTop: number; yBottom: number }[] = [];
  let inText = false;
  let start = 0;
  for (let y = 0; y < height; y++) {
    if (rowDensity[y] > 0.015 && !inText) { start = y; inText = true; }
    else if (rowDensity[y] <= 0.015 && inText) {
      if (y - start > 15) lineRegions.push({ yTop: start, yBottom: y });
      inText = false;
    }
  }
  if (inText && height - start > 15) lineRegions.push({ yTop: start, yBottom: height });

  if (lineRegions.length < 1) return 0;

  // For each line, find center-of-mass of dark pixels in left vs right halves
  const angles: number[] = [];
  // Use wider sampling bands for better detection
  const leftBound = Math.floor(width * 0.05);
  const leftEnd = Math.floor(width * 0.35);
  const rightStart = Math.floor(width * 0.65);
  const rightEnd = Math.floor(width * 0.95);

  for (const region of lineRegions) {
    let leftWeightedY = 0, leftCount = 0;
    let rightWeightedY = 0, rightCount = 0;

    for (let y = region.yTop; y < region.yBottom; y++) {
      for (let x = leftBound; x < leftEnd; x++) {
        if (data[y * width + x] < darkThreshold) {
          leftWeightedY += y;
          leftCount++;
        }
      }
      for (let x = rightStart; x < rightEnd; x++) {
        if (data[y * width + x] < darkThreshold) {
          rightWeightedY += y;
          rightCount++;
        }
      }
    }

    if (leftCount < 5 || rightCount < 5) continue;

    const leftCenterY = leftWeightedY / leftCount;
    const rightCenterY = rightWeightedY / rightCount;
    const leftCenterX = (leftBound + leftEnd) / 2;
    const rightCenterX = (rightStart + rightEnd) / 2;

    const angle = Math.atan2(rightCenterY - leftCenterY, rightCenterX - leftCenterX) * (180 / Math.PI);
    angles.push(angle);
  }

  if (angles.length === 0) return 0;

  // Use median angle for robustness
  angles.sort((a, b) => a - b);
  const median = angles[Math.floor(angles.length / 2)];

  // Only correct angles up to 10°, beyond that it's likely not simple skew
  if (Math.abs(median) > 10) return 0;

  return Math.round(median * 100) / 100;
}

// Pricing per million tokens (as of 2025)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
};

export interface FewShotLine {
  lineIndex: number;
  text: string;
}

/**
 * OCR a single cropped line image.
 * Returns the transcribed text for that line.
 */
async function ocrSingleLine(
  lineCropBase64: string,
  lineIndex: number,
  totalLines: number,
  correctionContext: string,
  fewShotHint?: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt =
    "You read ONE line of handwritten Hebrew text from a cropped image strip. " +
    "Output ONLY the Hebrew text you see — nothing else. No line numbers, no labels, no commentary.\n\n" +
    "RULES:\n" +
    "- Look at each letter shape individually. Read the INK, not what you think it should say.\n" +
    "- Do NOT auto-complete from Torah, Talmud, Gemara, or any known text.\n" +
    "- These are someone's personal notes. The text will NOT match any known source.\n" +
    "- If you cannot read a letter, write [?]. Never guess.\n" +
    "- Common abbreviations: וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, א״כ, ד״ה";

  let userText = `This is line ${lineIndex + 1} of ${totalLines} from a handwritten Hebrew page. Read exactly what is written.`;
  if (fewShotHint) {
    userText += `\n\nThe correct transcription for this line is known to be: ${fewShotHint}\nOutput this exact text.`;
  }
  if (correctionContext) {
    userText += correctionContext;
  }

  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg" as ImageMediaType,
              data: lineCropBase64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const response = await stream.finalMessage();
  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  const text = textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "";

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function runOCR(
  imageBase64: string,
  mediaType: string,
  imageBuffer: Buffer,
  userId: string,
  fileId: string,
  profileId?: string,
  firstLineHint?: string,
  fewShotLines?: FewShotLine[]
): Promise<{ rawText: string; lines: OCRLineResult[] }> {
  const sharp = (await import("sharp")).default;

  // Detect line positions in the image
  const detectedLines = await detectLines(imageBuffer);

  // Get correction examples for this profile
  let correctionContext = "";
  if (profileId) {
    const corrections = await prisma.correction.findMany({
      where: { profileId },
    });
    if (corrections.length > 0) {
      const pairCounts = new Map<string, number>();
      for (const c of corrections) {
        const key = `${c.originalText}|||${c.correctedText}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }

      const corrLines: string[] = [];
      pairCounts.forEach((count, key) => {
        const [orig, corrected] = key.split("|||");
        if (orig === corrected) {
          if (count >= 2) corrLines.push(`"${orig}" is confirmed correct (seen ${count}x)`);
        } else {
          corrLines.push(`"${orig}" should be "${corrected}" (corrected ${count}x)`);
        }
      });

      if (corrLines.length > 0) {
        correctionContext =
          "\n\nKnown patterns for this handwriting:\n" +
          corrLines.join("\n") +
          "\n";
      }
    }
  }

  // Build few-shot lookup from verified lines
  const fewShotMap = new Map<number, string>();
  if (fewShotLines) {
    for (const l of fewShotLines) {
      if (l.text.trim()) fewShotMap.set(l.lineIndex, l.text.trim());
    }
  }
  // Legacy first-line hint
  if (firstLineHint && !fewShotMap.has(0)) {
    fewShotMap.set(0, firstLineHint);
  }

  // Crop each line and OCR individually
  // Process in batches of 3 for parallelism without overwhelming the API
  const BATCH_SIZE = 3;
  const lineResults: { text: string; inputTokens: number; outputTokens: number }[] = new Array(detectedLines.length);
  let totalInput = 0;
  let totalOutput = 0;

  for (let batchStart = 0; batchStart < detectedLines.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, detectedLines.length);
    const batchPromises: Promise<void>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const line = detectedLines[i];
      // Add padding around the line crop for context
      const padTop = Math.floor((line.yBottom - line.yTop) * 0.15);
      const padBottom = Math.floor((line.yBottom - line.yTop) * 0.15);

      const cropPromise = (async () => {
        const metadata = await sharp(imageBuffer).metadata();
        const imgHeight = metadata.height || 1;
        const yTop = Math.max(0, line.yTop - padTop);
        const yBottom = Math.min(imgHeight, line.yBottom + padBottom);
        const cropHeight = yBottom - yTop;
        if (cropHeight < 5) {
          lineResults[i] = { text: "[?]", inputTokens: 0, outputTokens: 0 };
          return;
        }

        const cropBuffer = await sharp(imageBuffer)
          .extract({ left: 0, top: yTop, width: metadata.width || 1, height: cropHeight })
          .jpeg({ quality: 90 })
          .toBuffer();

        const cropBase64 = cropBuffer.toString("base64");
        const hint = fewShotMap.get(i);

        const result = await ocrSingleLine(
          cropBase64, i, detectedLines.length, correctionContext, hint
        );
        lineResults[i] = result;
      })();

      batchPromises.push(cropPromise);
    }

    await Promise.all(batchPromises);
  }

  // Sum up usage
  for (const lr of lineResults) {
    if (lr) {
      totalInput += lr.inputTokens;
      totalOutput += lr.outputTokens;
    }
  }

  // Track token usage
  const modelId = "claude-sonnet-4-20250514";
  const pricing = PRICING[modelId] || { input: 3, output: 15 };
  const costCents =
    (totalInput * pricing.input + totalOutput * pricing.output) / 1_000_000 * 100;

  await prisma.tokenUsage.create({
    data: {
      userId,
      fileId,
      model: modelId,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      costCents,
    },
  });

  // Build results
  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const text = lineResults[i]?.text || "[?]";
    // Take only the first line of output in case model outputs multiple lines
    const firstLine = text.split("\n")[0].trim();
    return {
      lineIndex: i,
      yTop: pos.yTop,
      yBottom: pos.yBottom,
      text: firstLine,
      words: firstLine.split(/\s+/),
    };
  });

  const rawText = lines.map((l) => l.text).join("\n");
  return { rawText, lines };
}

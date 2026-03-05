import Anthropic from "@anthropic-ai/sdk";
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
import { prisma } from "./prisma";
import { supabase, BUCKET } from "./supabase";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface OCRWordResult {
  text: string;
  xLeft: number;
  xRight: number;
}

interface OCRLineResult {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  text: string;
  words: OCRWordResult[];
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
 * Detect word boundaries within a line by finding vertical gaps in ink density.
 * Returns word regions sorted right-to-left (Hebrew reading order).
 */
export function detectWordsInLine(
  data: Buffer,
  width: number,
  line: { yTop: number; yBottom: number },
  numOcrWords: number,
): { xLeft: number; xRight: number }[] {
  const darkThreshold = 160;
  const lineHeight = line.yBottom - line.yTop;

  // Calculate ink density per column within this line
  const colDensity: number[] = [];
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = line.yTop; y < line.yBottom; y++) {
      if (data[y * width + x] < darkThreshold) dark++;
    }
    colDensity.push(dark / lineHeight);
  }

  // Find gaps (runs of low-density columns)
  // A gap needs to be wide enough to be a word space (not just thin letter spacing)
  const gapThreshold = 0.02;
  const minGapWidth = Math.max(5, Math.floor(width * 0.008)); // at least 0.8% of width or 5px

  const gaps: { start: number; end: number; width: number }[] = [];
  let inGap = false;
  let gapStart = 0;

  for (let x = 0; x < width; x++) {
    if (colDensity[x] <= gapThreshold && !inGap) {
      gapStart = x;
      inGap = true;
    } else if (colDensity[x] > gapThreshold && inGap) {
      const gapWidth = x - gapStart;
      if (gapWidth >= minGapWidth) {
        gaps.push({ start: gapStart, end: x, width: gapWidth });
      }
      inGap = false;
    }
  }
  if (inGap) {
    const gapWidth = width - gapStart;
    if (gapWidth >= minGapWidth) {
      gaps.push({ start: gapStart, end: width, width: gapWidth });
    }
  }

  // Find the first and last columns with ink to trim margins
  let firstInk = 0;
  let lastInk = width - 1;
  for (let x = 0; x < width; x++) {
    if (colDensity[x] > gapThreshold) { firstInk = x; break; }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colDensity[x] > gapThreshold) { lastInk = x; break; }
  }

  // Filter gaps to only those between text regions (not margins)
  const innerGaps = gaps.filter((g) => g.start > firstInk && g.end < lastInk);

  // We need exactly (numOcrWords - 1) gaps to split into numOcrWords regions
  // If we have more gaps, take the widest ones; if fewer, use what we have
  let selectedGaps: { start: number; end: number }[];
  if (innerGaps.length === numOcrWords - 1) {
    selectedGaps = innerGaps;
  } else if (innerGaps.length > numOcrWords - 1 && numOcrWords > 1) {
    // Take the (numOcrWords - 1) widest gaps
    selectedGaps = [...innerGaps]
      .sort((a, b) => b.width - a.width)
      .slice(0, numOcrWords - 1)
      .sort((a, b) => a.start - b.start);
  } else {
    // Not enough gaps — use what we found
    selectedGaps = innerGaps;
  }

  // Build word regions from gaps
  const wordRegions: { xLeft: number; xRight: number }[] = [];
  let regionStart = firstInk;

  for (const gap of selectedGaps) {
    const midGap = Math.floor((gap.start + gap.end) / 2);
    wordRegions.push({ xLeft: regionStart, xRight: midGap });
    regionStart = midGap;
  }
  wordRegions.push({ xLeft: regionStart, xRight: lastInk + 1 });

  // Sort right-to-left for Hebrew (rightmost word first)
  wordRegions.sort((a, b) => b.xLeft - a.xLeft);

  return wordRegions;
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

interface TrainingImage {
  base64: string;
  text: string;
}

/**
 * OCR a single cropped line image using real few-shot examples.
 * Training examples are included as reference images in a single message
 * so the model learns letter shapes without pattern-matching the conversation.
 */
async function ocrSingleLine(
  lineCropBase64: string,
  lineIndex: number,
  totalLines: number,
  correctionContext: string,
  trainingExamples: TrainingImage[],
  fewShotHint?: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt =
    "You are a Hebrew handwriting OCR. You receive images of handwritten Hebrew lines.\n" +
    "Your response must be ONLY Hebrew characters, spaces, and punctuation. Nothing else.\n" +
    "NEVER output English. NEVER describe the image. NEVER explain anything.\n" +
    "If the image is blank or unreadable, output only: [?]\n\n" +
    "Rules:\n" +
    "- Read each letter shape from the ink on the LAST image. Do not guess from context.\n" +
    "- Reference images are provided to show how THIS writer forms letters — study them.\n" +
    "- The new line will have DIFFERENT text than the references. Read what is actually written.\n" +
    "- Do not auto-complete from Torah, Talmud, or any known text.\n" +
    "- These are personal notes — text won't match any known source.\n" +
    "- Use [?] for any letter you cannot read.\n" +
    "- Common abbreviations: וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, א״כ, ד״ה";

  // Build a single message with reference examples + the line to read
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  // Add training examples as labeled reference images
  if (trainingExamples.length > 0) {
    content.push({
      type: "text",
      text: `Here are ${trainingExamples.length} reference examples of this writer's handwriting with correct transcriptions. Study the letter shapes:`,
    });

    for (let i = 0; i < trainingExamples.length; i++) {
      const ex = trainingExamples[i];
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: ex.base64 },
      });
      content.push({
        type: "text",
        text: `Reference ${i + 1} reads: ${ex.text}`,
      });
    }

    content.push({
      type: "text",
      text: "Now read the NEW line below. It has DIFFERENT text — do not copy from the references above.",
    });
  }

  // Add the actual line to OCR
  content.push({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: lineCropBase64 },
  });

  let userText = "Transcribe this new line.";
  if (fewShotHint) {
    userText = `Output exactly: ${fewShotHint}`;
  }
  if (correctionContext) {
    userText += correctionContext;
  }
  content.push({ type: "text", text: userText });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const response = await stream.finalMessage();
  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  let text = textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "";

  // Strip any English text the model might have output (descriptions, explanations)
  // Keep only Hebrew, punctuation, spaces, and [?]
  if (/[a-zA-Z]{3,}/.test(text) && !/[\u0590-\u05FF]/.test(text)) {
    // Entirely English response — model described the image instead of transcribing
    text = "[?]";
  }

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

  // Load real training examples (image crops + correct text) for this profile
  const trainingExamples: TrainingImage[] = [];
  let correctionContext = "";
  if (profileId) {
    // Load image-based training examples (max 5 to keep prompt size reasonable)
    const examples = await prisma.trainingExample.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    for (const ex of examples) {
      try {
        const { data: blob, error } = await supabase.storage
          .from(BUCKET)
          .download(ex.storagePath);
        if (!error && blob) {
          const buf = Buffer.from(await blob.arrayBuffer());
          trainingExamples.push({ base64: buf.toString("base64"), text: ex.text });
        }
      } catch {
        // Skip failed downloads
      }
    }

    // Also load text-based corrections as supplementary context
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

  // Build few-shot lookup from verified lines (text-only, for lines user typed in training mode)
  const fewShotMap = new Map<number, string>();
  if (fewShotLines) {
    for (const l of fewShotLines) {
      if (l.text.trim()) fewShotMap.set(l.lineIndex, l.text.trim());
    }
  }
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
          cropBase64, i, detectedLines.length, correctionContext, trainingExamples, hint
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

  // Detect word positions using pixel analysis
  const greyscale = await sharp(imageBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const imgData = greyscale.data;
  const imgWidth = greyscale.info.width;

  // Build results with word x-coordinates
  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const text = lineResults[i]?.text || "[?]";
    const firstLine = text.split("\n")[0].trim();
    const wordTexts = firstLine.split(/\s+/);

    // Detect word boundaries in this line
    const wordRegions = detectWordsInLine(imgData, imgWidth, pos, wordTexts.length);

    const words: OCRWordResult[] = wordTexts.map((wt, wi) => ({
      text: wt,
      xLeft: wordRegions[wi]?.xLeft ?? 0,
      xRight: wordRegions[wi]?.xRight ?? imgWidth,
    }));

    return {
      lineIndex: i,
      yTop: pos.yTop,
      yBottom: pos.yBottom,
      text: firstLine,
      words,
    };
  });

  const rawText = lines.map((l) => l.text).join("\n");
  return { rawText, lines };
}

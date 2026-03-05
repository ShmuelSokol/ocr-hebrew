import Anthropic from "@anthropic-ai/sdk";
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
import { prisma } from "./prisma";
import { supabase, BUCKET } from "./supabase";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface OCRWordResult {
  text: string;
  xLeft: number | null;
  xRight: number | null;
}

interface OCRLineResult {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  text: string;
  words: OCRWordResult[];
}

// ─── Line Detection ─────────────────────────────────────

function smoothArray(arr: number[], halfWindow: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(arr.length - 1, i + halfWindow); j++) {
      sum += arr[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
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

  // Smooth to avoid noise bridging lines
  const halfWindow = Math.max(2, Math.floor(height * 0.002));
  const smoothed = smoothArray(rowDensity, halfWindow);

  // Adaptive threshold: 10% of the max density (but at least 0.01)
  const maxDensity = Math.max(...smoothed);
  const threshold = Math.max(0.01, maxDensity * 0.1);

  // Minimum gap between lines to count as a separator
  const minGap = Math.max(4, Math.floor(height * 0.004));
  // Minimum height for a valid text line
  const minLineHeight = Math.max(10, Math.floor(height * 0.01));

  // Find text regions using gap tolerance
  const lines: { yTop: number; yBottom: number }[] = [];
  let inText = false;
  let start = 0;
  let gapCount = 0;

  for (let y = 0; y < height; y++) {
    if (smoothed[y] > threshold) {
      if (!inText) { start = y; inText = true; }
      gapCount = 0;
    } else if (inText) {
      gapCount++;
      if (gapCount >= minGap) {
        const end = y - gapCount;
        if (end - start >= minLineHeight) {
          lines.push({ yTop: Math.max(0, start - 3), yBottom: Math.min(height, end + 3) });
        }
        inText = false;
      }
    }
  }
  if (inText) {
    const end = height;
    if (end - start >= minLineHeight) {
      lines.push({ yTop: Math.max(0, start - 3), yBottom: Math.min(height, end + 3) });
    }
  }

  if (lines.length === 0) return lines;

  // Split overly tall regions that likely contain multiple merged lines
  const lineHeights = lines.map((l) => l.yBottom - l.yTop);
  lineHeights.sort((a, b) => a - b);
  const medianHeight = lineHeights[Math.floor(lineHeights.length / 2)];

  const result: { yTop: number; yBottom: number }[] = [];
  for (const line of lines) {
    const h = line.yBottom - line.yTop;
    if (h > medianHeight * 2 && medianHeight > 0) {
      // Try to split at density valleys within this region
      const subLines = splitAtValleys(smoothed, line.yTop, line.yBottom, medianHeight, threshold, minLineHeight);
      result.push(...subLines);
    } else {
      result.push(line);
    }
  }

  return result;
}

function splitAtValleys(
  smoothed: number[],
  yTop: number,
  yBottom: number,
  expectedHeight: number,
  threshold: number,
  minLineHeight: number,
): { yTop: number; yBottom: number }[] {
  const h = yBottom - yTop;
  const numExpected = Math.round(h / expectedHeight);
  if (numExpected <= 1) return [{ yTop, yBottom }];

  // Find valley points (local minima in smoothed density)
  const valleys: { y: number; density: number }[] = [];
  const searchMargin = Math.floor(expectedHeight * 0.3);

  for (let y = yTop + searchMargin; y < yBottom - searchMargin; y++) {
    // Check if this is a local minimum within a window
    const windowSize = Math.max(3, Math.floor(expectedHeight * 0.1));
    let isMin = true;
    for (let dy = -windowSize; dy <= windowSize; dy++) {
      if (dy !== 0 && y + dy >= yTop && y + dy < yBottom) {
        if (smoothed[y + dy] < smoothed[y]) { isMin = false; break; }
      }
    }
    if (isMin) {
      valleys.push({ y, density: smoothed[y] });
    }
  }

  if (valleys.length === 0) return [{ yTop, yBottom }];

  // Pick the best (numExpected - 1) valleys, preferring lowest density
  const sorted = [...valleys].sort((a, b) => a.density - b.density);
  const selectedCount = Math.min(sorted.length, numExpected - 1);
  const selected = sorted.slice(0, selectedCount).sort((a, b) => a.y - b.y);

  // Build sub-lines from split points
  const subLines: { yTop: number; yBottom: number }[] = [];
  let prevY = yTop;
  for (const v of selected) {
    if (v.y - prevY >= minLineHeight) {
      subLines.push({ yTop: prevY, yBottom: v.y });
      prevY = v.y;
    }
  }
  if (yBottom - prevY >= minLineHeight) {
    subLines.push({ yTop: prevY, yBottom });
  }

  return subLines.length > 0 ? subLines : [{ yTop, yBottom }];
}

// ─── Skew Detection ─────────────────────────────────────

export async function detectSkew(imageBuffer: Buffer): Promise<number> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const darkThreshold = 160;

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

  const angles: number[] = [];
  const leftBound = Math.floor(width * 0.05);
  const leftEnd = Math.floor(width * 0.35);
  const rightStart = Math.floor(width * 0.65);
  const rightEnd = Math.floor(width * 0.95);

  for (const region of lineRegions) {
    let leftWeightedY = 0, leftCount = 0;
    let rightWeightedY = 0, rightCount = 0;

    for (let y = region.yTop; y < region.yBottom; y++) {
      for (let x = leftBound; x < leftEnd; x++) {
        if (data[y * width + x] < darkThreshold) { leftWeightedY += y; leftCount++; }
      }
      for (let x = rightStart; x < rightEnd; x++) {
        if (data[y * width + x] < darkThreshold) { rightWeightedY += y; rightCount++; }
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
  angles.sort((a, b) => a - b);
  const median = angles[Math.floor(angles.length / 2)];
  if (Math.abs(median) > 10) return 0;
  return Math.round(median * 100) / 100;
}

// ─── Claude API ─────────────────────────────────────────

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

async function ocrSingleLine(
  lineCropBase64: string,
  lineIndex: number,
  totalLines: number,
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

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

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

  content.push({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: lineCropBase64 },
  });

  let userText = "Transcribe this new line.";
  if (fewShotHint) {
    userText = `Output exactly: ${fewShotHint}`;
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

  // Strip entirely-English responses (model described instead of transcribing)
  if (/[a-zA-Z]{3,}/.test(text) && !/[\u0590-\u05FF]/.test(text)) {
    text = "[?]";
  }

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ─── Main OCR Pipeline ──────────────────────────────────

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

  // Detect line positions
  const detectedLines = await detectLines(imageBuffer);

  // Load image-based training examples for this profile
  const trainingExamples: TrainingImage[] = [];
  if (profileId) {
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
  }

  // Build few-shot lookup
  const fewShotMap = new Map<number, string>();
  if (fewShotLines) {
    for (const l of fewShotLines) {
      if (l.text.trim()) fewShotMap.set(l.lineIndex, l.text.trim());
    }
  }
  if (firstLineHint && !fewShotMap.has(0)) {
    fewShotMap.set(0, firstLineHint);
  }

  // OCR each line in batches
  const BATCH_SIZE = 3;
  const lineResults: { text: string; inputTokens: number; outputTokens: number }[] = new Array(detectedLines.length);
  let totalInput = 0;
  let totalOutput = 0;

  for (let batchStart = 0; batchStart < detectedLines.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, detectedLines.length);
    const batchPromises: Promise<void>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const line = detectedLines[i];
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
          cropBase64, i, detectedLines.length, trainingExamples, hint
        );
        lineResults[i] = result;
      })();

      batchPromises.push(cropPromise);
    }

    await Promise.all(batchPromises);
  }

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

  // Build results — words are just text splits, no pixel-based coordinate detection
  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const text = lineResults[i]?.text || "[?]";
    const firstLine = text.split("\n")[0].trim();
    const wordTexts = firstLine.split(/\s+/);

    const words: OCRWordResult[] = wordTexts.map((wt) => ({
      text: wt,
      xLeft: null,
      xRight: null,
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

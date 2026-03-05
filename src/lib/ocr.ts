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

interface OCRPageWord {
  text: string;
  xLeft: number;
  xRight: number;
}

interface OCRPageLine {
  text: string;
  words: OCRPageWord[];
}

// Send the full page image to Opus and get word-level bounding boxes back.
async function ocrFullPage(
  imageBase64: string,
  mediaType: string,
  imageWidth: number,
  imageHeight: number,
  detectedLines: { yTop: number; yBottom: number }[],
  trainingExamples: TrainingImage[],
  fewShotHints: Map<number, string>,
): Promise<{ lines: OCRPageLine[]; inputTokens: number; outputTokens: number }> {
  const lineCount = detectedLines.length;

  const lineRanges = detectedLines.map((l, i) => `Line ${i + 1}: y=${l.yTop}..${l.yBottom}`).join("\n");

  const systemPrompt =
    `You are a Hebrew handwriting OCR. The image is ${imageWidth}x${imageHeight} pixels.\n` +
    `Line detection found ${lineCount} text lines at these y-ranges:\n${lineRanges}\n\n` +
    "For each line, identify every word and its horizontal pixel position.\n" +
    "Output valid JSON only — no markdown, no explanation, no extra text.\n\n" +
    "Output format (JSON array with exactly " + lineCount + " elements):\n" +
    '[{"words":[{"text":"word","x1":rightEdgePx,"x2":leftEdgePx},...]},...]\n\n' +
    "IMPORTANT:\n" +
    "- Hebrew is RTL: the FIRST word in reading order is on the RIGHT side of the image (high x values).\n" +
    "- x1 = right edge of the word (higher x), x2 = left edge of the word (lower x).\n" +
    "- Words should be in Hebrew reading order (right to left).\n" +
    "- x values are pixel coordinates (0 = left edge, " + imageWidth + " = right edge).\n" +
    "- Read each letter from the actual ink. Do not guess from context or known texts.\n" +
    "- These are personal study notes — text won't match any known source.\n" +
    "- Use [?] for unreadable letters. Use {\"words\":[{\"text\":\"[?]\",\"x1\":" + imageWidth + ",\"x2\":0}]} for blank lines.\n" +
    "- Common abbreviations: וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, א״כ, ד״ה";

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  // Training examples
  if (trainingExamples.length > 0) {
    content.push({
      type: "text",
      text: `Reference examples of this writer's handwriting — study the letter shapes:`,
    });
    for (let i = 0; i < trainingExamples.length; i++) {
      const ex = trainingExamples[i];
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: ex.base64 },
      });
      content.push({ type: "text", text: `Reference ${i + 1}: ${ex.text}` });
    }
  }

  // The full page image
  content.push({
    type: "image",
    source: { type: "base64", media_type: mediaType as ImageMediaType, data: imageBase64 },
  });

  // Instruction
  let instruction = `Transcribe all ${lineCount} lines with word positions. Output JSON only.`;
  if (fewShotHints.size > 0) {
    instruction += "\n\nKnown lines (use exact text, still provide x positions):";
    const sorted = Array.from(fewShotHints.entries()).sort((a, b) => a[0] - b[0]);
    for (const [idx, text] of sorted) {
      instruction += `\nLine ${idx + 1}: ${text}`;
    }
  }
  content.push({ type: "text", text: instruction });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  const response = await client.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  let rawText = textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "[]";

  // Strip markdown code fences if present
  rawText = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

  // Parse JSON
  let parsed: { words: { text: string; x1: number; x2: number }[] }[];
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Fallback: try to extract JSON array from the response
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = []; }
    } else {
      parsed = [];
    }
  }

  // Normalize into our format
  const lines: OCRPageLine[] = detectedLines.map((_, i) => {
    const lineData = parsed[i];
    if (!lineData || !lineData.words || !Array.isArray(lineData.words)) {
      return { text: "[?]", words: [{ text: "[?]", xLeft: 0, xRight: imageWidth }] };
    }

    const words: OCRPageWord[] = lineData.words
      .filter((w: { text?: string }) => w.text && w.text.trim())
      .map((w: { text: string; x1: number; x2: number }) => ({
        text: w.text.trim(),
        // x1 = right edge (higher), x2 = left edge (lower)
        xLeft: Math.max(0, Math.min(w.x1, w.x2)),
        xRight: Math.min(imageWidth, Math.max(w.x1, w.x2)),
      }));

    if (words.length === 0) {
      return { text: "[?]", words: [{ text: "[?]", xLeft: 0, xRight: imageWidth }] };
    }

    const text = words.map((w: OCRPageWord) => w.text).join(" ");
    return { text, words };
  });

  // Pad if needed
  while (lines.length < lineCount) {
    lines.push({ text: "[?]", words: [{ text: "[?]", xLeft: 0, xRight: imageWidth }] });
  }

  return {
    lines: lines.slice(0, lineCount),
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
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 1;
  const imageHeight = metadata.height || 1;

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

  // OCR the full page in one call (Opus, full context, word bounding boxes)
  const ocrResult = await ocrFullPage(
    imageBase64,
    mediaType,
    imageWidth,
    imageHeight,
    detectedLines,
    trainingExamples,
    fewShotMap,
  );

  const totalInput = ocrResult.inputTokens;
  const totalOutput = ocrResult.outputTokens;

  // Track token usage
  const modelId = "claude-opus-4-20250514";
  const pricing = PRICING[modelId] || { input: 15, output: 75 };
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

  // Build results using word coordinates from Opus
  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const lineData = ocrResult.lines[i];
    const text = lineData?.text || "[?]";

    const words: OCRWordResult[] = (lineData?.words || []).map((w) => ({
      text: w.text,
      xLeft: w.xLeft,
      xRight: w.xRight,
    }));

    if (words.length === 0) {
      words.push({ text: "[?]", xLeft: null, xRight: null });
    }

    return {
      lineIndex: i,
      yTop: pos.yTop,
      yBottom: pos.yBottom,
      text,
      words,
    };
  });

  const rawText = lines.map((l) => l.text).join("\n");
  return { rawText, lines };
}

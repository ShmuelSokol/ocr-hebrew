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

  const splitResult: { yTop: number; yBottom: number }[] = [];
  for (const line of lines) {
    const h = line.yBottom - line.yTop;
    if (h > medianHeight * 2 && medianHeight > 0) {
      const subLines = splitAtValleys(smoothed, line.yTop, line.yBottom, medianHeight, threshold, minLineHeight);
      splitResult.push(...subLines);
    } else {
      splitResult.push(line);
    }
  }

  // Filter out noise: scanner artifacts (very high ink density) and abnormal lines
  const result: { yTop: number; yBottom: number }[] = [];
  for (const line of splitResult) {
    const h = line.yBottom - line.yTop;

    // Calculate average ink density for this line region
    let totalDensity = 0;
    for (let y = line.yTop; y < line.yBottom; y++) {
      totalDensity += rowDensity[y] || 0;
    }
    const avgDensity = totalDensity / h;

    // Reject scanner artifacts: lines where >40% of pixels are dark (text is typically 5-25%)
    if (avgDensity > 0.4) continue;

    // Reject abnormally tall lines (>3x median) that weren't split — likely noise
    if (medianHeight > 0 && h > medianHeight * 3) continue;

    result.push(line);
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

// ─── Word Segmentation ──────────────────────────────────

/**
 * Find word boundaries within a line using column projection (vertical ink density).
 * Returns array of {xLeft, xRight} for each word-like region, sorted right-to-left (RTL).
 */
export function segmentWords(
  data: Buffer,
  width: number,
  yTop: number,
  yBottom: number,
  expectedWordCount: number,
): { xLeft: number; xRight: number }[] {
  const lineHeight = yBottom - yTop;
  if (lineHeight < 5 || width < 10) return [];

  // Calculate ink density per column within this line
  const colDensity: number[] = [];
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = yTop; y < yBottom; y++) {
      if (data[y * width + x] < 160) dark++;
    }
    colDensity.push(dark / lineHeight);
  }

  // Smooth columns to reduce noise
  const smoothed = smoothArray(colDensity, Math.max(2, Math.floor(width * 0.003)));

  // Find ink threshold — columns with density above this have ink
  const maxCol = Math.max(...smoothed);
  const inkThreshold = Math.max(0.02, maxCol * 0.08);

  // Find ink regions (runs of columns with ink)
  const regions: { xLeft: number; xRight: number }[] = [];
  let inInk = false;
  let start = 0;
  const minGapWidth = Math.max(3, Math.floor(width * 0.008)); // min gap between words
  let gapCount = 0;

  for (let x = 0; x < width; x++) {
    if (smoothed[x] > inkThreshold) {
      if (!inInk) { start = x; inInk = true; }
      gapCount = 0;
    } else if (inInk) {
      gapCount++;
      if (gapCount >= minGapWidth) {
        const end = x - gapCount;
        if (end - start >= 3) { // min word width
          regions.push({ xLeft: start, xRight: end });
        }
        inInk = false;
      }
    }
  }
  if (inInk) {
    regions.push({ xLeft: start, xRight: width - 1 });
  }

  if (regions.length === 0) return [];

  // If we have more regions than expected words, merge closest pairs
  // (some letters may be split). If fewer, that's ok — some words may be connected.
  const merged = [...regions];
  while (merged.length > expectedWordCount && merged.length > 1) {
    // Find the smallest gap between adjacent regions
    let minGap = Infinity;
    let minIdx = 0;
    for (let i = 0; i < merged.length - 1; i++) {
      const gap = merged[i + 1].xLeft - merged[i].xRight;
      if (gap < minGap) { minGap = gap; minIdx = i; }
    }
    // Merge the two regions
    merged[minIdx] = {
      xLeft: merged[minIdx].xLeft,
      xRight: merged[minIdx + 1].xRight,
    };
    merged.splice(minIdx + 1, 1);
  }

  // Sort right-to-left for Hebrew (rightmost region = first word in RTL)
  merged.sort((a, b) => b.xLeft - a.xLeft);

  return merged;
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

const LINE_OCR_SYSTEM =
  "You read Hebrew handwriting. You are given a cropped image showing a few lines of handwriting.\n\n" +
  "Rules:\n" +
  "- Output one line of text per line of handwriting shown, in order.\n" +
  "- Read each word by examining the actual letter shapes in the ink.\n" +
  "- Use [?] for any word you cannot read clearly. [?] is better than guessing.\n" +
  "- Do NOT generate text from memory. If you recognize a Talmudic topic, that does NOT mean " +
  "you know what this line says — the writer uses their own words and abbreviations.\n" +
  "- The writer uses many abbreviations (׳ ״), dashes between words, and parenthetical references.\n" +
  "- Output Hebrew/Aramaic only. No English, no explanations, no line labels.";

// OCR a batch of line crops in one API call.
// Returns one text string per line crop.
async function ocrLineBatch(
  lineCrops: { base64: string; lineIndex: number }[],
  trainingExamples: TrainingImage[],
  correctionVocab: string[],
  fewShotHints: Map<number, string>,
): Promise<{ texts: string[]; model: string; inputTokens: number; outputTokens: number }> {
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  // Training examples (word-level crops)
  if (trainingExamples.length > 0) {
    content.push({
      type: "text",
      text: "Examples of this writer's handwriting:",
    });
    for (const ex of trainingExamples) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: ex.base64 },
      });
      content.push({ type: "text", text: `reads: ${ex.text}` });
    }
  }

  // Vocabulary hint (brief)
  if (correctionVocab.length > 0) {
    content.push({
      type: "text",
      text: "Writer's vocabulary (use only when a word visually matches): " +
        correctionVocab.slice(0, 100).join(", "),
    });
  }

  // Line crop images
  const lineCount = lineCrops.length;
  content.push({
    type: "text",
    text: `Read these ${lineCount} line(s) of handwriting. Output exactly ${lineCount} line(s), one per image.`,
  });

  for (let i = 0; i < lineCrops.length; i++) {
    const lc = lineCrops[i];
    // If we have a verified hint for this line, tell the model
    const hint = fewShotHints.get(lc.lineIndex);
    if (hint) {
      content.push({ type: "text", text: `Line ${i + 1} (verified): ${hint}` });
    }
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: lc.base64 },
    });
  }

  content.push({
    type: "text",
    text: `Output exactly ${lineCount} line(s) of Hebrew text, one per handwriting line shown above. Use [?] for unreadable words.`,
  });

  // Use assistant prefill to force Hebrew-only output (no English preamble)
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content },
    { role: "assistant", content: "‎" }, // invisible RTL mark forces Hebrew start
  ];

  // Try models with retries
  const models: { id: string; retries: number; delay: number }[] = [
    { id: "claude-opus-4-20250514", retries: 2, delay: 3000 },
    { id: "claude-sonnet-4-20250514", retries: 3, delay: 2000 },
  ];
  let response: Anthropic.Message | null = null;
  let usedModel = models[0].id;

  for (const { id: model, retries, delay } of models) {
    usedModel = model;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 2048,
          temperature: 0,
          system: LINE_OCR_SYSTEM,
          messages,
        });
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 529 || status === 503 || status === 502) {
          if (attempt < retries - 1) await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    if (response) break;
  }
  if (!response) throw new Error("API overloaded — please try again in a minute");

  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  const rawText = textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "";

  let texts = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  // Clean up line number prefixes
  texts = texts.map(l => l.replace(/^(?:Line\s*)?\d+[\.:)\-]\s*/, ""));
  // Strip lines that are primarily English (model preamble/explanation)
  texts = texts.filter(l => /[\u0590-\u05FF]/.test(l));

  // Pad or trim to match expected line count
  while (texts.length < lineCount) texts.push("[?]");
  if (texts.length > lineCount) texts = texts.slice(0, lineCount);

  return {
    texts,
    model: usedModel,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// Crop individual lines from the image and OCR them in parallel batches.
async function ocrByLines(
  imageBuffer: Buffer,
  detectedLines: { yTop: number; yBottom: number }[],
  trainingExamples: TrainingImage[],
  correctionVocab: string[],
  fewShotHints: Map<number, string>,
): Promise<{ lines: string[]; model: string; inputTokens: number; outputTokens: number }> {
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width || 1;
  const imgHeight = metadata.height || 1;

  // Crop each line with some vertical padding
  const lineCrops: { base64: string; lineIndex: number }[] = [];
  for (let i = 0; i < detectedLines.length; i++) {
    const line = detectedLines[i];
    const padY = Math.floor((line.yBottom - line.yTop) * 0.2);
    const top = Math.max(0, line.yTop - padY);
    const bottom = Math.min(imgHeight, line.yBottom + padY);
    const height = bottom - top;
    if (height < 5) {
      lineCrops.push({ base64: "", lineIndex: i });
      continue;
    }
    const cropBuf = await sharp(imageBuffer)
      .extract({ left: 0, top, width: imgWidth, height })
      .jpeg({ quality: 85 })
      .toBuffer();
    lineCrops.push({ base64: cropBuf.toString("base64"), lineIndex: i });
  }

  // Batch lines into groups of 5 for parallel API calls
  const BATCH_SIZE = 5;
  const batches: { base64: string; lineIndex: number }[][] = [];
  for (let i = 0; i < lineCrops.length; i += BATCH_SIZE) {
    batches.push(lineCrops.slice(i, i + BATCH_SIZE).filter(lc => lc.base64.length > 0));
  }

  console.log(`[OCR] Processing ${detectedLines.length} lines in ${batches.length} batches...`);

  // Run all batches in parallel
  const batchResults = await Promise.all(
    batches.map((batch, bIdx) =>
      ocrLineBatch(batch, trainingExamples, correctionVocab, fewShotHints)
        .then(r => {
          console.log(`[OCR] Batch ${bIdx + 1}/${batches.length} done (${r.model})`);
          return r;
        })
    )
  );

  // Assemble results in order
  const allTexts: string[] = [];
  let totalInput = 0, totalOutput = 0;
  let usedModel = "claude-opus-4-20250514";

  let batchIdx = 0;
  for (let i = 0; i < lineCrops.length; i++) {
    if (lineCrops[i].base64.length === 0) {
      allTexts.push("[?]");
      continue;
    }
    // Find which batch this line is in
    const batch = batches[batchIdx];
    const posInBatch = batch.findIndex(lc => lc.lineIndex === i);
    if (posInBatch >= 0 && batchResults[batchIdx]) {
      allTexts.push(batchResults[batchIdx].texts[posInBatch] || "[?]");
    } else {
      allTexts.push("[?]");
    }
    // Move to next batch if we've consumed all lines in this one
    if (posInBatch >= 0 && posInBatch === batch.length - 1) {
      batchIdx++;
    }
  }

  for (const r of batchResults) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    usedModel = r.model;
  }

  return { lines: allTexts, model: usedModel, inputTokens: totalInput, outputTokens: totalOutput };
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
  // Detect line positions
  const detectedLines = await detectLines(imageBuffer);

  // Load image-based training examples and correction vocabulary for this profile
  const trainingExamples: TrainingImage[] = [];
  const correctionVocab: string[] = [];
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

    // Load confirmed words from previous OCR results for this profile
    // These are words the user has confirmed or corrected — reliable vocabulary
    const confirmedWords = await prisma.oCRWord.findMany({
      where: {
        correctedText: { not: null },
        line: { result: { file: { profileId } } },
      },
      select: { correctedText: true },
    });
    const vocabSet = new Set<string>();
    for (const w of confirmedWords) {
      if (w.correctedText && w.correctedText !== "[?]" && /[\u0590-\u05FF]/.test(w.correctedText)) {
        vocabSet.add(w.correctedText);
      }
    }
    correctionVocab.push(...Array.from(vocabSet).slice(0, 200));
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

  // OCR lines in parallel batches (line crops prevent full-page hallucination)
  const ocrResult = await ocrByLines(
    imageBuffer,
    detectedLines,
    trainingExamples,
    correctionVocab,
    fewShotMap,
  );

  const totalInput = ocrResult.inputTokens;
  const totalOutput = ocrResult.outputTokens;

  // Track token usage
  const modelId = ocrResult.model;
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

  // Line-by-line OCR already returns exactly one result per detected line
  const alignedTexts = ocrResult.lines;

  // Find ink bounds per line and assign word positions proportionally.
  // This is more robust than column-projection segmentation which breaks
  // when noise regions cause off-by-one shifts across all words.
  const sharp = (await import("sharp")).default;
  const { data: grayData, info: grayInfo } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const imgWidth = grayInfo.width;

  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const text = alignedTexts[i] || "[?]";
    const wordTexts = text.split(/\s+/).filter(w => w.length > 0);

    if (wordTexts.length === 0) {
      return { lineIndex: i, yTop: pos.yTop, yBottom: pos.yBottom, text, words: [{ text: "[?]", xLeft: null, xRight: null }] };
    }

    // Find the actual ink bounds for this line (skip margin whitespace)
    const lineHeight = pos.yBottom - pos.yTop;
    let inkLeft = imgWidth, inkRight = 0;
    for (let x = 0; x < imgWidth; x++) {
      let dark = 0;
      for (let y = pos.yTop; y < pos.yBottom; y++) {
        if (grayData[y * imgWidth + x] < 160) dark++;
      }
      if (dark / lineHeight > 0.02) {
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
      }
    }

    // Fallback if no ink found
    if (inkLeft >= inkRight) {
      const words = wordTexts.map(wt => ({ text: wt, xLeft: null, xRight: null }));
      return { lineIndex: i, yTop: pos.yTop, yBottom: pos.yBottom, text, words };
    }

    // Divide ink span proportionally by character count (RTL: first word is rightmost)
    const totalChars = wordTexts.reduce((sum, w) => sum + w.length, 0);
    const inkSpan = inkRight - inkLeft;
    const words: OCRWordResult[] = [];
    let cursor = inkRight; // start from right side (RTL)

    for (let wi = 0; wi < wordTexts.length; wi++) {
      const charFrac = wordTexts[wi].length / totalChars;
      const wordWidth = Math.round(inkSpan * charFrac);
      const xLeft = Math.max(inkLeft, cursor - wordWidth);
      const xRight = cursor;
      words.push({ text: wordTexts[wi], xLeft, xRight });
      cursor = xLeft; // next word starts where this one ended
    }

    return { lineIndex: i, yTop: pos.yTop, yBottom: pos.yBottom, text, words };
  });

  const rawText = lines.map((l) => l.text).join("\n");
  return { rawText, lines };
}

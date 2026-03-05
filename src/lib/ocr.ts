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

// Send full page image and get plain text lines back.
async function ocrFullPage(
  imageBase64: string,
  mediaType: string,
  lineCount: number,
  trainingExamples: TrainingImage[],
  fewShotHints: Map<number, string>,
  correctionVocab: string[],
): Promise<{ lines: string[]; model: string; inputTokens: number; outputTokens: number }> {
  const systemPrompt =
    "You are an expert Hebrew handwriting OCR specializing in Torah/Talmud study notes.\n\n" +
    "The image contains " + lineCount + " lines of handwritten Hebrew/Aramaic text.\n" +
    "These are personal study notes on Talmud, Halacha, and related topics.\n\n" +
    "Output EXACTLY " + lineCount + " lines of text, one per line, top to bottom.\n" +
    "Output ONLY the transcribed text. No English. No explanations. No line numbers.\n\n" +
    "Guidelines:\n" +
    "- Read the actual handwriting carefully — every word must correspond to visible ink.\n" +
    "- Use your knowledge of Hebrew, Aramaic, and Talmudic vocabulary to disambiguate unclear letters.\n" +
    "- Every word you output should be a real Hebrew/Aramaic word or a standard abbreviation.\n" +
    "- If a word looks like gibberish, re-examine the letter shapes — it's probably a real word you're misreading.\n" +
    "- Common abbreviations: בס״ד, וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, א״כ, ד״ה, הרמב״ם, ע״פ, וכ׳, ר׳, ב״ד\n" +
    "- Do NOT recite memorized passages. The writer summarizes in their own words — text won't match sources verbatim.\n" +
    "- Do not skip or add words. Each word in output = one word visible in the handwriting.\n" +
    "- Use [?] only for words that are truly illegible even with context.";

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  // Correction vocabulary — words this writer commonly uses
  if (correctionVocab.length > 0) {
    content.push({
      type: "text",
      text: "Vocabulary from this writer's confirmed corrections (words they commonly use):\n" +
        correctionVocab.join(", "),
    });
  }

  // Training examples
  if (trainingExamples.length > 0) {
    content.push({
      type: "text",
      text: "Reference examples of this writer's handwriting — study the letter shapes carefully:",
    });
    for (let i = 0; i < trainingExamples.length; i++) {
      const ex = trainingExamples[i];
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg" as ImageMediaType, data: ex.base64 },
      });
      content.push({ type: "text", text: `This line reads: ${ex.text}` });
    }
  }

  // The full page image
  content.push({
    type: "image",
    source: { type: "base64", media_type: mediaType as ImageMediaType, data: imageBase64 },
  });

  // Instruction
  let instruction = `Transcribe all ${lineCount} lines of handwritten text from the image above.\nOutput EXACTLY ${lineCount} lines of Hebrew/Aramaic text, nothing else.`;
  if (fewShotHints.size > 0) {
    instruction += "\n\nThese lines have been verified (use exact text):";
    const sorted = Array.from(fewShotHints.entries()).sort((a, b) => a[0] - b[0]);
    for (const [idx, text] of sorted) {
      instruction += `\nLine ${idx + 1}: ${text}`;
    }
    instruction += "\n\nInclude the verified lines AND transcribe the remaining lines.";
  }
  content.push({ type: "text", text: instruction });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  // Try Opus first (best quality), fall back to Sonnet on persistent failure
  const models = ["claude-opus-4-20250514", "claude-sonnet-4-20250514"];
  let response: Anthropic.Message | null = null;
  let usedModel = models[0];

  for (const model of models) {
    usedModel = model;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 529 || status === 503 || status === 502) {
          // Wait longer between retries: 3s, 6s, 10s, then try next model
          await new Promise(r => setTimeout(r, 3000 + attempt * 3000));
          continue;
        }
        throw err;
      }
    }
    if (response) break; // Got a response, stop trying models
  }
  if (!response) throw new Error("API overloaded — please try again in a minute");

  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  const rawText = textBlock && "text" in textBlock ? (textBlock.text as string).trim() : "";

  // Split into lines
  let lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  // Remove line number prefixes the model might add
  lines = lines.map(l => l.replace(/^(?:Line\s*)?\d+[\.:)\-]\s*/, ""));

  // Strip entirely-English lines (model explaining instead of transcribing)
  lines = lines.map(l => {
    if (/[a-zA-Z]{3,}/.test(l) && !/[\u0590-\u05FF]/.test(l)) return "[?]";
    return l;
  });

  // Pad or trim to expected count
  while (lines.length < lineCount) lines.push("[?]");
  if (lines.length > lineCount) lines = lines.slice(0, lineCount);

  return {
    lines,
    model: usedModel,
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

  // OCR the full page in one call
  const ocrResult = await ocrFullPage(
    imageBase64,
    mediaType,
    detectedLines.length,
    trainingExamples,
    fewShotMap,
    correctionVocab,
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

  // Build results — words are text splits from OCR output
  const lines: OCRLineResult[] = detectedLines.map((pos, i) => {
    const text = ocrResult.lines[i] || "[?]";
    const wordTexts = text.split(/\s+/).filter(w => w.length > 0);

    const words: OCRWordResult[] = wordTexts.length > 0
      ? wordTexts.map(wt => ({ text: wt, xLeft: null, xRight: null }))
      : [{ text: "[?]", xLeft: null, xRight: null }];

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

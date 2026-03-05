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
          "\n\nKnown patterns for this handwriting (from human corrections):\n" +
          corrLines.join("\n") +
          "\n";
      }
    }
  }

  // Build few-shot context from verified lines
  let fewShotContext = "";
  if (fewShotLines && fewShotLines.length > 0) {
    const sorted = [...fewShotLines].sort((a, b) => a.lineIndex - b.lineIndex);
    fewShotContext =
      "\n\nVERIFIED TRANSCRIPTIONS (these are 100% correct — use them to learn this writer's letter shapes):\n" +
      sorted.map((l) => `Line ${l.lineIndex + 1}: ${l.text}`).join("\n") +
      "\n\nStudy how the handwritten letters in those lines map to the transcribed text. " +
      "Apply that knowledge to read the remaining lines accurately.\n";
  }

  // Legacy first-line hint (still supported but few-shot is preferred)
  let firstLineContext = "";
  if (firstLineHint && (!fewShotLines || fewShotLines.length === 0)) {
    firstLineContext =
      `\nThe EXACT first line of this page is:\n${firstLineHint}\n` +
      `Use this to understand how THIS writer forms each Hebrew letter. ` +
      `Then read the rest of the page using that knowledge.\n`;
  }

  const systemPrompt =
    "You are a careful handwriting transcription tool. Your ONLY job is to read exactly " +
    "what is written on the page — letter by letter, stroke by stroke. " +
    "You must NEVER generate text from your knowledge of Torah, Talmud, or any other source. " +
    "You are NOT a Torah scholar here. You are a camera that reads ink shapes.\n\n" +
    "CRITICAL: If you recognize a phrase and your brain wants to auto-complete it, STOP. " +
    "Look at each letter individually. The writer may have written something different " +
    "from what you expect. Spell out ONLY what the ink shows.\n\n" +
    "When in doubt, write [?]. A [?] is infinitely better than a hallucinated word. " +
    "Getting 70% right with [?] for the rest is far more useful than getting 100% of " +
    "confident-but-wrong text.";

  const stream = client.messages.stream({
    model: "claude-opus-4-20250514",
    max_tokens: 16384,
    thinking: {
      type: "enabled",
      budget_tokens: 10000,
    },
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as ImageMediaType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text:
              `This page has exactly ${detectedLines.length} lines of handwritten Hebrew text.\n` +
              firstLineContext +
              fewShotContext +
              correctionContext +
              "\nTRANSCRIPTION RULES:\n" +
              "1. Output EXACTLY " + detectedLines.length + " lines of text, one per line in the image.\n" +
              "2. For EACH word: look at each letter shape individually. What does the INK show? " +
              "Do NOT recognize the word — READ the letters one by one.\n" +
              "3. These are someone's ORIGINAL notes (chiddushim). They are NOT copying a sefer. " +
              "The text will NOT match any known source exactly.\n" +
              "4. If a word looks like it could be two different words, write what the LETTERS show, not what makes more sense contextually.\n" +
              "5. If you cannot read a letter or word, write [?]. Do NOT guess.\n" +
              "6. Common abbreviations: וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, פ״ו, הל׳, דהיינו, א״כ, ד״ה\n" +
              "7. Output ONLY the Hebrew text. No commentary, no line numbers, no labels.\n" +
              "8. Each output line must correspond to one handwritten line in the image.\n" +
              "9. NEVER auto-complete a pasuk, mishna, or gemara quote from memory. Read ONLY what is written." +
              (fewShotLines && fewShotLines.length > 0
                ? "\n10. For lines with verified transcriptions above, output the EXACT verified text."
                : ""),
          },
        ],
      },
    ],
  });

  const response = await stream.finalMessage();

  // Extract text from response (skip thinking blocks)
  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  const rawText = textBlock && "text" in textBlock ? textBlock.text : "";

  // Track token usage
  const modelId = "claude-opus-4-20250514";
  const usage = response.usage;
  const pricing = PRICING[modelId] || { input: 15, output: 75 };
  const costCents =
    (usage.input_tokens * pricing.input + usage.output_tokens * pricing.output) / 1_000_000 * 100;

  await prisma.tokenUsage.create({
    data: {
      userId,
      fileId,
      model: modelId,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costCents,
    },
  });

  // Parse lines and match to detected positions
  const textLines = rawText.split("\n").filter((l) => l.trim());
  const lines: OCRLineResult[] = textLines.map((text, i) => {
    const pos = detectedLines[i] || { yTop: 0, yBottom: 0 };
    return {
      lineIndex: i,
      yTop: pos.yTop,
      yBottom: pos.yBottom,
      text: text.trim(),
      words: text.trim().split(/\s+/),
    };
  });

  return { rawText, lines };
}

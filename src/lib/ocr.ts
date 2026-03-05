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

// Pricing per million tokens (as of 2025)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
};

export async function runOCR(
  imageBase64: string,
  mediaType: string,
  imageBuffer: Buffer,
  userId: string,
  fileId: string,
  profileId?: string,
  firstLineHint?: string
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
      // Group corrections: count how many times each pair appears
      const pairCounts = new Map<string, number>();
      for (const c of corrections) {
        const key = `${c.originalText}|||${c.correctedText}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }

      // Build context with frequency — more examples = higher confidence
      const lines: string[] = [];
      pairCounts.forEach((count, key) => {
        const [orig, corrected] = key.split("|||");
        if (orig === corrected) {
          // Confirmed correct word
          if (count >= 2) lines.push(`"${orig}" is confirmed correct (seen ${count}x)`);
        } else {
          // Actual correction
          lines.push(`"${orig}" should be "${corrected}" (corrected ${count}x)`);
        }
      });

      if (lines.length > 0) {
        correctionContext =
          "\n\nKnown patterns for this handwriting (from human corrections):\n" +
          lines.join("\n") +
          "\n";
      }
    }
  }

  let firstLineContext = "";
  if (firstLineHint) {
    firstLineContext =
      `\nThe EXACT first line of this page is:\n${firstLineHint}\n` +
      `Use this to understand how THIS writer forms each Hebrew letter. ` +
      `Then read the rest of the page using that knowledge.\n`;
  }

  const response = await client.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 8192,
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
              correctionContext +
              "\nTRANSCRIPTION RULES:\n" +
              "1. Output EXACTLY " + detectedLines.length + " lines of text, one per line in the image.\n" +
              "2. Read each word letter-by-letter from the handwriting. Do NOT auto-complete from memory.\n" +
              "3. These are someone's ORIGINAL notes (chiddushim). They are NOT copying a sefer word-for-word.\n" +
              "4. The writer quotes sources but also adds their own analysis and comments.\n" +
              "5. If you cannot read a word, write [?] — this is MUCH better than guessing.\n" +
              "6. Common abbreviations: וכו׳, עי׳, הנ״ל, ר״ל, ע״ש, פ״ו, הל׳, דהיינו, א״כ, ד״ה\n" +
              "7. Output ONLY the Hebrew text. No commentary, no line numbers, no labels.\n" +
              "8. Each output line must correspond to one handwritten line in the image.",
          },
        ],
      },
    ],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";

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

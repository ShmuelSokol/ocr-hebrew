import { prisma } from "./prisma";

interface OCRWordResult {
  text: string;
  xLeft: number | null;
  xRight: number | null;
  confidence?: number;
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

  const rowDensity: number[] = [];
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 160) dark++;
    }
    rowDensity.push(dark / width);
  }

  const halfWindow = Math.max(2, Math.floor(height * 0.002));
  const smoothed = smoothArray(rowDensity, halfWindow);

  const maxDensity = Math.max(...smoothed);
  const threshold = Math.max(0.01, maxDensity * 0.1);
  const minGap = Math.max(4, Math.floor(height * 0.004));
  const minLineHeight = Math.max(10, Math.floor(height * 0.01));

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

  const result: { yTop: number; yBottom: number }[] = [];
  for (const line of splitResult) {
    const h = line.yBottom - line.yTop;
    let totalDensity = 0;
    for (let y = line.yTop; y < line.yBottom; y++) {
      totalDensity += rowDensity[y] || 0;
    }
    const avgDensity = totalDensity / h;
    if (avgDensity > 0.4) continue;
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

  const valleys: { y: number; density: number }[] = [];
  const searchMargin = Math.floor(expectedHeight * 0.3);

  for (let y = yTop + searchMargin; y < yBottom - searchMargin; y++) {
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

  const sorted = [...valleys].sort((a, b) => a.density - b.density);
  const selectedCount = Math.min(sorted.length, numExpected - 1);
  const selected = sorted.slice(0, selectedCount).sort((a, b) => a.y - b.y);

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

// ─── Azure Document Intelligence OCR ─────────────────────

async function ocrWithAzure(
  imageBuffer: Buffer,
): Promise<{ lines: OCRLineResult[]; rawText: string }> {
  const endpoint = process.env["AZURE_DOC_INTELLIGENCE_ENDPOINT"];
  const key = process.env["AZURE_DOC_INTELLIGENCE_KEY"];
  if (!endpoint || !key) {
    throw new Error("AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY must be set");
  }

  // Submit image for analysis
  const submitRes = await fetch(
    `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&locale=he`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "image/jpeg",
      },
      body: new Uint8Array(imageBuffer),
    },
  );

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`Azure Doc Intelligence submit error ${submitRes.status}: ${errText}`);
  }

  const operationUrl = submitRes.headers.get("operation-location");
  if (!operationUrl) throw new Error("No operation-location header in Azure response");

  // Poll for results (up to 60 seconds)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let result: any = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(operationUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });
    result = await pollRes.json();
    if (result.status === "succeeded") break;
    if (result.status === "failed") {
      throw new Error(`Azure OCR failed: ${JSON.stringify(result)}`);
    }
  }

  if (!result || result.status !== "succeeded") {
    throw new Error("Azure OCR timed out");
  }

  const page = result.analyzeResult?.pages?.[0];
  if (!page) return { lines: [], rawText: "" };

  const azureLines: any[] = page.lines || [];
  const azureWords: any[] = page.words || [];

  if (azureLines.length === 0) return { lines: [], rawText: "" };

  // Build a map of words to their line by matching y-coordinates
  // Azure words have polygon [x1,y1,x2,y2,x3,y3,x4,y4]
  function polyBounds(polygon: number[]): { xLeft: number; xRight: number; yTop: number; yBottom: number } {
    const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
    const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];
    return {
      xLeft: Math.round(Math.min(...xs)),
      xRight: Math.round(Math.max(...xs)),
      yTop: Math.round(Math.min(...ys)),
      yBottom: Math.round(Math.max(...ys)),
    };
  }

  // Group words into lines by finding which Azure line they belong to
  const lineWordMap = new Map<number, { text: string; xLeft: number; xRight: number; yTop: number; yBottom: number; confidence: number }[]>();

  for (let li = 0; li < azureLines.length; li++) {
    lineWordMap.set(li, []);
  }

  for (const word of azureWords) {
    if (!word.polygon || word.polygon.length < 8) continue;
    const wb = polyBounds(word.polygon);
    const wCenterY = (wb.yTop + wb.yBottom) / 2;

    // Find the best matching line for this word
    let bestLine = 0;
    let bestOverlap = -Infinity;
    for (let li = 0; li < azureLines.length; li++) {
      const linePoly = azureLines[li].polygon;
      if (!linePoly || linePoly.length < 8) continue;
      const lb = polyBounds(linePoly);
      // Check if word center falls within line y-range
      if (wCenterY >= lb.yTop && wCenterY <= lb.yBottom) {
        const overlap = Math.min(wb.yBottom, lb.yBottom) - Math.max(wb.yTop, lb.yTop);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestLine = li;
        }
      }
    }

    const words = lineWordMap.get(bestLine) || [];
    words.push({
      text: word.content || "",
      xLeft: wb.xLeft,
      xRight: wb.xRight,
      yTop: wb.yTop,
      yBottom: wb.yBottom,
      confidence: word.confidence ?? 0,
    });
    lineWordMap.set(bestLine, words);
  }

  // Build OCRLineResult array
  const lines: OCRLineResult[] = [];

  for (let li = 0; li < azureLines.length; li++) {
    const azLine = azureLines[li];
    const linePoly = azLine.polygon;
    if (!linePoly || linePoly.length < 8) continue;
    const lb = polyBounds(linePoly);

    const words = lineWordMap.get(li) || [];
    // Sort words right-to-left (Hebrew RTL)
    words.sort((a, b) => b.xRight - a.xRight);

    const lineText = azLine.content || words.map((w) => w.text).join(" ");

    lines.push({
      lineIndex: lines.length,
      yTop: lb.yTop,
      yBottom: lb.yBottom,
      text: lineText,
      words: words.map((w) => ({
        text: w.text,
        xLeft: w.xLeft,
        xRight: w.xRight,
        confidence: w.confidence,
      })),
    });
  }

  // Sort lines top-to-bottom
  lines.sort((a, b) => a.yTop - b.yTop);
  lines.forEach((l, i) => (l.lineIndex = i));

  const rawText = lines.map((l) => l.text).join("\n");
  const totalWords = lines.reduce((s, l) => s + l.words.length, 0);
  console.log(`[OCR] Azure: ${totalWords} words in ${lines.length} lines`);
  return { lines, rawText };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ─── Dictionary Correction ──────────────────────────────

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

async function buildCorrectionDictionary(profileId?: string): Promise<Map<string, number>> {
  const where = profileId ? { profileId } : {};
  const examples = await prisma.trainingExample.findMany({
    where,
    select: { text: true },
  });
  const dict = new Map<string, number>();
  for (const ex of examples) {
    const t = ex.text.trim();
    if (t) dict.set(t, (dict.get(t) || 0) + 1);
  }
  return dict;
}

function correctWithDictionary(
  words: OCRWordResult[],
  dict: Map<string, number>,
  confidenceThreshold: number = 0.85,
  maxEditDist: number = 2,
): OCRWordResult[] {
  if (dict.size === 0) return words;

  return words.map((word) => {
    const text = word.text.trim();
    if (!text || text.length <= 1) return word;
    // Skip if already in dictionary (exact match)
    if (dict.has(text)) return word;
    // Only correct low-confidence words
    if (word.confidence !== undefined && word.confidence >= confidenceThreshold) return word;

    // Find closest dictionary match
    let bestMatch = "";
    let bestDist = Infinity;
    let bestFreq = 0;
    const maxDist = Math.min(maxEditDist, Math.floor(text.length * 0.4));

    dict.forEach((freq, dictWord) => {
      // Quick length filter
      if (Math.abs(dictWord.length - text.length) > maxDist) return;
      const dist = editDistance(text, dictWord);
      if (dist < bestDist || (dist === bestDist && freq > bestFreq)) {
        bestDist = dist;
        bestMatch = dictWord;
        bestFreq = freq;
      }
    });

    if (bestDist > 0 && bestDist <= maxDist && bestMatch) {
      console.log(`[OCR-Dict] "${text}" -> "${bestMatch}" (dist=${bestDist}, freq=${bestFreq}, conf=${word.confidence?.toFixed(2)})`);
      return { ...word, text: bestMatch };
    }
    return word;
  });
}

// ─── DocTR + TrOCR (In-House OCR) ───────────────────────

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

async function ocrWithDocTR(
  imageBuffer: Buffer,
): Promise<{ lines: OCRLineResult[]; rawText: string }> {
  // Step 1: Send full page image to DocTR /detect endpoint for bounding boxes
  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), "page.jpg");

  const detectRes = await fetch(`${TROCR_SERVER}/detect`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  if (!detectRes.ok) {
    const err = await detectRes.text();
    throw new Error(`DocTR detection failed (${detectRes.status}): ${err}`);
  }

  const detection = await detectRes.json();
  console.log(`[OCR] DocTR: ${detection.total_words} words in ${detection.total_lines} lines (${detection.time_ms}ms)`);

  if (!detection.lines || detection.lines.length === 0) {
    return { lines: [], rawText: "" };
  }

  // Step 2: Crop each word and send to TrOCR /predict for text recognition
  const sharp = (await import("sharp")).default;
  const lines: OCRLineResult[] = [];

  for (const detectLine of detection.lines) {
    const words: OCRWordResult[] = [];

    for (const wordBox of detectLine.words) {
      const pad = 3;
      const left = Math.max(0, wordBox.xLeft - pad);
      const top = Math.max(0, wordBox.yTop - pad);
      const width = Math.min(wordBox.xRight + pad, 10000) - left;
      const height = Math.min(wordBox.yBottom + pad, 10000) - top;

      if (width < 5 || height < 5) continue;

      let text = "";
      try {
        const cropBuffer = await sharp(imageBuffer)
          .extract({ left, top, width, height })
          .jpeg({ quality: 90 })
          .toBuffer();

        const wordForm = new FormData();
        wordForm.append("image", new Blob([new Uint8Array(cropBuffer)], { type: "image/jpeg" }), "word.jpg");

        const predRes = await fetch(`${TROCR_SERVER}/predict`, {
          method: "POST",
          body: wordForm,
          signal: AbortSignal.timeout(10000),
        });

        if (predRes.ok) {
          const pred = await predRes.json();
          text = pred.text || "";
        }
      } catch {
        // Skip individual word failures
      }

      words.push({
        text,
        xLeft: wordBox.xLeft,
        xRight: wordBox.xRight,
        confidence: undefined,
      });
    }

    lines.push({
      lineIndex: detectLine.lineIndex,
      yTop: detectLine.yTop,
      yBottom: detectLine.yBottom,
      text: words.map((w) => w.text).join(" "),
      words,
    });
  }

  const rawText = lines.map((l) => l.text).join("\n");
  const totalWords = lines.reduce((s, l) => s + l.words.length, 0);
  console.log(`[OCR] TrOCR: recognized ${totalWords} words`);
  return { lines, rawText };
}

// ─── Main OCR Pipeline ──────────────────────────────────

export type OCRMethod = "azure" | "doctr";

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  firstLineHint?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fewShotLines?: FewShotLine[],
  method: OCRMethod = "azure",
): Promise<{ rawText: string; lines: OCRLineResult[] }> {
  let result: { rawText: string; lines: OCRLineResult[] };

  if (method === "doctr") {
    // In-house: DocTR bounding boxes + TrOCR text recognition
    result = await ocrWithDocTR(imageBuffer);
  } else {
    // Azure Document Intelligence: word-level bounding boxes + Hebrew text
    result = await ocrWithAzure(imageBuffer);
  }

  // Post-process: correct low-confidence words using verified training data
  const dict = await buildCorrectionDictionary(profileId);
  if (dict.size > 0) {
    let corrected = 0;
    for (const line of result.lines) {
      const before = line.words.map((w) => w.text).join(" ");
      line.words = correctWithDictionary(line.words, dict);
      const after = line.words.map((w) => w.text).join(" ");
      if (before !== after) corrected++;
      line.text = line.words.map((w) => w.text).join(" ");
    }
    result.rawText = result.lines.map((l) => l.text).join("\n");
    console.log(`[OCR-Dict] Dictionary: ${dict.size} words, corrected ${corrected} lines`);
  }

  // Track usage
  await prisma.tokenUsage.create({
    data: {
      userId,
      fileId,
      model: method === "doctr" ? "doctr-trocr" : "azure-doc-intelligence",
      inputTokens: 0,
      outputTokens: 0,
      costCents: method === "doctr" ? 0 : 0.1, // DocTR is free (local), Azure ~$1/1000
    },
  });

  return result;
}

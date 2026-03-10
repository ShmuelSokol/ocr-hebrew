import { prisma } from "./prisma";
import { getAllTalmudicWords, getTalmudicWordFreqs, getBigramMap, PUNCT_EQUIVALENCES } from "./talmudic-dictionary";

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

  // Downscale for speed — 600px wide is enough for skew detection
  const meta = await sharp(imageBuffer).metadata();
  const scale = Math.min(1, 600 / (meta.width || 600));
  const { data, info } = await sharp(imageBuffer)
    .resize(Math.round((meta.width || 600) * scale))
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Binarize: compute Otsu-like threshold
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = data.length; let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVar) { maxVar = variance; threshold = t; }
  }

  // Build binary row projection (count dark pixels per row)
  const rowCounts = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < threshold) count++;
    }
    rowCounts[y] = count;
  }

  // Projection profile variance method:
  // For each candidate angle, "rotate" the row projection and measure variance.
  // The angle with maximum variance = text lines are most horizontal.
  // We simulate rotation by shifting each column's contribution.
  const angleStep = 0.1;
  const maxAngle = 5; // search +/- 5 degrees
  let bestAngle = 0;
  let bestVariance = -1;

  for (let angle = -maxAngle; angle <= maxAngle; angle += angleStep) {
    const rad = angle * Math.PI / 180;
    const tanA = Math.tan(rad);

    // Build shifted row projection
    const proj = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] < threshold) {
          const newY = Math.round(y - x * tanA);
          if (newY >= 0 && newY < height) proj[newY]++;
        }
      }
    }

    // Compute variance of projection
    let mean = 0;
    for (let y = 0; y < height; y++) mean += proj[y];
    mean /= height;
    let variance = 0;
    for (let y = 0; y < height; y++) variance += (proj[y] - mean) * (proj[y] - mean);

    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  // Refine with finer step around the best angle
  const fineStart = bestAngle - angleStep;
  const fineEnd = bestAngle + angleStep;
  for (let angle = fineStart; angle <= fineEnd; angle += 0.02) {
    const rad = angle * Math.PI / 180;
    const tanA = Math.tan(rad);

    const proj = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] < threshold) {
          const newY = Math.round(y - x * tanA);
          if (newY >= 0 && newY < height) proj[newY]++;
        }
      }
    }

    let mean = 0;
    for (let y = 0; y < height; y++) mean += proj[y];
    mean /= height;
    let variance = 0;
    for (let y = 0; y < height; y++) variance += (proj[y] - mean) * (proj[y] - mean);

    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  if (Math.abs(bestAngle) > 10) return 0;
  return Math.round(bestAngle * 100) / 100;
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

// Normalize punctuation for comparison (geresh/gershayim variants)
function normalizePunct(text: string): string {
  let t = text;
  for (const [a, b] of PUNCT_EQUIVALENCES) {
    t = t.replaceAll(a, b);
  }
  return t;
}

function correctWithDictionary(
  words: OCRWordResult[],
  dict: Map<string, number>,
  confidenceThreshold: number = 0.85,
  maxEditDist: number = 2,
): OCRWordResult[] {
  const talmudicWords = getAllTalmudicWords();
  const talmudicFreqs = getTalmudicWordFreqs();
  const bigrams = getBigramMap();
  const hasDicts = dict.size > 0 || talmudicWords.size > 0;
  if (!hasDicts) return words;

  return words.map((word, idx) => {
    const text = word.text.trim();
    if (!text || text.length <= 1) return word;

    const normalized = normalizePunct(text);

    // Skip if exact match in user dict or talmudic dict
    if (dict.has(text) || dict.has(normalized)) return word;
    if (talmudicWords.has(text) || talmudicWords.has(normalized)) return word;

    // Only correct low-confidence words (or all words for TrOCR which has no confidence)
    if (word.confidence !== undefined && word.confidence >= confidenceThreshold) return word;

    // Find closest match across both dictionaries
    let bestMatch = "";
    let bestDist = Infinity;
    let bestScore = -Infinity; // Combined score: frequency + context bonus
    const maxDist = Math.min(maxEditDist, Math.floor(text.length * 0.4));

    // Get context: previous and next words for bigram matching
    const prevWord = idx > 0 ? words[idx - 1].text.trim() : "";
    const nextWord = idx < words.length - 1 ? words[idx + 1].text.trim() : "";

    function scoreCandidate(candidate: string, dist: number, freq: number) {
      if (dist > maxDist) return;
      // Base score from frequency (log scale)
      let score = Math.log2(freq + 1) * 10;
      // Bigram bonus: if previous word predicts this candidate
      if (prevWord && bigrams.has(prevWord)) {
        const followers = bigrams.get(prevWord)!;
        if (followers.has(candidate)) score += 50;
      }
      // Bigram bonus: if this candidate predicts the next word
      if (nextWord && bigrams.has(candidate)) {
        const followers = bigrams.get(candidate)!;
        if (followers.has(nextWord)) score += 30;
      }
      // Talmudic vocab bonus (known word)
      if (talmudicWords.has(candidate)) score += 20;
      // Prefer smaller edit distance
      score -= dist * 15;

      if (dist < bestDist || (dist === bestDist && score > bestScore)) {
        bestDist = dist;
        bestMatch = candidate;
        bestScore = score;
      }
    }

    // Search user training dictionary
    dict.forEach((freq, dictWord) => {
      if (Math.abs(dictWord.length - text.length) > maxDist) return;
      const dist = editDistance(normalized, normalizePunct(dictWord));
      scoreCandidate(dictWord, dist, freq);
    });

    // Search talmudic dictionary (with real Sefaria frequencies)
    talmudicFreqs.forEach((freq, tWord) => {
      if (Math.abs(tWord.length - text.length) > maxDist) return;
      if (dict.has(tWord)) return; // Already checked above
      const dist = editDistance(normalized, normalizePunct(tWord));
      scoreCandidate(tWord, dist, freq);
    });

    if (bestDist > 0 && bestDist <= maxDist && bestMatch) {
      const source = dict.has(bestMatch) ? "user" : "talmudic";
      console.log(`[OCR-Dict] "${text}" -> "${bestMatch}" (dist=${bestDist}, score=${bestScore.toFixed(0)}, src=${source}, conf=${word.confidence?.toFixed(2)})`);
      return { ...word, text: bestMatch };
    }
    return word;
  });
}

// ─── DocTR + TrOCR (In-House OCR) ───────────────────────

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

interface PreDetectedLine {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  words: { xLeft: number; xRight: number; yTop: number; yBottom: number }[];
}

async function ocrWithDocTR(
  imageBuffer: Buffer,
  preDetectedBoxes?: PreDetectedLine[],
): Promise<{ lines: OCRLineResult[]; rawText: string }> {
  let detection: { lines: PreDetectedLine[] };

  if (preDetectedBoxes && preDetectedBoxes.length > 0) {
    // Use pre-detected boxes (from stepper with user corrections)
    detection = { lines: preDetectedBoxes };
    const totalWords = preDetectedBoxes.reduce((s, l) => s + l.words.length, 0);
    console.log(`[OCR] Using pre-detected boxes: ${totalWords} words in ${preDetectedBoxes.length} lines`);
  } else {
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

    detection = await detectRes.json();
    const totalWords = detection.lines?.reduce((s: number, l: PreDetectedLine) => s + l.words.length, 0) || 0;
    const totalLines = detection.lines?.length || 0;
    console.log(`[OCR] DocTR: ${totalWords} words in ${totalLines} lines`);
  }

  if (!detection.lines || detection.lines.length === 0) {
    return { lines: [], rawText: "" };
  }

  // Step 2: Crop all words in parallel, then batch-predict via /predict_batch
  const sharp = (await import("sharp")).default;

  // Build a flat list of word crops with their line/word indices
  const cropJobs: { lineIdx: number; wordBox: { xLeft: number; xRight: number; yTop: number; yBottom: number } }[] = [];

  for (let li = 0; li < detection.lines.length; li++) {
    for (const wordBox of detection.lines[li].words) {
      const pad = 3;
      const left = Math.max(0, wordBox.xLeft - pad);
      const top = Math.max(0, wordBox.yTop - pad);
      const width = Math.min(wordBox.xRight + pad, 10000) - left;
      const height = Math.min(wordBox.yBottom + pad, 10000) - top;
      if (width < 5 || height < 5) continue;
      cropJobs.push({ lineIdx: li, wordBox });
    }
  }

  // Crop all words in parallel
  const cropPromises = cropJobs.map(({ wordBox }) => {
    const pad = 3;
    const left = Math.max(0, wordBox.xLeft - pad);
    const top = Math.max(0, wordBox.yTop - pad);
    const width = Math.min(wordBox.xRight + pad, 10000) - left;
    const height = Math.min(wordBox.yBottom + pad, 10000) - top;
    return sharp(imageBuffer).extract({ left, top, width, height }).jpeg({ quality: 90 }).toBuffer();
  });
  const allCrops = await Promise.all(cropPromises);

  // Send all crops in one batch request
  const BATCH_SIZE = 50;
  const allTexts: string[] = new Array(allCrops.length).fill("");

  for (let i = 0; i < allCrops.length; i += BATCH_SIZE) {
    const batch = allCrops.slice(i, i + BATCH_SIZE);
    const batchForm = new FormData();
    for (let j = 0; j < batch.length; j++) {
      batchForm.append("images", new Blob([new Uint8Array(batch[j])], { type: "image/jpeg" }), `word_${i + j}.jpg`);
    }
    try {
      const batchRes = await fetch(`${TROCR_SERVER}/predict_batch`, {
        method: "POST",
        body: batchForm,
        signal: AbortSignal.timeout(120000),
      });
      if (batchRes.ok) {
        const batchData = await batchRes.json();
        for (let j = 0; j < batchData.results.length; j++) {
          allTexts[i + j] = batchData.results[j].text || "";
        }
      }
    } catch {
      // Fall back to empty text for this batch
    }
  }

  // Assemble results by line
  const lines: OCRLineResult[] = [];
  let cropIdx = 0;
  for (let li = 0; li < detection.lines.length; li++) {
    const detectLine = detection.lines[li];
    const words: OCRWordResult[] = [];
    for (const wordBox of detectLine.words) {
      const pad = 3;
      const width = Math.min(wordBox.xRight + pad, 10000) - Math.max(0, wordBox.xLeft - pad);
      const height = Math.min(wordBox.yBottom + pad, 10000) - Math.max(0, wordBox.yTop - pad);
      if (width < 5 || height < 5) continue;
      words.push({
        text: allTexts[cropIdx],
        xLeft: wordBox.xLeft,
        xRight: wordBox.xRight,
        confidence: undefined,
      });
      cropIdx++;
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
  preDetectedBoxes?: PreDetectedLine[],
): Promise<{ rawText: string; lines: OCRLineResult[] }> {
  let result: { rawText: string; lines: OCRLineResult[] };

  if (method === "doctr") {
    // In-house: DocTR bounding boxes + TrOCR text recognition
    result = await ocrWithDocTR(imageBuffer, preDetectedBoxes);
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

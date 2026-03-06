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

// ─── Main OCR Pipeline ──────────────────────────────────

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  profileId?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  firstLineHint?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fewShotLines?: FewShotLine[],
): Promise<{ rawText: string; lines: OCRLineResult[] }> {
  // Azure Document Intelligence: word-level bounding boxes + Hebrew text in one call
  const result = await ocrWithAzure(imageBuffer);

  // Track usage (Azure free tier: 500 pages/month, then $1/1000 pages)
  await prisma.tokenUsage.create({
    data: {
      userId,
      fileId,
      model: "azure-doc-intelligence",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0.1, // ~$1/1000 pages
    },
  });

  return result;
}

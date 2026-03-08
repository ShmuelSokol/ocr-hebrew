import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

export async function POST(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { parts = 2 } = await req.json().catch(() => ({ parts: 2 }));

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { words: { orderBy: { wordIndex: "asc" } }, result: { include: { file: true } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (word.xLeft == null || word.xRight == null) {
    return NextResponse.json({ error: "Word has no bounding box" }, { status: 400 });
  }

  const yTop = word.yTop ?? word.line.yTop;
  const yBottom = word.yBottom ?? word.line.yBottom;
  const wordText = word.correctedText || word.rawText;

  // Try DocTR smart detection to find sub-word boundaries
  let splitXs: number[] = [];
  try {
    const sharp = (await import("sharp")).default;
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(word.line.result.file.storagePath);
    if (!error && blob) {
      const imageBuffer = Buffer.from(await blob.arrayBuffer());
      const pad = 5;
      const cropLeft = Math.max(0, word.xLeft - pad);
      const cropTop = Math.max(0, yTop - pad);
      const metadata = await sharp(imageBuffer).metadata();
      const cropRight = Math.min(metadata.width || 10000, word.xRight + pad);
      const cropBottom = Math.min(metadata.height || 10000, yBottom + pad);
      const cropW = cropRight - cropLeft;
      const cropH = cropBottom - cropTop;

      if (cropW > 10 && cropH > 10) {
        const cropBuffer = await sharp(imageBuffer)
          .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
          .jpeg({ quality: 90 })
          .toBuffer();

        const formData = new FormData();
        formData.append("image", new Blob([new Uint8Array(cropBuffer)], { type: "image/jpeg" }), "word.jpg");

        const detectRes = await fetch(`${TROCR_SERVER}/detect`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(15000),
        });

        if (detectRes.ok) {
          const detection = await detectRes.json();
          // Collect all detected word boxes, convert from crop-relative to absolute coords
          const detectedBoxes: { xLeft: number; xRight: number }[] = [];
          for (const line of detection.lines || []) {
            for (const wb of line.words || []) {
              detectedBoxes.push({
                xLeft: cropLeft + wb.xLeft,
                xRight: cropLeft + wb.xRight,
              });
            }
          }
          // Sort right-to-left (Hebrew RTL)
          detectedBoxes.sort((a, b) => b.xLeft - a.xLeft);

          if (detectedBoxes.length >= parts) {
            // Use the gaps between detected boxes as split points
            // Take the (parts-1) largest gaps between adjacent boxes
            const gaps: { x: number; gap: number }[] = [];
            for (let i = 0; i < detectedBoxes.length - 1; i++) {
              // In RTL sorted order, box[i] is to the right of box[i+1]
              const gapX = Math.round((detectedBoxes[i].xLeft + detectedBoxes[i + 1].xRight) / 2);
              const gapSize = detectedBoxes[i].xLeft - detectedBoxes[i + 1].xRight;
              gaps.push({ x: gapX, gap: gapSize });
            }
            // Sort by gap size descending, take top (parts-1)
            gaps.sort((a, b) => b.gap - a.gap);
            splitXs = gaps.slice(0, parts - 1).map(g => g.x).sort((a, b) => b - a); // sort right-to-left
          }
        }
      }
    }
  } catch {
    // DocTR failed — fall back to even splits
  }

  // Fallback: even splits if DocTR didn't find enough
  if (splitXs.length !== parts - 1) {
    splitXs = [];
    const step = (word.xRight - word.xLeft) / parts;
    for (let i = 1; i < parts; i++) {
      splitXs.push(Math.round(word.xRight - step * i)); // right-to-left
    }
    splitXs.sort((a, b) => b - a); // right-to-left
  }

  // Validate split points
  splitXs = splitXs.filter(x => x > word.xLeft! + 3 && x < word.xRight! - 3);
  if (splitXs.length === 0) {
    return NextResponse.json({ error: "Could not find valid split points" }, { status: 400 });
  }

  // Shift later words to make room
  const slotsNeeded = splitXs.length; // number of new words minus the original
  const laterWords = word.line.words.filter(w => w.wordIndex > word.wordIndex);
  for (const w of laterWords) {
    await prisma.oCRWord.update({
      where: { id: w.id },
      data: { wordIndex: w.wordIndex + slotsNeeded },
    });
  }

  const origLeft = word.originalXLeft ?? word.xLeft;
  const origRight = word.originalXRight ?? word.xRight;

  // Build edge list: [rightEdge, split1, split2, ..., leftEdge]
  const edges = [word.xRight, ...splitXs, word.xLeft];

  // Create new words (right-to-left = RTL reading order)
  const newWords = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const newWord = await prisma.oCRWord.create({
      data: {
        lineId: word.lineId,
        wordIndex: word.wordIndex + i,
        rawText: wordText,
        correctedText: wordText,
        xLeft: edges[i + 1],
        xRight: edges[i],
        yTop: word.yTop,
        yBottom: word.yBottom,
        originalXLeft: origLeft,
        originalXRight: origRight,
      },
    });
    newWords.push(newWord);
  }

  // Delete original word
  await prisma.oCRWord.delete({ where: { id: word.id } });

  return NextResponse.json({ success: true, words: newWords, usedDocTR: splitXs.length === parts - 1 });
}

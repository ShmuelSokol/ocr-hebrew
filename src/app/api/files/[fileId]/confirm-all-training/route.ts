import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

/**
 * Batch-create training examples for ALL words with bounding boxes in a file.
 * Downloads the image once, crops all words, skips any that already have training examples.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const file = await prisma.file.findFirst({
    where: { id: params.fileId, userId },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!file.profileId) return NextResponse.json({ error: "No profile assigned" }, { status: 400 });

  // Get all words with bounding boxes
  const result = await prisma.oCRResult.findUnique({
    where: { fileId: file.id },
    include: { lines: { include: { words: true } } },
  });
  if (!result) return NextResponse.json({ error: "No OCR result" }, { status: 404 });

  const allWords = result.lines.flatMap(l =>
    l.words
      .filter(w => w.xLeft != null && w.xRight != null)
      .map(w => ({ ...w, lineYTop: l.yTop, lineYBottom: l.yBottom }))
  );

  if (allWords.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0 });
  }

  // Find which words already have training examples
  const wordIds = allWords.map(w => w.id);
  const existing = await prisma.trainingExample.findMany({
    where: { sourceLineId: { in: wordIds } },
    select: { sourceLineId: true },
  });
  const existingIds = new Set(existing.map(e => e.sourceLineId));

  const wordsToProcess = allWords.filter(w => !existingIds.has(w.id));
  if (wordsToProcess.length === 0) {
    return NextResponse.json({ created: 0, skipped: allWords.length });
  }

  // Download image once
  const sharp = (await import("sharp")).default;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) {
    return NextResponse.json({ error: "Could not read image" }, { status: 500 });
  }

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgHeight = metadata.height || 1;
  const imgWidth = metadata.width || 1;

  let created = 0;
  const profileId = file.profileId;

  // Process words in batches of 20 to avoid memory issues
  for (let i = 0; i < wordsToProcess.length; i += 20) {
    const batch = wordsToProcess.slice(i, i + 20);
    await Promise.all(batch.map(async (word) => {
      const text = (word.correctedText || word.rawText || "").trim();
      if (!text) return;

      const padX = Math.floor(((word.xRight ?? 0) - (word.xLeft ?? 0)) * 0.1);
      const padY = Math.floor((word.lineYBottom - word.lineYTop) * 0.15);
      const left = Math.max(0, (word.xLeft ?? 0) - padX);
      const top = Math.max(0, word.lineYTop - padY);
      const right = Math.min(imgWidth, (word.xRight ?? 0) + padX);
      const bottom = Math.min(imgHeight, word.lineYBottom + padY);
      const cropW = right - left;
      const cropH = bottom - top;
      if (cropW < 5 || cropH < 5) return;

      try {
        const cropBuffer = await sharp(imageBuffer)
          .extract({ left, top, width: cropW, height: cropH })
          .jpeg({ quality: 90 })
          .toBuffer();

        const storagePath = `training/${userId}/${profileId}/${Date.now()}_w${word.wordIndex}_${i}.jpg`;
        const { error: upError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, cropBuffer, { contentType: "image/jpeg", upsert: false });

        if (upError) return;

        await prisma.trainingExample.create({
          data: {
            profileId,
            storagePath,
            text,
            source: "confirmed",
            sourceLineId: word.id,
          },
        });
        created++;
      } catch {
        // Skip individual word failures
      }
    }));
  }

  return NextResponse.json({ created, skipped: existingIds.size });
}

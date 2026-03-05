import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { correctedText } = await req.json();

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { result: { include: { file: true } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update the word
  await prisma.oCRWord.update({
    where: { id: params.wordId },
    data: { correctedText },
  });

  // Update line corrected text
  const lineWords = await prisma.oCRWord.findMany({
    where: { lineId: word.lineId },
    orderBy: { wordIndex: "asc" },
  });
  const lineCorrected = lineWords
    .map((w) => (w.id === params.wordId ? correctedText : w.correctedText || w.rawText))
    .join(" ");
  await prisma.oCRLine.update({
    where: { id: word.lineId },
    data: { correctedText: lineCorrected },
  });

  // Auto-save word crop as training example (background, non-blocking)
  // This links the correction to the actual handwriting image of this specific word
  const file = word.line.result.file;
  if (file.profileId && word.xLeft != null && word.xRight != null) {
    saveWordTraining(userId, file, word.line, word, correctedText).catch(() => {});
  }

  return NextResponse.json({ success: true });
}

// Save a word-level crop as training data (word handwriting image + corrected text)
async function saveWordTraining(
  userId: string,
  file: { id: string; storagePath: string; profileId: string | null },
  line: { id: string; lineIndex: number; yTop: number; yBottom: number },
  word: { id: string; wordIndex: number; xLeft: number | null; xRight: number | null },
  text: string,
) {
  if (!file.profileId || !text.trim() || word.xLeft == null || word.xRight == null) return;

  // Check if we already have a training example for this word
  const existing = await prisma.trainingExample.findUnique({
    where: { sourceLineId: word.id },
  });

  if (existing) {
    // Update text only — image crop is the same
    await prisma.trainingExample.update({
      where: { id: existing.id },
      data: { text },
    });
    return;
  }

  // Crop the word from the image
  const sharp = (await import("sharp")).default;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) return;

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgHeight = metadata.height || 1;
  const imgWidth = metadata.width || 1;

  // Pad around the word for context
  const padX = Math.floor((word.xRight - word.xLeft) * 0.1);
  const padY = Math.floor((line.yBottom - line.yTop) * 0.15);
  const left = Math.max(0, word.xLeft - padX);
  const top = Math.max(0, line.yTop - padY);
  const right = Math.min(imgWidth, word.xRight + padX);
  const bottom = Math.min(imgHeight, line.yBottom + padY);
  const cropW = right - left;
  const cropH = bottom - top;
  if (cropW < 5 || cropH < 5) return;

  const cropBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();

  const storagePath = `training/${userId}/${file.profileId}/${Date.now()}_w${word.wordIndex}.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, cropBuffer, { contentType: "image/jpeg", upsert: false });
  if (upError) return;

  await prisma.trainingExample.create({
    data: {
      profileId: file.profileId,
      storagePath,
      text,
      sourceLineId: word.id, // using sourceLineId to track word-level too
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: true },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.oCRWord.delete({ where: { id: params.wordId } });

  // Re-index remaining words
  const remaining = await prisma.oCRWord.findMany({
    where: { lineId: word.lineId },
    orderBy: { wordIndex: "asc" },
  });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].wordIndex !== i) {
      await prisma.oCRWord.update({
        where: { id: remaining[i].id },
        data: { wordIndex: i },
      });
    }
  }

  // Update line text
  const lineCorrected = remaining.map((w) => w.correctedText || w.rawText).join(" ");
  await prisma.oCRLine.update({
    where: { id: word.lineId },
    data: {
      correctedText: lineCorrected,
      rawText: remaining.map((w) => w.rawText).join(" "),
    },
  });

  return NextResponse.json({ success: true });
}

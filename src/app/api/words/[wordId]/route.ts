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

  const { correctedText, xLeft, xRight, yTop, yBottom } = await req.json();

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { result: { include: { file: true } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build update data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (correctedText !== undefined) updateData.correctedText = correctedText;

  // Bounding box correction (horizontal)
  if (xLeft !== undefined || xRight !== undefined) {
    if (word.originalXLeft == null && word.xLeft != null) {
      updateData.originalXLeft = word.xLeft;
    }
    if (word.originalXRight == null && word.xRight != null) {
      updateData.originalXRight = word.xRight;
    }
    if (xLeft !== undefined) updateData.xLeft = xLeft;
    if (xRight !== undefined) updateData.xRight = xRight;
  }

  // Bounding box correction (vertical)
  if (yTop !== undefined || yBottom !== undefined) {
    if (word.originalYTop == null) {
      updateData.originalYTop = word.yTop ?? word.line.yTop;
    }
    if (word.originalYBottom == null) {
      updateData.originalYBottom = word.yBottom ?? word.line.yBottom;
    }
    if (yTop !== undefined) updateData.yTop = yTop;
    if (yBottom !== undefined) updateData.yBottom = yBottom;
  }

  // Update the word
  await prisma.oCRWord.update({
    where: { id: params.wordId },
    data: updateData,
  });

  // Update line corrected text (only if text was changed)
  if (correctedText !== undefined) {
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
  }

  // Auto-save word crop as training example (background, non-blocking)
  // Use the latest bounds (possibly corrected) for the crop
  const file = word.line.result.file;
  const finalXLeft = xLeft ?? word.xLeft;
  const finalXRight = xRight ?? word.xRight;
  const finalYTop = yTop ?? word.yTop;
  const finalYBottom = yBottom ?? word.yBottom;
  const finalText = correctedText ?? word.correctedText ?? word.rawText;
  if (file.profileId && finalXLeft != null && finalXRight != null) {
    saveWordTraining(userId, file, word.line, { ...word, xLeft: finalXLeft, xRight: finalXRight, yTop: finalYTop, yBottom: finalYBottom }, finalText).catch(() => {});
  }

  return NextResponse.json({ success: true });
}

// Save a word-level crop as training data (word handwriting image + corrected text)
async function saveWordTraining(
  userId: string,
  file: { id: string; storagePath: string; profileId: string | null },
  line: { id: string; lineIndex: number; yTop: number; yBottom: number },
  word: { id: string; wordIndex: number; xLeft: number | null; xRight: number | null; yTop?: number | null; yBottom?: number | null },
  text: string,
) {
  if (!file.profileId || word.xLeft == null || word.xRight == null) return;

  const isNegative = !text.trim();

  // For positive examples, check if we already have one for this word
  if (!isNegative) {
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
  const cropYTop = word.yTop ?? line.yTop;
  const cropYBottom = word.yBottom ?? line.yBottom;
  const padX = Math.floor((word.xRight - word.xLeft) * 0.1);
  const padY = Math.floor((cropYBottom - cropYTop) * 0.15);
  const left = Math.max(0, word.xLeft - padX);
  const top = Math.max(0, cropYTop - padY);
  const right = Math.min(imgWidth, word.xRight + padX);
  const bottom = Math.min(imgHeight, cropYBottom + padY);
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
      source: isNegative ? "deleted" : "corrected",
      // Don't link negative examples to the word ID (word will be deleted)
      sourceLineId: isNegative ? undefined : word.id,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { result: { include: { file: true } } } } },
  });
  if (!word || word.xLeft == null || word.xRight == null)
    return NextResponse.json({ error: "Not found or no bounds" }, { status: 404 });

  const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "https://trocr.ksavyad.com";

  // Download image and crop the word
  const sharp = (await import("sharp")).default;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(word.line.result.file.storagePath);
  if (error || !blob) return NextResponse.json({ error: "Image download failed" }, { status: 500 });

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgH = metadata.height || 1;
  const imgW = metadata.width || 1;

  const yTop = word.yTop ?? word.line.yTop;
  const yBottom = word.yBottom ?? word.line.yBottom;
  const padX = Math.floor((word.xRight - word.xLeft) * 0.1);
  const padY = Math.floor((yBottom - yTop) * 0.15);
  const left = Math.max(0, word.xLeft - padX);
  const top = Math.max(0, yTop - padY);
  const right = Math.min(imgW, word.xRight + padX);
  const bottom = Math.min(imgH, yBottom + padY);

  const cropBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Send to TrOCR
  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(cropBuffer)], { type: "image/jpeg" }), "word.jpg");

  try {
    const res = await fetch(`${TROCR_SERVER}/predict`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return NextResponse.json({ error: "TrOCR failed" }, { status: 502 });

    const data = await res.json();
    const text = data.text || "";

    // Update word with new TrOCR text
    await prisma.oCRWord.update({
      where: { id: params.wordId },
      data: { modelText: text, rawText: text, correctedText: null },
    });

    return NextResponse.json({ success: true, text });
  } catch {
    return NextResponse.json({ error: "TrOCR server unavailable" }, { status: 502 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { result: { include: { file: true } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Save as negative training example (empty text) before deleting
  // This teaches the detector to avoid false positives on blank regions
  const file = word.line.result.file;
  if (file.profileId && word.xLeft != null && word.xRight != null) {
    saveWordTraining(userId, file, word.line, word, "").catch(() => {});
  }

  // Delete any existing positive training example for this word
  await prisma.trainingExample.deleteMany({ where: { sourceLineId: params.wordId } });

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

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function POST(
  _req: NextRequest,
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

  const file = word.line.result.file;
  if (!file.profileId || word.xLeft == null || word.xRight == null) {
    return NextResponse.json({ error: "No profile or no bounding box" }, { status: 400 });
  }

  const text = word.rawText;
  if (!text.trim()) {
    return NextResponse.json({ error: "Empty word text" }, { status: 400 });
  }

  // Check if already saved
  const existing = await prisma.trainingExample.findUnique({
    where: { sourceLineId: word.id },
  });
  if (existing) {
    return NextResponse.json({ success: true, alreadySaved: true });
  }

  // Crop the word from the image
  const sharp = (await import("sharp")).default;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) {
    return NextResponse.json({ error: "Could not read image" }, { status: 500 });
  }

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgHeight = metadata.height || 1;
  const imgWidth = metadata.width || 1;

  const padX = Math.floor((word.xRight - word.xLeft) * 0.1);
  const padY = Math.floor((word.line.yBottom - word.line.yTop) * 0.15);
  const left = Math.max(0, word.xLeft - padX);
  const top = Math.max(0, word.line.yTop - padY);
  const right = Math.min(imgWidth, word.xRight + padX);
  const bottom = Math.min(imgHeight, word.line.yBottom + padY);
  const cropW = right - left;
  const cropH = bottom - top;
  if (cropW < 5 || cropH < 5) {
    return NextResponse.json({ error: "Crop too small" }, { status: 400 });
  }

  const cropBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();

  const storagePath = `training/${userId}/${file.profileId}/${Date.now()}_w${word.wordIndex}.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, cropBuffer, { contentType: "image/jpeg", upsert: false });

  if (upError) {
    return NextResponse.json({ error: "Upload failed: " + upError.message }, { status: 500 });
  }

  await prisma.trainingExample.create({
    data: {
      profileId: file.profileId,
      storagePath,
      text,
      source: "confirmed",
      sourceLineId: word.id,
    },
  });

  return NextResponse.json({ success: true });
}

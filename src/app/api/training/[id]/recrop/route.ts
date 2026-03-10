import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const example = await prisma.trainingExample.findUnique({
    where: { id: params.id },
    include: { profile: true },
  });
  if (!example || example.profile.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!example.sourceLineId) {
    return NextResponse.json({ error: "No source word — cannot recrop" }, { status: 400 });
  }

  const body = await req.json();
  const { xLeft, xRight, yTop, yBottom } = body;
  if (xLeft == null || xRight == null || yTop == null || yBottom == null) {
    return NextResponse.json({ error: "xLeft, xRight, yTop, yBottom required" }, { status: 400 });
  }

  // Get source file
  const word = await prisma.oCRWord.findUnique({
    where: { id: example.sourceLineId },
    include: { line: { include: { result: { include: { file: true } } } } },
  });
  if (!word) {
    return NextResponse.json({ error: "Source word deleted" }, { status: 404 });
  }

  const file = word.line.result.file;

  // Download source image
  const sharp = (await import("sharp")).default;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) {
    return NextResponse.json({ error: "Could not read source image" }, { status: 500 });
  }

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgH = metadata.height || 1;
  const imgW = metadata.width || 1;

  // Apply padding (10% x, 15% y)
  const padX = Math.floor((xRight - xLeft) * 0.1);
  const padY = Math.floor((yBottom - yTop) * 0.15);
  const left = Math.max(0, xLeft - padX);
  const top = Math.max(0, yTop - padY);
  const right = Math.min(imgW, xRight + padX);
  const bottom = Math.min(imgH, yBottom + padY);
  const cropW = right - left;
  const cropH = bottom - top;

  if (cropW < 5 || cropH < 5) {
    return NextResponse.json({ error: "Crop too small" }, { status: 400 });
  }

  const cropBuffer = await sharp(imageBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Delete old image, upload new
  await supabase.storage.from(BUCKET).remove([example.storagePath]);
  const newPath = `training/${userId}/${example.profileId}/${Date.now()}_recrop.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, cropBuffer, { contentType: "image/jpeg", upsert: false });
  if (upError) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Update storage path and word bounding box
  await prisma.trainingExample.update({
    where: { id: params.id },
    data: { storagePath: newPath },
  });

  // Also update the OCRWord bounding box
  await prisma.oCRWord.update({
    where: { id: example.sourceLineId },
    data: { xLeft, xRight, yTop, yBottom },
  });

  return NextResponse.json({ success: true });
}

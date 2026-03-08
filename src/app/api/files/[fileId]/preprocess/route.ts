import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";
import sharp from "sharp";
import { detectSkew } from "@/lib/ocr";

export async function POST(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({
    where: { id: params.fileId, userId },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { contrast, brightness, sharpen: doSharpen, grayscale, rotate, deskew } = await req.json();

  // Download from Supabase
  const { data: blob, error } = await supabase.storage
    .from(BUCKET)
    .download(file.storagePath);

  if (error || !blob) {
    return NextResponse.json({ error: "Could not read file from storage" }, { status: 500 });
  }

  const imageData = Buffer.from(await blob.arrayBuffer());

  // Auto-detect skew angle if deskew requested
  let rotateAngle = rotate || 0;
  let detectedAngle = 0;
  if (deskew) {
    detectedAngle = await detectSkew(imageData);
    rotateAngle = -detectedAngle; // negate to correct
  }

  let pipeline = sharp(imageData);

  if (rotateAngle !== 0) {
    pipeline = pipeline.rotate(rotateAngle, { background: "#ffffff" });
  }

  if (grayscale) {
    pipeline = pipeline.greyscale();
  }

  const a = contrast != null ? contrast : 1.0;
  const b = brightness != null ? brightness : 0;
  if (a !== 1.0 || b !== 0) {
    pipeline = pipeline.linear(a, b);
  }

  if (doSharpen) {
    pipeline = pipeline.sharpen();
  }

  pipeline = pipeline.normalize();

  const processed = await pipeline.jpeg({ quality: 95 }).toBuffer();

  // Upload processed image back — use a stable processed path
  const newPath = file.storagePath.replace(/_processed(?=\.[^.]+$)/, "").replace(/(\.[^.]+)$/, "_processed$1");
  await supabase.storage.from(BUCKET).upload(newPath, processed, {
    contentType: "image/jpeg",
    upsert: true,
  });

  // Update file record (preserve original on first preprocess)
  await prisma.file.update({
    where: { id: file.id },
    data: {
      storagePath: newPath,
      ...(file.originalStoragePath ? {} : { originalStoragePath: file.storagePath }),
    },
  });

  return NextResponse.json({
    success: true,
    size: processed.length,
    skewAngle: detectedAngle,
  });
}

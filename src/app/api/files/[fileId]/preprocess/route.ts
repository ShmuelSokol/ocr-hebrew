import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readFile, writeFile } from "fs/promises";
import sharp from "sharp";

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

  const { contrast, brightness, sharpen, grayscale, rotate } = await req.json();

  const imageData = await readFile(file.storagePath);
  let pipeline = sharp(imageData);

  // Auto-rotate based on EXIF
  pipeline = pipeline.rotate(rotate || 0);

  if (grayscale) {
    pipeline = pipeline.greyscale();
  }

  // Adjust contrast and brightness using linear transform
  // linear(a, b) applies: output = a * input + b
  const a = contrast != null ? contrast : 1.0; // 1.0 = no change, >1 = more contrast
  const b = brightness != null ? brightness : 0; // 0 = no change, >0 = brighter
  if (a !== 1.0 || b !== 0) {
    pipeline = pipeline.linear(a, b);
  }

  if (sharpen) {
    pipeline = pipeline.sharpen();
  }

  // Normalize (auto-contrast)
  pipeline = pipeline.normalize();

  const processed = await pipeline.jpeg({ quality: 95 }).toBuffer();

  // Save as new file path
  const newPath = file.storagePath.replace(/(\.[^.]+)$/, "_processed$1");
  await writeFile(newPath, processed);

  // Update file record
  await prisma.file.update({
    where: { id: file.id },
    data: { storagePath: newPath },
  });

  return NextResponse.json({ success: true, size: processed.length });
}

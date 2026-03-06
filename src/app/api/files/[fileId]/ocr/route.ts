import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runOCR } from "@/lib/ocr";
import { supabase, BUCKET } from "@/lib/supabase";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({
    where: { id: params.fileId, userId },
    include: { profile: true },
  });

  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { firstLineHint, fewShotLines } = await req.json().catch(() => ({}));

  // Download image from Supabase Storage
  const { data: blob, error } = await supabase.storage
    .from(BUCKET)
    .download(file.storagePath);

  if (error || !blob) {
    return NextResponse.json({ error: "Could not read file from storage" }, { status: 500 });
  }

  const imageData = Buffer.from(await blob.arrayBuffer());
  const base64 = imageData.toString("base64");
  const ext = path.extname(file.filename).toLowerCase();
  const mediaType =
    ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";

  // Update status
  await prisma.file.update({ where: { id: file.id }, data: { status: "processing" } });

  try {
    const result = await runOCR(base64, mediaType, imageData, userId, file.id, file.profileId || undefined, firstLineHint, fewShotLines);

    // Delete old result if exists
    const oldResult = await prisma.oCRResult.findUnique({ where: { fileId: file.id } });
    if (oldResult) {
      await prisma.oCRWord.deleteMany({ where: { line: { resultId: oldResult.id } } });
      await prisma.oCRLine.deleteMany({ where: { resultId: oldResult.id } });
      await prisma.oCRResult.delete({ where: { id: oldResult.id } });
    }

    // Save result
    const ocrResult = await prisma.oCRResult.create({
      data: {
        fileId: file.id,
        rawText: result.rawText,
        lines: {
          create: result.lines.map((line) => ({
            lineIndex: line.lineIndex,
            yTop: line.yTop,
            yBottom: line.yBottom,
            rawText: line.text,
            words: {
              create: line.words.map((word, wi) => ({
                wordIndex: wi,
                rawText: word.text,
                xLeft: word.xLeft,
                xRight: word.xRight,
                confidence: word.confidence ?? null,
              })),
            },
          })),
        },
      },
    });

    await prisma.file.update({ where: { id: file.id }, data: { status: "completed" } });

    return NextResponse.json({ ocrResult, rawText: result.rawText });
  } catch (error) {
    await prisma.file.update({ where: { id: file.id }, data: { status: "pending" } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OCR failed" },
      { status: 500 }
    );
  }
}

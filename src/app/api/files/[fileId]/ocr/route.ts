import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runOCR } from "@/lib/ocr";
import type { OCRMethod } from "@/lib/ocr";
import { supabase, BUCKET } from "@/lib/supabase";
import path from "path";

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

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

  const { firstLineHint, fewShotLines, method: requestedMethod } = await req.json().catch(() => ({}));
  const method: OCRMethod = requestedMethod === "doctr" ? "doctr" : "azure";

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
    const result = await runOCR(base64, mediaType, imageData, userId, file.id, file.profileId || undefined, firstLineHint, fewShotLines, method);

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

    if (method === "azure") {
      // Run TrOCR in background for Azure results — silently skip if server is down
      runTrOCR(file.storagePath, ocrResult.id).catch(() => {});
    }
    // For DocTR method, TrOCR text is already in rawText (the pipeline does detect + recognize)

    return NextResponse.json({ ocrResult, rawText: result.rawText });
  } catch (error) {
    await prisma.file.update({ where: { id: file.id }, data: { status: "pending" } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OCR failed" },
      { status: 500 }
    );
  }
}

async function runTrOCR(storagePath: string, ocrResultId: string) {
  // Check if TrOCR server is available — bail silently if not
  try {
    const health = await fetch(`${TROCR_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) return;
  } catch {
    return; // Server down (training running, Mac off, etc.) — skip silently
  }

  const ocrResult = await prisma.oCRResult.findUnique({
    where: { id: ocrResultId },
    include: { lines: { include: { words: { orderBy: { wordIndex: "asc" } } }, orderBy: { lineIndex: "asc" } } },
  });
  if (!ocrResult) return;

  const { data: blob, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !blob) return;

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const sharp = (await import("sharp")).default;

  for (const line of ocrResult.lines) {
    for (const word of line.words) {
      if (word.xLeft == null || word.xRight == null) continue;

      const pad = 3;
      const left = Math.max(0, word.xLeft - pad);
      const top = Math.max(0, line.yTop - pad);
      const width = Math.min(word.xRight + pad, 10000) - left;
      const height = Math.min(line.yBottom + pad, 10000) - top;
      if (width < 5 || height < 5) continue;

      try {
        const cropBuffer = await sharp(imageBuffer)
          .extract({ left, top, width, height })
          .jpeg({ quality: 90 })
          .toBuffer();

        const formData = new FormData();
        formData.append("image", new Blob([new Uint8Array(cropBuffer)], { type: "image/jpeg" }), "word.jpg");

        const res = await fetch(`${TROCR_SERVER}/predict`, {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const result = await res.json();
          await prisma.oCRWord.update({
            where: { id: word.id },
            data: { modelText: result.text || null },
          });
        }
      } catch {
        // Skip individual word failures
      }
    }
  }
}

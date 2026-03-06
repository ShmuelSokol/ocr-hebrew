import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

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
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check TrOCR server is up
  try {
    const health = await fetch(`${TROCR_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not ok");
  } catch {
    return NextResponse.json({ error: "TrOCR server not available. Run: cd training && python serve.py" }, { status: 503 });
  }

  // Get OCR result with lines and words
  const ocrResult = await prisma.oCRResult.findUnique({
    where: { fileId: file.id },
    include: { lines: { include: { words: { orderBy: { wordIndex: "asc" } } }, orderBy: { lineIndex: "asc" } } },
  });
  if (!ocrResult) return NextResponse.json({ error: "No OCR result. Run Azure OCR first." }, { status: 400 });

  // Download the source image
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) return NextResponse.json({ error: "Could not read file" }, { status: 500 });

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const sharp = (await import("sharp")).default;

  let processed = 0;
  let failed = 0;

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
        // Crop the word from the image
        const cropBuffer = await sharp(imageBuffer)
          .extract({ left, top, width, height })
          .jpeg({ quality: 90 })
          .toBuffer();

        // Send to TrOCR server
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
          processed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  return NextResponse.json({ processed, failed, total: processed + failed });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
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

  const result = await prisma.oCRResult.findUnique({
    where: { fileId: file.id },
    include: {
      lines: {
        include: { words: { orderBy: { wordIndex: "asc" } } },
        orderBy: { lineIndex: "asc" },
      },
    },
  });

  if (!result) return NextResponse.json({ error: "No OCR result" }, { status: 404 });

  const format = req.nextUrl.searchParams.get("format") || "txt";

  // Use corrected text if available, otherwise raw
  const text = result.lines
    .map((line) => line.correctedText || line.rawText)
    .join("\n");

  if (format === "json") {
    return NextResponse.json({
      filename: file.filename,
      lines: result.lines.map((line) => ({
        lineIndex: line.lineIndex,
        text: line.correctedText || line.rawText,
        words: line.words.map((w) => ({
          original: w.rawText,
          corrected: w.correctedText,
          final: w.correctedText || w.rawText,
        })),
      })),
    });
  }

  // Plain text
  const baseName = file.filename.replace(/\.[^.]+$/, "");
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}_ocr.txt"`,
    },
  });
}

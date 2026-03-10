import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text, afterWordIndex, xLeft, xRight, yTop, yBottom } = await req.json();
  if (!text?.trim()) return NextResponse.json({ error: "Text required" }, { status: 400 });

  const line = await prisma.oCRLine.findUnique({
    where: { id: params.lineId },
    include: { words: { orderBy: { wordIndex: "asc" } } },
  });

  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const insertAt = afterWordIndex != null ? afterWordIndex + 1 : line.words.length;

  // Shift words at and after insertAt
  for (const w of line.words) {
    if (w.wordIndex >= insertAt) {
      await prisma.oCRWord.update({
        where: { id: w.id },
        data: { wordIndex: w.wordIndex + 1 },
      });
    }
  }

  // Create the new word (with optional bounding box)
  const newWord = await prisma.oCRWord.create({
    data: {
      lineId: params.lineId,
      wordIndex: insertAt,
      rawText: text.trim(),
      correctedText: text.trim(),
      ...(xLeft != null && xRight != null && yTop != null && yBottom != null
        ? { xLeft: Math.round(xLeft), xRight: Math.round(xRight), yTop: Math.round(yTop), yBottom: Math.round(yBottom) }
        : {}),
    },
  });

  // Update line text
  const updatedWords = await prisma.oCRWord.findMany({
    where: { lineId: params.lineId },
    orderBy: { wordIndex: "asc" },
  });
  const lineCorrected = updatedWords.map((w) => w.correctedText || w.rawText).join(" ");
  await prisma.oCRLine.update({
    where: { id: params.lineId },
    data: { correctedText: lineCorrected },
  });

  return NextResponse.json({ success: true, word: newWord });
}

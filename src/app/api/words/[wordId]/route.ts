import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { correctedText } = await req.json();

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: true },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update the word
  await prisma.oCRWord.update({
    where: { id: params.wordId },
    data: { correctedText },
  });

  // Update line corrected text
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

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: true },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

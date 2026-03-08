import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: { wordId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { splitX } = await req.json().catch(() => ({}));

  const word = await prisma.oCRWord.findUnique({
    where: { id: params.wordId },
    include: { line: { include: { words: { orderBy: { wordIndex: "asc" } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (word.xLeft == null || word.xRight == null) {
    return NextResponse.json({ error: "Word has no bounding box" }, { status: 400 });
  }

  // Calculate split point — use provided splitX or midpoint
  const mid = splitX ?? Math.round((word.xLeft + word.xRight) / 2);

  if (mid <= word.xLeft || mid >= word.xRight) {
    return NextResponse.json({ error: "Split point out of bounds" }, { status: 400 });
  }

  // Shift all words after this one by +1 to make room
  const laterWords = word.line.words.filter(w => w.wordIndex > word.wordIndex);
  for (const w of laterWords) {
    await prisma.oCRWord.update({
      where: { id: w.id },
      data: { wordIndex: w.wordIndex + 1 },
    });
  }

  // Create right word (in Hebrew RTL, right side = first part)
  const rightWord = await prisma.oCRWord.create({
    data: {
      lineId: word.lineId,
      wordIndex: word.wordIndex,
      rawText: "",
      correctedText: "",
      xLeft: mid,
      xRight: word.xRight,
    },
  });

  // Create left word (second part in RTL reading order)
  const leftWord = await prisma.oCRWord.create({
    data: {
      lineId: word.lineId,
      wordIndex: word.wordIndex + 1,
      rawText: "",
      correctedText: "",
      xLeft: word.xLeft,
      xRight: mid,
    },
  });

  // Delete original word
  await prisma.oCRWord.delete({ where: { id: word.id } });

  return NextResponse.json({ success: true, rightWord, leftWord });
}

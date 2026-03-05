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
    include: { line: { include: { result: { include: { file: true } } } } },
  });

  if (!word) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update the word
  await prisma.oCRWord.update({
    where: { id: params.wordId },
    data: { correctedText },
  });

  // Save to profile for learning — allow multiple examples of the same word
  // Only skip exact duplicates (same original + same corrected)
  const file = word.line.result.file;
  if (file.profileId) {
    const exactDuplicate = await prisma.correction.findFirst({
      where: {
        profileId: file.profileId,
        originalText: word.rawText,
        correctedText,
      },
    });
    if (!exactDuplicate) {
      await prisma.correction.create({
        data: {
          profileId: file.profileId,
          originalText: word.rawText,
          correctedText,
        },
      });
    }
  }

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

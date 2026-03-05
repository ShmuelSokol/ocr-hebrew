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

  const line = await prisma.oCRLine.findUnique({
    where: { id: params.lineId },
    include: {
      words: { orderBy: { wordIndex: "asc" } },
      result: { include: { file: true } },
    },
  });

  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const profileId = line.result.file.profileId;
  if (!profileId) return NextResponse.json({ error: "No profile" }, { status: 400 });

  // For each word that hasn't been confirmed yet, save it as a confirmed reading
  for (const word of line.words) {
    if (word.correctedText) continue; // already handled

    const finalText = word.rawText;

    // Mark word as confirmed (correctedText = rawText means confirmed correct)
    await prisma.oCRWord.update({
      where: { id: word.id },
      data: { correctedText: finalText },
    });

    // Save to profile — skip only exact duplicates
    const exactDuplicate = await prisma.correction.findFirst({
      where: { profileId, originalText: finalText, correctedText: finalText },
    });
    if (!exactDuplicate) {
      await prisma.correction.create({
        data: {
          profileId,
          originalText: finalText,
          correctedText: finalText,
        },
      });
    }
  }

  // Update line corrected text
  const updatedWords = await prisma.oCRWord.findMany({
    where: { lineId: line.id },
    orderBy: { wordIndex: "asc" },
  });
  const lineCorrected = updatedWords.map((w) => w.correctedText || w.rawText).join(" ");
  await prisma.oCRLine.update({
    where: { id: line.id },
    data: { correctedText: lineCorrected },
  });

  return NextResponse.json({ success: true, confirmedCount: line.words.length });
}

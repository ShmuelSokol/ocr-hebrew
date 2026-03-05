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
    include: { words: { orderBy: { wordIndex: "asc" } } },
  });

  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Batch confirm: set correctedText = rawText for all unconfirmed words
  const unconfirmed = line.words.filter((w) => !w.correctedText);
  if (unconfirmed.length > 0) {
    await prisma.$transaction(
      unconfirmed.map((w) =>
        prisma.oCRWord.update({
          where: { id: w.id },
          data: { correctedText: w.rawText },
        })
      )
    );
  }

  // Update line corrected text
  const lineCorrected = line.words.map((w) => w.correctedText || w.rawText).join(" ");
  await prisma.oCRLine.update({
    where: { id: line.id },
    data: { correctedText: lineCorrected },
  });

  return NextResponse.json({ success: true });
}

// Unconfirm a line — clears correctedText on all words
export async function DELETE(
  req: NextRequest,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const line = await prisma.oCRLine.findUnique({
    where: { id: params.lineId },
    include: { words: true },
  });

  if (!line) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Clear correctedText on all words
  await prisma.oCRWord.updateMany({
    where: { lineId: line.id },
    data: { correctedText: null },
  });

  // Clear line corrected text
  await prisma.oCRLine.update({
    where: { id: line.id },
    data: { correctedText: null },
  });

  return NextResponse.json({ success: true });
}

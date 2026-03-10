import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const example = await prisma.trainingExample.findUnique({
    where: { id: params.id },
    include: { profile: true },
  });
  if (!example || example.profile.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!example.sourceLineId) {
    return NextResponse.json({ error: "No source word linked" }, { status: 404 });
  }

  // Walk the chain: OCRWord -> OCRLine -> OCRResult -> File
  const word = await prisma.oCRWord.findUnique({
    where: { id: example.sourceLineId },
    include: {
      line: {
        include: {
          result: {
            include: { file: { select: { id: true, filename: true } } },
          },
        },
      },
    },
  });

  if (!word) {
    return NextResponse.json({ error: "Source word deleted" }, { status: 404 });
  }

  return NextResponse.json({
    fileId: word.line.result.file.id,
    filename: word.line.result.file.filename,
    word: {
      xLeft: word.xLeft,
      xRight: word.xRight,
      yTop: word.yTop ?? word.line.yTop,
      yBottom: word.yBottom ?? word.line.yBottom,
    },
    line: {
      yTop: word.line.yTop,
      yBottom: word.line.yBottom,
    },
  });
}

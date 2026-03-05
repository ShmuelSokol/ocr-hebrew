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

  return NextResponse.json(result);
}

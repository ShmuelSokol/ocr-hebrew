import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackActivity } from "@/lib/activity";

export async function GET(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  trackActivity(userId, `Editing file ${params.fileId}`);
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

  if (!result) return NextResponse.json(null);

  // Find which words already have a saved TrainingExample (i.e. "confirmed correct").
  // We store the word ID in TrainingExample.sourceLineId — sticking with that convention.
  const wordIds = result.lines.flatMap((l) => l.words.map((w) => w.id));
  let confirmedWordIds: string[] = [];
  if (wordIds.length) {
    const examples = await prisma.trainingExample.findMany({
      where: { sourceLineId: { in: wordIds } },
      select: { sourceLineId: true },
    });
    confirmedWordIds = examples
      .map((e) => e.sourceLineId)
      .filter((id): id is string => id !== null);
  }

  // Which engine produced this result? Inferred from the latest TokenUsage row.
  const lastUsage = await prisma.tokenUsage.findFirst({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
    select: { model: true },
  });
  let engineUsed: "doctr" | "azure" | "unknown" = "unknown";
  if (lastUsage?.model === "doctr-trocr") engineUsed = "doctr";
  else if (lastUsage?.model === "azure-doc-intelligence") engineUsed = "azure";

  return NextResponse.json({ ...result, confirmedWordIds, engineUsed });
}

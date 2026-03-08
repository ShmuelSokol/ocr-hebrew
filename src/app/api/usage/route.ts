import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const records = await prisma.tokenUsage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const totalInput = records.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutput = records.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalCostCents = records.reduce((sum, r) => sum + r.costCents, 0);

  // Bbox correction stats
  const bboxCorrected = await prisma.oCRWord.count({
    where: { OR: [{ originalXLeft: { not: null } }, { originalYTop: { not: null } }] },
  });
  const trainingExampleCount = await prisma.trainingExample.count();

  return NextResponse.json({
    totalInput,
    totalOutput,
    totalTokens: totalInput + totalOutput,
    totalCostCents,
    totalCostDollars: (totalCostCents / 100).toFixed(2),
    requestCount: records.length,
    bboxCorrections: bboxCorrected,
    trainingExamples: trainingExampleCount,
    recent: records.slice(0, 10).map((r) => ({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costCents: r.costCents.toFixed(2),
      createdAt: r.createdAt,
    })),
  });
}

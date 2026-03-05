import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { profileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const profile = await prisma.handwritingProfile.findFirst({
    where: { id: params.profileId, userId },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const corrections = await prisma.correction.findMany({
    where: { profileId: params.profileId },
    orderBy: { createdAt: "desc" },
  });

  // Group by originalText for display
  const grouped = new Map<string, { correctedText: string; count: number; ids: string[] }[]>();
  for (const c of corrections) {
    const key = c.originalText;
    if (!grouped.has(key)) grouped.set(key, []);
    const group = grouped.get(key)!;
    const existing = group.find((g) => g.correctedText === c.correctedText);
    if (existing) {
      existing.count++;
      existing.ids.push(c.id);
    } else {
      group.push({ correctedText: c.correctedText, count: 1, ids: [c.id] });
    }
  }

  const result: { originalText: string; corrections: { correctedText: string; count: number; ids: string[] }[] }[] = [];
  grouped.forEach((corrections, originalText) => {
    result.push({ originalText, corrections });
  });

  return NextResponse.json({
    profileName: profile.name,
    totalCorrections: corrections.length,
    uniqueWords: result.length,
    words: result,
  });
}

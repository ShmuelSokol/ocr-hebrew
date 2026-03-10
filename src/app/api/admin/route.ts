import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] || "Kbr613";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      lastSeenAt: true,
      lastAction: true,
      _count: {
        select: {
          files: true,
          profiles: true,
        },
      },
    },
    orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
  });

  // Also get training example counts per user (via profiles)
  const profileIds = await prisma.handwritingProfile.findMany({
    select: { id: true, userId: true },
  });
  const trainingCounts = await prisma.trainingExample.groupBy({
    by: ["profileId"],
    _count: true,
  });
  const trainingByUser: Record<string, number> = {};
  for (const tc of trainingCounts) {
    const profile = profileIds.find(p => p.id === tc.profileId);
    if (profile) {
      trainingByUser[profile.userId] = (trainingByUser[profile.userId] || 0) + tc._count;
    }
  }

  return NextResponse.json({
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      lastAction: u.lastAction,
      fileCount: u._count.files,
      profileCount: u._count.profiles,
      trainingExamples: trainingByUser[u.id] || 0,
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const profiles = await prisma.handwritingProfile.findMany({
    where: { userId },
    include: { _count: { select: { files: true, corrections: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(profiles);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const { name, description } = await req.json();

  const profile = await prisma.handwritingProfile.create({
    data: { name, description, userId },
  });

  return NextResponse.json(profile);
}

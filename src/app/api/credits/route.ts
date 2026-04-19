import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const LETTERS_PER_PAGE = 400;
const LOW_THRESHOLD_LETTERS = 2000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditsBalance: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const letters = user.creditsBalance;
  return NextResponse.json({
    letters,
    approxPages: Math.floor(letters / LETTERS_PER_PAGE),
    low: letters <= LOW_THRESHOLD_LETTERS,
  });
}

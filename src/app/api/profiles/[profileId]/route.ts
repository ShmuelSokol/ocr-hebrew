import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
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

  const { name, description } = await req.json();
  const updated = await prisma.handwritingProfile.update({
    where: { id: params.profileId },
    data: { ...(name && { name }), ...(description !== undefined && { description }) },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
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

  // Delete all corrections for this profile
  await prisma.correction.deleteMany({ where: { profileId: params.profileId } });
  // Unlink files (don't delete them)
  await prisma.file.updateMany({
    where: { profileId: params.profileId },
    data: { profileId: null },
  });
  await prisma.handwritingProfile.delete({ where: { id: params.profileId } });

  return NextResponse.json({ success: true });
}

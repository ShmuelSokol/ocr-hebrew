import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";
import { trackActivity } from "@/lib/activity";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  trackActivity(userId, "Viewed training data");

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "0");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const profileFilter = url.searchParams.get("profileId") || undefined;

  const profiles = await prisma.handwritingProfile.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const profileIds = profiles.map((p) => p.id);

  const where = {
    profileId: profileFilter ? profileFilter : { in: profileIds },
  };

  const total = await prisma.trainingExample.count({ where });

  const examples = await prisma.trainingExample.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { profile: { select: { name: true } } },
    ...(limit > 0 ? { take: limit, skip: offset } : {}),
  });

  return NextResponse.json({
    profiles,
    total,
    examples: examples.map((e) => ({
      id: e.id,
      text: e.text,
      profileId: e.profileId,
      profileName: e.profile.name,
      source: e.source,
      sourceLineId: e.sourceLineId,
      createdAt: e.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const text = formData.get("text") as string | null;
  const profileId = formData.get("profileId") as string | null;

  if (!file || !text?.trim() || !profileId) {
    return NextResponse.json({ error: "image, text, and profileId are required" }, { status: 400 });
  }

  // Verify profile belongs to user
  const profile = await prisma.handwritingProfile.findFirst({
    where: { id: profileId, userId },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // Optionally crop/normalize with sharp
  const sharp = (await import("sharp")).default;
  const processed = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

  const storagePath = `training/${userId}/${profileId}/${Date.now()}_manual.jpg`;
  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, processed, { contentType: "image/jpeg", upsert: false });

  if (upError) {
    return NextResponse.json({ error: "Upload failed: " + upError.message }, { status: 500 });
  }

  const example = await prisma.trainingExample.create({
    data: { profileId, storagePath, text: text.trim() },
  });

  return NextResponse.json({ id: example.id });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const example = await prisma.trainingExample.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!example || example.profile.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from(BUCKET).remove([example.storagePath]);
  await prisma.trainingExample.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { id, text } = await req.json();
  if (!id || !text?.trim()) return NextResponse.json({ error: "id and text required" }, { status: 400 });

  const example = await prisma.trainingExample.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!example || example.profile.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.trainingExample.update({ where: { id }, data: { text: text.trim() } });

  return NextResponse.json({ success: true });
}

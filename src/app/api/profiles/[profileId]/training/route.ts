import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

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

  const examples = await prisma.trainingExample.findMany({
    where: { profileId: params.profileId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ profileName: profile.name, examples });
}

export async function POST(
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

  const { imageBase64, text } = await req.json();
  if (!imageBase64 || !text?.trim()) {
    return NextResponse.json({ error: "imageBase64 and text are required" }, { status: 400 });
  }

  // Upload crop to Supabase Storage
  const buffer = Buffer.from(imageBase64, "base64");
  const storagePath = `training/${userId}/${params.profileId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

  if (error) {
    return NextResponse.json({ error: "Upload failed: " + error.message }, { status: 500 });
  }

  const example = await prisma.trainingExample.create({
    data: {
      profileId: params.profileId,
      storagePath,
      text: text.trim(),
    },
  });

  return NextResponse.json({ success: true, example });
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

  const { exampleId } = await req.json();

  if (exampleId) {
    // Delete single example
    const example = await prisma.trainingExample.findFirst({
      where: { id: exampleId, profileId: params.profileId },
    });
    if (example) {
      await supabase.storage.from(BUCKET).remove([example.storagePath]);
      await prisma.trainingExample.delete({ where: { id: exampleId } });
    }
  } else {
    // Delete all examples for this profile
    const all = await prisma.trainingExample.findMany({
      where: { profileId: params.profileId },
    });
    if (all.length > 0) {
      await supabase.storage.from(BUCKET).remove(all.map((e) => e.storagePath));
      await prisma.trainingExample.deleteMany({ where: { profileId: params.profileId } });
    }
  }

  return NextResponse.json({ success: true });
}

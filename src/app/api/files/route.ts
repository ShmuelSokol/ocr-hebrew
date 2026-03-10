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
  trackActivity(userId, "Viewed dashboard");
  const status = req.nextUrl.searchParams.get("status");

  const files = await prisma.file.findMany({
    where: { userId, ...(status ? { status } : {}) },
    include: { profile: true, project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(files);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const formData = await req.formData();
  const file = formData.get("file") as globalThis.File;
  const profileId = formData.get("profileId") as string | null;
  const projectId = formData.get("projectId") as string | null;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const storagePath = `${userId}/${Date.now()}-${file.name}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "image/jpeg",
    });

  if (error) {
    return NextResponse.json({ error: "Upload failed: " + error.message }, { status: 500 });
  }

  const dbFile = await prisma.file.create({
    data: {
      filename: file.name,
      storagePath,
      userId,
      profileId: profileId || undefined,
      projectId: projectId || undefined,
    },
  });

  return NextResponse.json(dbFile);
}

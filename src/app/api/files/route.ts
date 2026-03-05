import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const status = req.nextUrl.searchParams.get("status");

  const files = await prisma.file.findMany({
    where: { userId, ...(status ? { status } : {}) },
    include: { profile: true },
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

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const uploadsDir = path.join(process.cwd(), "uploads", userId);
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${Date.now()}-${file.name}`;
  const storagePath = path.join(uploadsDir, filename);
  const bytes = await file.arrayBuffer();
  await writeFile(storagePath, Buffer.from(bytes));

  const dbFile = await prisma.file.create({
    data: {
      filename: file.name,
      storagePath,
      userId,
      profileId: profileId || undefined,
    },
  });

  return NextResponse.json(dbFile);
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const profiles = await prisma.handwritingProfile.findMany({
    where: { userId },
    select: { id: true },
  });

  const examples = await prisma.trainingExample.findMany({
    where: { profileId: { in: profiles.map((p) => p.id) } },
    orderBy: { createdAt: "asc" },
    include: { profile: { select: { name: true } } },
  });

  if (examples.length === 0) {
    return NextResponse.json({ error: "No training examples found" }, { status: 404 });
  }

  // Build a zip-like structure: JSON manifest + base64 images
  const items: {
    id: string;
    text: string;
    profileName: string;
    filename: string;
    imageBase64: string;
  }[] = [];

  for (const ex of examples) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(ex.storagePath);

    if (error || !data) continue;

    const buffer = Buffer.from(await data.arrayBuffer());
    items.push({
      id: ex.id,
      text: ex.text,
      profileName: ex.profile.name,
      filename: `${ex.id}.jpg`,
      imageBase64: buffer.toString("base64"),
    });
  }

  return NextResponse.json({
    count: items.length,
    exportedAt: new Date().toISOString(),
    items,
  });
}

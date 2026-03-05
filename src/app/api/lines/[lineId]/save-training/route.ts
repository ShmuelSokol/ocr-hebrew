import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function POST(
  req: NextRequest,
  { params }: { params: { lineId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  // Get line with its file and profile
  const line = await prisma.oCRLine.findUnique({
    where: { id: params.lineId },
    include: {
      words: { orderBy: { wordIndex: "asc" } },
      result: { include: { file: { include: { profile: true } } } },
    },
  });

  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });

  const file = line.result.file;
  if (file.userId !== userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!file.profileId) return NextResponse.json({ error: "File has no handwriting profile" }, { status: 400 });

  // Get the correct text for this line
  const text = line.words.map((w) => w.correctedText || w.rawText).join(" ");
  if (!text.trim()) return NextResponse.json({ error: "No text for this line" }, { status: 400 });

  // Download the image and crop the line
  const sharp = (await import("sharp")).default;

  const { data: blob, error: dlError } = await supabase.storage
    .from(BUCKET)
    .download(file.storagePath);

  if (dlError || !blob) {
    return NextResponse.json({ error: "Could not download image" }, { status: 500 });
  }

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgHeight = metadata.height || 1;
  const imgWidth = metadata.width || 1;

  const padY = Math.floor((line.yBottom - line.yTop) * 0.15);
  const yTop = Math.max(0, line.yTop - padY);
  const yBottom = Math.min(imgHeight, line.yBottom + padY);
  const cropHeight = yBottom - yTop;

  if (cropHeight < 5) {
    return NextResponse.json({ error: "Line crop too small" }, { status: 400 });
  }

  const cropBuffer = await sharp(imageBuffer)
    .extract({ left: 0, top: yTop, width: imgWidth, height: cropHeight })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Upload crop to Supabase Storage
  const storagePath = `training/${userId}/${file.profileId}/${Date.now()}_line${line.lineIndex}.jpg`;

  const { error: upError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, cropBuffer, { contentType: "image/jpeg", upsert: false });

  if (upError) {
    return NextResponse.json({ error: "Upload failed: " + upError.message }, { status: 500 });
  }

  // Save training example
  const example = await prisma.trainingExample.create({
    data: {
      profileId: file.profileId,
      storagePath,
      text,
    },
  });

  return NextResponse.json({ success: true, example });
}

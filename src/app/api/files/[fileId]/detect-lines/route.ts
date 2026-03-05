import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";
import { detectLines } from "@/lib/ocr";

export async function POST(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({
    where: { id: params.fileId, userId },
  });

  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error } = await supabase.storage
    .from(BUCKET)
    .download(file.storagePath);

  if (error || !blob) {
    return NextResponse.json({ error: "Could not read file from storage" }, { status: 500 });
  }

  const imageData = Buffer.from(await blob.arrayBuffer());
  const lines = await detectLines(imageData);

  return NextResponse.json({ lines });
}

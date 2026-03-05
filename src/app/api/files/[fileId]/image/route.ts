import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({
    where: { id: params.fileId, userId },
  });

  if (!file) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(file.storagePath);

  if (error || !data) return new NextResponse("File not found in storage", { status: 404 });

  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = path.extname(file.filename).toLowerCase();
  const contentType =
    ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";

  return new NextResponse(buffer, {
    headers: { "Content-Type": contentType },
  });
}

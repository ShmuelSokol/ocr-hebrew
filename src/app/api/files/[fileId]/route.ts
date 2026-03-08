import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

export async function DELETE(
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

  // Delete OCR data
  const result = await prisma.oCRResult.findUnique({ where: { fileId: file.id } });
  if (result) {
    await prisma.oCRWord.deleteMany({ where: { line: { resultId: result.id } } });
    await prisma.oCRLine.deleteMany({ where: { resultId: result.id } });
    await prisma.oCRResult.delete({ where: { id: result.id } });
  }

  // Delete token usage
  await prisma.tokenUsage.deleteMany({ where: { fileId: file.id } });

  // Delete file from Supabase Storage (both processed and original)
  const pathsToDelete = [file.storagePath];
  if (file.originalStoragePath && file.originalStoragePath !== file.storagePath) {
    pathsToDelete.push(file.originalStoragePath);
  }
  await supabase.storage.from(BUCKET).remove(pathsToDelete);

  // Delete DB record
  await prisma.file.delete({ where: { id: file.id } });

  return NextResponse.json({ success: true });
}

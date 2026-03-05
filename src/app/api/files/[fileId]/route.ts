import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unlink } from "fs/promises";

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

  // Delete file from disk
  try { await unlink(file.storagePath); } catch { /* ignore */ }

  // Delete DB record
  await prisma.file.delete({ where: { id: file.id } });

  return NextResponse.json({ success: true });
}

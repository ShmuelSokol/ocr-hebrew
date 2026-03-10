import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Retrieve the full master text for a project
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const project = await prisma.project.findFirst({ where: { id: params.projectId, userId } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const approvedTexts = await prisma.approvedText.findMany({
    where: { projectId: params.projectId },
    orderBy: [{ approvedAt: "asc" }, { lineIndex: "asc" }],
    include: { file: { select: { filename: true } } },
  });

  // Group by file for structured output
  const byFile: Record<string, { filename: string; fileId: string; lines: { lineIndex: number; text: string }[] }> = {};
  for (const at of approvedTexts) {
    if (!byFile[at.fileId]) {
      byFile[at.fileId] = { filename: at.sourceFilename, fileId: at.fileId, lines: [] };
    }
    byFile[at.fileId].lines.push({ lineIndex: at.lineIndex, text: at.text });
  }

  // Full text concatenation
  const fullText = Object.values(byFile)
    .map(f => `--- ${f.filename} ---\n${f.lines.map(l => l.text).join("\n")}`)
    .join("\n\n");

  return NextResponse.json({
    projectName: project.name,
    files: Object.values(byFile),
    fullText,
    totalLines: approvedTexts.length,
  });
}

// POST: Approve text from a file into the project
export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const project = await prisma.project.findFirst({ where: { id: params.projectId, userId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { fileId } = await req.json();
  if (!fileId) return NextResponse.json({ error: "fileId required" }, { status: 400 });

  const file = await prisma.file.findFirst({
    where: { id: fileId, userId },
    include: {
      ocrResult: {
        include: {
          lines: {
            orderBy: { lineIndex: "asc" },
            include: { words: { orderBy: { wordIndex: "asc" } } },
          },
        },
      },
    },
  });

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (!file.ocrResult) return NextResponse.json({ error: "No OCR result" }, { status: 400 });

  // Build approved text lines from OCR result (use correctedText if available, else rawText)
  const lines = file.ocrResult.lines.map(line => ({
    lineIndex: line.lineIndex,
    text: line.words
      .map(w => w.correctedText || w.rawText)
      .join(" "),
  }));

  // Upsert each line (allows re-approval to update text)
  for (const line of lines) {
    await prisma.approvedText.upsert({
      where: {
        projectId_fileId_lineIndex: {
          projectId: params.projectId,
          fileId,
          lineIndex: line.lineIndex,
        },
      },
      create: {
        projectId: params.projectId,
        fileId,
        lineIndex: line.lineIndex,
        text: line.text,
        sourceFilename: file.filename,
      },
      update: {
        text: line.text,
        sourceFilename: file.filename,
        approvedAt: new Date(),
      },
    });
  }

  // Mark file as text-approved
  await prisma.file.update({
    where: { id: fileId },
    data: { textApproved: true },
  });

  return NextResponse.json({ approved: lines.length });
}

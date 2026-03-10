import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const project = await prisma.project.findFirst({ where: { id: params.projectId, userId } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = req.nextUrl.searchParams.get("format") || "txt";

  const approvedTexts = await prisma.approvedText.findMany({
    where: { projectId: params.projectId },
    orderBy: [{ approvedAt: "asc" }, { lineIndex: "asc" }],
  });

  // Group by file
  const byFile: Record<string, { filename: string; lines: { lineIndex: number; text: string }[] }> = {};
  for (const at of approvedTexts) {
    if (!byFile[at.fileId]) {
      byFile[at.fileId] = { filename: at.sourceFilename, lines: [] };
    }
    byFile[at.fileId].lines.push({ lineIndex: at.lineIndex, text: at.text });
  }

  if (format === "json") {
    return NextResponse.json({
      project: project.name,
      exportedAt: new Date().toISOString(),
      files: Object.entries(byFile).map(([fileId, f]) => ({
        fileId,
        filename: f.filename,
        lines: f.lines,
        text: f.lines.map(l => l.text).join("\n"),
      })),
    });
  }

  // Plain text export
  const text = Object.values(byFile)
    .map(f => `--- ${f.filename} ---\n${f.lines.map(l => l.text).join("\n")}`)
    .join("\n\n");

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.txt"`,
    },
  });
}

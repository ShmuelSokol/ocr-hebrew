import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";
import { trackActivity } from "@/lib/activity";
import { spawn } from "child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export const maxDuration = 300;
export const runtime = "nodejs";

const DPI = 200;
const UPLOAD_CONCURRENCY = 4;

function runPdftoppm(pdfPath: string, outPrefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pdftoppm", ["-png", "-r", String(DPI), pdfPath, outPrefix]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftoppm exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

async function uploadPageBatch(
  pages: { pageNum: number; buffer: Buffer }[],
  userId: string,
  pdfName: string,
  totalPages: number,
  profileId: string | null,
  projectId: string | null,
  concurrency: number
) {
  const created: { id: string; pageNum: number }[] = [];
  const queue = [...pages];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const page = queue.shift();
      if (!page) break;
      const storagePath = `${userId}/${Date.now()}-${page.pageNum}-${pdfName}.png`;
      const { error } = await supabase.storage.from(BUCKET).upload(
        storagePath,
        page.buffer,
        { contentType: "image/png" }
      );
      if (error) throw new Error(`Page ${page.pageNum} upload: ${error.message}`);
      const filename = `${pdfName} (page ${page.pageNum} of ${totalPages}).png`;
      const row = await prisma.file.create({
        data: {
          filename,
          storagePath,
          userId,
          profileId: profileId || undefined,
          projectId: projectId || undefined,
        },
      });
      created.push({ id: row.id, pageNum: page.pageNum });
    }
  });
  await Promise.all(workers);
  created.sort((a, b) => a.pageNum - b.pageNum);
  return created;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const formData = await req.formData();
  const file = formData.get("file") as globalThis.File | null;
  const profileId = (formData.get("profileId") as string | null) || null;
  const projectId = (formData.get("projectId") as string | null) || null;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Not a PDF" }, { status: 400 });
  }

  trackActivity(userId, "Uploaded PDF");

  const workDir = await mkdtemp(join(tmpdir(), "ocr-pdf-"));
  try {
    const pdfPath = join(workDir, "input.pdf");
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(pdfPath, buffer);

    const outPrefix = join(workDir, "page");
    await runPdftoppm(pdfPath, outPrefix);

    const entries = await readdir(workDir);
    const pngFiles = entries
      .filter((n) => n.startsWith("page-") && n.endsWith(".png"))
      .sort((a, b) => {
        const na = parseInt(a.replace("page-", "").replace(".png", ""), 10);
        const nb = parseInt(b.replace("page-", "").replace(".png", ""), 10);
        return na - nb;
      });

    if (pngFiles.length === 0) {
      return NextResponse.json({ error: "No pages rendered from PDF" }, { status: 500 });
    }

    const pdfBaseName = file.name.replace(/\.pdf$/i, "");
    const pages = await Promise.all(
      pngFiles.map(async (n) => {
        const pageNum = parseInt(n.replace("page-", "").replace(".png", ""), 10);
        const buf = await readFile(join(workDir, n));
        return { pageNum, buffer: buf };
      })
    );

    const created = await uploadPageBatch(
      pages,
      userId,
      pdfBaseName,
      pngFiles.length,
      profileId,
      projectId,
      UPLOAD_CONCURRENCY
    );

    return NextResponse.json({
      pages: pngFiles.length,
      files: created,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `PDF processing failed: ${msg}` }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

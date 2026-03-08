import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

export async function POST(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({ where: { id: params.fileId, userId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { method } = await req.json().catch(() => ({ method: "doctr" }));

  // Download current image
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) return NextResponse.json({ error: "Could not read file" }, { status: 500 });

  const imageBuffer = Buffer.from(await blob.arrayBuffer());

  if (method === "doctr") {
    // Call DocTR /detect for bounding boxes only
    const formData = new FormData();
    formData.append("image", new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }), "page.jpg");

    const detectRes = await fetch(`${TROCR_SERVER}/detect`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!detectRes.ok) {
      const err = await detectRes.text();
      return NextResponse.json({ error: `DocTR detection failed: ${err}` }, { status: 502 });
    }

    const detection = await detectRes.json();
    return NextResponse.json({
      lines: detection.lines || [],
      totalWords: detection.total_words || 0,
      totalLines: detection.total_lines || 0,
      timeMs: detection.time_ms || 0,
      method: "doctr",
    });
  } else {
    // Azure: submit for analysis, extract bounding boxes
    const endpoint = process.env["AZURE_DOC_INTELLIGENCE_ENDPOINT"];
    const key = process.env["AZURE_DOC_INTELLIGENCE_KEY"];
    if (!endpoint || !key) return NextResponse.json({ error: "Azure not configured" }, { status: 500 });

    const submitRes = await fetch(
      `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&locale=he`,
      { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "image/jpeg" }, body: imageBuffer }
    );
    if (!submitRes.ok) return NextResponse.json({ error: "Azure submit failed" }, { status: 502 });

    const opUrl = submitRes.headers.get("operation-location");
    if (!opUrl) return NextResponse.json({ error: "No operation URL" }, { status: 502 });

    // Poll for result
    let result = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(opUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
      const pollData = await pollRes.json();
      if (pollData.status === "succeeded") { result = pollData.analyzeResult; break; }
      if (pollData.status === "failed") return NextResponse.json({ error: "Azure analysis failed" }, { status: 502 });
    }
    if (!result) return NextResponse.json({ error: "Azure timeout" }, { status: 504 });

    // Extract lines and word bounding boxes
    const lines = (result.pages?.[0]?.lines || []).map((line: { polygon: number[]; content: string; words?: { polygon: number[]; content: string; confidence: number }[] }, li: number) => {
      const ys = [line.polygon[1], line.polygon[3], line.polygon[5], line.polygon[7]];
      const yTop = Math.min(...ys);
      const yBottom = Math.max(...ys);
      const words = (line.words || []).map((w: { polygon: number[]; content: string; confidence: number }) => {
        const wxs = [w.polygon[0], w.polygon[2], w.polygon[4], w.polygon[6]];
        const wys = [w.polygon[1], w.polygon[3], w.polygon[5], w.polygon[7]];
        return {
          xLeft: Math.round(Math.min(...wxs)),
          xRight: Math.round(Math.max(...wxs)),
          yTop: Math.round(Math.min(...wys)),
          yBottom: Math.round(Math.max(...wys)),
          text: w.content,
          confidence: w.confidence,
        };
      });
      return { lineIndex: li, yTop: Math.round(yTop), yBottom: Math.round(yBottom), words };
    });

    return NextResponse.json({
      lines,
      totalWords: lines.reduce((s: number, l: { words: unknown[] }) => s + l.words.length, 0),
      totalLines: lines.length,
      method: "azure",
    });
  }
}

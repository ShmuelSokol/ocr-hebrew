import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supabase, BUCKET } from "@/lib/supabase";

const TROCR_SERVER = process.env["TROCR_SERVER_URL"] || "http://localhost:8765";

interface Region {
  lineIdx: number;
  wordIdx: number;
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const file = await prisma.file.findFirst({ where: { id: params.fileId, userId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { regions } = (await req.json()) as { regions: Region[] };
  if (!regions || regions.length === 0) {
    return NextResponse.json({ error: "No regions provided" }, { status: 400 });
  }

  // Download image
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.storagePath);
  if (error || !blob) return NextResponse.json({ error: "Could not read file" }, { status: 500 });

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  const sharp = (await import("sharp")).default;

  const results: { lineIdx: number; wordIdx: number; subBoxes: { xLeft: number; xRight: number; yTop: number; yBottom: number }[] }[] = [];

  for (const region of regions) {
    // Add padding around the region for better detection
    const metadata = await sharp(imageBuffer).metadata();
    const imgW = metadata.width || 1;
    const imgH = metadata.height || 1;
    const padX = Math.floor((region.xRight - region.xLeft) * 0.1);
    const padY = Math.floor((region.yBottom - region.yTop) * 0.15);
    const cropLeft = Math.max(0, region.xLeft - padX);
    const cropTop = Math.max(0, region.yTop - padY);
    const cropRight = Math.min(imgW, region.xRight + padX);
    const cropBottom = Math.min(imgH, region.yBottom + padY);
    const cropW = cropRight - cropLeft;
    const cropH = cropBottom - cropTop;

    if (cropW < 10 || cropH < 10) {
      results.push({ lineIdx: region.lineIdx, wordIdx: region.wordIdx, subBoxes: [] });
      continue;
    }

    try {
      // Crop the region
      const cropBuffer = await sharp(imageBuffer)
        .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
        .jpeg({ quality: 95 })
        .toBuffer();

      // Send to DocTR /detect
      const formData = new FormData();
      formData.append("image", new Blob([new Uint8Array(cropBuffer)], { type: "image/jpeg" }), "region.jpg");

      const detectRes = await fetch(`${TROCR_SERVER}/detect`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(15000),
      });

      if (!detectRes.ok) {
        results.push({ lineIdx: region.lineIdx, wordIdx: region.wordIdx, subBoxes: [] });
        continue;
      }

      const detection = await detectRes.json();

      // Map sub-boxes back to absolute coordinates
      const subBoxes: { xLeft: number; xRight: number; yTop: number; yBottom: number }[] = [];
      for (const line of (detection.lines || [])) {
        for (const word of line.words) {
          subBoxes.push({
            xLeft: word.xLeft + cropLeft,
            xRight: word.xRight + cropLeft,
            yTop: word.yTop + cropTop,
            yBottom: word.yBottom + cropTop,
          });
        }
      }

      // Sort RTL (Hebrew)
      subBoxes.sort((a, b) => b.xRight - a.xRight);

      results.push({ lineIdx: region.lineIdx, wordIdx: region.wordIdx, subBoxes });
    } catch {
      results.push({ lineIdx: region.lineIdx, wordIdx: region.wordIdx, subBoxes: [] });
    }
  }

  return NextResponse.json({ results });
}

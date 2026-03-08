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
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

    const userId = (session.user as { id: string }).id;
    const file = await prisma.file.findFirst({
      where: { id: params.fileId, userId },
    });

    if (!file) return new NextResponse("Not found", { status: 404 });

    const wantOriginal = req.nextUrl.searchParams.get("original") === "true";
    const storagePath = wantOriginal && file.originalStoragePath ? file.originalStoragePath : file.storagePath;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);

    if (error || !data) {
      console.error("Supabase storage error:", error, "path:", file.storagePath);
      return new NextResponse("File not found in storage: " + (error?.message || "unknown"), { status: 404 });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const ext = path.extname(file.filename).toLowerCase();
    const contentType =
      ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Image route error:", err);
    return new NextResponse("Internal error: " + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
}

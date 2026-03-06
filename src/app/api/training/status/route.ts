import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Look for status.json in the training output directory
  // The training script writes to: ocr-hebrew/training/output/status.json
  const possiblePaths = [
    path.resolve(process.cwd(), "..", "training", "output", "status.json"),
    path.resolve(process.cwd(), "training", "output", "status.json"),
  ];

  for (const statusPath of possiblePaths) {
    try {
      if (fs.existsSync(statusPath)) {
        const raw = fs.readFileSync(statusPath, "utf-8");
        const data = JSON.parse(raw);
        return NextResponse.json(data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({
    status: "no_data",
    message: "No training status found. Run train.py to start training.",
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  "user",
  "project",
  "handwritingProfile",
  "file",
  "trainingExample",
] as const;

export async function GET() {
  const missing: string[] = [];
  let checked = 0;

  for (const t of REQUIRED_TABLES) {
    try {
      // Any read attempt confirms the table exists. count() is cheapest.
      // @ts-expect-error — indexing Prisma client by model name
      await prisma[t].count();
      checked++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Prisma P2021 === table does not exist
      if (msg.includes("does not exist") || msg.includes("P2021")) {
        missing.push(t);
      } else {
        return NextResponse.json(
          { status: "degraded", error: `Unexpected DB error on ${t}: ${msg.slice(0, 200)}` },
          { status: 503 }
        );
      }
    }
  }

  if (missing.length) {
    return NextResponse.json(
      { status: "schema-missing", missingTables: missing, checked },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: "ok", tablesChecked: checked });
}

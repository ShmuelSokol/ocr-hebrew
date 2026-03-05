import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Use bracket notation to prevent webpack inlining
    const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] || "NOT SET";
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
    const keySet = key ? "YES" : "NO";
    const keyPrefix = key ? key.substring(0, 10) + "..." : "EMPTY";

    // Check which SUPABASE env keys exist
    const supabaseKeys = Object.keys(process.env).filter(k => k.includes("SUPABASE"));

    // Try importing supabase
    const { supabase, BUCKET } = await import("@/lib/supabase");

    // Try listing files
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("cmmdqxc9m000013pm3xbsntl9", { limit: 2 });

    return NextResponse.json({
      supabaseUrl: url,
      serviceKeySet: keySet,
      serviceKeyPrefix: keyPrefix,
      envKeys: supabaseKeys,
      storageListResult: data?.length ?? 0,
      storageError: error?.message || null,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : null,
    }, { status: 500 });
  }
}

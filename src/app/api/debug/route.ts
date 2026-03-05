import { NextResponse } from "next/server";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "NOT SET";
    const keySet = process.env.SUPABASE_SERVICE_ROLE_KEY ? "YES" : "NO";

    // Try importing supabase
    const { supabase, BUCKET } = await import("@/lib/supabase");

    // Try listing files
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("cmmdqxc9m000013pm3xbsntl9", { limit: 2 });

    return NextResponse.json({
      supabaseUrl: url,
      serviceKeySet: keySet,
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

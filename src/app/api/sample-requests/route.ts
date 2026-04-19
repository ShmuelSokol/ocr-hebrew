import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { name, email, phone, writerDescription, pageCount } = body as {
    name?: string; email?: string; phone?: string; writerDescription?: string; pageCount?: number | null;
  };

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!writerDescription || writerDescription.trim().length < 10) {
    return NextResponse.json({ error: "Please describe the handwriting (at least a sentence)" }, { status: 400 });
  }

  await prisma.sampleRequest.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name?.trim() || null,
      phone: phone?.trim() || null,
      writerDescription: writerDescription.trim(),
      pageCount: typeof pageCount === "number" && pageCount > 0 ? pageCount : null,
      source: "web",
    },
  });

  // TODO (Tier 2): fire off a transactional email to admin + confirmation to requester.

  return NextResponse.json({ ok: true });
}

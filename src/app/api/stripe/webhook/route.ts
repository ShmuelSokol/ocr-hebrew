import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FREE_CREDIT_LETTERS_BY_TIER: Record<string, number> = {
  starter: 20000,
  professional: 20000,
};

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Signature verify failed: ${msg}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as { id: string; metadata?: { userId?: string; tier?: string } };
    const userId = s.metadata?.userId;
    const tier = s.metadata?.tier;
    if (userId && tier) {
      const letters = FREE_CREDIT_LETTERS_BY_TIER[tier] ?? 0;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { creditsBalance: { increment: letters } },
        }),
        prisma.creditTransaction.create({
          data: {
            userId,
            delta: letters,
            kind: "setup_fee_grant",
            note: `Setup fee paid: ${tier}`,
            reference: s.id,
          },
        }),
      ]);
    }
  }

  return NextResponse.json({ received: true });
}

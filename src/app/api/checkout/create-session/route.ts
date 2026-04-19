import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStripe, STRIPE_TIERS, TierKey } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Checkout unavailable — STRIPE_SECRET_KEY not configured on server." },
      { status: 503 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { tier } = (await req.json().catch(() => ({}))) as { tier?: TierKey };
  if (!tier || !(tier in STRIPE_TIERS)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const t = STRIPE_TIERS[tier];
  const origin = req.headers.get("origin") || process.env["NEXTAUTH_URL"] || "https://ksavyad.com";

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: session.user.email || undefined,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: t.priceCents,
          product_data: { name: t.name, description: t.description },
        },
        quantity: 1,
      },
    ],
    metadata: { userId, tier },
    success_url: `${origin}/settings/billing?checkout=success&tier=${tier}`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });

  return NextResponse.json({ url: checkout.url });
}

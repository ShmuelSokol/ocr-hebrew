import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  cached = new Stripe(key);
  return cached;
}

export const STRIPE_TIERS = {
  starter: {
    name: "Starter setup",
    priceCents: 50000,
    description: "85% accuracy target · 1 retraining cycle · 20,000 free letters",
  },
  professional: {
    name: "Professional setup",
    priceCents: 150000,
    description: "92% accuracy target · 2 retraining cycles · 20,000 free letters",
  },
  // Archival intentionally omitted — custom quote.
} as const;

export type TierKey = keyof typeof STRIPE_TIERS;

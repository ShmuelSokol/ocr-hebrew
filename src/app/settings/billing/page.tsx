"use client";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";

export const dynamic = "force-dynamic";

interface Credits { letters: number; approxPages: number; low: boolean }

export default function BillingPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <BillingPage />
    </Suspense>
  );
}

function BillingPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/credits");
    if (r.ok) setCredits(await r.json());
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") load();
  }, [status, router, load]);

  async function buy(tier: "starter" | "professional") {
    setBuying(tier);
    try {
      const r = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (r.status === 503) {
          alert("Online checkout is not configured yet. Please contact us to purchase.");
        } else {
          alert(body.error || "Checkout failed");
        }
        return;
      }
      const { url } = await r.json();
      if (url) window.location.href = url;
    } finally {
      setBuying(null);
    }
  }

  if (status === "loading") return <div className="p-8">Loading...</div>;
  const checkoutStatus = params.get("checkout");

  return (
    <>
      <TopNav />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Billing & credits</h1>

        {checkoutStatus === "success" && (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">
            Payment successful — your credits have been added. It may take a few seconds to appear.
          </div>
        )}

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-3">Current balance</h2>
          {credits ? (
            <div className="flex items-baseline gap-3">
              <div className={`text-3xl font-bold ${credits.low ? "text-amber-700" : "text-slate-900"}`}>
                {credits.letters.toLocaleString()}
              </div>
              <div className="text-sm text-slate-500">letters (~{credits.approxPages} pages)</div>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">Loading...</div>
          )}
          {credits?.low && (
            <p className="text-sm text-amber-700 mt-2">Your balance is running low. Call support or buy a package below.</p>
          )}
          <p className="text-xs text-slate-500 mt-3">
            1 letter of Hebrew text = ₪0.05. About 400 letters per page.
          </p>
        </section>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-1">Setup packages</h2>
          <p className="text-xs text-slate-500 mb-4">
            Purchase a setup tier to train a personal model on your writer&apos;s handwriting. Each package includes 20,000 free letters of transcription credits.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { k: "starter" as const, t: "Starter", p: "$500", d: "85% target · 1 retraining" },
              { k: "professional" as const, t: "Professional", p: "$1,500", d: "92% target · 2 retraining cycles" },
            ].map((t) => (
              <div key={t.k} className="border border-slate-200 rounded-lg p-4">
                <div className="text-sm text-slate-500 uppercase tracking-wide">{t.t}</div>
                <div className="text-2xl font-bold">{t.p}</div>
                <div className="text-xs text-slate-600 mt-1 mb-3">{t.d}</div>
                <button onClick={() => buy(t.k)} disabled={buying === t.k}
                  className="w-full px-3 py-2 bg-slate-900 text-white rounded text-sm hover:bg-slate-800 disabled:bg-slate-400">
                  {buying === t.k ? "Redirecting..." : `Buy ${t.t}`}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Need Archival (≥95% accuracy, 6 months retraining)? <a href="/request-sample" className="text-blue-600 hover:underline">Contact us for a custom quote.</a>
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-1">Top up by phone</h2>
          <p className="text-sm text-slate-600 mb-3">
            Prefer to pay by phone? Call our support line, pay by card or bank transfer, and we&apos;ll read you back a top-up code to type here.
          </p>
          <div className="flex gap-2">
            <input placeholder="Paste top-up code..." className="border border-slate-300 rounded px-3 py-2 text-sm flex-1 font-mono" disabled />
            <button disabled className="px-4 py-2 bg-slate-200 text-slate-500 rounded text-sm">Apply code</button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Top-up code application is coming soon.</p>
        </section>
      </div>
    </>
  );
}

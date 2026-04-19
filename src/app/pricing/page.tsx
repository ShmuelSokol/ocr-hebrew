import Link from "next/link";

export default function PricingPage() {
  const tiers = [
    {
      name: "Starter",
      price: "$500",
      target: "85% accuracy target",
      summary: "For a first pass through a modest collection. Expect real review time on each page; the model is learning.",
      features: [
        "~500 included corrections for training",
        "1 retraining cycle included",
        "20,000 free letters (~50 pages)",
        "Email support",
      ],
      cta: "Start with Starter",
    },
    {
      name: "Professional",
      price: "$1,500",
      target: "92% accuracy target",
      summary: "The common choice. Enough training cycles to reach fluent reading-aloud review on most handwritings.",
      features: [
        "~2,000 corrections included",
        "2 retraining cycles included",
        "20,000 free letters (~50 pages)",
        "Priority email support",
      ],
      cta: "Start Professional",
      highlight: true,
    },
    {
      name: "Archival",
      price: "from $4,000",
      target: "≥95% accuracy target",
      summary: "For serious projects — a lifetime of notes, an institutional collection, or a book-length manuscript.",
      features: [
        "5,000–10,000+ corrections",
        "Unlimited retraining cycles for 6 months",
        "20,000 free letters plus volume discount",
        "Phone support & thumb-drive delivery option",
      ],
      cta: "Talk to us",
    },
  ];

  return (
    <div dir="ltr" className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-bold text-xl tracking-tight">ksavyad</Link>
          <nav className="flex gap-5 mr-auto ml-8 text-sm text-slate-600">
            <Link href="/pricing" className="text-slate-900 font-medium">Pricing</Link>
            <Link href="/request-sample" className="hover:text-slate-900">Request a sample</Link>
          </nav>
          <div className="flex gap-2 ml-auto">
            <Link href="/login" className="px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900">Sign in</Link>
            <Link href="/login" className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded hover:bg-slate-800">Get started</Link>
          </div>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 pt-14 pb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-4 text-slate-600">
          A one-time setup fee trains a personal AI model on your writer&apos;s handwriting. After that, you pay only for what you transcribe — about half of what a manual typist charges.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-12 grid md:grid-cols-3 gap-4">
        {tiers.map((t) => (
          <div key={t.name} className={`rounded-xl bg-white p-6 flex flex-col ${t.highlight ? "border-2 border-blue-500 ring-2 ring-blue-100" : "border border-slate-200"}`}>
            {t.highlight && <div className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded self-start mb-2 uppercase tracking-wide">Most popular</div>}
            <div className="text-sm text-slate-500 uppercase tracking-wide">{t.name}</div>
            <div className="text-4xl font-bold mt-1">{t.price}</div>
            <div className="text-sm text-blue-600 mt-1">{t.target}</div>
            <p className="text-sm text-slate-600 mt-4 mb-6">{t.summary}</p>
            <ul className="space-y-2 text-sm text-slate-700 mb-6">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-green-600">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/request-sample"
              className={`mt-auto text-center px-4 py-2.5 rounded-lg font-medium ${t.highlight ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-900 text-white hover:bg-slate-800"}`}
            >
              {t.cta}
            </Link>
          </div>
        ))}
      </section>

      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-3">Usage pricing after setup</h2>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-slate-500 uppercase">Rate</div>
              <div className="text-xl font-semibold">₪0.05 / letter</div>
              <div className="text-xs text-slate-500">≈ ₪20 per page</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase">Manual typist (market)</div>
              <div className="text-xl font-semibold text-slate-400 line-through">₪0.10 / letter</div>
              <div className="text-xs text-slate-500">≈ ₪40 per page</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase">Free on signup</div>
              <div className="text-xl font-semibold text-green-700">20,000 letters</div>
              <div className="text-xs text-slate-500">≈ 50 pages</div>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Top up any time by phone — we issue a signed code you enter in the app. No internet required on your end.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-6">Frequently asked</h2>
        <div className="space-y-5 text-sm">
          {[
            { q: "Can it learn my late father/grandfather/rebbe's handwriting?", a: "Yes. We need ~20–30 sample pages to start. Accuracy climbs as you correct pages yourself. If we review your sample and think ≥95% isn't feasible, we'll tell you before you pay." },
            { q: "What if I don't have a computer?", a: "The app runs on any laptop made in the last 8 years. If you don't have one, we can recommend a modest setup under $500." },
            { q: "Do you see my writings?", a: "Only during retraining, when you mail the drive back. Day-to-day transcription stays entirely on your computer. We never upload your pages to the cloud." },
            { q: "Is there a free trial?", a: "We'll review up to 5 pages of any handwriting for free — you'll get an honest assessment of feasibility and an exact quote before you commit to a package." },
            { q: "How long does setup take?", a: "Starter: 1–2 weeks. Professional: 2–4 weeks. Archival: 4–8 weeks depending on the writer. Most of that is iterative — you correct, we retrain, repeat." },
            { q: "Can I use it for multiple writers?", a: "Each writer gets their own model and their own setup fee. A family project with two or three different scripts is one pilot per hand." },
          ].map((f, i) => (
            <details key={i} className="bg-white border border-slate-200 rounded-lg p-4 group">
              <summary className="font-medium cursor-pointer list-none flex justify-between items-center">
                {f.q}
                <span className="text-slate-400 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-slate-600 mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-14 text-center">
        <h2 className="text-2xl font-bold mb-3">Unsure which tier?</h2>
        <p className="text-slate-600 mb-6">Send us a few sample pages. We&apos;ll tell you honestly what&apos;s realistic for that handwriting — before you pay anything.</p>
        <Link href="/request-sample" className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
          Request a free sample review
        </Link>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <div>&copy; {new Date().getFullYear()} ksavyad</div>
          <nav className="flex gap-5">
            <Link href="/" className="hover:text-slate-900">Home</Link>
            <Link href="/request-sample" className="hover:text-slate-900">Request sample</Link>
            <Link href="/login" className="hover:text-slate-900">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

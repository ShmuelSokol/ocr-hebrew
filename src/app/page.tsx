import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <div dir="ltr" className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      {/* nav */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-bold text-xl tracking-tight">ksavyad</Link>
          <nav className="flex gap-5 mr-auto ml-8 text-sm text-slate-600">
            <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
            <Link href="/request-sample" className="hover:text-slate-900">Request a sample</Link>
          </nav>
          <div className="flex gap-2 ml-auto">
            <Link href="/login" className="px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900">Sign in</Link>
            <Link href="/login" className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded hover:bg-slate-800">Get started</Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight">
          Handwritten Hebrew,<br/>
          <span className="text-blue-600">digitized faster than a scribe.</span>
        </h1>
        <p className="max-w-2xl mx-auto mt-6 text-lg text-slate-600">
          Ksavyad learns your father&apos;s, grandfather&apos;s, or rebbe&apos;s exact handwriting and turns pages of manuscript into clean digital text — at half the price of a human typist, with none of it leaving your computer.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/request-sample" className="px-5 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            Request a free sample
          </Link>
          <Link href="/pricing" className="px-5 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50">
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">Sample review is free. Paid pilots start at $500.</p>
      </section>

      {/* sample */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="grid md:grid-cols-2 gap-0">
            <div className="p-6 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">You upload</div>
              <div className="aspect-video bg-white border border-dashed border-slate-300 rounded flex items-center justify-center text-sm text-slate-400">
                handwritten page image
              </div>
              <p className="mt-3 text-sm text-slate-600">Scan, photo, or PDF. One page or hundreds.</p>
            </div>
            <div className="p-6">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Ksavyad returns</div>
              <div dir="rtl" className="bg-slate-50 p-4 rounded border border-slate-200 text-lg leading-relaxed font-serif">
                בס״ד<br/>
                בהלכות דעות<br/>
                כל אחד ואחד מבני אדם יש לו דעות הרבה
              </div>
              <p className="mt-3 text-sm text-slate-600">You review each word, fix anything wrong — and the model learns your writer&apos;s style every time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* use cases */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold mb-10 text-center">Who uses ksavyad</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: "Families & legacy keepers", body: "Preserving a late grandfather&apos;s chiddushei Torah, a parent&apos;s daily journal, letters from a revered ancestor." },
              { title: "Scholars & archivists", body: "Working through a private library or an institutional collection with consistent handwriting across thousands of pages." },
              { title: "Yeshivas & institutions", body: "Digitizing the notes of a past rosh yeshiva or maggid shiur for publication, reference, or internal study." },
            ].map((u, i) => (
              <div key={i} className="bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="font-semibold mb-2">{u.title}</h3>
                <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: u.body }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold mb-10 text-center">How it works</h2>
        <ol className="grid md:grid-cols-4 gap-4">
          {[
            { n: "1", t: "Send a sample", b: "Mail us 5 pages. We&apos;ll tell you honestly how feasible 95% accuracy is for that handwriting." },
            { n: "2", t: "Build your model", b: "We train a personal AI model on your writer&apos;s style. 1–3 weeks depending on tier." },
            { n: "3", t: "Transcribe", b: "Upload pages, review word-by-word. The hard work is done; you just confirm or correct." },
            { n: "4", t: "Model improves", b: "Every correction makes the model sharper. Ship us your drive; we retrain and return it." },
          ].map((s) => (
            <li key={s.n} className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="text-3xl font-bold text-blue-600 mb-2">{s.n}</div>
              <h3 className="font-semibold text-sm mb-1">{s.t}</h3>
              <p className="text-xs text-slate-600" dangerouslySetInnerHTML={{ __html: s.b }} />
            </li>
          ))}
        </ol>
      </section>

      {/* trust strip */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-3 gap-6 text-center">
          <div>
            <div className="text-3xl font-bold text-slate-900">50%</div>
            <div className="text-sm text-slate-600 mt-1">Cheaper than a manual typist</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900">Offline</div>
            <div className="text-sm text-slate-600 mt-1">Your writings never touch the internet</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900">≥95%</div>
            <div className="text-sm text-slate-600 mt-1">Accuracy target per-writer, after training</div>
          </div>
        </div>
      </section>

      {/* pricing preview */}
      <section className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold mb-3">Simple pricing</h2>
        <p className="text-slate-600 mb-8">One-time setup. Prepaid per-letter credits after.</p>
        <div className="grid md:grid-cols-3 gap-4 text-left">
          {[
            { t: "Starter", p: "$500", d: "85% target · 1 retraining · 20,000 free letters" },
            { t: "Professional", p: "$1,500", d: "92% target · 2 retraining cycles · 20,000 free letters", highlight: true },
            { t: "Archival", p: "from $4,000", d: "95% target · unlimited retraining for 6 months" },
          ].map((p) => (
            <div key={p.t} className={`rounded-xl border p-6 ${p.highlight ? "border-blue-500 ring-2 ring-blue-100 bg-white" : "border-slate-200 bg-white"}`}>
              <div className="text-sm text-slate-500 uppercase tracking-wide">{p.t}</div>
              <div className="text-3xl font-bold mt-1">{p.p}</div>
              <p className="text-sm text-slate-600 mt-3">{p.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/pricing" className="text-blue-600 hover:underline text-sm">See full pricing and FAQ &rarr;</Link>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <div>&copy; {new Date().getFullYear()} ksavyad</div>
          <nav className="flex gap-5">
            <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
            <Link href="/request-sample" className="hover:text-slate-900">Request sample</Link>
            <Link href="/login" className="hover:text-slate-900">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

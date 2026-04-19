"use client";
import Link from "next/link";
import { useState } from "react";

export default function RequestSamplePage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    writerDescription: "",
    pageCount: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          pageCount: form.pageCount ? parseInt(form.pageCount, 10) : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong");
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="ltr" className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-bold text-xl tracking-tight">ksavyad</Link>
          <nav className="flex gap-5 mr-auto ml-8 text-sm text-slate-600">
            <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
            <Link href="/request-sample" className="text-slate-900 font-medium">Request a sample</Link>
          </nav>
          <div className="flex gap-2 ml-auto">
            <Link href="/login" className="px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900">Sign in</Link>
          </div>
        </div>
      </header>

      <section className="max-w-2xl mx-auto px-6 py-14">
        {done ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <div className="text-5xl mb-4">✓</div>
            <h1 className="text-2xl font-bold mb-3">We got it.</h1>
            <p className="text-slate-600 mb-6">
              We&apos;ll email you within 1 business day with next steps for sending us sample pages. We typically turn feasibility reviews around in 48–72 hours.
            </p>
            <Link href="/" className="inline-block px-5 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800">Back to home</Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Request a free sample review</h1>
            <p className="text-slate-600 mb-8">
              Tell us about the handwriting you want digitized. We&apos;ll reply with mailing instructions and — after reviewing your pages — give you an honest feasibility assessment and quote. No charge, no obligation.
            </p>

            <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <Field label="Your name" required>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
              </Field>
              <Field label="Email" required>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
              </Field>
              <Field label="Phone (optional, preferred for scholarly customers)">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
              </Field>
              <Field label="About the handwriting" required hint="Who wrote it, what era, what content (Torah notes, journal, letters, etc.)">
                <textarea required rows={4} value={form.writerDescription} onChange={(e) => setForm({ ...form, writerDescription: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
              </Field>
              <Field label="Approximate total pages (optional)">
                <input type="number" min="0" value={form.pageCount} onChange={(e) => setForm({ ...form, pageCount: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm max-w-xs" />
              </Field>
              {error && <div className="text-sm text-red-600">{error}</div>}
              <div className="flex justify-end pt-2">
                <button type="submit" disabled={submitting}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300">
                  {submitting ? "Sending..." : "Request sample review"}
                </button>
              </div>
            </form>
            <p className="text-xs text-slate-500 mt-4">
              We read every submission. Expect a human reply, not an autoresponder.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </div>
      {hint && <div className="text-xs text-slate-500 mb-1.5">{hint}</div>}
      {children}
    </label>
  );
}

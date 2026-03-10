"use client";
import { useState, useEffect } from "react";

interface DictData {
  stats: {
    totalWords: number;
    abbreviations: number;
    sageNames: number;
    vocabTerms: number;
    bigramTriggers: number;
  };
  abbreviations: Record<string, string>;
  sageNames: string[];
  topWords: { word: string; freq: number }[];
  bigrams: { trigger: string; followers: string[] }[];
}

type Tab = "overview" | "abbreviations" | "sages" | "words" | "bigrams";

export default function DictionaryPage() {
  const [data, setData] = useState<DictData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/dictionary")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto p-6 mt-12 text-center text-gray-500">
        Loading dictionary...
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "abbreviations", label: `Abbreviations (${data.stats.abbreviations})` },
    { key: "sages", label: `Sages (${data.stats.sageNames})` },
    { key: "words", label: `Top Words (${data.topWords.length})` },
    { key: "bigrams", label: `Bigrams (${data.stats.bigramTriggers})` },
  ];

  const q = search.trim();

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Talmudic Dictionary</h1>
      <p className="text-gray-500 text-sm mb-6">
        Hebrew/Aramaic vocabulary used for OCR post-processing correction.
        Sourced from curated lists + 196 pages of Babylonian Talmud via Sefaria.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              tab === t.key
                ? "border-blue-600 text-blue-600 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== "overview" && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="border rounded px-3 py-2 w-full mb-4 text-sm"
          dir="rtl"
        />
      )}

      {/* Overview */}
      {tab === "overview" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard label="Total Words" value={data.stats.totalWords.toLocaleString()} />
          <StatCard label="Abbreviations" value={data.stats.abbreviations} />
          <StatCard label="Sage Names" value={data.stats.sageNames} />
          <StatCard label="Vocab Terms" value={data.stats.vocabTerms} />
          <StatCard label="Bigram Triggers" value={data.stats.bigramTriggers} />
          <StatCard label="Top 500 Words" value={data.topWords.length} />
        </div>
      )}

      {/* Abbreviations */}
      {tab === "abbreviations" && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-right px-4 py-3 font-medium">Abbreviation</th>
                <th className="text-right px-4 py-3 font-medium">Expansion</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.abbreviations)
                .filter(([k, v]) => !q || k.includes(q) || v.includes(q))
                .map(([abbr, expansion]) => (
                  <tr key={abbr} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-lg" dir="rtl">
                      {abbr}
                    </td>
                    <td className="px-4 py-2 text-gray-600" dir="rtl">
                      {expansion}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sages */}
      {tab === "sages" && (
        <div className="flex flex-wrap gap-2" dir="rtl">
          {data.sageNames
            .filter((n) => !q || n.includes(q))
            .map((name) => (
              <span
                key={name}
                className="bg-amber-50 border border-amber-200 rounded-full px-3 py-1 text-sm"
              >
                {name}
              </span>
            ))}
        </div>
      )}

      {/* Top Words */}
      {tab === "words" && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-center px-4 py-3 font-medium w-16">#</th>
                <th className="text-right px-4 py-3 font-medium">Word</th>
                <th className="text-center px-4 py-3 font-medium">Frequency</th>
                <th className="text-left px-4 py-3 font-medium w-48">Bar</th>
              </tr>
            </thead>
            <tbody>
              {data.topWords
                .filter((w) => !q || w.word.includes(q))
                .map((w, i) => {
                  const maxFreq = data.topWords[0].freq;
                  const pct = Math.round((w.freq / maxFreq) * 100);
                  return (
                    <tr key={w.word} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 text-center text-gray-400">{i + 1}</td>
                      <td className="px-4 py-2 font-mono text-lg" dir="rtl">
                        {w.word}
                      </td>
                      <td className="px-4 py-2 text-center text-gray-600">
                        {w.freq.toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <div className="bg-gray-100 rounded-full h-4 overflow-hidden">
                          <div
                            className="bg-blue-500 h-full rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bigrams */}
      {tab === "bigrams" && (
        <div className="space-y-2" dir="rtl">
          {data.bigrams
            .filter(
              (b) =>
                !q || b.trigger.includes(q) || b.followers.some((f) => f.includes(q))
            )
            .map((b) => (
              <div key={b.trigger} className="bg-white rounded-lg shadow px-4 py-3">
                <span className="font-bold text-blue-700">{b.trigger}</span>
                <span className="text-gray-400 mx-2">→</span>
                <span className="text-gray-600">
                  {b.followers.join("، ")}
                </span>
                <span className="text-xs text-gray-400 mr-2">
                  ({b.followers.length})
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  );
}

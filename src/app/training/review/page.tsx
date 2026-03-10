"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";

interface TrainingItem {
  id: string;
  text: string;
  profileId: string;
  profileName: string;
  source: string;
  sourceLineId: string | null;
  createdAt: string;
}

interface Profile {
  id: string;
  name: string;
}

const PAGE_SIZE = 50;
const NUDGE_PX = 5;

export default function TrainingReviewPage() {
  const { status } = useSession();
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [examples, setExamples] = useState<TrainingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterProfile, setFilterProfile] = useState("");
  const [loading, setLoading] = useState(false);

  // Expanded item for bbox editing
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bbox, setBbox] = useState({ xLeft: 0, xRight: 0, yTop: 0, yBottom: 0 });
  const [originalBbox, setOriginalBbox] = useState({ xLeft: 0, xRight: 0, yTop: 0, yBottom: 0 });
  const [bboxLoading, setBboxLoading] = useState(false);
  const [bboxDirty, setBboxDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const [contextFileId, setContextFileId] = useState<string | null>(null);
  const [sourceImgSize, setSourceImgSize] = useState<{ w: number; h: number } | null>(null);
  const sourceImgRef = useRef<HTMLImageElement>(null);

  // Inline text editing
  const [dirtyTexts, setDirtyTexts] = useState<Record<string, string>>({});
  const [savingTextId, setSavingTextId] = useState<string | null>(null);

  // Pending delete (undo toast)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; timer: NodeJS.Timeout } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const loadPage = useCallback(async (newOffset: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(newOffset));
    if (filterProfile) params.set("profileId", filterProfile);

    const res = await fetch(`/api/training?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProfiles(data.profiles || []);
      setExamples(data.examples || []);
      setTotal(data.total || 0);
      setOffset(newOffset);
    }
    setLoading(false);
  }, [filterProfile]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") loadPage(0);
  }, [status, router, loadPage]);

  // Toggle expand — load bbox from context API
  async function toggleExpand(item: TrainingItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      setBboxDirty(false);
      setContextFileId(null);
      setSourceImgSize(null);
      return;
    }
    setExpandedId(item.id);
    setBboxDirty(false);
    setContextFileId(null);
    setSourceImgSize(null);

    if (item.sourceLineId) {
      setBboxLoading(true);
      const res = await fetch(`/api/training/${item.id}/context`);
      if (res.ok) {
        const ctx = await res.json();
        setBbox(ctx.word);
        setOriginalBbox(ctx.word);
        setContextFileId(ctx.fileId);
      }
      setBboxLoading(false);
    }
  }

  function nudge(edge: string, delta: number) {
    setBbox(prev => {
      const next = { ...prev };
      if (edge === "left") next.xLeft = Math.min(prev.xLeft + delta, prev.xRight - 10);
      if (edge === "right") next.xRight = Math.max(prev.xRight + delta, prev.xLeft + 10);
      if (edge === "top") next.yTop = Math.min(prev.yTop + delta, prev.yBottom - 10);
      if (edge === "bottom") next.yBottom = Math.max(prev.yBottom + delta, prev.yTop + 10);
      return next;
    });
    setBboxDirty(true);
  }

  async function recrop() {
    if (!expandedId) return;
    setSaving(true);
    await fetch(`/api/training/${expandedId}/recrop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bbox),
    });
    setSaving(false);
    setBboxDirty(false);
    setImgKey(prev => prev + 1);
  }

  async function saveText(id: string) {
    const text = dirtyTexts[id];
    if (text === undefined || !text.trim()) return;
    // Skip if text hasn't actually changed
    const current = examples.find(e => e.id === id);
    if (current && text.trim() === current.text) {
      setDirtyTexts(prev => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    setSavingTextId(id);
    try {
      const res = await fetch("/api/training", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text }),
      });
      if (res.ok) {
        setExamples(prev => prev.map(e => e.id === id ? { ...e, text: text.trim() } : e));
        setDirtyTexts(prev => { const n = { ...prev }; delete n[id]; return n; });
        // Show "Saved" for 1.5 seconds
        setTimeout(() => setSavingTextId(prev => prev === id ? null : prev), 1500);
        return;
      }
      console.error("Save failed:", await res.text());
    } catch (err) {
      console.error("Save error:", err);
    }
    // On failure, keep dirty state so user knows it didn't save
    setSavingTextId(null);
  }

  function deleteExample(id: string) {
    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      fetch("/api/training", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
    }
    setDeletedIds(prev => new Set(prev).add(id));
    if (expandedId === id) setExpandedId(null);

    const timer = setTimeout(async () => {
      await fetch("/api/training", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setPendingDelete(null);
      setDeletedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      setExamples(prev => prev.filter(e => e.id !== id));
      setTotal(prev => prev - 1);
    }, 5000);
    setPendingDelete({ id, timer });
  }

  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    setDeletedIds(prev => { const n = new Set(prev); n.delete(pendingDelete.id); return n; });
    setPendingDelete(null);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (status === "loading") return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold">Review Training Data</h1>
          <p className="text-sm text-gray-500">{total} examples</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push("/training")} className="text-sm text-blue-600 hover:underline">Training Page</button>
          <button onClick={() => router.push("/dashboard")} className="text-sm text-blue-600 hover:underline">Dashboard</button>
        </div>
      </div>

      {/* Profile filter */}
      {profiles.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => { setFilterProfile(""); loadPage(0); }}
            className={`px-3 py-1 rounded-full text-sm border ${!filterProfile ? "bg-blue-100 border-blue-500" : "bg-gray-50 border-gray-200 hover:bg-gray-100"}`}>
            All
          </button>
          {profiles.map(p => (
            <button key={p.id} onClick={() => { setFilterProfile(p.id); loadPage(0); }}
              className={`px-3 py-1 rounded-full text-sm border ${filterProfile === p.id ? "bg-blue-100 border-blue-500" : "bg-gray-50 border-gray-200 hover:bg-gray-100"}`}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => loadPage(offset - PAGE_SIZE)} disabled={offset === 0}
            className="px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300 disabled:opacity-30">Prev</button>
          <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
          <button onClick={() => loadPage(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300 disabled:opacity-30">Next</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-2">
          {examples.filter(e => !deletedIds.has(e.id)).map(item => (
            <div key={item.id} className="bg-white rounded-lg shadow overflow-hidden">
              {/* Row */}
              <div className="flex items-center gap-3 p-3">
                {/* Word crop thumbnail — click to expand */}
                <div className="w-24 h-12 flex-shrink-0 bg-gray-100 rounded flex items-center justify-center overflow-hidden cursor-pointer"
                  onClick={() => toggleExpand(item)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/training/${item.id}/image?k=${imgKey}`} alt={item.text}
                    className="max-w-full max-h-full object-contain" loading="lazy" />
                </div>

                {/* Inline editable text */}
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <input
                    type="text"
                    value={dirtyTexts[item.id] ?? item.text}
                    onChange={e => setDirtyTexts(prev => ({ ...prev, [item.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") saveText(item.id); }}
                    onBlur={() => { if (dirtyTexts[item.id] && dirtyTexts[item.id] !== item.text) saveText(item.id); }}
                    className={`border rounded px-2 py-1 text-sm flex-1 min-w-0 font-medium ${
                      dirtyTexts[item.id] && dirtyTexts[item.id] !== item.text ? "border-orange-400 bg-orange-50" : "border-gray-200"
                    }`}
                    dir="rtl"
                  />
                  {savingTextId === item.id && <span className="text-xs text-green-600 font-medium animate-pulse">Saved!</span>}
                  {dirtyTexts[item.id] !== undefined && dirtyTexts[item.id] !== item.text && savingTextId !== item.id && (
                    <button onClick={() => saveText(item.id)} className="text-xs px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600">Save</button>
                  )}
                </div>

                {/* Source badge */}
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                  item.source === "confirmed" ? "bg-blue-100 text-blue-600" :
                  item.source === "corrected" ? "bg-green-100 text-green-600" :
                  "bg-gray-100 text-gray-500"
                }`}>
                  {item.source === "confirmed" ? "correct" : item.source === "corrected" ? "corrected" : item.source || "manual"}
                </span>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  {item.sourceLineId && (
                    <button onClick={() => toggleExpand(item)}
                      className="text-xs px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-600">
                      {expandedId === item.id ? "Close" : "Crop"}
                    </button>
                  )}
                  <button onClick={() => deleteExample(item.id)}
                    className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-500">Del</button>
                </div>
              </div>

              {/* Expanded: source page zoomed to word with live bbox + nudge controls */}
              {expandedId === item.id && (
                <div className="border-t p-4 bg-gray-50">
                  {!item.sourceLineId ? (
                    <p className="text-sm text-gray-400">Manual upload — no bounding box to edit.</p>
                  ) : bboxLoading ? (
                    <p className="text-sm text-gray-400">Loading...</p>
                  ) : !contextFileId ? (
                    <p className="text-sm text-gray-400">Source not found.</p>
                  ) : (
                    <div className="space-y-3">
                      {/* Hidden img to get natural dimensions */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={sourceImgRef}
                        src={`/api/files/${contextFileId}/image`}
                        alt=""
                        style={{ display: "none" }}
                        onLoad={e => {
                          const img = e.currentTarget;
                          setSourceImgSize({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                      />

                      {/* SVG zoomed view of source page around the word */}
                      {sourceImgSize && (() => {
                        const bboxW = bbox.xRight - bbox.xLeft;
                        const bboxH = bbox.yBottom - bbox.yTop;
                        const pad = Math.max(bboxW, bboxH) * 1.2;
                        const cx = (bbox.xLeft + bbox.xRight) / 2;
                        const cy = (bbox.yTop + bbox.yBottom) / 2;
                        const vx = Math.max(0, cx - pad);
                        const vy = Math.max(0, cy - pad * 0.6);
                        const vw = Math.min(sourceImgSize.w - vx, pad * 2);
                        const vh = Math.min(sourceImgSize.h - vy, pad * 1.2);
                        return (
                          <div className="bg-white border rounded overflow-hidden inline-block">
                            <svg width="100%" height="180" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet">
                              <image href={`/api/files/${contextFileId}/image`}
                                x="0" y="0" width={sourceImgSize.w} height={sourceImgSize.h} />
                              {/* Original bbox (faint) */}
                              {bboxDirty && (
                                <rect x={originalBbox.xLeft} y={originalBbox.yTop}
                                  width={originalBbox.xRight - originalBbox.xLeft}
                                  height={originalBbox.yBottom - originalBbox.yTop}
                                  fill="none" stroke="rgba(156,163,175,0.5)" strokeWidth={2}
                                  strokeDasharray="6 3" />
                              )}
                              {/* Current bbox */}
                              <rect x={bbox.xLeft} y={bbox.yTop}
                                width={bboxW} height={bboxH}
                                fill="none" stroke="rgba(249,115,22,0.9)" strokeWidth={3} />
                            </svg>
                          </div>
                        );
                      })()}

                      {/* Nudge controls */}
                      <div className="flex flex-wrap gap-3 text-xs items-center">
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 w-12">Left:</span>
                          <button onClick={() => nudge("left", -NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&larr;</button>
                          <button onClick={() => nudge("left", NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&rarr;</button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 w-12">Right:</span>
                          <button onClick={() => nudge("right", -NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&larr;</button>
                          <button onClick={() => nudge("right", NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&rarr;</button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 w-12">Top:</span>
                          <button onClick={() => nudge("top", -NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&uarr;</button>
                          <button onClick={() => nudge("top", NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&darr;</button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500 w-12">Bottom:</span>
                          <button onClick={() => nudge("bottom", -NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&uarr;</button>
                          <button onClick={() => nudge("bottom", NUDGE_PX)}
                            className="px-2.5 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-base leading-none">&darr;</button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={recrop} disabled={saving || !bboxDirty}
                          className="px-3 py-1.5 rounded text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
                          {saving ? "Saving..." : "Save & Re-crop"}
                        </button>
                        <button onClick={() => { setBbox(originalBbox); setBboxDirty(false); }}
                          disabled={!bboxDirty}
                          className="px-3 py-1.5 rounded text-sm bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-40">
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => loadPage(offset - PAGE_SIZE)} disabled={offset === 0}
            className="px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300 disabled:opacity-30">Prev</button>
          <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
          <button onClick={() => loadPage(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300 disabled:opacity-30">Next</button>
        </div>
      )}

      {/* Undo delete toast */}
      {pendingDelete && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3">
          <span className="text-sm">Example deleted</span>
          <button onClick={undoDelete}
            className="bg-white text-gray-900 px-3 py-1 rounded text-sm font-medium hover:bg-gray-100">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

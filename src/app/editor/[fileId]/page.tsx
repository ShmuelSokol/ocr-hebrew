"use client";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";

interface Word {
  id: string;
  wordIndex: number;
  rawText: string;
  correctedText: string | null;
}

interface Line {
  id: string;
  lineIndex: number;
  yTop: number;
  yBottom: number;
  rawText: string;
  correctedText: string | null;
  words: Word[];
}

interface OCRResult {
  id: string;
  rawText: string;
  lines: Line[];
}

interface DetectedLine {
  yTop: number;
  yBottom: number;
}

const RERUN_THRESHOLD = 5;

export default function EditorPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const fileId = params.fileId as string;

  const [result, setResult] = useState<OCRResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [filename, setFilename] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [showProfileCorrections, setShowProfileCorrections] = useState(false);
  const [profileCorrections, setProfileCorrections] = useState<{
    totalCorrections: number;
    uniqueWords: number;
    words: { originalText: string; corrections: { correctedText: string; count: number; ids: string[] }[] }[];
  } | null>(null);
  const [imageNaturalHeight, setImageNaturalHeight] = useState(0);
  const [imageDisplayWidth, setImageDisplayWidth] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [showRerunBanner, setShowRerunBanner] = useState(false);
  // Training mode
  const [trainingMode, setTrainingMode] = useState(false);
  const [detectedLines, setDetectedLines] = useState<DetectedLine[]>([]);
  const [trainingTexts, setTrainingTexts] = useState<Record<number, string>>({});
  const [detectingLines, setDetectingLines] = useState(false);
  // Word-by-word review
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewLineIdx, setReviewLineIdx] = useState(0);
  const [reviewWordIdx, setReviewWordIdx] = useState(0);
  const [reviewEditValue, setReviewEditValue] = useState("");
  const [reviewEditing, setReviewEditing] = useState(false);
  // Add word
  const [addingWordLineId, setAddingWordLineId] = useState<string | null>(null);
  const [addingWordAfterIdx, setAddingWordAfterIdx] = useState<number>(-1);
  const [addWordValue, setAddWordValue] = useState("");
  // Line highlight for side-by-side view
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [imageCacheBust, setImageCacheBust] = useState(() => Date.now());

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const reviewInputRef = useRef<HTMLInputElement>(null);

  const loadResult = useCallback(async () => {
    setLoading(true);
    const [resultRes, fileRes] = await Promise.all([
      fetch(`/api/files/${fileId}/result`),
      fetch(`/api/files`),
    ]);
    const resultData = await resultRes.json();
    const filesData = await fileRes.json();
    const file = filesData.find((f: { id: string }) => f.id === fileId);
    if (file) {
      setFilename(file.filename);
      setFileStatus(file.status);
      setProfileId(file.profileId || null);
      setProfileName(file.profile?.name || null);
    }
    if (resultData?.id) {
      setResult(resultData);
      const corrected = resultData.lines.reduce(
        (sum: number, line: Line) =>
          sum +
          line.words.filter(
            (w: Word) => w.correctedText && w.correctedText !== w.rawText
          ).length,
        0
      );
      setCorrectionCount(corrected);
    }
    setLoading(false);
  }, [fileId]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") loadResult();
  }, [status, router, loadResult]);

  useEffect(() => {
    if (ocrRunning) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ocrRunning]);

  useEffect(() => {
    if (correctionCount >= RERUN_THRESHOLD && result) setShowRerunBanner(true);
  }, [correctionCount, result]);

  // Focus review input when entering edit mode
  useEffect(() => {
    if (reviewEditing && reviewInputRef.current) reviewInputRef.current.focus();
  }, [reviewEditing]);

  function onImageLoad() {
    if (imageRef.current) {
      setImageNaturalHeight(imageRef.current.naturalHeight);
      setImageDisplayWidth(imageRef.current.clientWidth);
    }
  }

  async function startTrainingMode() {
    setDetectingLines(true);
    const res = await fetch(`/api/files/${fileId}/detect-lines`, { method: "POST" });
    if (res.ok) { const data = await res.json(); setDetectedLines(data.lines); setTrainingMode(true); }
    setDetectingLines(false);
  }

  async function confirmLine(lineId: string) {
    await fetch(`/api/lines/${lineId}/confirm`, { method: "POST" });
    await loadResult();
  }

  async function confirmAllLines() {
    if (!result) return;
    for (const line of result.lines) {
      if (line.words.some((w) => !w.correctedText))
        await fetch(`/api/lines/${line.id}/confirm`, { method: "POST" });
    }
    await loadResult();
  }

  function buildFewShotLines() {
    const lines: { lineIndex: number; text: string }[] = [];
    for (const [idx, text] of Object.entries(trainingTexts)) {
      if (text.trim()) lines.push({ lineIndex: parseInt(idx), text: text.trim() });
    }
    if (result) {
      for (const line of result.lines) {
        if (lines.some((l) => l.lineIndex === line.lineIndex)) continue;
        if (line.words.every((w) => w.correctedText)) {
          lines.push({ lineIndex: line.lineIndex, text: line.words.map((w) => w.correctedText || w.rawText).join(" ") });
        }
      }
    }
    return lines;
  }

  async function runOCR() {
    setOcrRunning(true);
    setShowRerunBanner(false);
    setReviewMode(false);
    const fewShotLines = buildFewShotLines();
    const res = await fetch(`/api/files/${fileId}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fewShotLines: fewShotLines.length > 0 ? fewShotLines : undefined }),
    });
    if (res.ok) { setTrainingMode(false); setCorrectionCount(0); await loadResult(); }
    else { const err = await res.json(); alert("OCR Error: " + (err.error || "Unknown error")); }
    setOcrRunning(false);
  }

  async function preprocessImage() {
    const res = await fetch(`/api/files/${fileId}/preprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrast: 1.3, brightness: 10, sharpen: true, grayscale: true, deskew: true }),
    });
    if (res.ok) {
      const data = await res.json();
      const bust = Date.now();
      setImageCacheBust(bust);
      if (imageRef.current) imageRef.current.src = `/api/files/${fileId}/image?t=${bust}`;
      if (data.skewAngle && Math.abs(data.skewAngle) > 0.1) {
        alert(`Straightened image by ${data.skewAngle.toFixed(1)}°`);
      }
    }
  }

  async function loadProfileCorrections() {
    if (!profileId) return;
    const res = await fetch(`/api/profiles/${profileId}/corrections`);
    if (res.ok) {
      const data = await res.json();
      setProfileCorrections(data);
      setShowProfileCorrections(true);
    }
  }

  async function deleteCorrection(ids: string[]) {
    for (const id of ids) {
      await fetch(`/api/corrections/${id}`, { method: "DELETE" });
    }
    if (profileId) {
      const res = await fetch(`/api/profiles/${profileId}/corrections`);
      if (res.ok) setProfileCorrections(await res.json());
    }
  }

  async function clearAllCorrections() {
    if (!profileCorrections || !profileId) return;
    if (!confirm(`Delete all ${profileCorrections.totalCorrections} learned corrections for this profile? This cannot be undone.`)) return;
    const allIds = profileCorrections.words.flatMap((w) => w.corrections.flatMap((c) => c.ids));
    for (const id of allIds) {
      await fetch(`/api/corrections/${id}`, { method: "DELETE" });
    }
    const res = await fetch(`/api/profiles/${profileId}/corrections`);
    if (res.ok) setProfileCorrections(await res.json());
  }

  async function manualRotate(degrees: number) {
    const res = await fetch(`/api/files/${fileId}/preprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotate: degrees }),
    });
    if (res.ok) {
      const bust = Date.now();
      setImageCacheBust(bust);
      if (imageRef.current) imageRef.current.src = `/api/files/${fileId}/image?t=${bust}`;
    }
  }

  async function straightenImage() {
    const res = await fetch(`/api/files/${fileId}/preprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deskew: true }),
    });
    if (res.ok) {
      const data = await res.json();
      const bust = Date.now();
      setImageCacheBust(bust);
      if (imageRef.current) imageRef.current.src = `/api/files/${fileId}/image?t=${bust}`;
      if (Math.abs(data.skewAngle) < 0.1) {
        alert("Image appears straight (no significant skew detected). Try 'Enhance Image' for full processing.");
      } else {
        alert(`Straightened by ${data.skewAngle.toFixed(1)}°`);
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert("Straighten failed: " + (err.error || "Unknown error"));
    }
  }

  async function saveWord(wordId: string, corrected: string) {
    await fetch(`/api/words/${wordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correctedText: corrected }),
    });
    setEditingWord(null);
    await loadResult();
  }

  async function deleteWord(wordId: string) {
    if (!confirm("Delete this word?")) return;
    await fetch(`/api/words/${wordId}`, { method: "DELETE" });
    await loadResult();
  }

  async function addWord(lineId: string, afterWordIndex: number, text: string) {
    if (!text.trim()) return;
    await fetch(`/api/lines/${lineId}/words`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), afterWordIndex }),
    });
    setAddingWordLineId(null);
    setAddWordValue("");
    await loadResult();
  }

  function startEdit(word: Word) {
    setEditingWord(word.id);
    setEditValue(word.correctedText || word.rawText);
  }

  // === Review mode helpers ===
  function startReview() {
    setReviewLineIdx(0);
    setReviewWordIdx(0);
    setReviewEditing(false);
    setReviewMode(true);
  }

  const reviewLine = result?.lines[reviewLineIdx];
  const reviewWord = reviewLine?.words[reviewWordIdx];
  const totalWords = result ? result.lines.reduce((s, l) => s + l.words.length, 0) : 0;
  const currentWordNum = result
    ? result.lines.slice(0, reviewLineIdx).reduce((s, l) => s + l.words.length, 0) + reviewWordIdx + 1
    : 0;

  function reviewNext() {
    if (!result) return;
    setReviewEditing(false);
    const line = result.lines[reviewLineIdx];
    if (reviewWordIdx < line.words.length - 1) {
      setReviewWordIdx(reviewWordIdx + 1);
    } else if (reviewLineIdx < result.lines.length - 1) {
      setReviewLineIdx(reviewLineIdx + 1);
      setReviewWordIdx(0);
    }
  }

  function reviewPrev() {
    if (!result) return;
    setReviewEditing(false);
    if (reviewWordIdx > 0) {
      setReviewWordIdx(reviewWordIdx - 1);
    } else if (reviewLineIdx > 0) {
      const prevLine = result.lines[reviewLineIdx - 1];
      setReviewLineIdx(reviewLineIdx - 1);
      setReviewWordIdx(prevLine.words.length - 1);
    }
  }

  async function reviewConfirm() {
    if (!reviewWord) return;
    const text = reviewWord.correctedText || reviewWord.rawText;
    await saveWord(reviewWord.id, text);
    reviewNext();
  }

  async function reviewSave() {
    if (!reviewWord) return;
    await saveWord(reviewWord.id, reviewEditValue);
    setReviewEditing(false);
    reviewNext();
  }

  async function reviewDelete() {
    if (!reviewWord) return;
    await fetch(`/api/words/${reviewWord.id}`, { method: "DELETE" });
    await loadResult();
    // Adjust index if needed
    if (result) {
      const line = result.lines[reviewLineIdx];
      if (line && reviewWordIdx >= line.words.length - 1 && reviewWordIdx > 0) {
        setReviewWordIdx(reviewWordIdx - 1);
      }
    }
  }

  // Keyboard nav for review mode
  useEffect(() => {
    if (!reviewMode || reviewEditing) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); reviewNext(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); reviewPrev(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        setReviewEditValue(reviewWord?.correctedText || reviewWord?.rawText || "");
        setReviewEditing(true);
      }
      else if (e.key === " ") { e.preventDefault(); reviewConfirm(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode, reviewEditing, reviewLineIdx, reviewWordIdx, result]);

  const trainingLineCount = Object.values(trainingTexts).filter((t) => t.trim()).length;

  const scale = imageDisplayWidth && imageRef.current
    ? imageDisplayWidth / imageRef.current.naturalWidth
    : 1;

  // === Render training mode ===
  function renderTraining() {
    if (!detectedLines.length || !imageNaturalHeight) return null;
    return (
      <div className="relative" style={{ width: imageDisplayWidth || "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/files/${fileId}/image?t=${imageCacheBust}`} alt="Original" className="w-full block" />
        {detectedLines.map((line, i) => (
          <div key={`train-${i}`} className="absolute left-0 right-0 flex items-center gap-1 px-2" dir="rtl"
            style={{ top: `${(line.yTop / imageNaturalHeight) * 100}%`, minHeight: `${((line.yBottom - line.yTop) / imageNaturalHeight) * 100}%` }}>
            <span className="text-xs bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0">{i + 1}</span>
            <input type="text" dir="rtl" placeholder={i < 3 ? "Type this line..." : ""} value={trainingTexts[i] || ""}
              onChange={(e) => setTrainingTexts((prev) => ({ ...prev, [i]: e.target.value }))}
              className={`flex-1 border rounded px-2 py-1 text-sm text-right ${trainingTexts[i]?.trim() ? "bg-green-50/90 border-green-400" : "bg-white/80 border-gray-300"}`} />
          </div>
        ))}
      </div>
    );
  }

  // === Render word add button ===
  function renderAddBtn(lineId: string, afterIdx: number) {
    const isAdding = addingWordLineId === lineId && addingWordAfterIdx === afterIdx;
    if (isAdding) {
      return (
        <span className="inline-flex items-center gap-1">
          <input type="text" dir="rtl" value={addWordValue} onChange={(e) => setAddWordValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addWord(lineId, afterIdx, addWordValue); if (e.key === "Escape") { setAddingWordLineId(null); setAddWordValue(""); } }}
            className="border-2 border-purple-500 rounded px-1 py-0.5 text-base w-24 text-right bg-white" autoFocus placeholder="word..." />
          <button onClick={() => addWord(lineId, afterIdx, addWordValue)} className="text-purple-600 text-sm font-bold">&#10003;</button>
          <button onClick={() => { setAddingWordLineId(null); setAddWordValue(""); }} className="text-gray-400 text-sm font-bold">&#10005;</button>
        </span>
      );
    }
    return (
      <button onClick={() => { setAddingWordLineId(lineId); setAddingWordAfterIdx(afterIdx); setAddWordValue(""); }}
        className="text-gray-300 hover:text-purple-500 text-lg leading-none px-0.5 transition-colors" title="Add word here">+</button>
    );
  }

  // === Render side-by-side view: full image left, OCR text right ===
  function renderOverlay() {
    if (!result?.lines.length || !imageNaturalHeight) return null;

    return (
      <div className="flex flex-col lg:flex-row">
        {/* Left: Full original image with line highlight boxes */}
        <div className="relative lg:w-1/2 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${fileId}/image?t=${imageCacheBust}`} alt="Original" className="w-full block" />
          {/* Line highlight overlays */}
          {result.lines.map((line) => {
            const isHovered = highlightedLine === line.lineIndex;
            return (
              <div key={`hl-${line.id}`}
                className="absolute left-0 right-0 cursor-pointer transition-all duration-150"
                style={{
                  top: `${(line.yTop / imageNaturalHeight) * 100}%`,
                  height: `${((line.yBottom - line.yTop) / imageNaturalHeight) * 100}%`,
                  backgroundColor: isHovered ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  borderTop: isHovered ? "2px solid rgba(59, 130, 246, 0.5)" : "none",
                  borderBottom: isHovered ? "2px solid rgba(59, 130, 246, 0.5)" : "none",
                }}
                onMouseEnter={() => setHighlightedLine(line.lineIndex)}
                onMouseLeave={() => setHighlightedLine(null)}
                onClick={() => setHighlightedLine(line.lineIndex === highlightedLine ? null : line.lineIndex)}
              />
            );
          })}
        </div>

        {/* Right: OCR text lines */}
        {showOverlay && (
          <div className="lg:w-1/2 lg:border-l lg:overflow-y-auto lg:max-h-[80vh]">
            {result.lines.map((line) => {
              const allConfirmed = line.words.every((w) => w.correctedText);
              const isHovered = highlightedLine === line.lineIndex;

              return (
                <div key={line.id}
                  className={`px-3 py-2 border-b transition-colors duration-150 ${
                    isHovered ? "bg-blue-50 border-blue-300" :
                    allConfirmed ? "bg-green-50/50 border-gray-200" : "bg-white border-gray-200"
                  }`}
                  dir="rtl"
                  onMouseEnter={() => setHighlightedLine(line.lineIndex)}
                  onMouseLeave={() => setHighlightedLine(null)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] text-gray-400 mt-1 shrink-0 w-4 text-center">{line.lineIndex + 1}</span>
                    <div className="flex flex-wrap items-center gap-0.5 text-base leading-relaxed flex-1">
                      {renderAddBtn(line.id, -1)}
                      {line.words.map((word) => {
                        const isCorrected = word.correctedText && word.correctedText !== word.rawText;
                        const isEditing = editingWord === word.id;
                        const displayText = word.correctedText || word.rawText;

                        return (
                          <span key={word.id} className="inline-flex items-center">
                            {isEditing ? (
                              <span className="inline-flex items-center gap-1">
                                <input type="text" dir="rtl" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveWord(word.id, editValue); if (e.key === "Escape") setEditingWord(null); }}
                                  className="border-2 border-blue-500 rounded px-1 py-0.5 text-base w-28 text-right bg-white" autoFocus />
                                <button onClick={() => saveWord(word.id, editValue)} className="text-green-600 text-sm font-bold">&#10003;</button>
                                <button onClick={() => setEditingWord(null)} className="text-red-500 text-sm font-bold">&#10005;</button>
                                <button onClick={() => deleteWord(word.id)} className="text-red-400 text-xs hover:text-red-600" title="Delete word">&#128465;</button>
                              </span>
                            ) : (
                              <span onClick={() => startEdit(word)}
                                className={`cursor-pointer px-1.5 py-0.5 rounded transition-all hover:bg-blue-100 hover:shadow ${
                                  isCorrected ? "bg-green-100 border border-green-300 font-medium" : "hover:underline"
                                } ${word.rawText === "[?]" ? "bg-red-100 text-red-500 border border-red-300" : ""}`}
                                title={isCorrected ? `Original: ${word.rawText}` : "Click to correct"}>
                                {displayText}
                              </span>
                            )}
                            {renderAddBtn(line.id, word.wordIndex)}
                          </span>
                        );
                      })}
                    </div>
                    {!allConfirmed ? (
                      <button onClick={() => confirmLine(line.id)}
                        className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 whitespace-nowrap mt-0.5 shrink-0" title="Confirm this line">&#10003;</button>
                    ) : (
                      <span className="text-xs text-green-600 whitespace-nowrap mt-1 shrink-0">&#10003;</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // === Render review mode ===
  function renderReview() {
    if (!result || !reviewLine || !reviewWord) return null;

    const lineHeight = (reviewLine.yBottom - reviewLine.yTop) * scale;

    return (
      <div className="p-4 space-y-4">
        {/* Progress bar */}
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Word {currentWordNum} of {totalWords}</span>
          <span>Line {reviewLineIdx + 1} of {result.lines.length}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(currentWordNum / totalWords) * 100}%` }} />
        </div>

        {/* Image strip for this line (larger) */}
        <div className="border rounded-lg overflow-hidden">
          <div style={{
            width: "100%", height: Math.max(lineHeight * 1.5, 60),
            backgroundImage: `url(/api/files/${fileId}/image?t=${imageCacheBust})`,
            backgroundPosition: `0 ${-reviewLine.yTop * scale}px`,
            backgroundSize: `${imageDisplayWidth}px auto`,
            backgroundRepeat: "no-repeat",
          }} />
        </div>

        {/* Full line text with current word highlighted */}
        <div className="flex flex-wrap gap-1 text-lg leading-relaxed justify-end p-3 bg-gray-50 rounded-lg border" dir="rtl">
          {reviewLine.words.map((w, wi) => (
            <span key={w.id} className={`px-2 py-1 rounded ${wi === reviewWordIdx
              ? "bg-blue-500 text-white font-bold text-xl ring-2 ring-blue-300"
              : w.correctedText ? "bg-green-100 text-green-800" : "text-gray-600"}`}>
              {w.correctedText || w.rawText}
            </span>
          ))}
        </div>

        {/* Focused word card */}
        <div className="bg-white border-2 border-blue-200 rounded-xl p-6 text-center space-y-4">
          <div className="text-3xl font-bold" dir="rtl">{reviewWord.correctedText || reviewWord.rawText}</div>
          {reviewWord.correctedText && reviewWord.correctedText !== reviewWord.rawText && (
            <div className="text-sm text-gray-400">Original OCR: <span className="font-mono">{reviewWord.rawText}</span></div>
          )}

          {reviewEditing ? (
            <div className="flex items-center justify-center gap-2">
              <input ref={reviewInputRef} type="text" dir="rtl" value={reviewEditValue}
                onChange={(e) => setReviewEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") reviewSave(); if (e.key === "Escape") setReviewEditing(false); }}
                className="border-2 border-blue-500 rounded px-3 py-2 text-xl text-right w-48 bg-white" />
              <button onClick={reviewSave} className="bg-green-500 text-white px-4 py-2 rounded font-medium hover:bg-green-600">Save</button>
              <button onClick={() => setReviewEditing(false)} className="text-gray-500 px-3 py-2 hover:text-gray-700">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <button onClick={reviewConfirm}
                className="bg-green-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-600 text-sm">
                &#10003; Correct (Space)
              </button>
              <button onClick={() => { setReviewEditValue(reviewWord.correctedText || reviewWord.rawText); setReviewEditing(true); }}
                className="bg-blue-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-600 text-sm">
                &#9998; Edit (Enter)
              </button>
              <button onClick={reviewDelete}
                className="bg-red-100 text-red-600 px-4 py-2 rounded-lg font-medium hover:bg-red-200 text-sm">
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button onClick={reviewPrev} disabled={reviewLineIdx === 0 && reviewWordIdx === 0}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-sm">
            &rarr; Previous
          </button>
          <div className="text-xs text-gray-400">Arrow keys to navigate, Space to confirm, Enter to edit</div>
          <button onClick={reviewNext}
            disabled={reviewLineIdx === result.lines.length - 1 && reviewWordIdx === reviewLine.words.length - 1}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-30 text-sm">
            Next &larr;
          </button>
        </div>
      </div>
    );
  }

  if (status === "loading" || loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/dashboard")} className="text-blue-600 hover:underline text-sm">&larr; Dashboard</button>
          <h1 className="text-xl font-bold">{filename}</h1>
          <span className={`px-2 py-0.5 rounded text-xs ${fileStatus === "completed" ? "bg-green-100 text-green-700" : fileStatus === "processing" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>{fileStatus}</span>
        </div>
        <div className="flex gap-2">
          {result && (
            <>
              {!reviewMode && (
                <button onClick={startReview} className="bg-purple-500 text-white px-3 py-1 rounded text-sm hover:bg-purple-600">
                  Review Words
                </button>
              )}
              {reviewMode && (
                <button onClick={() => setReviewMode(false)} className="bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600">
                  Exit Review
                </button>
              )}
              <button onClick={confirmAllLines} className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600">Confirm All</button>
              <button onClick={() => window.open(`/api/files/${fileId}/export?format=txt`, "_blank")} className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">Export TXT</button>
            </>
          )}
        </div>
      </div>

      {/* Profile info + corrections */}
      {profileName && (
        <div className="mb-4 flex items-center gap-3 text-sm">
          <span className="text-gray-500">Profile: <strong>{profileName}</strong></span>
          <button onClick={loadProfileCorrections}
            className={`px-2 py-1 rounded text-xs font-medium ${showProfileCorrections ? "bg-blue-500 text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-700"}`}>
            {showProfileCorrections ? "Hide Corrections" : "View Learned Words"}
          </button>
        </div>
      )}

      {showProfileCorrections && profileCorrections && (
        <div className="bg-white rounded-lg shadow p-4 mb-4 border">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium text-sm">
              Learned corrections
              <span className="text-gray-400 font-normal ml-2">
                ({profileCorrections.totalCorrections} total, {profileCorrections.uniqueWords} unique words)
              </span>
            </h3>
            <div className="flex gap-2">
              {profileCorrections.totalCorrections > 0 && (
                <button onClick={clearAllCorrections}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-50">
                  Clear All
                </button>
              )}
              <button onClick={() => setShowProfileCorrections(false)}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">
                Close
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-auto space-y-1" dir="rtl">
            {profileCorrections.words.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-2">No learned corrections yet</p>
            )}
            {profileCorrections.words.map((word, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1">
                <span className="font-mono bg-gray-200 px-1.5 py-0.5 rounded text-xs">{word.originalText}</span>
                <span className="text-gray-400">&larr;</span>
                <div className="flex gap-1 flex-wrap flex-1">
                  {word.corrections.map((c, j) => (
                    <span key={j} className={`px-1.5 py-0.5 rounded text-xs ${
                      c.correctedText === word.originalText ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                    }`}>
                      {c.correctedText}
                      {c.count > 1 && <span className="opacity-60"> x{c.count}</span>}
                    </span>
                  ))}
                </div>
                <button onClick={() => deleteCorrection(word.corrections.flatMap((c) => c.ids))}
                  className="text-red-400 hover:text-red-600 text-xs px-1" dir="ltr" title="Delete">
                  &#10005;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Re-run suggestion banner */}
      {showRerunBanner && !reviewMode && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-amber-800">You&apos;ve corrected {correctionCount} words</p>
            <p className="text-sm text-amber-600">Re-running OCR will use your corrections as training data for better accuracy.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowRerunBanner(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Dismiss</button>
            <button onClick={runOCR} disabled={ocrRunning} className="bg-amber-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-amber-600 disabled:opacity-50">Re-run OCR</button>
          </div>
        </div>
      )}

      {/* OCR Controls (hidden during review) */}
      {!reviewMode && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          {!result && !trainingMode && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-2"><strong>Tip:</strong> Type the first 2-3 lines manually to teach the OCR how this writer forms letters.</p>
              <button onClick={startTrainingMode} disabled={detectingLines} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {detectingLines ? "Detecting lines..." : "Start Training Mode"}
              </button>
            </div>
          )}
          {trainingMode && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800"><strong>Training Mode:</strong> Type the text for each line. {trainingLineCount > 0 && <span className="text-green-700 font-medium">{trainingLineCount} line{trainingLineCount > 1 ? "s" : ""} entered</span>}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => { setTrainingMode(false); setDetectedLines([]); setTrainingTexts({}); }} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border rounded">Cancel</button>
                <button onClick={runOCR} disabled={ocrRunning || trainingLineCount === 0} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  Run OCR with {trainingLineCount} training line{trainingLineCount !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={straightenImage} className="px-4 py-2 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300" title="Auto-detect and correct tilt/slant">Straighten</button>
            <button onClick={() => manualRotate(-1)} className="px-3 py-2 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300" title="Rotate 1° counter-clockwise">&#8634; -1°</button>
            <button onClick={() => manualRotate(1)} className="px-3 py-2 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300" title="Rotate 1° clockwise">&#8635; +1°</button>
            <button onClick={preprocessImage} className="px-4 py-2 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300" title="Straighten + enhance contrast/sharpness">Enhance Image</button>
            {!trainingMode && (
              <button onClick={runOCR} disabled={ocrRunning}
                className={`px-6 py-2 rounded text-sm font-medium text-white disabled:opacity-50 ${result ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"}`}>
                {ocrRunning ? "Processing..." : result ? "Re-run OCR" : "Run OCR"}
              </button>
            )}
          </div>
          {ocrRunning && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span>Processing image...</span>
                </div>
                <span className="tabular-nums font-mono">{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out" style={{ width: `${Math.min(95, (elapsedSeconds / 60) * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400">{elapsedSeconds < 15 ? "Detecting lines..." : elapsedSeconds < 45 ? "Reading handwriting..." : "Almost done..."}</p>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="bg-white rounded-lg shadow overflow-hidden" ref={containerRef}>
        {result && !reviewMode && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
            <div className="flex items-center gap-3">
              <button onClick={() => setShowOverlay(!showOverlay)}
                className={`text-xs px-3 py-1 rounded font-medium ${showOverlay ? "bg-blue-100 text-blue-700 border border-blue-300" : "bg-gray-200 text-gray-600"}`}>
                {showOverlay ? "Hide Text" : "Show Text"}
              </button>
              {correctionCount > 0 && <span className="text-xs text-gray-500">{correctionCount} correction{correctionCount !== 1 ? "s" : ""}</span>}
            </div>
          </div>
        )}
        <div className="overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} src={`/api/files/${fileId}/image?t=${imageCacheBust}`} alt="" className="w-full invisible h-0" onLoad={onImageLoad} />
          {reviewMode ? (
            renderReview()
          ) : trainingMode && imageNaturalHeight > 0 ? (
            renderTraining()
          ) : !result ? (
            <div className="p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${fileId}/image?t=${imageCacheBust}`} alt="Original" className="w-full" />
            </div>
          ) : imageNaturalHeight > 0 ? (
            renderOverlay()
          ) : (
            <p className="p-8 text-center text-gray-400">Loading image...</p>
          )}
        </div>
      </div>

      {/* Legend */}
      {result && !reviewMode && (
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-gray-50 border border-gray-200 rounded"></span>OCR text (click to edit)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-green-100 border border-green-300 rounded"></span>Corrected/confirmed</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-red-100 border border-red-300 rounded"></span>Unclear [?]</span>
          <span className="flex items-center gap-1"><span className="text-gray-300 text-lg leading-none">+</span> Add word</span>
        </div>
      )}
    </div>
  );
}

"use client";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";

interface Word {
  id: string;
  wordIndex: number;
  rawText: string;
  correctedText: string | null;
  modelText: string | null;
  xLeft: number | null;
  xRight: number | null;
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

// Canvas-based word crop — uses real coordinates from Opus
function WordCropCanvas({ imgEl, word, line, maxHeight = 50 }: {
  imgEl: HTMLImageElement | null;
  word: Word;
  line: Line;
  maxHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl || !imgEl.complete || !imgEl.naturalWidth) return;
    if (word.xLeft == null || word.xRight == null) return;

    const srcW = word.xRight - word.xLeft;
    const srcH = line.yBottom - line.yTop;
    if (srcW <= 0 || srcH <= 0) return;

    const scale = Math.min(2, maxHeight / srcH);
    canvas.width = Math.max(20, Math.round(srcW * scale));
    canvas.height = Math.max(15, Math.round(srcH * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(imgEl, word.xLeft, line.yTop, srcW, srcH, 0, 0, canvas.width, canvas.height);
  }, [imgEl, word.xLeft, word.xRight, line.yTop, line.yBottom, maxHeight]);

  if (word.xLeft == null || word.xRight == null) return null;
  return <canvas ref={canvasRef} className="block" />;
}

// Canvas-based line crop
function LineCropCanvas({ imgEl, line, maxHeight = 80 }: {
  imgEl: HTMLImageElement | null;
  line: Line;
  maxHeight?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl || !imgEl.complete || !imgEl.naturalWidth) return;

    const srcH = line.yBottom - line.yTop;
    if (srcH <= 0) return;

    const scale = Math.min(1, maxHeight / srcH);
    canvas.width = Math.round(imgEl.naturalWidth * scale);
    canvas.height = Math.max(20, Math.round(srcH * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(imgEl, 0, line.yTop, imgEl.naturalWidth, srcH, 0, 0, canvas.width, canvas.height);
  }, [imgEl, line.yTop, line.yBottom, maxHeight]);

  return <canvas ref={canvasRef} className="w-full block" />;
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
  const [ocrMethod, setOcrMethod] = useState<"azure" | "doctr">("azure");
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [filename, setFilename] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [showTrainingExamples, setShowTrainingExamples] = useState(false);
  const [trainingExamples, setTrainingExamples] = useState<{
    id: string; storagePath: string; text: string; createdAt: string;
  }[]>([]);
  const [imageNaturalHeight, setImageNaturalHeight] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [showRerunBanner, setShowRerunBanner] = useState(false);
  const [trainingMode, setTrainingMode] = useState(false);
  const [detectedLines, setDetectedLines] = useState<DetectedLine[]>([]);
  const [trainingTexts, setTrainingTexts] = useState<Record<number, string>>({});
  const [detectingLines, setDetectingLines] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewLineIdx, setReviewLineIdx] = useState(0);
  const [reviewWordIdx, setReviewWordIdx] = useState(0);
  const [reviewEditValue, setReviewEditValue] = useState("");
  const [reviewEditing, setReviewEditing] = useState(false);
  const [addingWordLineId, setAddingWordLineId] = useState<string | null>(null);
  const [addingWordAfterIdx, setAddingWordAfterIdx] = useState<number>(-1);
  const [addWordValue, setAddWordValue] = useState("");
  const [imageCacheBust, setImageCacheBust] = useState(() => Date.now());
  // This counter triggers canvas re-draws when the image changes
  const [imageVersion, setImageVersion] = useState(0);
  const [confirmedWords, setConfirmedWords] = useState<Set<string>>(new Set());
  const [trocrRunning, setTrocrRunning] = useState(false);
  const [trocrProgress, setTrocrProgress] = useState<{ processed: number; total: number } | null>(null);
  const [textSource, setTextSource] = useState<"azure" | "trocr">("azure");

  const imageRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ocrStartRef = useRef<number>(0);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ─── Data Loading ──────────────────────────────────────

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
          sum + line.words.filter((w: Word) => w.correctedText && w.correctedText !== w.rawText).length,
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
      ocrStartRef.current = Date.now();
      setElapsedSeconds(0);
      // Use wall-clock time so timer stays accurate when tab is backgrounded on mobile
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - ocrStartRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [ocrRunning]);

  useEffect(() => {
    if (correctionCount >= RERUN_THRESHOLD && result) setShowRerunBanner(true);
  }, [correctionCount, result]);

  useEffect(() => {
    if (reviewEditing && editInputRef.current) editInputRef.current.focus();
  }, [reviewEditing]);

  function onImageLoad() {
    if (imageRef.current) {
      setImageNaturalHeight(imageRef.current.naturalHeight);
      setImageVersion((v) => v + 1);
    }
  }

  // ─── Actions ───────────────────────────────────────────

  async function startTrainingMode() {
    setDetectingLines(true);
    const res = await fetch(`/api/files/${fileId}/detect-lines`, { method: "POST" });
    if (res.ok) { const data = await res.json(); setDetectedLines(data.lines); setTrainingMode(true); }
    setDetectingLines(false);
  }

  async function confirmLine(lineId: string) {
    await fetch(`/api/lines/${lineId}/confirm`, { method: "POST" });
    if (profileId) fetch(`/api/lines/${lineId}/save-training`, { method: "POST" }).catch(() => {});
    await loadResult();
  }

  async function unconfirmLine(lineId: string) {
    await fetch(`/api/lines/${lineId}/confirm`, { method: "DELETE" });
    await loadResult();
  }

  async function confirmAllLines() {
    if (!result) return;
    const toConfirm = result.lines.filter((line) => line.words.some((w) => !w.correctedText));
    await Promise.all(toConfirm.map((line) => fetch(`/api/lines/${line.id}/confirm`, { method: "POST" })));
    if (profileId) {
      for (const line of toConfirm) fetch(`/api/lines/${line.id}/save-training`, { method: "POST" }).catch(() => {});
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

  async function runOCR(methodOverride?: "azure" | "doctr") {
    const method = methodOverride || ocrMethod;
    setOcrRunning(true);
    setShowRerunBanner(false);
    setReviewMode(false);
    const fewShotLines = buildFewShotLines();
    const res = await fetch(`/api/files/${fileId}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fewShotLines: fewShotLines.length > 0 ? fewShotLines : undefined,
        method,
      }),
    });
    if (res.ok) { setTrainingMode(false); setCorrectionCount(0); await loadResult(); }
    else { const err = await res.json(); alert("OCR Error: " + (err.error || "Unknown error")); }
    setOcrRunning(false);
  }

  async function runTrOCR() {
    setTrocrRunning(true);
    setTrocrProgress(null);
    const res = await fetch(`/api/files/${fileId}/trocr`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setTrocrProgress({ processed: data.processed, total: data.total });
      setTextSource("trocr");
      await loadResult();
    } else {
      const err = await res.json().catch(() => ({}));
      alert("TrOCR Error: " + (err.error || "Unknown error"));
    }
    setTrocrRunning(false);
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
      if (data.skewAngle && Math.abs(data.skewAngle) > 0.1) alert(`Straightened image by ${data.skewAngle.toFixed(1)}deg`);
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
      if (Math.abs(data.skewAngle) < 0.1) alert("Image appears straight. Try 'Enhance Image' for full processing.");
      else alert(`Straightened by ${data.skewAngle.toFixed(1)}deg`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert("Straighten failed: " + (err.error || "Unknown error"));
    }
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

  async function saveWord(wordId: string, corrected: string) {
    // Update locally first — no reload
    setResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map(l => ({
          ...l,
          words: l.words.map(w => w.id === wordId ? { ...w, correctedText: corrected } : w),
        })),
      };
    });
    if (corrected !== result?.lines.flatMap(l => l.words).find(w => w.id === wordId)?.rawText) {
      setCorrectionCount(c => c + 1);
    }
    // Save in background
    fetch(`/api/words/${wordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correctedText: corrected }),
    });
  }

  async function confirmWordCorrect(wordId: string) {
    setConfirmedWords(prev => new Set(prev).add(wordId));
    fetch(`/api/words/${wordId}/confirm`, { method: "POST" }).catch(() => {
      setConfirmedWords(prev => { const next = new Set(prev); next.delete(wordId); return next; });
    });
  }

  async function confirmAllWordsCorrect() {
    if (!result) return;
    const uncorrectedWords = result.lines
      .flatMap(l => l.words)
      .filter(w => !w.correctedText && w.xLeft != null && !confirmedWords.has(w.id));
    for (const w of uncorrectedWords) {
      confirmWordCorrect(w.id);
    }
  }

  // Save current word and move to next
  async function saveAndNext(wordId: string, corrected: string) {
    await saveWord(wordId, corrected);
    editNextWord(wordId);
  }

  // Save current word and move to previous
  async function saveAndPrev(wordId: string, corrected: string) {
    await saveWord(wordId, corrected);
    editPrevWord(wordId);
  }

  function editNextWord(currentWordId: string) {
    if (!result) return;
    const allWords = result.lines.flatMap(l => l.words);
    const idx = allWords.findIndex(w => w.id === currentWordId);
    if (idx >= 0 && idx < allWords.length - 1) {
      startEdit(allWords[idx + 1]);
    } else {
      setEditingWord(null); // was last word
    }
  }

  function editPrevWord(currentWordId: string) {
    if (!result) return;
    const allWords = result.lines.flatMap(l => l.words);
    const idx = allWords.findIndex(w => w.id === currentWordId);
    if (idx > 0) {
      startEdit(allWords[idx - 1]);
    }
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

  const NUDGE_PX = 5;

  async function adjustWordBounds(wordId: string, edge: "left" | "right", direction: "expand" | "shrink") {
    setResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map(l => ({
          ...l,
          words: l.words.map(w => {
            if (w.id !== wordId || w.xLeft == null || w.xRight == null) return w;
            let newLeft = w.xLeft;
            let newRight = w.xRight;
            if (edge === "left") {
              newLeft += direction === "expand" ? -NUDGE_PX : NUDGE_PX;
            } else {
              newRight += direction === "expand" ? NUDGE_PX : -NUDGE_PX;
            }
            // Don't let edges cross or go negative
            if (newLeft < 0) newLeft = 0;
            if (newRight - newLeft < 5) return w;
            return { ...w, xLeft: newLeft, xRight: newRight };
          }),
        })),
      };
    });
    // Find current word bounds after local update
    const word = result?.lines.flatMap(l => l.words).find(w => w.id === wordId);
    if (!word || word.xLeft == null || word.xRight == null) return;
    let newLeft = word.xLeft;
    let newRight = word.xRight;
    if (edge === "left") newLeft += direction === "expand" ? -NUDGE_PX : NUDGE_PX;
    else newRight += direction === "expand" ? NUDGE_PX : -NUDGE_PX;
    if (newLeft < 0) newLeft = 0;
    if (newRight - newLeft < 5) return;
    // Save to server
    fetch(`/api/words/${wordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xLeft: newLeft, xRight: newRight }),
    });
  }

  function startEdit(word: Word) {
    setEditingWord(word.id);
    setEditValue(word.correctedText || (textSource === "trocr" && word.modelText ? word.modelText : word.rawText));
    setTimeout(() => editInputRef.current?.focus(), 50);
  }

  // ─── Training / Corrections Panels ─────────────────────

  async function loadTrainingExamples() {
    if (!profileId) return;
    const res = await fetch(`/api/profiles/${profileId}/training`);
    if (res.ok) { setTrainingExamples((await res.json()).examples); setShowTrainingExamples(true); }
  }

  async function deleteTrainingExample(exampleId: string) {
    if (!profileId) return;
    await fetch(`/api/profiles/${profileId}/training`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exampleId }),
    });
    const res = await fetch(`/api/profiles/${profileId}/training`);
    if (res.ok) setTrainingExamples((await res.json()).examples);
  }

  async function clearAllTrainingExamples() {
    if (!profileId || !confirm(`Delete all ${trainingExamples.length} training examples?`)) return;
    await fetch(`/api/profiles/${profileId}/training`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    setTrainingExamples([]);
  }


  // ─── Review Mode ──────────────────────────────────────

  const reviewLine = result?.lines[reviewLineIdx];
  const reviewWord = reviewLine?.words[reviewWordIdx];
  const totalWords = result ? result.lines.reduce((s, l) => s + l.words.length, 0) : 0;
  const currentWordNum = result
    ? result.lines.slice(0, reviewLineIdx).reduce((s, l) => s + l.words.length, 0) + reviewWordIdx + 1
    : 0;

  function startReview() {
    if (!result) return;
    // Find first line with words
    const firstLine = result.lines.findIndex(l => l.words.length > 0);
    setReviewLineIdx(firstLine >= 0 ? firstLine : 0);
    setReviewWordIdx(0);
    setReviewEditing(false);
    setReviewMode(true);
  }

  function reviewNext() {
    if (!result) return;
    setReviewEditing(false);
    const line = result.lines[reviewLineIdx];
    if (reviewWordIdx < line.words.length - 1) {
      setReviewWordIdx(reviewWordIdx + 1);
    } else {
      // Find next line that has words
      for (let i = reviewLineIdx + 1; i < result.lines.length; i++) {
        if (result.lines[i].words.length > 0) {
          setReviewLineIdx(i);
          setReviewWordIdx(0);
          return;
        }
      }
      // No more lines with words — stay at end
    }
  }

  function reviewPrev() {
    if (!result) return;
    setReviewEditing(false);
    if (reviewWordIdx > 0) {
      setReviewWordIdx(reviewWordIdx - 1);
    } else {
      // Find previous line that has words
      for (let i = reviewLineIdx - 1; i >= 0; i--) {
        if (result.lines[i].words.length > 0) {
          setReviewLineIdx(i);
          setReviewWordIdx(result.lines[i].words.length - 1);
          return;
        }
      }
      // No previous lines with words — stay at start
    }
  }

  async function reviewConfirm() {
    if (!reviewWord) return;
    await saveWord(reviewWord.id, reviewWord.correctedText || reviewWord.rawText);
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
    if (result) {
      const line = result.lines[reviewLineIdx];
      if (line && reviewWordIdx >= line.words.length - 1 && reviewWordIdx > 0) setReviewWordIdx(reviewWordIdx - 1);
    }
  }

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

  // ─── Render: Add Word Button ──────────────────────────

  function renderAddBtn(lineId: string, afterIdx: number) {
    if (addingWordLineId === lineId && addingWordAfterIdx === afterIdx) {
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

  // ─── Render: Word Cards ───────────────────────────────

  function renderWordCards() {
    if (!result?.lines.length || !imageNaturalHeight) return null;
    const imgEl = imageRef.current;

    return (
      <div>
        {result.lines.map((line) => {
          const allConfirmed = line.words.every((w) => w.correctedText);

          return (
            <div key={line.id} className="border-b border-gray-200">
              {/* Line image crop */}
              <div className="px-2 pt-2">
                <LineCropCanvas imgEl={imgEl} line={line} key={`lc-${line.id}-${imageVersion}`} />
              </div>

              {/* Word text row — RTL */}
              <div className="flex flex-wrap items-start gap-1 px-2 py-2" dir="rtl">
                {/* Line number + confirm */}
                <div className="flex flex-col items-center justify-center shrink-0 w-6 pt-1">
                  <span className="text-[10px] text-gray-400">{line.lineIndex + 1}</span>
                  {!allConfirmed ? (
                    <button onClick={() => confirmLine(line.id)}
                      className="text-[10px] text-green-500 hover:text-green-700 mt-1" title="Confirm line">&#10003;</button>
                  ) : (
                    <button onClick={() => unconfirmLine(line.id)}
                      className="text-[10px] text-green-600 hover:text-red-500 mt-1" title="Unconfirm">&#10003;</button>
                  )}
                </div>

                {renderAddBtn(line.id, -1)}

                {line.words.map((word) => {
                  const isCorrected = word.correctedText && word.correctedText !== word.rawText;
                  const isConfirmed = confirmedWords.has(word.id);
                  const isSelected = editingWord === word.id;
                  const displayText = word.correctedText || (textSource === "trocr" && word.modelText ? word.modelText : word.rawText);

                  return (
                    <div key={word.id} className="inline-flex flex-col items-center">
                      <div className="relative">
                        <button
                          onClick={() => startEdit(word)}
                          className={`rounded-lg border-2 transition-all flex flex-col items-center overflow-hidden ${
                            isSelected ? "border-orange-500 ring-2 ring-orange-300 shadow-lg scale-105" :
                            isCorrected ? "border-green-400 bg-green-50 hover:border-green-500 hover:shadow" :
                            isConfirmed ? "border-blue-400 bg-blue-50 hover:border-blue-500 hover:shadow" :
                            word.rawText === "[?]" ? "border-red-300 bg-red-50 hover:border-red-400" :
                            "border-gray-300 bg-white hover:border-blue-400 hover:shadow-md"
                          }`}
                        >
                          {/* Word handwriting crop */}
                          {word.xLeft != null && word.xRight != null && (
                            <div className="bg-white">
                              <WordCropCanvas imgEl={imgEl} word={word} line={line} maxHeight={50} key={`wc-${word.id}-${imageVersion}`} />
                            </div>
                          )}

                          {/* OCR text */}
                          <div className={`w-full text-center px-2 sm:px-3 py-1.5 sm:py-2 text-sm sm:text-base font-bold text-gray-900 ${word.xLeft != null ? "border-t border-gray-200" : ""} ${
                            isSelected ? "bg-orange-100" :
                            isCorrected ? "bg-green-100" :
                            isConfirmed ? "bg-blue-100" :
                            textSource === "trocr" && word.modelText ? "bg-indigo-50" : "bg-gray-50"
                          }`} dir="rtl">
                            {displayText}
                            {textSource === "trocr" && word.modelText && !isCorrected && word.modelText !== word.rawText && (
                              <div className="text-[9px] text-gray-400 font-normal">azure: {word.rawText}</div>
                            )}
                          </div>
                        </button>

                        {/* Confirm correct button */}
                        {!isCorrected && !isConfirmed && word.xLeft != null && profileId && (
                          <button
                            onClick={(e) => { e.stopPropagation(); confirmWordCorrect(word.id); }}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:bg-blue-600 shadow transition-opacity"
                            style={{ opacity: undefined }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = "")}
                            title="Save as correct to training data"
                          >
                            &#10003;
                          </button>
                        )}
                        {isConfirmed && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center shadow">&#10003;</span>
                        )}
                      </div>

                      {renderAddBtn(line.id, word.wordIndex)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Render: Review Mode ──────────────────────────────

  function renderReview() {
    if (!result || !reviewLine || !reviewWord) return null;
    const imgEl = imageRef.current;
    const isFirst = reviewLineIdx === 0 && reviewWordIdx === 0;
    // Check if this is the last word across all lines (skipping empty lines)
    const lastLineWithWords = result.lines.map((l, i) => l.words.length > 0 ? i : -1).filter(i => i >= 0);
    const isLastLine = lastLineWithWords.length === 0 || reviewLineIdx === lastLineWithWords[lastLineWithWords.length - 1];
    const isLast = isLastLine && reviewWordIdx === reviewLine.words.length - 1;

    return (
      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
        {/* Progress */}
        <div className="flex items-center justify-between text-xs sm:text-sm text-gray-500">
          <span>{currentWordNum}/{totalWords}</span>
          <span>Line {reviewLineIdx + 1}/{result.lines.length}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(currentWordNum / totalWords) * 100}%` }} />
        </div>

        {/* Word handwriting crop (large) or line if no coords */}
        <div className="flex justify-center border rounded-xl overflow-hidden bg-white p-2">
          {reviewWord.xLeft != null && reviewWord.xRight != null ? (
            <WordCropCanvas imgEl={imgEl} word={reviewWord} line={reviewLine} maxHeight={100} key={`rwc-${reviewWord.id}-${imageVersion}`} />
          ) : (
            <LineCropCanvas imgEl={imgEl} line={reviewLine} maxHeight={100} key={`rlc-${reviewLine.id}-${imageVersion}`} />
          )}
        </div>

        {/* Focused word text */}
        <div className="bg-white border-2 border-blue-200 rounded-xl p-4 sm:p-6 text-center space-y-3">
          <div className="text-2xl sm:text-3xl font-bold" dir="rtl">{reviewWord.correctedText || (textSource === "trocr" && reviewWord.modelText ? reviewWord.modelText : reviewWord.rawText)}</div>
          {reviewWord.correctedText && reviewWord.correctedText !== reviewWord.rawText && (
            <div className="text-xs sm:text-sm text-gray-400">Original: <span className="font-mono">{reviewWord.rawText}</span></div>
          )}
          {reviewWord.modelText && reviewWord.modelText !== reviewWord.rawText && (
            <div className="text-xs sm:text-sm text-gray-400">TrOCR: <span className="font-mono">{reviewWord.modelText}</span></div>
          )}

          {reviewEditing ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
              <input ref={editInputRef} type="text" dir="rtl" value={reviewEditValue}
                onChange={(e) => setReviewEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") reviewSave(); if (e.key === "Escape") setReviewEditing(false); }}
                className="border-2 border-blue-500 rounded-lg px-4 py-3 text-xl text-right bg-white" />
              <div className="flex gap-2">
                <button onClick={reviewSave} className="flex-1 bg-green-500 text-white px-4 py-3 rounded-lg font-medium hover:bg-green-600 text-base">Save</button>
                <button onClick={() => setReviewEditing(false)} className="flex-1 text-gray-500 px-4 py-3 rounded-lg hover:bg-gray-100 text-base">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => { confirmWordCorrect(reviewWord.id); reviewNext(); }}
                className={`py-3 sm:py-2 rounded-lg font-medium text-base sm:text-sm ${confirmedWords.has(reviewWord.id) ? "bg-blue-200 text-blue-800" : "bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700"}`}
                disabled={confirmedWords.has(reviewWord.id)}>
                {confirmedWords.has(reviewWord.id) ? "Saved" : "&#10003; Correct"}
              </button>
              <button onClick={reviewConfirm} className="bg-green-500 text-white py-3 sm:py-2 rounded-lg font-medium hover:bg-green-600 text-base sm:text-sm active:bg-green-700">
                &#10140; Skip
              </button>
              <button onClick={() => { setReviewEditValue(reviewWord.correctedText || reviewWord.rawText); setReviewEditing(true); }}
                className="bg-orange-500 text-white py-3 sm:py-2 rounded-lg font-medium hover:bg-orange-600 text-base sm:text-sm active:bg-orange-700">
                &#9998; Edit
              </button>
              <button onClick={reviewDelete} className="bg-red-100 text-red-600 py-3 sm:py-2 rounded-lg font-medium hover:bg-red-200 text-base sm:text-sm active:bg-red-300">
                &#10005; Del
              </button>
            </div>
          )}
        </div>

        {/* Line context — collapsed on mobile, shown on desktop */}
        <details className="sm:open bg-gray-50 rounded-lg border">
          <summary className="sm:hidden px-3 py-2 text-xs text-gray-400 cursor-pointer">Show line context</summary>
          <div className="flex flex-wrap gap-1 text-base sm:text-lg leading-relaxed justify-end p-3" dir="rtl">
            {reviewLine.words.map((w, wi) => (
              <span key={w.id} className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${wi === reviewWordIdx
                ? "bg-blue-500 text-white font-bold ring-2 ring-blue-300"
                : w.correctedText ? "bg-green-100 text-green-800" : "text-gray-600"}`}>
                {w.correctedText || (textSource === "trocr" && w.modelText ? w.modelText : w.rawText)}
              </span>
            ))}
          </div>
        </details>

        {/* Navigation — large touch targets */}
        <div className="flex items-center gap-2">
          <button onClick={reviewPrev} disabled={isFirst}
            className="flex-1 py-4 sm:py-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 disabled:opacity-30 text-base sm:text-sm font-medium">&rarr; Prev</button>
          <button onClick={reviewNext} disabled={isLast}
            className="flex-1 py-4 sm:py-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 disabled:opacity-30 text-base sm:text-sm font-medium">Next &larr;</button>
        </div>

        <div className="hidden sm:block text-center text-xs text-gray-400">Arrow keys to navigate, Space to confirm, Enter to edit</div>
      </div>
    );
  }

  // ─── Render: Training Mode ────────────────────────────

  function renderTraining() {
    if (!detectedLines.length || !imageNaturalHeight) return null;
    return (
      <div className="relative" style={{ width: "100%" }}>
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

  // ─── Main Render ──────────────────────────────────────

  const trainingLineCount = Object.values(trainingTexts).filter((t) => t.trim()).length;

  if (status === "loading" || loading) return <div className="p-8">Loading...</div>;

  return (
    <div className={`max-w-5xl mx-auto px-3 py-4 sm:px-6 sm:py-6 ${editingWord ? "pb-44 sm:pb-28" : ""}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-4">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button onClick={() => router.push("/dashboard")} className="text-blue-600 hover:underline text-sm shrink-0">&larr;</button>
          <h1 className="text-base sm:text-xl font-bold truncate">{filename}</h1>
          <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${fileStatus === "completed" ? "bg-green-100 text-green-700" : fileStatus === "processing" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>{fileStatus}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {result && (
            <>
              {!reviewMode && <button onClick={startReview} className="bg-purple-500 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-600">Review Words</button>}
              {reviewMode && <button onClick={() => setReviewMode(false)} className="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600">Exit Review</button>}
              <button onClick={confirmAllLines} className="bg-green-500 text-white px-3 py-1.5 rounded text-sm hover:bg-green-600">Confirm All</button>
              {profileId && <button onClick={confirmAllWordsCorrect} className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600">Save All Correct</button>}
              <button onClick={() => window.open(`/api/files/${fileId}/export?format=txt`, "_blank")} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">Export</button>
            </>
          )}
        </div>
      </div>

      {/* Profile info */}
      {profileName && (
        <div className="mb-4 flex items-center gap-3 text-sm flex-wrap">
          <span className="text-gray-500">Profile: <strong>{profileName}</strong></span>
          <button onClick={() => { if (showTrainingExamples) setShowTrainingExamples(false); else loadTrainingExamples(); }}
            className={`px-2 py-1 rounded text-xs font-medium ${showTrainingExamples ? "bg-purple-500 text-white" : "bg-purple-100 hover:bg-purple-200 text-purple-700"}`}>
            {showTrainingExamples ? "Hide Training" : `Training Examples (${trainingExamples.length || "?"})`}
          </button>
        </div>
      )}

      {/* Training examples panel */}
      {showTrainingExamples && (
        <div className="bg-white rounded-lg shadow p-4 mb-4 border border-purple-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium text-sm">
              Training Examples <span className="text-gray-400 font-normal ml-2">({trainingExamples.length} saved)</span>
            </h3>
            <div className="flex gap-2">
              {trainingExamples.length > 0 && (
                <button onClick={clearAllTrainingExamples} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-50">Clear All</button>
              )}
              <button onClick={() => setShowTrainingExamples(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Close</button>
            </div>
          </div>
          {trainingExamples.length === 0 ? (
            <div className="text-center py-4 text-gray-400 text-sm">
              <p>No training examples yet. Confirm lines to save them as training data.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {trainingExamples.map((ex) => (
                <div key={ex.id} className="flex items-center gap-3 bg-gray-50 rounded p-2 border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/profiles/${profileId}/training/image/${ex.id}`} alt="" className="h-10 max-w-[200px] object-contain rounded border bg-white"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <span className="flex-1 text-sm font-medium" dir="rtl">{ex.text}</span>
                  <button onClick={() => deleteTrainingExample(ex.id)} className="text-red-400 hover:text-red-600 text-xs px-1 shrink-0" title="Delete">&#10005;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* Rerun banner */}
      {showRerunBanner && !reviewMode && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-amber-800">You&apos;ve corrected {correctionCount} words</p>
            <p className="text-sm text-amber-600">Re-running OCR will use your corrections for better accuracy.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowRerunBanner(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Dismiss</button>
            <button onClick={() => runOCR()} disabled={ocrRunning} className="bg-amber-500 text-white px-4 py-2 rounded text-sm font-medium hover:bg-amber-600 disabled:opacity-50">Re-run OCR</button>
          </div>
        </div>
      )}

      {/* OCR Controls */}
      {!reviewMode && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          {!result && !trainingMode && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-2"><strong>Tip:</strong> Type the first 2-3 lines manually to teach the OCR.</p>
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
                <button onClick={() => runOCR()} disabled={ocrRunning || trainingLineCount === 0} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  Run OCR with {trainingLineCount} training line{trainingLineCount !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <button onClick={straightenImage} className="px-3 sm:px-4 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 active:bg-gray-900">Straighten</button>
            <button onClick={() => manualRotate(-1)} className="px-2 sm:px-3 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 active:bg-gray-900">&#8634; -1&deg;</button>
            <button onClick={() => manualRotate(1)} className="px-2 sm:px-3 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 active:bg-gray-900">&#8635; +1&deg;</button>
            <button onClick={preprocessImage} className="px-3 sm:px-4 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 active:bg-gray-900">Enhance</button>
            {!trainingMode && (
              <div className="flex items-center gap-1">
                <select
                  value={ocrMethod}
                  onChange={(e) => setOcrMethod(e.target.value as "azure" | "doctr")}
                  disabled={ocrRunning}
                  className="px-2 py-2 rounded-l text-sm border border-gray-300 bg-white text-gray-700 disabled:opacity-50"
                >
                  <option value="azure">Azure OCR</option>
                  <option value="doctr">In-House (DocTR + TrOCR)</option>
                </select>
                <button onClick={() => runOCR()} disabled={ocrRunning}
                  className={`px-4 sm:px-6 py-2 rounded-r text-sm font-medium text-white disabled:opacity-50 ${result ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700" : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"}`}>
                  {ocrRunning ? "Processing..." : result ? "Re-run" : "Run OCR"}
                </button>
              </div>
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
              <p className="text-xs text-gray-400">{ocrMethod === "doctr"
                ? (elapsedSeconds < 5 ? "DocTR: detecting word boxes..." : elapsedSeconds < 30 ? "TrOCR: recognizing words..." : "Finishing up...")
                : (elapsedSeconds < 15 ? "Azure: detecting lines..." : elapsedSeconds < 45 ? "Azure: reading handwriting..." : "Finishing up (+ TrOCR if available)...")
              }</p>
            </div>
          )}
          {trocrRunning && (
            <div className="mt-3 flex items-center gap-2 text-sm text-indigo-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
              <span>Running TrOCR on each word...</span>
            </div>
          )}
          {trocrProgress && !trocrRunning && (
            <div className="mt-3 text-sm text-indigo-600">
              TrOCR: {trocrProgress.processed} words processed{trocrProgress.total > trocrProgress.processed ? `, ${trocrProgress.total - trocrProgress.processed} failed` : ""}
            </div>
          )}
          {result && result.lines.some(l => l.words.some(w => w.modelText)) && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-gray-500">Show text from:</span>
              <button onClick={() => setTextSource("azure")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textSource === "azure" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}>
                Azure
              </button>
              <button onClick={() => setTextSource("trocr")}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${textSource === "trocr" ? "bg-indigo-500 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}>
                TrOCR
              </button>
              <button onClick={runTrOCR} disabled={trocrRunning}
                className="text-xs text-indigo-500 hover:text-indigo-700 underline disabled:opacity-50 ml-2">
                {trocrRunning ? "Running..." : "Re-run TrOCR"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {result && !reviewMode && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
            <span className="text-xs text-gray-500">Click any word to edit it</span>
            <div className="flex items-center gap-3">
              {correctionCount > 0 && <span className="text-xs text-gray-500">{correctionCount} correction{correctionCount !== 1 ? "s" : ""}</span>}
            </div>
          </div>
        )}
        <div className="overflow-auto">
          {/* Hidden image element — canvas draws from this */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} src={`/api/files/${fileId}/image?t=${imageCacheBust}`} alt="" className="w-full invisible h-0" onLoad={onImageLoad} crossOrigin="anonymous" />

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
            renderWordCards()
          ) : (
            <p className="p-8 text-center text-gray-400">Loading image...</p>
          )}
        </div>
      </div>

      {/* Fixed edit bar at bottom */}
      {editingWord && result && !reviewMode && (() => {
        let selectedWord: Word | undefined;
        let selectedLine: Line | undefined;
        for (const l of result.lines) {
          const w = l.words.find((w) => w.id === editingWord);
          if (w) { selectedWord = w; selectedLine = l; break; }
        }
        if (!selectedWord || !selectedLine) return null;
        const allWords = result.lines.flatMap(l => l.words);
        const wordIdx = allWords.findIndex(w => w.id === selectedWord.id);
        const isFirst = wordIdx <= 0;
        const isLast = wordIdx >= allWords.length - 1;
        return (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-orange-400 shadow-lg z-50 px-3 py-2 sm:px-4 sm:py-3 safe-bottom">
            <div className="max-w-5xl mx-auto space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
              {/* Prev button */}
              <button onClick={() => saveAndPrev(selectedWord!.id, editValue)} disabled={isFirst}
                className="hidden sm:block shrink-0 px-2 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 disabled:opacity-30 text-sm">&rarr;</button>

              {/* Crop with bounding box controls */}
              <div className="flex items-center gap-1 sm:gap-2">
                {/* Right edge controls (Hebrew RTL — right edge is the "start") */}
                {selectedWord.xLeft != null && (
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => adjustWordBounds(selectedWord!.id, "right", "expand")}
                      className="px-1 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600" title="Expand right edge">&#9654;</button>
                    <button onClick={() => adjustWordBounds(selectedWord!.id, "right", "shrink")}
                      className="px-1 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600" title="Shrink right edge">&#9664;</button>
                  </div>
                )}
                <div className="shrink-0 border rounded overflow-hidden bg-white max-w-[150px] sm:max-w-[200px]">
                  {selectedWord.xLeft != null && selectedWord.xRight != null ? (
                    <WordCropCanvas imgEl={imageRef.current} word={selectedWord} line={selectedLine} maxHeight={48} key={`ewc-${selectedWord.id}-${selectedWord.xLeft}-${selectedWord.xRight}-${imageVersion}`} />
                  ) : (
                    <LineCropCanvas imgEl={imageRef.current} line={selectedLine} maxHeight={48} key={`eblc-${selectedLine.id}-${imageVersion}`} />
                  )}
                </div>
                {/* Left edge controls */}
                {selectedWord.xRight != null && (
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => adjustWordBounds(selectedWord!.id, "left", "expand")}
                      className="px-1 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600" title="Expand left edge">&#9664;</button>
                    <button onClick={() => adjustWordBounds(selectedWord!.id, "left", "shrink")}
                      className="px-1 py-0.5 text-[10px] rounded bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600" title="Shrink left edge">&#9654;</button>
                  </div>
                )}
                <div className="flex flex-col gap-0.5 shrink-0 min-w-0" dir="rtl">
                  <span className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded truncate">{selectedWord.rawText}</span>
                  {selectedWord.modelText && selectedWord.modelText !== selectedWord.rawText && (
                    <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded truncate">{selectedWord.modelText}</span>
                  )}
                  <span className="text-[10px] text-gray-400">{wordIdx + 1}/{allWords.length}</span>
                </div>
              </div>

              {/* Input */}
              <div className="flex-1 min-w-0" dir="rtl">
                <input
                  ref={editInputRef}
                  type="text"
                  dir="rtl"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveAndNext(selectedWord!.id, editValue); }
                    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); saveAndNext(selectedWord!.id, editValue); }
                    else if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); saveAndPrev(selectedWord!.id, editValue); }
                    else if (e.key === "Escape") setEditingWord(null);
                  }}
                  className="w-full border-2 border-orange-400 rounded-lg px-3 py-3 sm:py-2 text-lg text-right bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                  autoFocus
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-1.5 shrink-0">
                {profileId && !confirmedWords.has(selectedWord!.id) && (
                  <button onClick={() => { confirmWordCorrect(selectedWord!.id); editNextWord(selectedWord!.id); }}
                    className="flex-1 sm:flex-none bg-blue-500 text-white px-3 py-3 sm:py-2 rounded-lg font-medium hover:bg-blue-600 active:bg-blue-700 text-base sm:text-sm">Correct</button>
                )}
                {profileId && confirmedWords.has(selectedWord!.id) && (
                  <span className="flex-1 sm:flex-none bg-blue-200 text-blue-800 px-3 py-3 sm:py-2 rounded-lg font-medium text-base sm:text-sm text-center">Saved</span>
                )}
                <button onClick={() => saveAndNext(selectedWord!.id, editValue)}
                  className="flex-1 sm:flex-none bg-green-500 text-white px-3 py-3 sm:py-2 rounded-lg font-medium hover:bg-green-600 active:bg-green-700 text-base sm:text-sm">Next</button>
                <button onClick={() => setEditingWord(null)}
                  className="flex-1 sm:flex-none bg-gray-200 text-gray-700 px-3 py-3 sm:py-2 rounded-lg text-base sm:text-sm hover:bg-gray-300">Done</button>
                <button onClick={() => deleteWord(selectedWord!.id)}
                  className="bg-red-100 text-red-600 px-2 py-3 sm:py-2 rounded-lg text-sm hover:bg-red-200">Del</button>
              </div>

              {/* Next button */}
              <button onClick={() => saveAndNext(selectedWord!.id, editValue)} disabled={isLast}
                className="hidden sm:block shrink-0 px-2 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 disabled:opacity-30 text-sm">&larr;</button>
            </div>
            {/* Mobile nav row */}
            <div className="flex gap-2 mt-2 sm:hidden">
              <button onClick={() => saveAndPrev(selectedWord!.id, editValue)} disabled={isFirst}
                className="flex-1 py-2.5 rounded-lg bg-gray-200 active:bg-gray-400 disabled:opacity-30 text-sm font-medium">&rarr; Prev</button>
              <button onClick={() => saveAndNext(selectedWord!.id, editValue)} disabled={isLast}
                className="flex-1 py-2.5 rounded-lg bg-gray-200 active:bg-gray-400 disabled:opacity-30 text-sm font-medium">Next &larr;</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

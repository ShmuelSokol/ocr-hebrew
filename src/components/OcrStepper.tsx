"use client";
import { useState, useRef, useCallback } from "react";

interface DetectedWord {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
  text?: string;
  confidence?: number;
}

interface DetectedLine {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  words: DetectedWord[];
}

type OcrStep = "idle" | "straightening" | "straightened" | "detecting" | "detected" | "running" | "done";
type EditMode = "none" | "addMissing" | "splitWords";

const STEPS: { key: OcrStep; label: string }[] = [
  { key: "straightened", label: "Straighten" },
  { key: "detected", label: "Detect" },
  { key: "done", label: "OCR" },
];

function stepIndex(step: OcrStep): number {
  if (step === "idle") return -1;
  if (step === "straightening") return 0;
  if (step === "straightened") return 0;
  if (step === "detecting") return 1;
  if (step === "detected") return 1;
  if (step === "running") return 2;
  if (step === "done") return 2;
  return -1;
}

export default function OcrStepper({
  fileId,
  method,
  imageNaturalWidth,
  imageNaturalHeight,
  onImageRefresh,
  onComplete,
}: {
  fileId: string;
  method: "azure" | "doctr";
  imageNaturalWidth: number;
  imageNaturalHeight: number;
  onImageRefresh: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<OcrStep>("idle");
  const [detectedLines, setDetectedLines] = useState<DetectedLine[]>([]);
  const [skewAngle, setSkewAngle] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [timerHandle, setTimerHandle] = useState<NodeJS.Timeout | null>(null);

  // Edit modes for detected step
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [drawnBoxes, setDrawnBoxes] = useState<DetectedWord[]>([]);
  const [selectedSplits, setSelectedSplits] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState(false);

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  function startTimer() {
    setElapsed(0);
    const start = Date.now();
    const h = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    setTimerHandle(h);
    return h;
  }
  function stopTimer(h?: NodeJS.Timeout | null) {
    if (h) clearInterval(h);
    if (timerHandle) clearInterval(timerHandle);
  }

  // Convert screen coordinates to image natural coordinates
  const screenToNatural = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !imageNaturalWidth || !imageNaturalHeight) return null;
    const rect = img.getBoundingClientRect();
    const scaleX = imageNaturalWidth / rect.width;
    const scaleY = imageNaturalHeight / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, [imageNaturalWidth, imageNaturalHeight]);

  // Drawing handlers
  function handlePointerDown(e: React.PointerEvent) {
    if (editMode !== "addMissing") return;
    e.preventDefault();
    const pt = screenToNatural(e.clientX, e.clientY);
    if (!pt) return;
    setDrawing(true);
    setDrawStart(pt);
    setDrawCurrent(pt);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drawing || editMode !== "addMissing") return;
    e.preventDefault();
    const pt = screenToNatural(e.clientX, e.clientY);
    if (pt) setDrawCurrent(pt);
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drawing || !drawStart || !drawCurrent || editMode !== "addMissing") return;
    e.preventDefault();
    setDrawing(false);

    const xLeft = Math.min(drawStart.x, drawCurrent.x);
    const xRight = Math.max(drawStart.x, drawCurrent.x);
    const yTop = Math.min(drawStart.y, drawCurrent.y);
    const yBottom = Math.max(drawStart.y, drawCurrent.y);

    // Only add if box is big enough
    if (xRight - xLeft > 10 && yBottom - yTop > 10) {
      setDrawnBoxes(prev => [...prev, { xLeft, xRight, yTop, yBottom }]);
    }

    setDrawStart(null);
    setDrawCurrent(null);
  }

  // Click handler for split mode
  function handleBoxClick(lineIdx: number, wordIdx: number) {
    if (editMode !== "splitWords") return;
    const key = `${lineIdx}-${wordIdx}`;
    setSelectedSplits(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Add drawn boxes into the detection result
  function applyDrawnBoxes() {
    if (drawnBoxes.length === 0) return;

    setDetectedLines(prev => {
      const newLines = [...prev];
      for (const box of drawnBoxes) {
        // Find the line this box belongs to (by y overlap)
        let bestLine = -1;
        let bestOverlap = 0;
        for (let li = 0; li < newLines.length; li++) {
          const line = newLines[li];
          const overlapTop = Math.max(box.yTop, line.yTop);
          const overlapBottom = Math.min(box.yBottom, line.yBottom);
          const overlap = Math.max(0, overlapBottom - overlapTop);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestLine = li;
          }
        }

        if (bestLine >= 0 && bestOverlap > (box.yBottom - box.yTop) * 0.3) {
          // Add to existing line, sort RTL
          const line = { ...newLines[bestLine], words: [...newLines[bestLine].words, box] };
          line.words.sort((a, b) => b.xRight - a.xRight);
          line.yTop = Math.min(line.yTop, box.yTop);
          line.yBottom = Math.max(line.yBottom, box.yBottom);
          newLines[bestLine] = line;
        } else {
          // Create new line
          newLines.push({
            lineIndex: newLines.length,
            yTop: box.yTop,
            yBottom: box.yBottom,
            words: [box],
          });
        }
      }
      // Re-sort lines by yTop
      newLines.sort((a, b) => a.yTop - b.yTop);
      newLines.forEach((l, i) => l.lineIndex = i);
      return newLines;
    });

    setDrawnBoxes([]);
    setEditMode("none");
  }

  // Split selected boxes via server re-detection
  async function splitSelected() {
    if (selectedSplits.size === 0) return;
    setSplitting(true);
    setError(null);

    try {
      // Collect regions to split
      const regions: { lineIdx: number; wordIdx: number; xLeft: number; xRight: number; yTop: number; yBottom: number }[] = [];
      for (const key of selectedSplits) {
        const [li, wi] = key.split("-").map(Number);
        const line = detectedLines[li];
        if (!line) continue;
        const word = line.words[wi];
        if (!word) continue;
        regions.push({ lineIdx: li, wordIdx: wi, ...word });
      }

      const res = await fetch(`/api/files/${fileId}/ocr-split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regions, method }),
      });

      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Split failed");
      const data = await res.json();

      // Replace original boxes with split results
      setDetectedLines(prev => {
        const newLines = prev.map(l => ({ ...l, words: [...l.words] }));

        // Process in reverse order so indices don't shift
        const sortedRegions = [...regions].sort((a, b) =>
          a.lineIdx !== b.lineIdx ? b.lineIdx - a.lineIdx : b.wordIdx - a.wordIdx
        );

        for (const region of sortedRegions) {
          const splitResult = data.results.find(
            (r: { lineIdx: number; wordIdx: number }) => r.lineIdx === region.lineIdx && r.wordIdx === region.wordIdx
          );
          if (!splitResult || !splitResult.subBoxes || splitResult.subBoxes.length <= 1) continue;

          const line = newLines[region.lineIdx];
          if (!line) continue;

          // Replace the word with sub-boxes
          line.words.splice(region.wordIdx, 1, ...splitResult.subBoxes);
        }

        // Re-sort words RTL within each line
        for (const line of newLines) {
          line.words.sort((a: DetectedWord, b: DetectedWord) => b.xRight - a.xRight);
        }

        return newLines;
      });

      setSelectedSplits(new Set());
      setEditMode("none");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed");
    } finally {
      setSplitting(false);
    }
  }

  async function doStraighten() {
    setStep("straightening");
    setError(null);
    const h = startTimer();
    try {
      const res = await fetch(`/api/files/${fileId}/preprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskew: true, sharpen: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preprocess failed");
      const data = await res.json();
      setSkewAngle(data.skewAngle || 0);
      onImageRefresh();
      setStep("straightened");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Straighten failed");
      setStep("idle");
    } finally {
      stopTimer(h);
    }
  }

  async function doDetect() {
    setStep("detecting");
    setError(null);
    setDrawnBoxes([]);
    setSelectedSplits(new Set());
    setEditMode("none");
    const h = startTimer();
    try {
      const res = await fetch(`/api/files/${fileId}/ocr-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Detection failed");
      const data = await res.json();
      setDetectedLines(data.lines || []);
      setStep("detected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detection failed");
      setStep("straightened");
    } finally {
      stopTimer(h);
    }
  }

  async function doOcr() {
    setStep("running");
    setError(null);
    const h = startTimer();
    try {
      // Pass the (possibly user-corrected) detected boxes so OCR skips re-detection
      const res = await fetch(`/api/files/${fileId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          skipPreprocess: true,
          detectedBoxes: detectedLines.length > 0 ? detectedLines : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "OCR failed");
      setStep("done");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR failed");
      setStep("detected");
    } finally {
      stopTimer(h);
    }
  }

  async function runAll() {
    setError(null);
    setStep("straightening");
    const h = startTimer();
    try {
      const preRes = await fetch(`/api/files/${fileId}/preprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskew: true, sharpen: true }),
      });
      if (preRes.ok) {
        const preData = await preRes.json();
        setSkewAngle(preData.skewAngle || 0);
        onImageRefresh();
      }
      setStep("detecting");

      const detRes = await fetch(`/api/files/${fileId}/ocr-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (detRes.ok) {
        const detData = await detRes.json();
        setDetectedLines(detData.lines || []);
      }
      setStep("running");

      const ocrRes = await fetch(`/api/files/${fileId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, skipPreprocess: true }),
      });
      if (!ocrRes.ok) throw new Error((await ocrRes.json().catch(() => ({}))).error || "OCR failed");
      setStep("done");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      stopTimer(h);
    }
  }

  const currentStep = stepIndex(step);
  const isWorking = ["straightening", "detecting", "running"].includes(step);
  const totalWords = detectedLines.reduce((s, l) => s + l.words.length, 0);

  // Preview rect while drawing
  const previewRect = drawStart && drawCurrent ? {
    xLeft: Math.min(drawStart.x, drawCurrent.x),
    xRight: Math.max(drawStart.x, drawCurrent.x),
    yTop: Math.min(drawStart.y, drawCurrent.y),
    yBottom: Math.max(drawStart.y, drawCurrent.y),
  } : null;

  return (
    <div className="space-y-3">
      {/* Step indicator */}
      <div className="flex items-center gap-1 text-xs">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 && <div className={`w-4 sm:w-8 h-0.5 ${currentStep >= i ? "bg-blue-400" : "bg-gray-200"}`} />}
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${
              currentStep === i && isWorking ? "bg-blue-100 text-blue-700 animate-pulse" :
              currentStep >= i ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-400"
            }`}>
              <span className="font-medium">{i + 1}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          </div>
        ))}
        {isWorking && (
          <span className="ml-2 tabular-nums font-mono text-gray-500">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        {step === "idle" && (
          <>
            <button onClick={doStraighten} className="px-4 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800">
              1. Straighten
            </button>
            <button onClick={runAll} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              Run All Steps
            </button>
          </>
        )}
        {step === "straightened" && (
          <>
            <div className="text-sm text-gray-600">
              {skewAngle !== null && Math.abs(skewAngle) >= 0.1
                ? `Straightened by ${skewAngle.toFixed(1)}°`
                : "Image appears straight"}
            </div>
            <button onClick={doDetect} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              2. Detect Words
            </button>
            <button onClick={doStraighten} className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Re-straighten
            </button>
          </>
        )}
        {step === "detected" && editMode === "none" && (
          <>
            <div className="text-sm text-gray-600">
              {totalWords} words in {detectedLines.length} lines
            </div>
            <button onClick={doOcr} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              3. Recognize Text
            </button>
            <button onClick={() => setEditMode("addMissing")}
              className="px-3 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700">
              + Add Missing
            </button>
            <button onClick={() => setEditMode("splitWords")}
              className="px-3 py-2 rounded text-sm font-medium bg-orange-500 text-white hover:bg-orange-600">
              Split Words
            </button>
            <button onClick={doDetect} className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Re-detect
            </button>
          </>
        )}
        {step === "detected" && editMode === "addMissing" && (
          <>
            <div className="text-sm text-green-700 font-medium">
              Draw rectangles around missing words ({drawnBoxes.length} added)
            </div>
            <button onClick={applyDrawnBoxes} disabled={drawnBoxes.length === 0}
              className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              Apply {drawnBoxes.length} box{drawnBoxes.length !== 1 ? "es" : ""}
            </button>
            {drawnBoxes.length > 0 && (
              <button onClick={() => setDrawnBoxes(prev => prev.slice(0, -1))}
                className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
                Undo Last
              </button>
            )}
            <button onClick={() => { setEditMode("none"); setDrawnBoxes([]); }}
              className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Cancel
            </button>
          </>
        )}
        {step === "detected" && editMode === "splitWords" && (
          <>
            <div className="text-sm text-orange-700 font-medium">
              Tap boxes to split ({selectedSplits.size} selected)
            </div>
            <button onClick={splitSelected} disabled={selectedSplits.size === 0 || splitting}
              className="px-4 py-2 rounded text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
              {splitting ? "Splitting..." : `Split ${selectedSplits.size} word${selectedSplits.size !== 1 ? "s" : ""}`}
            </button>
            <button onClick={() => { setEditMode("none"); setSelectedSplits(new Set()); }}
              className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Cancel
            </button>
          </>
        )}
        {step === "done" && (
          <div className="text-sm text-green-600 font-medium">OCR complete! Entering edit mode...</div>
        )}
        {isWorking && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
            {step === "straightening" && "Straightening & enhancing..."}
            {step === "detecting" && "Detecting word boxes..."}
            {step === "running" && "Recognizing text..."}
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
      )}

      {/* Bounding box overlay with drawing/selection */}
      {detectedLines.length > 0 && imageNaturalHeight > 0 && step !== "done" && (
        <div
          ref={overlayRef}
          className="relative border rounded overflow-hidden bg-gray-50 select-none"
          style={{ touchAction: editMode === "addMissing" ? "none" : "auto" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={`/api/files/${fileId}/image?t=${Date.now()}`} alt="Detected" className="w-full" draggable={false} />
          <svg
            className="absolute top-0 left-0 w-full h-full"
            viewBox={`0 0 ${imageNaturalWidth} ${imageNaturalHeight}`}
            preserveAspectRatio="none"
            style={{ pointerEvents: editMode === "splitWords" ? "auto" : "none" }}
          >
            {/* Existing detected boxes */}
            {detectedLines.map((line, li) =>
              line.words.map((word, wi) => {
                const key = `${li}-${wi}`;
                const isSelected = selectedSplits.has(key);
                return (
                  <rect
                    key={key}
                    x={word.xLeft}
                    y={word.yTop}
                    width={word.xRight - word.xLeft}
                    height={word.yBottom - word.yTop}
                    fill={isSelected ? "rgba(249, 115, 22, 0.3)" : "rgba(59, 130, 246, 0.15)"}
                    stroke={isSelected ? "rgba(249, 115, 22, 0.8)" : "rgba(59, 130, 246, 0.6)"}
                    strokeWidth={Math.max(1, imageNaturalWidth / 600) * (isSelected ? 2 : 1)}
                    style={{ cursor: editMode === "splitWords" ? "pointer" : "default", pointerEvents: editMode === "splitWords" ? "auto" : "none" }}
                    onClick={() => handleBoxClick(li, wi)}
                  />
                );
              })
            )}
            {/* Newly drawn boxes (green) */}
            {drawnBoxes.map((box, i) => (
              <rect
                key={`drawn-${i}`}
                x={box.xLeft}
                y={box.yTop}
                width={box.xRight - box.xLeft}
                height={box.yBottom - box.yTop}
                fill="rgba(34, 197, 94, 0.25)"
                stroke="rgba(34, 197, 94, 0.8)"
                strokeWidth={Math.max(1, imageNaturalWidth / 600) * 2}
              />
            ))}
            {/* Preview rect while drawing */}
            {previewRect && (
              <rect
                x={previewRect.xLeft}
                y={previewRect.yTop}
                width={previewRect.xRight - previewRect.xLeft}
                height={previewRect.yBottom - previewRect.yTop}
                fill="rgba(34, 197, 94, 0.15)"
                stroke="rgba(34, 197, 94, 0.6)"
                strokeWidth={Math.max(1, imageNaturalWidth / 600)}
                strokeDasharray="8 4"
              />
            )}
          </svg>
          {/* Mode indicator overlay */}
          {editMode === "addMissing" && (
            <div className="absolute top-2 left-2 bg-green-600 text-white text-xs px-2 py-1 rounded shadow">
              Draw mode — drag to add boxes
            </div>
          )}
          {editMode === "splitWords" && (
            <div className="absolute top-2 left-2 bg-orange-500 text-white text-xs px-2 py-1 rounded shadow">
              Tap boxes to select for splitting
            </div>
          )}
        </div>
      )}
    </div>
  );
}

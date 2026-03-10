"use client";
import { useState, useRef, useCallback, useEffect } from "react";

interface DetectedWord {
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
  text?: string;
  confidence?: number;
  source?: "detected" | "added" | "split" | "corrected";
}

interface DetectedLine {
  lineIndex: number;
  yTop: number;
  yBottom: number;
  words: DetectedWord[];
}

type OcrStep = "idle" | "straightening" | "straightened" | "detecting" | "detected" | "running" | "done";

const STEPS: { key: OcrStep; label: string }[] = [
  { key: "straightened", label: "Straighten" },
  { key: "detected", label: "Detect" },
  { key: "done", label: "OCR" },
];

const SOURCE_COLORS: Record<string, { fill: string; stroke: string }> = {
  detected: { fill: "rgba(59, 130, 246, 0.15)", stroke: "rgba(59, 130, 246, 0.6)" },
  added: { fill: "rgba(34, 197, 94, 0.2)", stroke: "rgba(34, 197, 94, 0.8)" },
  split: { fill: "rgba(249, 115, 22, 0.2)", stroke: "rgba(249, 115, 22, 0.8)" },
  corrected: { fill: "rgba(168, 85, 247, 0.2)", stroke: "rgba(168, 85, 247, 0.8)" },
};

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
  const [imgCacheBust, setImgCacheBust] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [timerHandle, setTimerHandle] = useState<NodeJS.Timeout | null>(null);

  // Manual rotation
  const [manualAngle, setManualAngle] = useState(0);
  const [applyingRotation, setApplyingRotation] = useState(false);
  const [totalAppliedAngle, setTotalAppliedAngle] = useState(0);

  // Undo stack for box operations
  const undoStackRef = useRef<DetectedLine[][]>([]);
  const [undoCount, setUndoCount] = useState(0); // triggers re-render when stack changes
  function pushUndo() {
    undoStackRef.current.push(JSON.parse(JSON.stringify(detectedLines)));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    setUndoCount(undoStackRef.current.length);
  }
  function undo() {
    const prev = undoStackRef.current.pop();
    if (prev) {
      setDetectedLines(prev);
      setSelectedBox(null);
      setSplitPickerOpen(false);
    }
    setUndoCount(undoStackRef.current.length);
  }

  // Unified edit state
  const [selectedBox, setSelectedBox] = useState<{ lineIdx: number; wordIdx: number } | null>(null);
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [boxesLocked, setBoxesLocked] = useState(false);
  const [showOverlaps, setShowOverlaps] = useState(false);

  // Overlap data (computed on toggle)
  const [detectedOverlaps, setDetectedOverlaps] = useState<{ lineIdx: number; wordIdxA: number; wordIdxB: number; overlapPct: number }[]>([]);
  const overlapBoxKeys = new Set(detectedOverlaps.flatMap(o => [`${o.lineIdx}-${o.wordIdxA}`, `${o.lineIdx}-${o.wordIdxB}`]));

  // Drawing state (drag on empty space to add a box)
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Drag state for resizing/moving selected box
  const [dragTarget, setDragTarget] = useState<{
    lineIdx: number;
    wordIdx: number;
    edge: "left" | "right" | "top" | "bottom" | "move";
    startX: number;
    startY: number;
    origBox: DetectedWord;
  } | null>(null);

  // Local image dimensions
  const [localImgW, setLocalImgW] = useState(0);
  const [localImgH, setLocalImgH] = useState(0);
  const effectiveW = localImgW || imageNaturalWidth;
  const effectiveH = localImgH || imageNaturalHeight;

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = useState({ x: 0, y: 0 });

  const [pinchState, setPinchState] = useState<{
    dist0: number;
    zoom0: number;
    pan0: { x: number; y: number };
    mid0: { x: number; y: number };
  } | null>(null);

  // Mobile touch: navigate vs edit toggle
  const [touchNavMode, setTouchNavMode] = useState(true);

  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load saved bounding boxes on mount
  useEffect(() => {
    fetch(`/api/files/${fileId}`)
      .then(r => r.json())
      .then(file => {
        if (file.detectedBoxes && Array.isArray(file.detectedBoxes) && file.detectedBoxes.length > 0) {
          setDetectedLines(file.detectedBoxes);
          setBoxesLocked(true);
          setStep("detected");
        }
      })
      .catch(() => {});
  }, [fileId]);

  async function saveBoxes(lines: DetectedLine[]) {
    await fetch(`/api/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detectedBoxes: lines.length > 0 ? lines : null }),
    });
  }

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

  function getSignal(): AbortSignal {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  }

  function stopProcessing() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    if (timerHandle) clearInterval(timerHandle);
    setStep(prev => {
      if (prev === "straightening") return "idle";
      if (prev === "detecting") return skewAngle !== null ? "straightened" : "idle";
      if (prev === "running") return detectedLines.length > 0 ? "detected" : "idle";
      return prev;
    });
    setError("Stopped");
  }

  const screenToNatural = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !effectiveW || !effectiveH) return null;
    const rect = img.getBoundingClientRect();
    const scaleX = effectiveW / rect.width;
    const scaleY = effectiveH / rect.height;
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  }, [effectiveW, effectiveH]);

  function getEdge(pt: { x: number; y: number }, box: DetectedWord): "left" | "right" | "top" | "bottom" | "move" {
    const threshold = Math.max(15, (box.xRight - box.xLeft) * 0.15);
    const distLeft = Math.abs(pt.x - box.xLeft);
    const distRight = Math.abs(pt.x - box.xRight);
    const distTop = Math.abs(pt.y - box.yTop);
    const distBottom = Math.abs(pt.y - box.yBottom);
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    if (minDist > threshold) return "move";
    if (minDist === distLeft) return "left";
    if (minDist === distRight) return "right";
    if (minDist === distTop) return "top";
    return "bottom";
  }

  // Refs for non-passive wheel handler
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  function focalZoom(oldZ: number, newZ: number, oldPan: { x: number; y: number }, cx: number, cy: number) {
    if (newZ <= 1) return { x: 0, y: 0 };
    return {
      x: cx - (cx - oldPan.x) * newZ / oldZ,
      y: cy - (cy - oldPan.y) * newZ / oldZ,
    };
  }

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const oldZ = zoomRef.current;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZ = Math.min(8, Math.max(1, oldZ * delta));
      const newPan = focalZoom(oldZ, newZ, panRef.current, cx, cy);
      setZoom(newZ);
      setPan(newPan);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Touch pinch zoom
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      if (drawing) { setDrawing(false); setDrawStart(null); setDrawCurrent(null); }
      if (dragTarget) setDragTarget(null);
      if (panning) setPanning(false);

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      setPinchState({
        dist0: Math.hypot(dx, dy),
        zoom0: zoom,
        pan0: { ...pan },
        mid0: { x: mx, y: my },
      });
    }
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchState) {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const newZ = Math.min(8, Math.max(1, pinchState.zoom0 * (dist / pinchState.dist0)));

      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      const zoomPan = focalZoom(pinchState.zoom0, newZ, pinchState.pan0, pinchState.mid0.x, pinchState.mid0.y);
      const newPan = {
        x: zoomPan.x + (mx - pinchState.mid0.x),
        y: zoomPan.y + (my - pinchState.mid0.y),
      };

      setZoom(newZ);
      setPan(newZ <= 1 ? { x: 0, y: 0 } : newPan);
    }
  }
  function handleTouchEnd() {
    setPinchState(null);
  }

  const isTouch = (e: React.PointerEvent) => e.pointerType === "touch";

  function startPan(e: React.PointerEvent) {
    setPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
    setPanOrigin({ ...pan });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  // Find which box (if any) the pointer hits
  function hitTestBox(pt: { x: number; y: number }): { lineIdx: number; wordIdx: number } | null {
    for (let li = 0; li < detectedLines.length; li++) {
      for (let wi = 0; wi < detectedLines[li].words.length; wi++) {
        const w = detectedLines[li].words[wi];
        const tol = Math.max(10, (w.xRight - w.xLeft) * 0.1);
        if (pt.x >= w.xLeft - tol && pt.x <= w.xRight + tol &&
            pt.y >= w.yTop - tol && pt.y <= w.yBottom + tol) {
          return { lineIdx: li, wordIdx: wi };
        }
      }
    }
    return null;
  }

  // --- Unified pointer handlers ---
  // When detected: click box = select, drag empty = draw new box, drag selected box edge = resize
  function handlePointerDown(e: React.PointerEvent) {
    if (step !== "detected") {
      // Before detection, only allow pan
      if (zoom > 1) { e.preventDefault(); startPan(e); }
      return;
    }

    // Touch + navigate mode: always pan
    if (isTouch(e) && touchNavMode) {
      e.preventDefault();
      if (zoom > 1) startPan(e);
      return;
    }

    e.preventDefault();

    if (boxesLocked) {
      if (zoom > 1) startPan(e);
      return;
    }

    const pt = screenToNatural(e.clientX, e.clientY);
    if (!pt) return;

    // If a box is selected, check if pointer is on THAT box to start edge drag
    if (selectedBox) {
      const line = detectedLines[selectedBox.lineIdx];
      const w = line?.words[selectedBox.wordIdx];
      if (w) {
        const tol = Math.max(15, (w.xRight - w.xLeft) * 0.15);
        if (pt.x >= w.xLeft - tol && pt.x <= w.xRight + tol &&
            pt.y >= w.yTop - tol && pt.y <= w.yBottom + tol) {
          const edge = getEdge(pt, w);
          pushUndo();
          setDragTarget({ lineIdx: selectedBox.lineIdx, wordIdx: selectedBox.wordIdx, edge, startX: pt.x, startY: pt.y, origBox: { ...w } });
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // Check if pointer hit any box
    const hit = hitTestBox(pt);
    if (hit) {
      // Record pointer start — we'll decide tap-select vs noop in pointerUp
      const w = detectedLines[hit.lineIdx].words[hit.wordIdx];
      setDragTarget({ lineIdx: hit.lineIdx, wordIdx: hit.wordIdx, edge: "move", startX: pt.x, startY: pt.y, origBox: { ...w } });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // Empty space — start drawing a new box (or pan if zoomed)
    setSelectedBox(null);
    setSplitPickerOpen(false);
    setDrawing(true);
    setDrawStart(pt);
    setDrawCurrent(pt);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (panning) {
      e.preventDefault();
      setPan({
        x: panOrigin.x + (e.clientX - panStart.x),
        y: panOrigin.y + (e.clientY - panStart.y),
      });
      return;
    }
    if (drawing) {
      e.preventDefault();
      const pt = screenToNatural(e.clientX, e.clientY);
      if (pt) setDrawCurrent(pt);
    } else if (dragTarget) {
      // Only allow resizing/moving the selected box
      const isSelected = selectedBox?.lineIdx === dragTarget.lineIdx && selectedBox?.wordIdx === dragTarget.wordIdx;
      if (!isSelected) return;

      e.preventDefault();
      const pt = screenToNatural(e.clientX, e.clientY);
      if (!pt) return;
      const dx = pt.x - dragTarget.startX;
      const dy = pt.y - dragTarget.startY;
      const orig = dragTarget.origBox;

      setDetectedLines(prev => {
        const newLines = prev.map(l => ({ ...l, words: [...l.words] }));
        const line = newLines[dragTarget.lineIdx];
        if (!line) return prev;
        const word = { ...line.words[dragTarget.wordIdx] };

        if (dragTarget.edge === "left") {
          word.xLeft = Math.min(orig.xLeft + dx, word.xRight - 5);
        } else if (dragTarget.edge === "right") {
          word.xRight = Math.max(orig.xRight + dx, word.xLeft + 5);
        } else if (dragTarget.edge === "top") {
          word.yTop = Math.min(orig.yTop + dy, word.yBottom - 5);
        } else if (dragTarget.edge === "bottom") {
          word.yBottom = Math.max(orig.yBottom + dy, word.yTop + 5);
        } else {
          word.xLeft = orig.xLeft + dx;
          word.xRight = orig.xRight + dx;
          word.yTop = orig.yTop + dy;
          word.yBottom = orig.yBottom + dy;
        }

        word.source = "corrected";
        line.words[dragTarget.wordIdx] = word;
        return newLines;
      });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (panning) {
      setPanning(false);
      return;
    }
    if (drawing && drawStart && drawCurrent) {
      e.preventDefault();
      setDrawing(false);
      const xLeft = Math.min(drawStart.x, drawCurrent.x);
      const xRight = Math.max(drawStart.x, drawCurrent.x);
      const yTop = Math.min(drawStart.y, drawCurrent.y);
      const yBottom = Math.max(drawStart.y, drawCurrent.y);
      if (xRight - xLeft > 10 && yBottom - yTop > 10) {
        addBoxToLines({ xLeft, xRight, yTop, yBottom, source: "added" });
      }
      setDrawStart(null);
      setDrawCurrent(null);
    } else if (dragTarget) {
      const pt = screenToNatural(e.clientX, e.clientY);
      const isTap = pt ? Math.abs(pt.x - dragTarget.startX) < 5 && Math.abs(pt.y - dragTarget.startY) < 5 : false;

      if (isTap) {
        // Tap selects this box (open its toolbar)
        setSelectedBox({ lineIdx: dragTarget.lineIdx, wordIdx: dragTarget.wordIdx });
        setSplitPickerOpen(false);
      }
      // If it was already selected and dragged, the move already happened in pointerMove
      setDragTarget(null);
    }
  }

  // Add a drawn box directly into detectedLines (auto-assign to nearest line)
  function addBoxToLines(box: DetectedWord) {
    pushUndo();
    setDetectedLines(prev => {
      const newLines = [...prev];
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
        const line = { ...newLines[bestLine], words: [...newLines[bestLine].words, { ...box }] };
        line.words.sort((a, b) => b.xRight - a.xRight);
        line.yTop = Math.min(line.yTop, box.yTop);
        line.yBottom = Math.max(line.yBottom, box.yBottom);
        newLines[bestLine] = line;
      } else {
        newLines.push({
          lineIndex: newLines.length,
          yTop: box.yTop,
          yBottom: box.yBottom,
          words: [{ ...box }],
        });
      }
      newLines.sort((a, b) => a.yTop - b.yTop);
      newLines.forEach((l, i) => l.lineIndex = i);
      return newLines;
    });
  }

  function deleteDetectedBox(lineIdx: number, wordIdx: number) {
    pushUndo();
    setDetectedLines(prev => {
      const newLines = prev.map(l => ({ ...l, words: [...l.words] }));
      const line = newLines[lineIdx];
      if (!line) return prev;
      line.words.splice(wordIdx, 1);
      if (line.words.length === 0) {
        newLines.splice(lineIdx, 1);
        newLines.forEach((l, i) => l.lineIndex = i);
      }
      return newLines;
    });
    setSelectedBox(null);
    setSplitPickerOpen(false);
    if (showOverlaps) {
      setTimeout(() => setDetectedOverlaps(computeOverlaps()), 0);
    }
  }

  function splitIntoN(n: number) {
    if (!selectedBox) return;
    pushUndo();
    const { lineIdx, wordIdx } = selectedBox;

    setDetectedLines(prev => {
      const newLines = prev.map(l => ({ ...l, words: [...l.words] }));
      const line = newLines[lineIdx];
      if (!line) return prev;
      const word = line.words[wordIdx];
      if (!word) return prev;

      const totalW = word.xRight - word.xLeft;
      const partW = totalW / n;
      const subBoxes: DetectedWord[] = [];
      for (let i = 0; i < n; i++) {
        subBoxes.push({
          xLeft: Math.round(word.xLeft + i * partW),
          xRight: Math.round(word.xLeft + (i + 1) * partW),
          yTop: word.yTop,
          yBottom: word.yBottom,
          source: "split",
        });
      }
      line.words.splice(wordIdx, 1, ...subBoxes);
      line.words.sort((a, b) => b.xRight - a.xRight);
      return newLines;
    });

    setSelectedBox(null);
    setSplitPickerOpen(false);
  }

  function computeOverlaps() {
    const found: { lineIdx: number; wordIdxA: number; wordIdxB: number; overlapPct: number }[] = [];
    for (let li = 0; li < detectedLines.length; li++) {
      const words = detectedLines[li].words;
      for (let a = 0; a < words.length; a++) {
        const wa = words[a];
        for (let b = a + 1; b < words.length; b++) {
          const wb = words[b];
          const xOverlap = Math.max(0, Math.min(wa.xRight, wb.xRight) - Math.max(wa.xLeft, wb.xLeft));
          if (xOverlap <= 0) continue;
          const yOverlap = Math.max(0, Math.min(wa.yBottom, wb.yBottom) - Math.max(wa.yTop, wb.yTop));
          if (yOverlap <= 0) continue;
          const areaA = (wa.xRight - wa.xLeft) * (wa.yBottom - wa.yTop);
          const areaB = (wb.xRight - wb.xLeft) * (wb.yBottom - wb.yTop);
          const overlapArea = xOverlap * yOverlap;
          const minArea = Math.min(areaA, areaB);
          const pct = minArea > 0 ? Math.round((overlapArea / minArea) * 100) : 0;
          if (pct >= 5) found.push({ lineIdx: li, wordIdxA: a, wordIdxB: b, overlapPct: pct });
        }
      }
    }
    found.sort((a, b) => b.overlapPct - a.overlapPct);
    return found;
  }

  // --- Server actions ---

  async function doStraighten() {
    setStep("straightening");
    setError(null);
    const signal = getSignal();
    const h = startTimer();
    try {
      const res = await fetch(`/api/files/${fileId}/preprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deskew: true, sharpen: true }),
        signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preprocess failed");
      const data = await res.json();
      setSkewAngle(data.skewAngle || 0);
      setTotalAppliedAngle(data.appliedAngle || 0);
      setImgCacheBust(Date.now());
      onImageRefresh();
      setStep("straightened");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Straighten failed");
      setStep("idle");
    } finally {
      stopTimer(h);
    }
  }

  async function applyManualRotation() {
    if (manualAngle === 0) return;
    setApplyingRotation(true);
    setError(null);
    try {
      const newTotal = totalAppliedAngle + manualAngle;
      const res = await fetch(`/api/files/${fileId}/preprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cumulativeAngle: newTotal }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Rotation failed");
      setTotalAppliedAngle(newTotal);
      setImgCacheBust(Date.now());
      onImageRefresh();
      setManualAngle(0);
      if (detectedLines.length > 0) {
        setDetectedLines([]);
        setSelectedBox(null);
        setStep("straightened");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rotation failed");
    } finally {
      setApplyingRotation(false);
    }
  }

  async function doDetect() {
    setStep("detecting");
    setError(null);
    setSelectedBox(null);
    setBoxesLocked(false);
    setShowOverlaps(false);
    saveBoxes([]);
    const signal = getSignal();
    const h = startTimer();
    try {
      const res = await fetch(`/api/files/${fileId}/ocr-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
        signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Detection failed");
      const data = await res.json();
      const taggedLines = (data.lines || []).map((l: DetectedLine) => ({
        ...l,
        words: l.words.map((w: DetectedWord) => ({ ...w, source: "detected" as const })),
      }));
      setDetectedLines(taggedLines);
      setStep("detected");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Detection failed");
      setStep(skewAngle !== null ? "straightened" : "idle");
    } finally {
      stopTimer(h);
    }
  }

  async function doOcr() {
    setStep("running");
    setError(null);
    const signal = getSignal();
    const h = startTimer();
    try {
      const res = await fetch(`/api/files/${fileId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          skipPreprocess: true,
          detectedBoxes: detectedLines.length > 0 ? detectedLines : undefined,
        }),
        signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "OCR failed");
      setStep("done");
      onComplete();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "OCR failed");
      setStep("detected");
    } finally {
      stopTimer(h);
    }
  }

  // --- Render ---
  const totalWords = detectedLines.reduce((s, l) => s + l.words.length, 0);
  const isWorking = step === "straightening" || step === "detecting" || step === "running";
  const strokeW = effectiveW > 0 ? Math.max(1, effectiveW / 600) : 2;
  const previewRect = drawing && drawStart && drawCurrent ? {
    xLeft: Math.min(drawStart.x, drawCurrent.x),
    xRight: Math.max(drawStart.x, drawCurrent.x),
    yTop: Math.min(drawStart.y, drawCurrent.y),
    yBottom: Math.max(drawStart.y, drawCurrent.y),
  } : null;

  return (
    <div className="space-y-3">
      {/* Step progress bar */}
      <div className="flex items-center gap-1 text-xs">
        {STEPS.map((s, i) => {
          const active = stepIndex(step) >= i;
          const current = stepIndex(step) === i;
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && <div className={`w-4 h-0.5 ${active ? "bg-blue-400" : "bg-gray-200"}`} />}
              <div className={`px-2 py-1 rounded-full ${current ? "bg-blue-600 text-white" : active ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                {s.label}
              </div>
            </div>
          );
        })}
        {elapsed > 0 && isWorking && <span className="ml-auto text-gray-400 tabular-nums">{elapsed}s</span>}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {step === "idle" && (
          <>
            <button onClick={doStraighten} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              1. Straighten & Enhance
            </button>
            <button onClick={doDetect} className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Skip to Detect
            </button>
          </>
        )}
        {step === "straightened" && !isWorking && (
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
        {/* Manual rotation controls */}
        {(step === "straightened" || (step === "detected" && !isWorking)) && (
          <div className="w-full flex flex-wrap items-center gap-2 mt-1">
            <span className="text-xs text-gray-500 shrink-0">Manual rotate:</span>
            <button onClick={() => setManualAngle(a => Math.round((a - 0.5) * 10) / 10)}
              className="w-7 h-7 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm font-bold">-</button>
            <input type="range" min={-5} max={5} step={0.1} value={manualAngle}
              onChange={e => setManualAngle(parseFloat(e.target.value))}
              className="flex-1 min-w-[100px] max-w-[250px] accent-blue-600" />
            <button onClick={() => setManualAngle(a => Math.round((a + 0.5) * 10) / 10)}
              className="w-7 h-7 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm font-bold">+</button>
            <span className="text-xs tabular-nums font-mono w-12 text-center">{manualAngle.toFixed(1)}°</span>
            <button onClick={applyManualRotation} disabled={manualAngle === 0 || applyingRotation}
              className="px-3 py-1 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50">
              {applyingRotation ? "Applying..." : "Apply"}
            </button>
            {manualAngle !== 0 && (
              <button onClick={() => setManualAngle(0)} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
            )}
          </div>
        )}
        {step === "detected" && !isWorking && (
          <>
            <div className="text-sm text-gray-600">
              {totalWords} words in {detectedLines.length} lines
            </div>
            <button onClick={doOcr} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              3. Recognize Text
            </button>
            <button onClick={() => {
              const next = !showOverlaps;
              setShowOverlaps(next);
              if (next) setDetectedOverlaps(computeOverlaps());
              else setDetectedOverlaps([]);
            }}
              className={`px-3 py-2 rounded text-sm font-medium ${showOverlaps ? "bg-red-500 text-white hover:bg-red-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}>
              {showOverlaps ? `Overlaps (${detectedOverlaps.length})` : "Show Overlaps"}
            </button>
            <button onClick={() => {
              const newLocked = !boxesLocked;
              setBoxesLocked(newLocked);
              setSelectedBox(null);
              setSplitPickerOpen(false);
              if (newLocked) saveBoxes(detectedLines);
            }}
              className={`px-3 py-2 rounded text-sm font-medium ${boxesLocked ? "bg-yellow-500 text-white hover:bg-yellow-600" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}>
              {boxesLocked ? "Unlock Boxes" : "Lock & Save"}
            </button>
            {undoCount > 0 && (
              <button onClick={undo} className="px-3 py-2 rounded text-sm font-medium bg-gray-700 text-white hover:bg-gray-800">
                Undo
              </button>
            )}
            <button onClick={doDetect} className="px-3 py-2 rounded text-sm bg-gray-200 text-gray-700 hover:bg-gray-300">
              Re-detect
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
            <button onClick={stopProcessing}
              className="ml-1 px-3 py-1.5 rounded text-sm font-medium bg-red-500 text-white hover:bg-red-600">
              Stop
            </button>
          </div>
        )}
      </div>

      {/* Color legend */}
      {detectedLines.length > 0 && step !== "done" && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: SOURCE_COLORS.detected.stroke }} /> Detected</span>
          {detectedLines.some(l => l.words.some(w => w.source === "added")) && (
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: SOURCE_COLORS.added.stroke }} /> Added</span>
          )}
          {detectedLines.some(l => l.words.some(w => w.source === "split")) && (
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: SOURCE_COLORS.split.stroke }} /> Split</span>
          )}
          {detectedLines.some(l => l.words.some(w => w.source === "corrected")) && (
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: SOURCE_COLORS.corrected.stroke }} /> Corrected</span>
          )}
          {showOverlaps && detectedOverlaps.length > 0 && (
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> Overlap</span>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
      )}

      {/* Zoom controls */}
      {effectiveH > 0 && step !== "done" && step !== "idle" && (
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => {
            const el = overlayRef.current;
            const rect = el?.getBoundingClientRect();
            const cx = rect ? rect.width / 2 : 0;
            const cy = rect ? rect.height / 2 : 0;
            const newZ = Math.min(8, zoom * 1.3);
            setPan(focalZoom(zoom, newZ, pan, cx, cy));
            setZoom(newZ);
          }} className="w-7 h-7 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold">+</button>
          <button onClick={() => {
            const el = overlayRef.current;
            const rect = el?.getBoundingClientRect();
            const cx = rect ? rect.width / 2 : 0;
            const cy = rect ? rect.height / 2 : 0;
            const newZ = Math.max(1, zoom / 1.3);
            setPan(focalZoom(zoom, newZ, pan, cx, cy));
            setZoom(newZ);
          }} className="w-7 h-7 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-bold">-</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="px-2 h-7 rounded bg-gray-200 text-gray-700 hover:bg-gray-300">Reset</button>
          <span className="text-gray-400">{Math.round(zoom * 100)}%</span>
        </div>
      )}

      {/* Image + SVG overlay */}
      {effectiveH > 0 && step !== "done" && step !== "idle" && (
        <div
          ref={overlayRef}
          className="relative border rounded bg-gray-50 select-none"
          style={{
            overflow: zoom > 1 ? "hidden" : "visible",
            touchAction: (step === "detected" || zoom > 1) ? "none" : "auto",
            cursor: panning ? "grabbing" : zoom > 1 ? "grab" : step === "detected" && !boxesLocked ? "crosshair" : undefined,
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative" style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: "0 0",
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={`/api/files/${fileId}/image?t=${imgCacheBust}`} alt="Detected"
            className="w-full block"
            draggable={false}
            style={manualAngle !== 0 ? { transform: `rotate(${manualAngle}deg)`, transition: "transform 0.15s" } : undefined}
            onLoad={() => {
              if (imgRef.current) {
                setLocalImgW(imgRef.current.naturalWidth);
                setLocalImgH(imgRef.current.naturalHeight);
              }
            }} />
          <svg
            className="absolute top-0 left-0 w-full h-full"
            viewBox={`0 0 ${effectiveW} ${effectiveH}`}
            preserveAspectRatio="none"
            style={{ pointerEvents: "none" }}
          >
            {/* Guide lines for straighten preview */}
            {(step === "straightened" || step === "straightening") && detectedLines.length === 0 && (
              Array.from({ length: 19 }, (_, i) => {
                const y = effectiveH * (i + 1) / 20;
                return (
                  <line key={`guide-${i}`}
                    x1={0} y1={y} x2={effectiveW} y2={y}
                    stroke="rgba(59, 130, 246, 0.3)"
                    strokeWidth={Math.max(1, effectiveW / 1200)}
                  />
                );
              })
            )}
            {/* Detected boxes */}
            {detectedLines.map((line, li) =>
              line.words.map((word, wi) => {
                const isDragTarget = dragTarget?.lineIdx === li && dragTarget?.wordIdx === wi;
                const isActiveBox = selectedBox?.lineIdx === li && selectedBox?.wordIdx === wi;
                const source = word.source || "detected";
                const colors = SOURCE_COLORS[source] || SOURCE_COLORS.detected;
                const isOverlapping = showOverlaps && overlapBoxKeys.has(`${li}-${wi}`);

                const fill = isActiveBox ? "rgba(168, 85, 247, 0.35)"
                  : isOverlapping ? "rgba(239, 68, 68, 0.3)"
                  : isDragTarget ? "rgba(168, 85, 247, 0.2)"
                  : colors.fill;
                const stroke = isActiveBox ? "rgba(168, 85, 247, 0.95)"
                  : isOverlapping ? "rgba(239, 68, 68, 0.9)"
                  : isDragTarget ? "rgba(168, 85, 247, 0.6)"
                  : colors.stroke;

                return (
                  <rect
                    key={`${li}-${wi}`}
                    x={word.xLeft}
                    y={word.yTop}
                    width={word.xRight - word.xLeft}
                    height={word.yBottom - word.yTop}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeW * (isActiveBox ? 3 : isOverlapping || isDragTarget ? 2.5 : 1)}
                  />
                );
              })
            )}
            {/* Preview rect while drawing */}
            {previewRect && (
              <rect
                x={previewRect.xLeft}
                y={previewRect.yTop}
                width={previewRect.xRight - previewRect.xLeft}
                height={previewRect.yBottom - previewRect.yTop}
                fill="rgba(34, 197, 94, 0.15)"
                stroke="rgba(34, 197, 94, 0.6)"
                strokeWidth={strokeW}
                strokeDasharray="8 4"
              />
            )}
          </svg>
          </div>{/* end zoom/pan transform */}

          {/* Status hint overlay */}
          {step === "detected" && (
            <div className="absolute top-2 left-2 bg-gray-800/80 text-white text-xs px-2 py-1 rounded shadow">
              {boxesLocked ? "Locked — unlock to edit"
                : touchNavMode && isTouch({ pointerType: "touch" } as React.PointerEvent) ? "Navigate mode"
                : selectedBox ? "Drag edges to resize"
                : "Tap box to edit, drag empty area to add"}
            </div>
          )}

          {/* Floating toolbar for selected box: Delete + Split */}
          {selectedBox && !boxesLocked && step === "detected" && (() => {
            const sdLine = detectedLines[selectedBox.lineIdx];
            const sdWord = sdLine?.words[selectedBox.wordIdx];
            if (!sdWord || !effectiveW || !effectiveH) return null;
            const topPct = (sdWord.yTop / effectiveH) * 100;
            const leftPct = ((sdWord.xLeft + sdWord.xRight) / 2 / effectiveW) * 100;
            return (
              <div className="absolute z-10 flex flex-col items-center gap-1" style={{
                top: `calc(${topPct}% - 8px)`,
                left: `${leftPct}%`,
                transform: "translate(-50%, -100%)",
              }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <div className="flex gap-1 bg-white rounded-lg shadow-lg border border-gray-300 p-1">
                  <button onClick={() => deleteDetectedBox(selectedBox.lineIdx, selectedBox.wordIdx)}
                    className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-red-500 text-white hover:bg-red-600 active:bg-red-700">
                    Delete
                  </button>
                  <button onClick={() => setSplitPickerOpen(p => !p)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-bold ${splitPickerOpen ? "bg-orange-600 text-white" : "bg-orange-500 text-white hover:bg-orange-600"}`}>
                    Split
                  </button>
                  <button onClick={() => { setSelectedBox(null); setSplitPickerOpen(false); }}
                    className="px-2 py-1.5 rounded-md text-xs bg-gray-200 text-gray-600 hover:bg-gray-300">
                    &#10005;
                  </button>
                </div>
                {splitPickerOpen && (
                  <div className="flex gap-1 bg-white rounded-lg shadow-lg border border-orange-300 p-1">
                    {[2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => splitIntoN(n)}
                        className="w-8 h-8 rounded-md text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700">
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Mobile navigate/edit toggle */}
          {step === "detected" && !boxesLocked && (
            <button
              onClick={() => setTouchNavMode(m => !m)}
              className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 px-3 py-2.5 rounded-full shadow-lg text-sm font-bold transition-colors ${
                touchNavMode
                  ? "bg-blue-600 text-white active:bg-blue-700"
                  : "bg-purple-600 text-white active:bg-purple-700"
              }`}
              style={{ touchAction: "manipulation" }}
            >
              {touchNavMode ? (
                <><span className="text-base">&#9995;</span> Navigate</>
              ) : (
                <><span className="text-base">&#9998;</span> Edit</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

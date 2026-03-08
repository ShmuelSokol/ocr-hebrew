"use client";
import { useState } from "react";

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
      const res = await fetch(`/api/files/${fileId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, skipPreprocess: true }),
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
    // Run all steps in sequence
    setStep("straightening");
    const h = startTimer();
    try {
      // Step 1: Straighten
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

      // Step 2: Detect
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

      // Step 3: Full OCR
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
      <div className="flex flex-wrap gap-2">
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
        {step === "detected" && (
          <>
            <div className="text-sm text-gray-600">
              {detectedLines.reduce((s, l) => s + l.words.length, 0)} words in {detectedLines.length} lines
            </div>
            <button onClick={doOcr} className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700">
              3. Recognize Text
            </button>
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
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
      )}

      {/* Bounding box overlay — shown after detection */}
      {detectedLines.length > 0 && imageNaturalHeight > 0 && step !== "done" && (
        <div className="relative border rounded overflow-hidden bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${fileId}/image?t=${Date.now()}`} alt="Detected" className="w-full" />
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${imageNaturalWidth} ${imageNaturalHeight}`}
            preserveAspectRatio="none"
          >
            {detectedLines.map((line) =>
              line.words.map((word, wi) => (
                <rect
                  key={`${line.lineIndex}-${wi}`}
                  x={word.xLeft}
                  y={word.yTop}
                  width={word.xRight - word.xLeft}
                  height={word.yBottom - word.yTop}
                  fill="rgba(59, 130, 246, 0.15)"
                  stroke="rgba(59, 130, 246, 0.6)"
                  strokeWidth={Math.max(1, imageNaturalWidth / 600)}
                />
              ))
            )}
          </svg>
        </div>
      )}
    </div>
  );
}

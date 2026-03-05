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

export default function EditorPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const fileId = params.fileId as string;

  const [result, setResult] = useState<OCRResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [firstLineHint, setFirstLineHint] = useState("");
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [filename, setFilename] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [imageNaturalHeight, setImageNaturalHeight] = useState(0);
  const [imageDisplayWidth, setImageDisplayWidth] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showOverlay, setShowOverlay] = useState(true);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
    }
    if (resultData?.id) setResult(resultData);
    setLoading(false);
  }, [fileId]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") loadResult();
  }, [status, router, loadResult]);

  // Timer for OCR processing
  useEffect(() => {
    if (ocrRunning) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ocrRunning]);

  function onImageLoad() {
    if (imageRef.current) {
      setImageNaturalHeight(imageRef.current.naturalHeight);
      setImageDisplayWidth(imageRef.current.clientWidth);
    }
  }

  async function confirmLine(lineId: string) {
    await fetch(`/api/lines/${lineId}/confirm`, { method: "POST" });
    await loadResult();
  }

  async function confirmAllLines() {
    if (!result) return;
    for (const line of result.lines) {
      const hasUnconfirmed = line.words.some((w) => !w.correctedText);
      if (hasUnconfirmed) {
        await fetch(`/api/lines/${line.id}/confirm`, { method: "POST" });
      }
    }
    await loadResult();
  }

  async function runOCR() {
    setOcrRunning(true);
    const res = await fetch(`/api/files/${fileId}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstLineHint: firstLineHint || undefined }),
    });
    if (res.ok) {
      await loadResult();
    } else {
      const err = await res.json();
      alert("OCR Error: " + (err.error || "Unknown error"));
    }
    setOcrRunning(false);
  }

  async function preprocessImage() {
    const res = await fetch(`/api/files/${fileId}/preprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contrast: 1.3, brightness: 10, sharpen: true, grayscale: true }),
    });
    if (res.ok) {
      // Force image reload
      if (imageRef.current) {
        imageRef.current.src = `/api/files/${fileId}/image?t=${Date.now()}`;
      }
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

  function startEdit(word: Word) {
    setEditingWord(word.id);
    setEditValue(word.correctedText || word.rawText);
  }

  // Render OCR text overlayed directly on the image
  function renderOverlay() {
    if (!result?.lines.length || !imageNaturalHeight) return null;

    return (
      <div className="relative" style={{ width: imageDisplayWidth || "100%" }}>
        {/* Full image as background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/files/${fileId}/image`}
          alt="Original"
          className="w-full block"
          style={{ display: "block" }}
        />
        {/* Overlay text lines on top of the image */}
        {showOverlay && result.lines.map((line) => {
          const allConfirmed = line.words.every((w) => w.correctedText);
          return (
            <div
              key={`text-${line.id}`}
              className={`absolute left-0 right-0 px-2 py-1 flex items-center gap-1 ${
                allConfirmed
                  ? "bg-green-50/80 border-y border-green-300"
                  : "bg-yellow-50/80 border-y border-yellow-300"
              }`}
              dir="rtl"
              style={{
                top: `${(line.yTop / imageNaturalHeight) * 100}%`,
                minHeight: `${((line.yBottom - line.yTop) / imageNaturalHeight) * 100}%`,
              }}
            >
              <div className="flex flex-wrap gap-1 text-sm leading-snug flex-1">
                {line.words.map((word) => {
                  const isCorrected =
                    word.correctedText && word.correctedText !== word.rawText;
                  const isEditing = editingWord === word.id;
                  const displayText = word.correctedText || word.rawText;

                  if (isEditing) {
                    return (
                      <span key={word.id} className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          dir="rtl"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveWord(word.id, editValue);
                            if (e.key === "Escape") setEditingWord(null);
                          }}
                          className="border-2 border-blue-500 rounded px-1 py-0.5 text-sm w-24 text-right bg-white"
                          autoFocus
                        />
                        <button
                          onClick={() => saveWord(word.id, editValue)}
                          className="text-green-600 text-xs font-bold"
                        >
                          &#10003;
                        </button>
                        <button
                          onClick={() => setEditingWord(null)}
                          className="text-red-500 text-xs font-bold"
                        >
                          &#10005;
                        </button>
                      </span>
                    );
                  }

                  return (
                    <span
                      key={word.id}
                      onClick={() => startEdit(word)}
                      className={`cursor-pointer px-1 rounded transition-all hover:bg-blue-200 hover:shadow text-gray-900 ${
                        isCorrected
                          ? "bg-green-200/90 border border-green-400 font-medium"
                          : ""
                      } ${word.rawText === "[?]" ? "bg-red-200/90 text-red-600 border border-red-400" : ""}`}
                      title={
                        isCorrected
                          ? `Original: ${word.rawText}`
                          : "Click to correct"
                      }
                    >
                      {displayText}
                    </span>
                  );
                })}
              </div>
              {!allConfirmed && (
                <button
                  onClick={() => confirmLine(line.id)}
                  className="text-xs bg-green-500 text-white px-2 py-0.5 rounded hover:bg-green-600 whitespace-nowrap"
                  title="Confirm this line is correct"
                >
                  &#10003;
                </button>
              )}
              {allConfirmed && (
                <span className="text-xs text-green-600 whitespace-nowrap">&#10003;</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (status === "loading" || loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-blue-600 hover:underline text-sm"
          >
            &larr; Dashboard
          </button>
          <h1 className="text-xl font-bold">{filename}</h1>
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              fileStatus === "completed"
                ? "bg-green-100 text-green-700"
                : fileStatus === "processing"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {fileStatus}
          </span>
        </div>
        <div className="flex gap-2">
          {result && (
            <>
              <button
                onClick={confirmAllLines}
                className="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600"
              >
                Confirm All Lines
              </button>
              <button
                onClick={() => window.open(`/api/files/${fileId}/export?format=txt`, "_blank")}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
              >
                Export TXT
              </button>
              <button
                onClick={() => window.open(`/api/files/${fileId}/export?format=json`, "_blank")}
                className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
              >
                Export JSON
              </button>
            </>
          )}
        </div>
      </div>

      {/* OCR Controls */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center gap-3">
          <input
            type="text"
            dir="rtl"
            placeholder="Optional: paste the first line of text to improve accuracy..."
            value={firstLineHint}
            onChange={(e) => setFirstLineHint(e.target.value)}
            className="flex-1 border rounded px-3 py-2 text-right text-sm"
          />
          <button
            onClick={preprocessImage}
            className="px-4 py-2 rounded text-sm font-medium bg-gray-200 hover:bg-gray-300"
            title="Enhance contrast, sharpen, and convert to grayscale for better OCR"
          >
            Enhance Image
          </button>
          <button
            onClick={runOCR}
            disabled={ocrRunning}
            className={`px-6 py-2 rounded text-sm font-medium text-white disabled:opacity-50 ${
              result ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {ocrRunning ? "Processing..." : result ? "Re-run OCR" : "Run OCR"}
          </button>
        </div>
        {ocrRunning && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Processing image...</span>
              </div>
              <span className="tabular-nums font-mono">
                {Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${Math.min(95, (elapsedSeconds / 60) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-400">
              {elapsedSeconds < 15
                ? "Detecting lines..."
                : elapsedSeconds < 45
                ? "Reading handwriting..."
                : "Almost done..."}
            </p>
          </div>
        )}
      </div>

      {/* Main content: image with OCR overlay */}
      <div className="bg-white rounded-lg shadow overflow-hidden" ref={containerRef}>
        {result && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
            <button
              onClick={() => setShowOverlay(!showOverlay)}
              className={`text-xs px-3 py-1 rounded font-medium ${
                showOverlay
                  ? "bg-blue-100 text-blue-700 border border-blue-300"
                  : "bg-gray-200 text-gray-600"
              }`}
            >
              {showOverlay ? "Hide Overlay" : "Show Overlay"}
            </button>
          </div>
        )}
        <div className="overflow-auto">
          {/* Hidden image for measuring natural dimensions */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={`/api/files/${fileId}/image`}
            alt=""
            className="w-full invisible h-0"
            onLoad={onImageLoad}
          />
          {!result ? (
            <div className="p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${fileId}/image`}
                alt="Original"
                className="w-full"
              />
            </div>
          ) : imageNaturalHeight > 0 ? (
            renderOverlay()
          ) : (
            <p className="p-8 text-center text-gray-400">Loading image...</p>
          )}
        </div>
      </div>

      {/* Legend */}
      {result && (
        <div className="mt-4 flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-yellow-50 border border-yellow-200 rounded"></span>
            OCR text (click to edit)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-green-100 border border-green-300 rounded"></span>
            Corrected word
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 bg-red-100 border border-red-300 rounded"></span>
            Unclear word [?]
          </span>
        </div>
      )}
    </div>
  );
}

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
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Calculate scale from natural image to displayed size
  const scale = imageRef.current
    ? imageRef.current.clientHeight / imageNaturalHeight
    : 1;

  // Build interleaved strips: for each detected line, show the image strip then the OCR text
  function renderOverlay() {
    if (!result?.lines.length || !imageNaturalHeight) return null;

    const strips: { type: "image" | "text"; line: Line; yTop: number; yBottom: number }[] = [];
    let prevBottom = 0;

    for (const line of result.lines) {
      // If there's a gap before this line, add it as blank image space
      if (line.yTop > 0 && line.yTop > prevBottom) {
        strips.push({
          type: "image",
          line,
          yTop: prevBottom,
          yBottom: line.yTop,
        });
      }
      // The image strip for this line
      strips.push({
        type: "image",
        line,
        yTop: line.yTop || prevBottom,
        yBottom: line.yBottom || prevBottom + 50,
      });
      // The OCR text strip
      strips.push({
        type: "text",
        line,
        yTop: line.yTop,
        yBottom: line.yBottom,
      });
      prevBottom = line.yBottom || prevBottom + 50;
    }

    // Remaining image after last line
    if (prevBottom < imageNaturalHeight) {
      strips.push({
        type: "image",
        line: result.lines[result.lines.length - 1],
        yTop: prevBottom,
        yBottom: imageNaturalHeight,
      });
    }

    return (
      <div className="relative" style={{ width: imageDisplayWidth || "100%" }}>
        {strips.map((strip, i) => {
          if (strip.type === "image") {
            const height = strip.yBottom - strip.yTop;
            return (
              <div
                key={`img-${i}`}
                style={{
                  width: "100%",
                  height: height * scale,
                  backgroundImage: `url(/api/files/${fileId}/image)`,
                  backgroundPosition: `0 ${-strip.yTop * scale}px`,
                  backgroundSize: `${imageDisplayWidth}px auto`,
                  backgroundRepeat: "no-repeat",
                }}
              />
            );
          }

          // Text overlay strip
          const line = strip.line;
          const allConfirmed = line.words.every((w) => w.correctedText);
          return (
            <div
              key={`text-${line.id}`}
              className={`border-t border-b px-3 py-2 flex items-start gap-2 ${
                allConfirmed ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"
              }`}
              dir="rtl"
            >
              <div className="flex flex-wrap gap-1 text-base leading-relaxed flex-1">
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
                          className="border-2 border-blue-500 rounded px-1 py-0.5 text-base w-28 text-right bg-white"
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
                      className={`cursor-pointer px-1 rounded transition-all hover:bg-blue-100 hover:shadow ${
                        isCorrected
                          ? "bg-green-100 border border-green-300 font-medium"
                          : ""
                      } ${word.rawText === "[?]" ? "bg-red-100 text-red-500 border border-red-300" : ""}`}
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
                  className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 whitespace-nowrap mt-0.5"
                  title="Confirm this line is correct and save all words to the handwriting profile"
                >
                  Confirm
                </button>
              )}
              {allConfirmed && (
                <span className="text-xs text-green-600 whitespace-nowrap mt-1">&#10003;</span>
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
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            Processing with Claude Opus... (30-60 seconds)
          </div>
        )}
      </div>

      {/* Main content: overlaid image + text */}
      <div className="bg-white rounded-lg shadow overflow-hidden" ref={containerRef}>
        {!result ? (
          // Just show the image if no OCR yet
          <div className="p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={`/api/files/${fileId}/image`}
              alt="Original"
              className="w-full"
              onLoad={onImageLoad}
            />
          </div>
        ) : (
          // Show interleaved image strips + OCR text
          <div className="overflow-auto">
            {/* Hidden image to get dimensions */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={`/api/files/${fileId}/image`}
              alt=""
              className="w-full invisible h-0"
              onLoad={onImageLoad}
            />
            {imageNaturalHeight > 0 ? (
              renderOverlay()
            ) : (
              <p className="p-8 text-center text-gray-400">Loading image...</p>
            )}
          </div>
        )}
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

"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";

interface Sample {
  reference: string;
  prediction: string;
  correct: boolean;
}

interface TrainingStatus {
  status: string;
  started_at?: string;
  updated_at?: string;
  current_epoch: number;
  total_epochs: number;
  current_step: number;
  total_steps: number;
  elapsed_seconds: number;
  eta_seconds: number;
  train_loss: number;
  val_loss: number;
  val_cer: number;
  val_wer: number;
  val_exact_match: number;
  best_cer: number | null;
  best_epoch: number;
  learning_rate: number;
  patience_counter: number;
  patience_limit: number;
  device: string;
  train_examples: number;
  val_examples: number;
  samples: Sample[];
  history: {
    train_loss: number[];
    val_loss: number[];
    val_cer: number[];
    val_wer: number[];
    val_exact_match: number[];
    learning_rate: number[];
  };
  error?: string | null;
  message?: string;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPercent(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

// ─── SVG Line Chart ────────────────────────────────────────

function MiniChart({
  data,
  color,
  label,
  height = 120,
  formatVal,
  secondData,
  secondColor,
  secondLabel,
}: {
  data: number[];
  color: string;
  label: string;
  height?: number;
  formatVal?: (n: number) => string;
  secondData?: number[];
  secondColor?: string;
  secondLabel?: string;
}) {
  if (!data.length) return null;

  const width = 320;
  const pad = { top: 20, right: 10, bottom: 25, left: 45 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const allData = secondData ? [...data, ...secondData] : data;
  const minVal = Math.min(...allData);
  const maxVal = Math.max(...allData);
  const range = maxVal - minVal || 1;

  function toX(i: number) {
    return pad.left + (i / Math.max(data.length - 1, 1)) * chartW;
  }
  function toY(v: number) {
    return pad.top + chartH - ((v - minVal) / range) * chartH;
  }

  function polyline(d: number[], c: string) {
    const points = d.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
    return <polyline points={points} fill="none" stroke={c} strokeWidth="2" />;
  }

  const fmt = formatVal || ((n: number) => n < 1 ? n.toFixed(3) : n.toFixed(1));
  const yTicks = 4;
  const step = range / yTicks;

  return (
    <div>
      <svg width={width} height={height} className="font-mono text-xs">
        {/* Grid lines */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const val = minVal + step * i;
          const y = toY(val);
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={pad.left - 4} y={y + 3} textAnchor="end" fill="#9ca3af" fontSize="9">{fmt(val)}</text>
            </g>
          );
        })}

        {/* Data lines */}
        {polyline(data, color)}
        {secondData && secondColor && polyline(secondData, secondColor)}

        {/* Dots on last points */}
        {data.length > 0 && (
          <circle cx={toX(data.length - 1)} cy={toY(data[data.length - 1])} r="3" fill={color} />
        )}
        {secondData && secondData.length > 0 && secondColor && (
          <circle cx={toX(secondData.length - 1)} cy={toY(secondData[secondData.length - 1])} r="3" fill={secondColor} />
        )}

        {/* X axis labels */}
        {data.length > 1 && (
          <>
            <text x={pad.left} y={height - 4} fill="#9ca3af" fontSize="9">1</text>
            <text x={toX(data.length - 1)} y={height - 4} fill="#9ca3af" fontSize="9" textAnchor="end">{data.length}</text>
            <text x={pad.left + chartW / 2} y={height - 4} fill="#9ca3af" fontSize="9" textAnchor="middle">Epoch</text>
          </>
        )}

        {/* Legend */}
        <circle cx={pad.left + 5} cy={8} r="4" fill={color} />
        <text x={pad.left + 12} y={11} fill="#6b7280" fontSize="9">{label}</text>
        {secondLabel && secondColor && (
          <>
            <circle cx={pad.left + 65} cy={8} r="4" fill={secondColor} />
            <text x={pad.left + 72} y={11} fill="#6b7280" fontSize="9">{secondLabel}</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    training: "bg-green-100 text-green-800 border-green-300",
    complete: "bg-blue-100 text-blue-800 border-blue-300",
    error: "bg-red-100 text-red-800 border-red-300",
    idle: "bg-gray-100 text-gray-600 border-gray-300",
    no_data: "bg-gray-100 text-gray-600 border-gray-300",
    evaluating: "bg-yellow-100 text-yellow-800 border-yellow-300",
  };

  const pulseStatuses = ["training", "evaluating"];

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${styles[status] || styles.idle}`}>
      {pulseStatuses.includes(status) && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      )}
      {status === "no_data" ? "Not Started" : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200"}`}>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${highlight ? "text-blue-700" : "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────

function ProgressBar({ current, total, label }: { current: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div>
      {label && <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{label}</span><span>{pct.toFixed(0)}%</span></div>}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────

export default function TrainingMonitor() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<TrainingStatus | null>(null);
  const [pollInterval, setPollInterval] = useState(3000);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/training/status");
      const json = await res.json();
      setData(json);
      // Slow down polling when not actively training
      if (json.status === "training" || json.status === "evaluating") {
        setPollInterval(3000);
      } else {
        setPollInterval(10000);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
    if (authStatus === "authenticated") fetchStatus();
  }, [authStatus, router, fetchStatus]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchStatus, pollInterval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchStatus, pollInterval]);

  if (authStatus === "loading") return <div className="p-8">Loading...</div>;

  const isActive = data?.status === "training" || data?.status === "evaluating";
  const hasHistory = data?.history && data.history.train_loss.length > 0;

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Training Monitor</h1>
          {data && <StatusBadge status={data.status} />}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/training")} className="text-sm text-blue-600 hover:underline">
            Training Data
          </button>
          <button onClick={() => router.push("/dashboard")} className="text-sm text-blue-600 hover:underline">
            Dashboard
          </button>
        </div>
      </div>

      {/* No data state */}
      {(!data || data.status === "no_data") && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-400 text-lg mb-2">No training in progress</p>
          <p className="text-gray-400 text-sm">
            Start training from the terminal:
          </p>
          <code className="block mt-3 bg-gray-100 p-3 rounded text-sm text-left max-w-md mx-auto">
            cd ocr-hebrew/training<br />
            source venv/bin/activate<br />
            python train.py
          </code>
        </div>
      )}

      {/* Error state */}
      {data?.status === "error" && data.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="font-medium text-red-800">Training Error</p>
          <p className="text-red-600 text-sm mt-1 font-mono">{data.error}</p>
        </div>
      )}

      {data && data.status !== "no_data" && (
        <>
          {/* Progress */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <ProgressBar current={data.current_epoch} total={data.total_epochs} label={`Epoch ${data.current_epoch} / ${data.total_epochs}`} />
              <ProgressBar current={data.current_step} total={data.total_steps} label={`Step ${data.current_step} / ${data.total_steps}`} />
            </div>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Elapsed: <strong>{formatTime(data.elapsed_seconds)}</strong></span>
              {isActive && <span>ETA: <strong>{formatTime(data.eta_seconds)}</strong></span>}
              <span>Device: <strong>{data.device}</strong></span>
              <span>Data: <strong>{data.train_examples} train / {data.val_examples} val</strong></span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-4">
            <StatCard label="Train Loss" value={data.train_loss ? data.train_loss.toFixed(4) : "--"} />
            <StatCard label="Val Loss" value={data.val_loss ? data.val_loss.toFixed(4) : "--"} />
            <StatCard label="CER" value={data.val_cer ? formatPercent(data.val_cer) : "--"} sub="Character Error" />
            <StatCard label="WER" value={data.val_wer ? formatPercent(data.val_wer) : "--"} sub="Word Error" />
            <StatCard label="Exact Match" value={data.val_exact_match ? formatPercent(data.val_exact_match) : "--"} highlight />
            <StatCard
              label="Best CER"
              value={data.best_cer != null ? formatPercent(data.best_cer) : "--"}
              sub={data.best_epoch ? `Epoch ${data.best_epoch}` : undefined}
              highlight
            />
          </div>

          {/* Early stopping indicator */}
          <div className="bg-white rounded-lg shadow p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">Early Stopping Patience:</span>
              <div className="flex gap-1">
                {Array.from({ length: data.patience_limit }, (_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      i < data.patience_counter ? "bg-orange-400" : "bg-gray-200"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-400">{data.patience_counter} / {data.patience_limit}</span>
            </div>
            <div className="text-xs text-gray-500">
              LR: <span className="font-mono">{data.learning_rate ? data.learning_rate.toExponential(2) : "--"}</span>
            </div>
          </div>

          {/* Charts */}
          {hasHistory && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-lg shadow p-4">
                <MiniChart
                  data={data.history.train_loss}
                  color="#3b82f6"
                  label="Train"
                  secondData={data.history.val_loss}
                  secondColor="#ef4444"
                  secondLabel="Val"
                />
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <MiniChart
                  data={data.history.val_cer}
                  color="#ef4444"
                  label="CER"
                  formatVal={(n) => formatPercent(n)}
                />
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <MiniChart
                  data={data.history.val_wer}
                  color="#f97316"
                  label="WER"
                  formatVal={(n) => formatPercent(n)}
                />
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <MiniChart
                  data={data.history.val_exact_match}
                  color="#22c55e"
                  label="Exact Match"
                  formatVal={(n) => formatPercent(n)}
                />
              </div>
            </div>
          )}

          {/* Sample Predictions */}
          {data.samples && data.samples.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-3">Sample Predictions</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-3 w-8"></th>
                      <th className="py-2 px-3" dir="rtl">Expected</th>
                      <th className="py-2 px-3" dir="rtl">Predicted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.samples.map((s, i) => (
                      <tr key={i} className={`border-b last:border-0 ${s.correct ? "bg-green-50" : ""}`}>
                        <td className="py-2 pr-3 text-center">
                          {s.correct ? (
                            <span className="text-green-600 font-bold">&#10003;</span>
                          ) : (
                            <span className="text-red-400">&#10007;</span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono" dir="rtl">{s.reference}</td>
                        <td className={`py-2 px-3 font-mono ${s.correct ? "text-green-700" : "text-red-600"}`} dir="rtl">
                          {s.prediction}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Updated timestamp */}
          {data.updated_at && (
            <p className="text-xs text-gray-400 text-center mt-4">
              Last updated: {new Date(data.updated_at).toLocaleTimeString()}
              {isActive && " (auto-refreshing every 3s)"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

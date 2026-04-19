"use client";
import { useState } from "react";

export default function TypedConfirmButton({
  buttonLabel,
  confirmWord,
  warningTitle,
  warningBody,
  onConfirm,
  variant = "danger",
}: {
  buttonLabel: string;
  confirmWord: string;
  warningTitle: string;
  warningBody: React.ReactNode;
  onConfirm: () => Promise<void> | void;
  variant?: "danger" | "warning";
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const match = typed === confirmWord;
  const base = variant === "danger"
    ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";

  async function run() {
    setBusy(true);
    try { await onConfirm(); setOpen(false); setTyped(""); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`border rounded px-3 py-1.5 text-xs ${base}`}
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-red-700">{warningTitle}</h3>
            <div className="text-sm text-gray-700 mb-4 space-y-2">{warningBody}</div>
            <label className="block text-xs text-gray-500 mb-1">
              Type <span className="font-mono bg-gray-100 px-1 rounded">{confirmWord}</span> to confirm:
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="border rounded px-3 py-1.5 w-full text-sm font-mono mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setTyped(""); }}
                disabled={busy}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={!match || busy}
                className={`px-3 py-1.5 text-sm rounded ${match && !busy ? "bg-red-600 text-white hover:bg-red-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
              >
                {busy ? "Deleting..." : buttonLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

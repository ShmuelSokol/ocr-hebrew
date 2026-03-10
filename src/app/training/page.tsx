"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";

interface Profile {
  id: string;
  name: string;
}

interface TrainingItem {
  id: string;
  text: string;
  profileId: string;
  profileName: string;
  source: string;
  createdAt: string;
}

export default function TrainingPage() {
  const { status } = useSession();
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [examples, setExamples] = useState<TrainingItem[]>([]);
  const [filterProfile, setFilterProfile] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState("");
  const [addProfile, setAddProfile] = useState("");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPreview, setAddPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const res = await fetch("/api/training");
    const data = await res.json();
    setProfiles(data.profiles || []);
    setExamples(data.examples || []);
    if (!addProfile && data.profiles?.length > 0) {
      setAddProfile(data.profiles[0].id);
    }
  }, [addProfile]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") loadData();
  }, [status, router, loadData]);

  const filtered = filterProfile
    ? examples.filter((e) => e.profileId === filterProfile)
    : examples;

  async function deleteExample(id: string) {
    if (!confirm("Delete this training example?")) return;
    await fetch("/api/training", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setExamples((prev) => prev.filter((e) => e.id !== id));
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    await fetch("/api/training", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, text: editText }),
    });
    setExamples((prev) =>
      prev.map((e) => (e.id === id ? { ...e, text: editText.trim() } : e))
    );
    setEditingId(null);
  }

  function startEdit(item: TrainingItem) {
    setEditingId(item.id);
    setEditText(item.text);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAddFile(file);
    const url = URL.createObjectURL(file);
    setAddPreview(url);
  }

  async function addExample() {
    if (!addFile || !addText.trim() || !addProfile) return;
    setUploading(true);
    const form = new FormData();
    form.append("image", addFile);
    form.append("text", addText);
    form.append("profileId", addProfile);
    await fetch("/api/training", { method: "POST", body: form });
    setAddText("");
    setAddFile(null);
    setAddPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
    loadData();
  }

  if (status === "loading") return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Training Data</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} examples
            {filterProfile && " (filtered)"}
            {filtered.length > 0 && (
              <span className="ml-2 text-xs">
                <span className="text-blue-600">{filtered.filter(e => e.source === "confirmed").length} correct</span>
                {" / "}
                <span className="text-green-600">{filtered.filter(e => e.source === "corrected").length} corrected</span>
                {filtered.filter(e => e.source !== "confirmed" && e.source !== "corrected").length > 0 && (
                  <> / <span className="text-gray-500">{filtered.filter(e => e.source !== "confirmed" && e.source !== "corrected").length} manual</span></>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/training/review")}
            className="text-sm text-blue-600 hover:underline"
          >
            Review Data
          </button>
          <button
            onClick={() => router.push("/training/monitor")}
            className="text-sm text-blue-600 hover:underline"
          >
            Training Monitor
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-sm text-blue-600 hover:underline"
          >
            Dashboard
          </button>
          <button
            onClick={() => setAdding(!adding)}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
          >
            {adding ? "Cancel" : "Add Word"}
          </button>
        </div>
      </div>

      {/* Add new example */}
      {adding && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="font-semibold mb-3">Add Training Example</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Profile</label>
              <select
                value={addProfile}
                onChange={(e) => setAddProfile(e.target.value)}
                className="border rounded px-3 py-2 text-sm w-full mb-3"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <label className="block text-sm text-gray-600 mb-1">Word Image</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="border rounded px-3 py-2 text-sm w-full mb-3"
              />

              <label className="block text-sm text-gray-600 mb-1">Correct Text</label>
              <input
                type="text"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addExample()}
                placeholder="Type the Hebrew word..."
                className="border rounded px-3 py-2 text-sm w-full mb-3"
                dir="rtl"
              />

              <button
                onClick={addExample}
                disabled={!addFile || !addText.trim() || !addProfile || uploading}
                className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : "Save Example"}
              </button>
            </div>

            {addPreview && (
              <div className="flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={addPreview}
                  alt="Preview"
                  className="max-w-[200px] max-h-[120px] border rounded object-contain bg-gray-50"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter by profile */}
      {profiles.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilterProfile("")}
            className={`px-3 py-1 rounded-full text-sm border ${
              !filterProfile ? "bg-blue-100 border-blue-500" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
            }`}
          >
            All
          </button>
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterProfile(filterProfile === p.id ? "" : p.id)}
              className={`px-3 py-1 rounded-full text-sm border ${
                filterProfile === p.id ? "bg-blue-100 border-blue-500" : "bg-gray-50 border-gray-200 hover:bg-gray-100"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Examples grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          <p className="text-lg mb-2">No training examples yet</p>
          <p className="text-sm">Correct words in the editor or click &quot;Add Word&quot; to manually add examples</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow overflow-hidden group"
            >
              {/* Word image */}
              <div className="bg-gray-50 p-2 flex items-center justify-center min-h-[60px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/training/${item.id}/image`}
                  alt={item.text}
                  className="max-h-[50px] object-contain"
                  loading="lazy"
                />
              </div>

              {/* Text + actions */}
              <div className="p-2">
                {editingId === item.id ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(item.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="border rounded px-2 py-1 text-sm flex-1 min-w-0"
                      dir="rtl"
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="text-green-600 text-sm px-1"
                      title="Save"
                    >
                      &#10003;
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-gray-400 text-sm px-1"
                      title="Cancel"
                    >
                      &#10005;
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span
                      className="font-medium text-sm cursor-pointer hover:text-blue-600"
                      dir="rtl"
                      onClick={() => startEdit(item)}
                      title="Click to edit"
                    >
                      {item.text}
                    </span>
                    <button
                      onClick={() => deleteExample(item.id)}
                      className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                      title="Delete"
                    >
                      &#10005;
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    item.source === "confirmed" ? "bg-blue-100 text-blue-600" :
                    item.source === "corrected" ? "bg-green-100 text-green-600" :
                    "bg-gray-100 text-gray-500"
                  }`}>
                    {item.source === "confirmed" ? "correct" : item.source === "corrected" ? "corrected" : item.source || "manual"}
                  </span>
                  <span className="text-[10px] text-gray-400">{item.profileName}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

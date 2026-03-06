"use client";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

interface Profile {
  id: string;
  name: string;
  description: string | null;
  _count: { files: number; corrections: number };
}

interface FileRecord {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  profile: { name: string } | null;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [usage, setUsage] = useState<{
    totalTokens: number;
    totalCostDollars: string;
    requestCount: number;
  } | null>(null);
  const [showCorrections, setShowCorrections] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<{
    profileName: string;
    totalCorrections: number;
    uniqueWords: number;
    words: { originalText: string; corrections: { correctedText: string; count: number; ids: string[] }[] }[];
  } | null>(null);

  const loadData = useCallback(async () => {
    const [filesRes, profilesRes, usageRes] = await Promise.all([
      fetch("/api/files"),
      fetch("/api/profiles"),
      fetch("/api/usage"),
    ]);
    setFiles(await filesRes.json());
    setProfiles(await profilesRes.json());
    setUsage(await usageRes.json());
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") loadData();
  }, [status, router, loadData]);

  async function createProfile() {
    if (!newProfileName.trim()) return;
    await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProfileName }),
    });
    setNewProfileName("");
    loadData();
  }

  async function deleteProfile(profileId: string, name: string) {
    if (!confirm(`Delete profile "${name}" and all its learned corrections?`)) return;
    await fetch(`/api/profiles/${profileId}`, { method: "DELETE" });
    setSelectedProfile("");
    setShowCorrections(null);
    loadData();
  }

  async function viewCorrections(profileId: string) {
    if (showCorrections === profileId) {
      setShowCorrections(null);
      return;
    }
    const res = await fetch(`/api/profiles/${profileId}/corrections`);
    setCorrections(await res.json());
    setShowCorrections(profileId);
  }

  async function deleteCorrection(ids: string[]) {
    for (const id of ids) {
      await fetch(`/api/corrections/${id}`, { method: "DELETE" });
    }
    if (showCorrections) {
      const res = await fetch(`/api/profiles/${showCorrections}/corrections`);
      setCorrections(await res.json());
    }
    loadData();
  }

  async function deleteFile(fileId: string, filename: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${filename}"?`)) return;
    await fetch(`/api/files/${fileId}`, { method: "DELETE" });
    loadData();
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);

    for (let i = 0; i < fileList.length; i++) {
      const form = new FormData();
      form.append("file", fileList[i]);
      if (selectedProfile) form.append("profileId", selectedProfile);
      await fetch("/api/files", { method: "POST", body: form });
    }

    setUploading(false);
    loadData();
    e.target.value = "";
  }

  const filtered = files.filter((f) =>
    tab === "pending" ? f.status !== "completed" : f.status === "completed"
  );

  if (status === "loading") return <div className="p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">OCR Hebrew</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/training")}
            className="text-sm text-blue-600 hover:underline"
          >
            Training Data
          </button>
          <span className="text-sm text-gray-500">{session?.user?.email}</span>
          <button onClick={() => signOut()} className="text-sm text-red-500 hover:underline">
            Sign Out
          </button>
        </div>
      </div>

      {/* Token Usage */}
      {usage && usage.requestCount > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">API Usage</h2>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-gray-400">Requests: </span>
                <span className="font-medium">{usage.requestCount}</span>
              </div>
              <div>
                <span className="text-gray-400">Tokens: </span>
                <span className="font-medium">{usage.totalTokens.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-400">Cost: </span>
                <span className="font-medium text-green-700">${usage.totalCostDollars}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Handwriting Profiles */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-3">Handwriting Profiles</h2>
        <div className="flex gap-2 mb-3 flex-wrap">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <div
                className={`px-3 py-1 rounded-r-none rounded-full text-sm border cursor-pointer ${
                  selectedProfile === p.id
                    ? "bg-blue-100 border-blue-500"
                    : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                }`}
                onClick={() => setSelectedProfile(selectedProfile === p.id ? "" : p.id)}
              >
                {p.name}
                <span className="text-gray-400 mr-1">
                  ({p._count.files} files, {p._count.corrections} corrections)
                </span>
              </div>
              <button
                onClick={() => viewCorrections(p.id)}
                className={`px-2 py-1 text-xs border rounded-none ${
                  showCorrections === p.id ? "bg-blue-500 text-white" : "bg-gray-50 hover:bg-gray-100"
                }`}
                title="View learned corrections"
              >
                View
              </button>
              <button
                onClick={() => deleteProfile(p.id, p.name)}
                className="px-2 py-1 text-xs border rounded-l-none rounded-full bg-gray-50 text-red-500 hover:bg-red-50"
                title="Delete profile"
              >
                &#10005;
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New profile name..."
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProfile()}
            className="border rounded px-3 py-1 text-sm flex-1"
          />
          <button
            onClick={createProfile}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
          >
            Add Profile
          </button>
        </div>

        {/* Corrections viewer */}
        {showCorrections && corrections && (
          <div className="mt-4 border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-medium text-sm">
                Learned corrections for {corrections.profileName}
                <span className="text-gray-400 font-normal mr-2">
                  ({corrections.totalCorrections} total, {corrections.uniqueWords} unique words)
                </span>
              </h3>
            </div>
            <div className="max-h-64 overflow-auto space-y-2" dir="rtl">
              {corrections.words.length === 0 && (
                <p className="text-gray-400 text-sm text-center">No corrections yet</p>
              )}
              {corrections.words.map((word, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded p-2">
                  <span className="font-mono bg-gray-200 px-2 py-0.5 rounded">{word.originalText}</span>
                  <span className="text-gray-400">&larr;</span>
                  <div className="flex gap-1 flex-wrap flex-1">
                    {word.corrections.map((c, j) => (
                      <span
                        key={j}
                        className={`px-2 py-0.5 rounded text-sm ${
                          c.correctedText === word.originalText
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {c.correctedText}
                        {c.count > 1 && <span className="text-xs opacity-60"> x{c.count}</span>}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const allIds = word.corrections.flatMap((c) => c.ids);
                      deleteCorrection(allIds);
                    }}
                    className="text-red-400 hover:text-red-600 text-xs px-1"
                    dir="ltr"
                    title="Delete all corrections for this word"
                  >
                    &#10005;
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-3">Upload Files</h2>
        {!selectedProfile && profiles.length > 0 && (
          <p className="text-amber-600 text-sm mb-2">
            Select a handwriting profile above for better OCR results
          </p>
        )}
        <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={uploadFile}
            className="hidden"
            disabled={uploading}
          />
          {uploading ? (
            <span className="text-gray-500">Uploading...</span>
          ) : (
            <span className="text-gray-500">
              Click or drag image files here (JPG, PNG) — multiple files supported
            </span>
          )}
        </label>
      </div>

      {/* Files */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b">
          <button
            onClick={() => setTab("pending")}
            className={`flex-1 py-3 text-center text-sm font-medium ${
              tab === "pending" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"
            }`}
          >
            Pending / In Progress
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`flex-1 py-3 text-center text-sm font-medium ${
              tab === "completed" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"
            }`}
          >
            Completed
          </button>
        </div>

        <div className="divide-y">
          {filtered.length === 0 && (
            <p className="p-6 text-center text-gray-400">No files yet</p>
          )}
          {filtered.map((file) => (
            <div
              key={file.id}
              className="p-4 flex justify-between items-center hover:bg-gray-50 cursor-pointer"
              onClick={() => router.push(`/editor/${file.id}`)}
            >
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/files/${file.id}/image`}
                  alt={file.filename}
                  className="w-16 h-16 object-cover rounded border border-gray-200"
                />
                <div>
                  <p className="font-medium">{file.filename}</p>
                  <p className="text-sm text-gray-400">
                    {file.profile?.name || "No profile"} &middot;{" "}
                    {new Date(file.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    file.status === "completed"
                      ? "bg-green-100 text-green-700"
                      : file.status === "processing"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {file.status}
                </span>
                <button
                  onClick={(e) => deleteFile(file.id, file.filename, e)}
                  className="text-red-400 hover:text-red-600 text-sm px-1"
                  title="Delete file"
                >
                  &#10005;
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

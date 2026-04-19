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
  project: { id: string; name: string } | null;
}

interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  _count: { files: number; approvedTexts: number };
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState("");
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [usage, setUsage] = useState<{
    totalTokens: number;
    totalCostDollars: string;
    requestCount: number;
    bboxCorrections?: number;
    trainingExamples?: number;
  } | null>(null);
  const [showCorrections, setShowCorrections] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<{
    profileName: string;
    totalCorrections: number;
    uniqueWords: number;
    words: { originalText: string; corrections: { correctedText: string; count: number; ids: string[] }[] }[];
  } | null>(null);

  const loadData = useCallback(async () => {
    const [filesRes, profilesRes, usageRes, projectsRes] = await Promise.all([
      fetch("/api/files"),
      fetch("/api/profiles"),
      fetch("/api/usage"),
      fetch("/api/projects"),
    ]);
    setFiles(await filesRes.json());
    setProfiles(await profilesRes.json());
    setUsage(await usageRes.json());
    setProjects(await projectsRes.json());
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

  async function createProject() {
    if (!newProjectName.trim()) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName }),
    });
    setNewProjectName("");
    loadData();
  }

  async function deleteProject(projectId: string, name: string) {
    if (!confirm(`Delete project "${name}"? Files won't be deleted.`)) return;
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    loadData();
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);

    try {
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
        const form = new FormData();
        form.append("file", f);
        if (selectedProfile) form.append("profileId", selectedProfile);
        if (selectedProject) form.append("projectId", selectedProject);

        if (isPdf) {
          setUploadStatus(`Splitting "${f.name}" into pages (this may take a minute)...`);
          const res = await fetch("/api/files/pdf", { method: "POST", body: form });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Upload failed" }));
            alert(`PDF upload failed: ${err.error || res.statusText}`);
            break;
          }
          const body = await res.json();
          setUploadStatus(`Imported ${body.pages} pages from "${f.name}"`);
        } else {
          setUploadStatus(`Uploading ${i + 1} of ${fileList.length}: ${f.name}`);
          const res = await fetch("/api/files", { method: "POST", body: form });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Upload failed" }));
            alert(`Upload failed: ${err.error || res.statusText}`);
            break;
          }
        }
      }
    } finally {
      setUploading(false);
      setUploadStatus("");
      loadData();
      e.target.value = "";
    }
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

      {/* Token Usage & Training Stats */}
      {usage && (usage.requestCount > 0 || (usage.trainingExamples ?? 0) > 0) && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Stats</h2>
            <div className="flex gap-4 sm:gap-6 text-sm flex-wrap">
              {usage.requestCount > 0 && (
                <>
                  <div>
                    <span className="text-gray-400">OCR Runs: </span>
                    <span className="font-medium">{usage.requestCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Cost: </span>
                    <span className="font-medium text-green-700">${usage.totalCostDollars}</span>
                  </div>
                </>
              )}
              {(usage.trainingExamples ?? 0) > 0 && (
                <div>
                  <span className="text-gray-400">Training Words: </span>
                  <span className="font-medium">{usage.trainingExamples}</span>
                </div>
              )}
              {(usage.bboxCorrections ?? 0) > 0 && (
                <div>
                  <span className="text-gray-400">BBox Fixes: </span>
                  <span className="font-medium text-amber-600">{usage.bboxCorrections}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Projects */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold">Projects</h2>
          <span className="text-xs text-gray-400">{projects.length} total</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A project groups files from one source (e.g. a book, a manuscript, a single person&apos;s notes).
        </p>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-400 italic mb-3">
            You don&apos;t have any projects yet. Create one below to group your files.
          </p>
        ) : (
          <div className="space-y-2 mb-3">
            {projects.map(p => (
              <div key={p.id}
                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 cursor-pointer"
                onClick={() => router.push(`/projects/${p.id}`)}>
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm text-gray-400 mr-2">
                    {" "}({p._count.files} files, {p._count.approvedTexts} lines)
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteProject(p.id, p.name); }}
                  className="text-red-400 hover:text-red-600 text-sm px-1" title="Delete project">
                  &#10005;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" placeholder="New project name..."
            value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createProject()}
            className="border rounded px-3 py-1 text-sm flex-1" />
          <button onClick={createProject}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
            Create Project
          </button>
        </div>
      </div>

      {/* Handwriting Profiles */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-semibold">Handwriting Profiles</h2>
          <span className="text-xs text-gray-400">{profiles.length} total</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A profile represents one writer&apos;s handwriting style. Corrections you make here train OCR to recognize that specific writer better over time.
        </p>
        {profiles.length === 0 && (
          <p className="text-sm text-gray-400 italic mb-3">
            You don&apos;t have any handwriting profiles yet. Create one below so corrections can be saved and used to improve OCR.
          </p>
        )}
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

        {/* Destination selectors */}
        <div className="flex flex-wrap gap-3 mb-3">
          {projects.length > 0 && (
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Add to project</label>
              <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
                className="border rounded px-2 py-1 text-sm w-full">
                <option value="">— Unassigned —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {profiles.length > 0 && (
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Handwriting profile</label>
              <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)}
                className="border rounded px-2 py-1 text-sm w-full">
                <option value="">— None —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {!selectedProfile && profiles.length > 0 && (
          <p className="text-amber-600 text-xs mb-2">
            Select a handwriting profile for better OCR results
          </p>
        )}

        <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept="image/*,application/pdf,.pdf"
            multiple
            onChange={uploadFile}
            className="hidden"
            disabled={uploading}
          />
          {uploading ? (
            <span className="text-gray-500">{uploadStatus || "Uploading..."}</span>
          ) : (
            <span className="text-gray-500">
              Click or drag files here — images (JPG, PNG) or PDF (multi-page supported)
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
                    {file.profile?.name || "No profile"}
                    {file.project && <> &middot; <span className="text-blue-500">{file.project.name}</span></>}
                    {" "}&middot; {new Date(file.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    file.status === "completed"
                      ? "bg-green-100 text-green-700"
                      : file.status === "ready"
                      ? "bg-blue-100 text-blue-700"
                      : file.status === "processing"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {file.status}
                </span>
                {(file.status === "ready" || file.status === "completed") && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const newStatus = file.status === "completed" ? "ready" : "completed";
                      await fetch(`/api/files/${file.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: newStatus }),
                      });
                      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: newStatus } : f));
                    }}
                    className={`px-2 py-1 rounded text-xs ${
                      file.status === "completed"
                        ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        : "bg-green-100 text-green-700 hover:bg-green-200"
                    }`}
                    title={file.status === "completed" ? "Mark as not complete" : "Mark as complete"}
                  >
                    {file.status === "completed" ? "Undo" : "Complete"}
                  </button>
                )}
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

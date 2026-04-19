"use client";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

interface FileRecord {
  id: string;
  filename: string;
  status: string;
  textApproved: boolean;
  createdAt: string;
  profile: { name: string } | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  files: FileRecord[];
  _count: { approvedTexts: number };
}

interface MasterText {
  projectName: string;
  fullText: string;
  totalLines: number;
  files: { filename: string; fileId: string; lines: { lineIndex: number; text: string }[] }[];
}

export default function ProjectPage() {
  const { status } = useSession();
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [masterText, setMasterText] = useState<MasterText | null>(null);
  const [showText, setShowText] = useState(false);
  const [allFiles, setAllFiles] = useState<FileRecord[]>([]);
  const [showAddFiles, setShowAddFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) setProject(await res.json());
  }, [projectId]);

  const loadText = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/text`);
    if (res.ok) setMasterText(await res.json());
  }, [projectId]);

  const loadAllFiles = useCallback(async () => {
    const res = await fetch("/api/files");
    if (res.ok) setAllFiles(await res.json());
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") {
      loadProject();
      loadText();
    }
  }, [status, router, loadProject, loadText]);

  async function addFileToProject(fileId: string) {
    await fetch(`/api/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    loadProject();
  }

  async function removeFileFromProject(fileId: string) {
    await fetch(`/api/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: null }),
    });
    loadProject();
    loadText();
  }

  async function uploadToProject(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList?.length) return;
    setUploading(true);

    try {
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
        const form = new FormData();
        form.append("file", f);
        form.append("projectId", projectId);

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
      loadProject();
      e.target.value = "";
    }
  }

  async function approveFile(fileId: string) {
    await fetch(`/api/projects/${projectId}/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    loadProject();
    loadText();
  }

  async function saveEdit() {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    setEditing(false);
    loadProject();
  }

  if (status === "loading" || !project) return <div className="p-8">Loading...</div>;

  const projectFileIds = new Set(project.files.map(f => f.id));
  const availableFiles = allFiles.filter(f => !projectFileIds.has(f.id));

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/dashboard")} className="text-gray-400 hover:text-gray-600">&larr;</button>
        {editing ? (
          <div className="flex-1 flex gap-2">
            <input value={editName} onChange={e => setEditName(e.target.value)}
              className="border rounded px-3 py-1 text-lg font-bold flex-1" />
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
              placeholder="Description..." className="border rounded px-3 py-1 text-sm flex-1" />
            <button onClick={saveEdit} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">Save</button>
            <button onClick={() => setEditing(false)} className="text-gray-500 text-sm">Cancel</button>
          </div>
        ) : (
          <div className="flex-1">
            <h1 className="text-2xl font-bold cursor-pointer hover:text-blue-600"
              onClick={() => { setEditing(true); setEditName(project.name); setEditDesc(project.description || ""); }}>
              {project.name}
            </h1>
            {project.description && <p className="text-sm text-gray-500">{project.description}</p>}
          </div>
        )}
        <div className="flex gap-2 text-sm text-gray-500">
          <span>{project.files.length} files</span>
          <span>{project._count.approvedTexts} approved lines</span>
        </div>
      </div>

      {/* Image Gallery */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Files</h2>
          <div className="flex gap-2">
            <label className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm cursor-pointer hover:bg-blue-700">
              Upload
              <input type="file" accept="image/*,application/pdf,.pdf" multiple onChange={uploadToProject} className="hidden" disabled={uploading} />
            </label>
            <button onClick={() => { setShowAddFiles(!showAddFiles); if (!showAddFiles) loadAllFiles(); }}
              className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300">
              {showAddFiles ? "Cancel" : "Add Existing"}
            </button>
          </div>
        </div>

        {uploading && <p className="text-sm text-gray-500 mb-2">{uploadStatus || "Uploading..."}</p>}

        {/* Add existing files picker */}
        {showAddFiles && (
          <div className="border rounded p-3 mb-3 max-h-48 overflow-auto">
            {availableFiles.length === 0 ? (
              <p className="text-sm text-gray-400">No unassigned files available</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {availableFiles.map(f => (
                  <div key={f.id} onClick={() => addFileToProject(f.id)}
                    className="border rounded p-2 cursor-pointer hover:bg-blue-50 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${f.id}/image`} alt={f.filename}
                      className="w-full h-16 object-cover rounded mb-1" />
                    <p className="text-xs truncate">{f.filename}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* File grid */}
        {project.files.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No files yet. Upload or add existing files.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {project.files.map(file => (
              <div key={file.id} className="border rounded overflow-hidden group relative">
                <div className="cursor-pointer" onClick={() => router.push(`/editor/${file.id}`)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${file.id}/image`} alt={file.filename}
                    className="w-full h-32 object-cover" />
                </div>
                <div className="p-2">
                  <p className="text-xs truncate font-medium">{file.filename}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      file.status === "completed" ? "bg-green-100 text-green-700" :
                      file.status === "ready" ? "bg-blue-100 text-blue-700" :
                      file.status === "processing" ? "bg-yellow-100 text-yellow-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{file.status}</span>
                    {file.textApproved && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">approved</span>
                    )}
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {(file.status === "completed" || file.status === "ready") && (
                      <button onClick={() => approveFile(file.id)}
                        className={`text-xs px-2 py-1 rounded ${
                          file.textApproved
                            ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                            : "bg-green-600 text-white hover:bg-green-700"
                        }`}>
                        {file.textApproved ? "Re-approve" : "Approve Text"}
                      </button>
                    )}
                    <button onClick={() => removeFileFromProject(file.id)}
                      className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50">Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Master Text */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Master Text</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowText(!showText)}
              className="text-sm text-blue-600 hover:underline">
              {showText ? "Hide" : "Show"} Text
            </button>
            {masterText && masterText.totalLines > 0 && (
              <>
                <a href={`/api/projects/${projectId}/export?format=txt`}
                  className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300">
                  Export .txt
                </a>
                <a href={`/api/projects/${projectId}/export?format=json`}
                  className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300">
                  Export .json
                </a>
              </>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-2">
          {masterText?.totalLines || 0} lines from {masterText?.files?.length || 0} files
        </p>

        {showText && masterText && (
          <div className="border rounded p-4 max-h-[60vh] overflow-auto bg-gray-50" dir="rtl">
            {masterText.files.length === 0 ? (
              <p className="text-gray-400 text-center">No approved text yet. Process and approve files to build the master text.</p>
            ) : (
              masterText.files.map((f, i) => (
                <div key={f.fileId} className={i > 0 ? "mt-4 pt-4 border-t" : ""}>
                  <p className="text-xs text-gray-400 mb-1 text-left" dir="ltr">
                    Source: {f.filename}
                  </p>
                  <div className="whitespace-pre-wrap leading-relaxed text-sm">
                    {f.lines.map(l => l.text).join("\n")}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

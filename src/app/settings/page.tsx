"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";
import TypedConfirmButton from "@/components/TypedConfirmButton";

interface Project {
  id: string;
  name: string;
  _count: { files: number; approvedTexts: number };
}
interface Profile {
  id: string;
  name: string;
  _count: { files: number; corrections: number };
}

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    const [pr, pf] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/profiles"),
    ]);
    setProjects(await pr.json());
    setProfiles(await pf.json());
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") load();
  }, [status, router, load]);

  async function deleteProject(id: string) {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Delete failed"); return; }
    load();
  }
  async function deleteProfile(id: string) {
    const res = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Delete failed"); return; }
    load();
  }

  if (status === "loading") return <div className="p-8">Loading...</div>;

  return (
    <>
      <TopNav />
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-3">Account</h2>
          <dl className="text-sm grid grid-cols-[120px_1fr] gap-y-1">
            <dt className="text-gray-500">Email</dt>
            <dd>{session?.user?.email}</dd>
            <dt className="text-gray-500">User ID</dt>
            <dd className="font-mono text-xs text-gray-600">{(session?.user as { id?: string } | undefined)?.id || "—"}</dd>
          </dl>
        </section>

        <section className="bg-white rounded-lg shadow p-5 border border-red-100">
          <h2 className="font-semibold mb-1 text-red-700">Danger zone — Projects</h2>
          <p className="text-xs text-gray-500 mb-4">
            Delete projects you no longer need. Deleting a project does NOT delete the underlying files — they become unassigned and can be added to another project.
          </p>
          {projects.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No projects to manage.</p>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p._count.files} files · {p._count.approvedTexts} approved lines</div>
                  </div>
                  <TypedConfirmButton
                    buttonLabel="Delete project"
                    confirmWord={p.name}
                    warningTitle={`Delete project "${p.name}"?`}
                    warningBody={
                      <>
                        <p>This removes the project record. The {p._count.files} file(s) inside it will not be deleted — they become unassigned.</p>
                        <p>{p._count.approvedTexts} approved text line(s) will be lost.</p>
                      </>
                    }
                    onConfirm={() => deleteProject(p.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg shadow p-5 border border-red-100">
          <h2 className="font-semibold mb-1 text-red-700">Danger zone — Handwriting profiles</h2>
          <p className="text-xs text-gray-500 mb-4">
            Deleting a profile permanently removes all learned corrections and training examples associated with it. This cannot be undone.
          </p>
          {profiles.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No profiles to manage.</p>
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p._count.files} files · {p._count.corrections} corrections</div>
                  </div>
                  <TypedConfirmButton
                    buttonLabel="Delete profile"
                    confirmWord={p.name}
                    warningTitle={`Delete profile "${p.name}"?`}
                    warningBody={
                      <>
                        <p><strong>All {p._count.corrections} learned corrections and the associated training examples will be permanently deleted.</strong></p>
                        <p>This is the main signal used to train the model for this writer&apos;s handwriting.</p>
                        <p>Files linked to this profile will lose their profile assignment but will not be deleted.</p>
                      </>
                    }
                    onConfirm={() => deleteProfile(p.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

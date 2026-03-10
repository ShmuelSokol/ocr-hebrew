"use client";
import { useState, useEffect, useCallback } from "react";

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastAction: string | null;
  fileCount: number;
  profileCount: number;
  trainingExamples: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return "Just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async (pw: string) => {
    setLoading(true);
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) {
      setError("Invalid password");
      setAuthed(false);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users);
    setAuthed(true);
    setError("");
    setLoading(false);
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(() => loadUsers(password), 30000);
    return () => clearInterval(interval);
  }, [authed, password, loadUsers]);

  function handleLogin() {
    if (!password.trim()) return;
    loadUsers(password);
  }

  if (!authed) {
    return (
      <div className="max-w-sm mx-auto mt-24 p-6">
        <h1 className="text-2xl font-bold mb-4">Admin</h1>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="Password"
          className="border rounded px-3 py-2 w-full mb-3"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <button
          onClick={handleLogin}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded w-full hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Login"}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex gap-2 text-sm text-gray-500">
          <span>{users.length} users</span>
          <button onClick={() => loadUsers(password)} className="text-blue-600 hover:underline">Refresh</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Last Seen</th>
              <th className="text-left px-4 py-3 font-medium">Last Action</th>
              <th className="text-center px-4 py-3 font-medium">Files</th>
              <th className="text-center px-4 py-3 font-medium">Profiles</th>
              <th className="text-center px-4 py-3 font-medium">Training</th>
              <th className="text-left px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const seenMs = u.lastSeenAt ? Date.now() - new Date(u.lastSeenAt).getTime() : Infinity;
              const isOnline = seenMs < 5 * 60 * 1000; // within 5 min
              return (
                <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-500" : "bg-gray-300"}`} />
                      <div>
                        <div className="font-medium">{u.name || u.email}</div>
                        {u.name && <div className="text-xs text-gray-400">{u.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={isOnline ? "text-green-600 font-medium" : "text-gray-500"}>
                      {timeAgo(u.lastSeenAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                    {u.lastAction || "—"}
                  </td>
                  <td className="px-4 py-3 text-center">{u.fileCount}</td>
                  <td className="px-4 py-3 text-center">{u.profileCount}</td>
                  <td className="px-4 py-3 text-center">{u.trainingExamples}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

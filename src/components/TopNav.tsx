"use client";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/training", label: "Training" },
  { href: "/dictionary", label: "Dictionary" },
  { href: "/settings", label: "Settings" },
];

interface Credits {
  letters: number;
  approxPages: number;
  low: boolean;
}

export default function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [credits, setCredits] = useState<Credits | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) return;
    fetch("/api/credits")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setCredits(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session, pathname]);

  return (
    <nav className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center gap-1">
        <Link href="/dashboard" className="font-bold text-lg mr-4 hover:text-blue-600">
          ksavyad
        </Link>
        <div className="flex gap-1 flex-1">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname?.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-1.5 rounded text-sm transition ${
                  active
                    ? "bg-blue-100 text-blue-700 font-medium"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          {credits && (
            <span
              className={`text-xs px-2 py-1 rounded font-medium whitespace-nowrap ${
                credits.low
                  ? "bg-amber-100 text-amber-800"
                  : "bg-green-50 text-green-700"
              }`}
              title={`${credits.letters.toLocaleString()} letters remaining (~${credits.approxPages} pages)`}
            >
              {credits.letters.toLocaleString()} letters
              <span className="text-gray-500 font-normal"> · ~{credits.approxPages}p</span>
              {credits.low && <Link href="/settings/billing" className="ml-2 underline hover:no-underline">Top up</Link>}
            </span>
          )}
          <span className="text-xs text-gray-400 hidden sm:inline">{session?.user?.email}</span>
          <button
            onClick={() => signOut()}
            className="text-xs text-gray-500 hover:text-red-500"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}

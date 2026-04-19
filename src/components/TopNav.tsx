"use client";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/training", label: "Training" },
  { href: "/dictionary", label: "Dictionary" },
  { href: "/settings", label: "Settings" },
];

export default function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();

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

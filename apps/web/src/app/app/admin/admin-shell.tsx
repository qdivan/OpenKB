"use client";

import { ArrowLeft, Database, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

const adminNavItems = [
  {
    href: "/app/admin/users",
    icon: <Users className="h-4 w-4" />,
    label: "Users",
    description: "Accounts and tenant roles"
  },
  {
    href: "/app/admin/retrieval",
    icon: <Database className="h-4 w-4" />,
    label: "Retrieval",
    description: "Search and index controls"
  },
  {
    href: "/app/admin/permission-boundary",
    icon: <ShieldCheck className="h-4 w-4" />,
    label: "Permission Boundary",
    description: "Admin scope rules"
  }
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="icon-button" href="/app" title="Back to workspace">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Admin</p>
              <p className="truncate text-xs text-zinc-500">OpenKB control plane</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-md border border-zinc-200 bg-white p-2">
          <nav className="space-y-1">
            {adminNavItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  className={`flex items-start gap-3 rounded-md px-3 py-2 text-left transition ${
                    active
                      ? "bg-emerald-50 text-emerald-900"
                      : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  <span className={`mt-0.5 ${active ? "text-emerald-700" : "text-zinc-500"}`}>
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="block truncate text-xs text-zinc-500">{item.description}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0">{children}</section>
      </div>
    </main>
  );
}

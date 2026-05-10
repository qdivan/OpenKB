"use client";

import {
  ArrowLeft,
  BrainCircuit,
  ClipboardList,
  Database,
  Gauge,
  FileCog,
  Mail,
  KeyRound,
  ListChecks,
  PlugZap,
  ShieldCheck,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";
import { getMe, type AuthMe } from "@/lib/openkb-api";

const adminNavItems = [
  {
    href: "/app/admin/users",
    icon: <Users className="h-4 w-4" />,
    label: "Users",
    description: "Accounts and tenant roles"
  },
  {
    href: "/app/admin/auth-settings",
    icon: <ShieldCheck className="h-4 w-4" />,
    label: "Auth Settings",
    description: "Registration and login policy"
  },
  {
    href: "/app/admin/email",
    icon: <Mail className="h-4 w-4" />,
    label: "Email",
    description: "SMTP and outbox",
    systemOnly: true
  },
  {
    href: "/app/admin/retrieval",
    icon: <Database className="h-4 w-4" />,
    label: "Retrieval",
    description: "Search and index controls"
  },
  {
    href: "/app/admin/models",
    icon: <BrainCircuit className="h-4 w-4" />,
    label: "Models",
    description: "Embedding, rerank, and LLM",
    systemOnly: true
  },
  {
    href: "/app/admin/import-tools",
    icon: <FileCog className="h-4 w-4" />,
    label: "Import Tools",
    description: "Conversion routes and adapters",
    systemOnly: true
  },
  {
    href: "/app/admin/indexing",
    icon: <ListChecks className="h-4 w-4" />,
    label: "Indexing",
    description: "Milvus aliases and rebuild jobs"
  },
  {
    href: "/app/admin/dify",
    icon: <PlugZap className="h-4 w-4" />,
    label: "Dify",
    description: "External Knowledge keys"
  },
  {
    href: "/app/admin/mcp",
    icon: <KeyRound className="h-4 w-4" />,
    label: "MCP",
    description: "PAT and OAuth clients"
  },
  {
    href: "/app/admin/audit",
    icon: <ClipboardList className="h-4 w-4" />,
    label: "Audit Logs",
    description: "Security and admin events"
  },
  {
    href: "/app/admin/security",
    icon: <Gauge className="h-4 w-4" />,
    label: "Security Ops",
    description: "Health and secret rotation",
    systemOnly: true
  },
  {
    href: "/app/admin/permission-boundary",
    icon: <ShieldCheck className="h-4 w-4" />,
    label: "Permission Boundary",
    description: "Admin scope rules"
  }
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<AuthMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((next) => {
        if (!cancelled) setMe(next);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const prefetchAdminRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router]
  );

  const visibleNavItems = useMemo(
    () => adminNavItems.filter((item) => !item.systemOnly || me?.roles.includes("system_admin")),
    [me]
  );

  useEffect(() => {
    for (const item of visibleNavItems) {
      prefetchAdminRoute(item.href);
    }
  }, [prefetchAdminRoute, visibleNavItems]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="icon-button" href="/app" title={t("Back to workspace")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t("Admin")}</p>
              <p className="truncate text-xs text-zinc-500">{t("OpenKB control plane")}</p>
            </div>
          </div>
          <LanguageSwitcher compact />
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-md border border-zinc-200 bg-white p-2">
          <nav className="space-y-1">
            {visibleNavItems.map((item) => {
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
                  onFocus={() => prefetchAdminRoute(item.href)}
                  onMouseEnter={() => prefetchAdminRoute(item.href)}
                >
                  <span className={`mt-0.5 ${active ? "text-emerald-700" : "text-zinc-500"}`}>
                    {item.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(item.label)}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {t(item.description)}
                    </span>
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

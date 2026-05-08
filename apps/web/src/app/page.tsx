"use client";

import { OPENKB_PHASE } from "@openkb/shared";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";

export default function Home() {
  const { t } = useI18n();
  const services = [
    ["Web", t("Next.js knowledge base workbench")],
    ["API", t("NestJS Fastify content and search API")],
    ["MCP", t("User-bound Streamable HTTP server")],
    ["Dify", t("External Knowledge adapter")]
  ] as const;

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-teal-700">
              {OPENKB_PHASE}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal">OpenKB</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
              {t(
                "Markdown-first knowledge base foundation with Yuque-style permissions, Milkdown editing, Milvus indexing, MCP, and Dify integration boundaries."
              )}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                className="inline-flex h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
                href="/app"
              >
                {t("Enter workbench")}
              </Link>
              <Link
                className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800"
                href="/login"
              >
                {t("Log in")}
              </Link>
            </div>
          </div>
          <LanguageSwitcher />
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          {services.map(([name, description]) => (
            <article
              key={name}
              className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-medium">{name}</h2>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  {t("ready")}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">{description}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

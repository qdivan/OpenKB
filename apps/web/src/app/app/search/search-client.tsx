"use client";

import { AlertTriangle, ArrowLeft, BookOpen, FileText, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  getKnowledgeBase,
  getMe,
  isUnauthorized,
  searchKnowledge,
  type SearchResponse
} from "@/lib/openkb-api";

type SearchState = "idle" | "loading" | "done" | "error";

export function SearchPageClient() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scopedKnowledgeBaseId = searchParams.get("kb_id")?.trim() ?? "";
  const urlQuery = searchParams.get("q")?.trim() ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [knowledgeBaseTitle, setKnowledgeBaseTitle] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>(urlQuery ? "loading" : "idle");
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);

  const scopedIds = useMemo(
    () => (scopedKnowledgeBaseId ? [scopedKnowledgeBaseId] : undefined),
    [scopedKnowledgeBaseId]
  );

  const runSearch = useCallback(
    async (nextQuery: string) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setResponse(null);
        setState("idle");
        return;
      }

      setState("loading");
      setMessage("");
      try {
        const result = await searchKnowledge({
          query: trimmed,
          knowledge_base_ids: scopedIds,
          top_k: 10,
          filters: {}
        });
        setResponse(result);
        setState("done");
      } catch (error) {
        if (isUnauthorized(error)) {
          router.replace("/login");
          return;
        }
        setMessage(formatSearchError(error, t));
        setState("error");
      }
    },
    [router, scopedIds]
  );

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    let cancelled = false;
    void getMe().catch((error) => {
      if (!cancelled && isUnauthorized(error)) {
        router.replace("/login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!scopedKnowledgeBaseId) {
      setKnowledgeBaseTitle(null);
      return;
    }

    let cancelled = false;
    void getKnowledgeBase(scopedKnowledgeBaseId)
      .then((knowledgeBase) => {
        if (!cancelled) {
          setKnowledgeBaseTitle(knowledgeBase.title);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKnowledgeBaseTitle(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scopedKnowledgeBaseId]);

  useEffect(() => {
    void runSearch(urlQuery);
  }, [runSearch, urlQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    const next = new URLSearchParams();
    if (trimmed) {
      next.set("q", trimmed);
    }
    if (scopedKnowledgeBaseId) {
      next.set("kb_id", scopedKnowledgeBaseId);
    }
    const nextUrl = next.toString() ? `/app/search?${next}` : "/app/search";
    router.replace(nextUrl);
    if (trimmed === urlQuery) {
      void runSearch(trimmed);
    }
  }

  const scopedLabel = knowledgeBaseTitle
    ? t("Scoped to {name}", { name: knowledgeBaseTitle })
    : scopedKnowledgeBaseId
      ? t("Scoped to current knowledge base")
      : t("All readable knowledge bases");

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              className="icon-button"
              href={scopedKnowledgeBaseId ? `/app/kb/${scopedKnowledgeBaseId}` : "/app"}
              title={t("Back to workspace")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t("Search")}</p>
              <p className="truncate text-xs text-zinc-500">{scopedLabel}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher compact />
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white">
              OK
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-5">
        <form
          className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 shadow-sm sm:flex-row"
          onSubmit={handleSubmit}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 focus-within:border-emerald-500">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-zinc-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search OpenKB")}
              value={query}
            />
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            disabled={state === "loading"}
            type="submit"
          >
            {state === "loading" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {t("Search")}
          </button>
        </form>

        <div className="mt-5">
          {state === "loading" ? (
            <SearchStatus icon={<LoaderCircle className="h-4 w-4 animate-spin" />}>
              {t("Searching index")}
            </SearchStatus>
          ) : state === "error" ? (
            <SearchStatus icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}>
              {message}
            </SearchStatus>
          ) : response && response.results.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
                <span>{t("{count} results", { count: response.results.length })}</span>
                <span>top_k {response.top_k}</span>
              </div>
              {response.results.map((result) => (
                <Link
                  key={result.chunk_id}
                  className="block rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm transition hover:border-sky-200 hover:bg-sky-50/40"
                  href={`/app/kb/${result.knowledge_base_id}/docs/${result.document_id}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-950">
                          {result.title}
                        </h2>
                        <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">
                          {result.score.toFixed(3)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">
                        {result.content}
                      </p>
                      <div className="mt-2 flex min-w-0 items-center gap-1 text-xs text-zinc-500">
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{result.path.join(" / ")}</span>
                        {result.heading_path.length > 0 ? (
                          <span className="hidden truncate text-zinc-400 sm:inline">
                            / {result.heading_path.join(" / ")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5">
                          {result.context_mode ?? response.context_mode ?? "chunk"}
                        </span>
                        {result.parent_chunk?.chunk_id ? (
                          <span>
                            {t("matched child, returned parent {id}", {
                              id: result.parent_chunk.chunk_id
                            })}
                          </span>
                        ) : (
                          <span>
                            {t("matched chunk {id}", {
                              id: result.match_chunk?.chunk_id ?? result.chunk_id
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : response ? (
            <SearchStatus icon={<Search className="h-4 w-4 text-zinc-500" />}>
              {t("No readable results")}
            </SearchStatus>
          ) : (
            <SearchStatus icon={<Search className="h-4 w-4 text-zinc-500" />}>
              {t("Ready")}
            </SearchStatus>
          )}
        </div>
      </section>
    </main>
  );
}

function SearchStatus({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 shadow-sm">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function formatSearchError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiRequestError) {
    const code = error.body.error ? `${error.body.error}: ` : "";
    return `${code}${error.body.message ?? error.message}`;
  }
  return error instanceof Error ? error.message : t("Search failed.");
}

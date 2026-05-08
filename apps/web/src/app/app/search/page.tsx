"use client";

import { Suspense } from "react";

import { useI18n } from "@/lib/i18n-provider";

import { SearchPageClient } from "./search-client";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageClient />
    </Suspense>
  );
}

function SearchFallback() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-600">
      <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm">
        {t("Loading search")}
      </div>
    </main>
  );
}

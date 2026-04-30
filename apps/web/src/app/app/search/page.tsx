import { Suspense } from "react";

import { SearchPageClient } from "./search-client";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageClient />
    </Suspense>
  );
}

function SearchFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-600">
      <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm">
        Loading search
      </div>
    </main>
  );
}

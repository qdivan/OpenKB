export default function AdminLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="h-3 w-16 rounded bg-zinc-200" />
          <div className="mt-2 h-8 w-44 rounded bg-zinc-200" />
          <div className="mt-2 h-4 w-80 max-w-full rounded bg-zinc-100" />
        </div>
        <div className="h-9 w-9 rounded-md bg-zinc-100" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4">
          <div className="h-36 rounded-md border border-zinc-200 bg-white p-4">
            <div className="h-4 w-24 rounded bg-zinc-200" />
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <div className="h-16 rounded-md bg-zinc-100" />
              <div className="h-16 rounded-md bg-zinc-100" />
            </div>
          </div>
          <div className="h-64 rounded-md border border-zinc-200 bg-white p-4">
            <div className="h-4 w-28 rounded bg-zinc-200" />
            <div className="mt-4 space-y-2">
              <div className="h-10 rounded bg-zinc-100" />
              <div className="h-10 rounded bg-zinc-100" />
              <div className="h-10 rounded bg-zinc-100" />
            </div>
          </div>
        </section>
        <aside className="space-y-4">
          <div className="h-44 rounded-md border border-zinc-200 bg-white p-4">
            <div className="h-4 w-24 rounded bg-zinc-200" />
            <div className="mt-4 space-y-2">
              <div className="h-12 rounded bg-zinc-100" />
              <div className="h-12 rounded bg-zinc-100" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

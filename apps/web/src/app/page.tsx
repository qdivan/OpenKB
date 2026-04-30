const services = [
  ["Web", "Next.js knowledge base workbench"],
  ["API", "NestJS Fastify content and search API"],
  ["MCP", "User-bound Streamable HTTP server"],
  ["Dify", "External Knowledge adapter"]
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="border-b border-zinc-200 pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-teal-700">
            Phase 11 Deployment
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">OpenKB</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            Markdown-first knowledge base foundation with Yuque-style permissions, Milkdown editing,
            Milvus indexing, MCP, and Dify integration boundaries.
          </p>
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
                  ready
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

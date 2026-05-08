import { OPENKB_PHASE } from "@openkb/shared";
import Link from "next/link";

const services = [
  ["Web", "Next.js knowledge base workbench"],
  ["API", "NestJS Fastify content and search API"],
  ["MCP", "User-bound Streamable HTTP server"],
  ["Dify", "External Knowledge adapter"]
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="border-b border-zinc-200 pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
            {OPENKB_PHASE}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">OpenKB</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            Local development entry for the Markdown-first knowledge base workbench.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              href="/app"
            >
              进入工作台
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              href="/login"
            >
              登录
            </Link>
          </div>
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

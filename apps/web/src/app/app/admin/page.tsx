import { ArrowLeft, Database, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="icon-button" href="/app" title="Back to app">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Admin</p>
              <p className="truncate text-xs text-zinc-500">OpenKB control plane</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 py-5 md:grid-cols-2">
        <Link
          className="rounded-md border border-zinc-200 bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50"
          href="/app/admin/users"
        >
          <Users className="h-5 w-5 text-emerald-700" />
          <h1 className="mt-3 text-lg font-semibold">Users</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Create accounts, change tenant roles, revoke sessions, and review account audit logs.
          </p>
        </Link>

        <Link
          className="rounded-md border border-zinc-200 bg-white p-4 transition hover:border-sky-300 hover:bg-sky-50"
          href="/app/admin/retrieval"
        >
          <Database className="h-5 w-5 text-sky-700" />
          <h2 className="mt-3 text-lg font-semibold">Retrieval</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Configure retrieval mode, probe model endpoints, and queue index rebuilds.
          </p>
        </Link>

        <div className="rounded-md border border-zinc-200 bg-white p-4">
          <ShieldCheck className="h-5 w-5 text-zinc-700" />
          <h2 className="mt-3 text-lg font-semibold">Permission Boundary</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Admin roles manage configuration and accounts; private content still requires explicit
            content permission.
          </p>
        </div>
      </section>
    </main>
  );
}

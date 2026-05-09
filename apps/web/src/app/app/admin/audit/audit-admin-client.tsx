"use client";

import { ClipboardList, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  ApiRequestError,
  isUnauthorized,
  listAuditLogs,
  type AuditLogEntry
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function AuditAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filters, setFilters] = useState({
    action: "",
    object_type: "",
    object_id: "",
    actor_type: "",
    actor_user_id: "",
    date_from: "",
    date_to: ""
  });
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await listAuditLogs({
        ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim() !== "")),
        limit: 100
      });
      setLogs(response.items);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(error.body.message || t("Admin role is required."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Audit Logs")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Review security, account, integration, and operations events.")}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => void load()}
          title={t("Refresh")}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={submit}>
        <div className="grid gap-3 md:grid-cols-4">
          {(["action", "object_type", "object_id", "actor_type", "actor_user_id"] as const).map(
            (field) => (
              <label className="block text-sm" key={field}>
                <span className="mb-1 block font-medium text-zinc-700">{t(field)}</span>
                <input
                  className={inputClass}
                  onChange={(event) => setFilters({ ...filters, [field]: event.target.value })}
                  value={filters[field]}
                />
              </label>
            )
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700">{t("Date from")}</span>
            <input
              className={inputClass}
              onChange={(event) => setFilters({ ...filters, date_from: event.target.value })}
              type="datetime-local"
              value={filters.date_from}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700">{t("Date to")}</span>
            <input
              className={inputClass}
              onChange={(event) => setFilters({ ...filters, date_to: event.target.value })}
              type="datetime-local"
              value={filters.date_to}
            />
          </label>
          <button
            className="mt-6 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
            type="submit"
          >
            <Search className="h-4 w-4" />
            {t("Filter")}
          </button>
        </div>
      </form>

      <section className="rounded-md border border-zinc-200 bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <ClipboardList className="h-4 w-4 text-emerald-700" />
          <h2 className="text-sm font-semibold">{t("Events")}</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("Loading")}
          </div>
        ) : null}
        {!isLoading && logs.length === 0 ? (
          <div className="p-4 text-sm text-zinc-500">{t("No audit logs")}</div>
        ) : null}
        <div className="divide-y divide-zinc-100">
          {logs.map((log) => (
            <article className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[180px_1fr]" key={log.id}>
              <div className="text-xs text-zinc-500">
                {new Date(log.createdAt).toLocaleString()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{log.action}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                    {log.actorType}
                  </span>
                  {log.objectType ? (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                      {log.objectType}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {log.objectId ?? "-"} · {log.actorUserId ?? "-"}
                </p>
                <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-zinc-50 p-2 text-xs text-zinc-600">
                  {JSON.stringify(log.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </article>
          ))}
        </div>
      </section>
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
    </div>
  );
}

"use client";

import { Database, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  createMilvusRebuildJob,
  getMilvusAdminStatus,
  isUnauthorized,
  listMilvusIndexProfiles,
  listMilvusRebuildJobs,
  switchMilvusAlias,
  type IndexRebuildJob,
  type MilvusIndexProfile,
  type MilvusStatusResponse
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function IndexingAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<MilvusStatusResponse | null>(null);
  const [profiles, setProfiles] = useState<MilvusIndexProfile[]>([]);
  const [jobs, setJobs] = useState<IndexRebuildJob[]>([]);
  const [targetCollection, setTargetCollection] = useState("");
  const [targetAlias, setTargetAlias] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const [nextStatus, nextProfiles, nextJobs] = await Promise.all([
        getMilvusAdminStatus(),
        listMilvusIndexProfiles(),
        listMilvusRebuildJobs({ limit: 50 })
      ]);
      setStatus(nextStatus);
      setProfiles(nextProfiles);
      setJobs(nextJobs.items);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setMessage("");
    try {
      const job = await createMilvusRebuildJob({
        target_collection: targetCollection.trim() || undefined,
        target_alias: targetAlias.trim() || undefined
      });
      setMessage(t("Index rebuild job queued: {id}", { id: job.id }));
      setTargetCollection("");
      setTargetAlias("");
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setIsCreating(false);
    }
  }

  async function activateProfile(profile: MilvusIndexProfile) {
    setMessage("");
    try {
      await switchMilvusAlias({ alias: profile.alias, collection_name: profile.collection_name });
      setMessage(t("Alias switched."));
      await load();
    } catch (error) {
      handleError(error);
    }
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
          <h1 className="mt-1 text-2xl font-semibold">{t("Indexing")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Inspect Milvus health, active aliases, profiles, and rebuild jobs.")}
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

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-700" />
          <h2 className="text-sm font-semibold">{t("Milvus status")}</h2>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Metric label={t("Alias")} value={status?.active_alias ?? "-"} />
          <Metric
            label={t("Active profile")}
            value={status?.active_profile?.collection_name ?? "-"}
          />
          <Metric label={t("Health")} value={status ? JSON.stringify(status.health) : "-"} />
        </div>
      </section>

      <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={createJob}>
        <h2 className="text-sm font-semibold">{t("Create rebuild job")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            onChange={(event) => setTargetCollection(event.target.value)}
            placeholder={t("Target collection optional")}
            value={targetCollection}
          />
          <input
            className={inputClass}
            onChange={(event) => setTargetAlias(event.target.value)}
            placeholder={t("Target alias optional")}
            value={targetAlias}
          />
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            {t("Rebuild")}
          </button>
        </div>
      </form>

      <section className="grid gap-4 xl:grid-cols-2">
        <ListPanel title={t("Profiles")}>
          {profiles.map((profile) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={profile.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{profile.collection_name}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                  {profile.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {profile.alias} · dim {profile.vector_dim} · {profile.schema_version}
              </p>
              <button
                className="mt-2 inline-flex h-8 items-center rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-50"
                onClick={() => void activateProfile(profile)}
                type="button"
              >
                {t("Switch alias")}
              </button>
            </article>
          ))}
          {!profiles.length && !isLoading ? <Empty>{t("No profiles")}</Empty> : null}
        </ListPanel>

        <ListPanel title={t("Rebuild jobs")}>
          {jobs.map((job) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={job.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{job.target_collection}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{job.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {job.target_alias} · {new Date(job.started_at).toLocaleString()}
              </p>
              {job.error ? <p className="mt-1 text-xs text-red-600">{job.error}</p> : null}
            </article>
          ))}
          {!jobs.length && !isLoading ? <Empty>{t("No rebuild jobs")}</Empty> : null}
        </ListPanel>
      </section>

      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-200 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function ListPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-500">{children}</div>;
}

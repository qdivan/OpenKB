"use client";

import { CheckCircle2, Database, Info, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
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
            {t(
              "Inspect Milvus health, active aliases, embedding profiles, and blue-green rebuild jobs."
            )}
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

      <section className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <h2 className="font-semibold">{t("When to rebuild the Milvus index")}</h2>
            <p>
              {t(
                "Index rebuild creates a new Milvus collection from PostgreSQL chunks, writes BM25 and embedding fields, runs health checks, then switches the active alias. It is needed when the embedding model, vector dimension, schema, function configuration, or input modality changes. Publishing a document only makes its current chunks eligible for retrieval; it does not mutate the active collection inline."
              )}
            </p>
          </div>
        </div>
      </section>

      {status?.model ? (
        <section className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4 md:grid-cols-3">
          <ModelMetric
            label={t("Embedding profile")}
            value={status.model.embedding.model ?? "-"}
            meta={[
              `dim ${status.model.embedding.dim}`,
              formatModalities(status.model.embedding.capabilities),
              status.model.embedding.source.toUpperCase()
            ].join(" · ")}
          />
          <ModelMetric
            label={t("Rerank profile")}
            value={status.model.rerank.model ?? "-"}
            meta={[
              formatModalities(status.model.rerank.capabilities),
              status.model.rerank.source.toUpperCase()
            ].join(" · ")}
          />
          <ModelMetric
            icon={
              status.model.dense_profile_compatible ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : (
                <RotateCcw className="h-4 w-4 text-amber-700" />
              )
            }
            label={t("Profile compatibility")}
            value={status.model.dense_profile_compatible ? t("Ready") : t("Rebuild required")}
            meta={
              status.model.rebuild_required_reason
                ? t(formatRebuildReason(status.model.rebuild_required_reason))
                : t("Active profile matches the current embedding configuration.")
            }
          />
        </section>
      ) : null}

      <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={createJob}>
        <h2 className="text-sm font-semibold">{t("Create index rebuild job")}</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {t("Use this for embedding profile changes, not as a normal document refresh.")}
        </p>
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
            {t("Create index rebuild job")}
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
              <p className="mt-1 text-xs text-zinc-500">
                {formatProfileMetadata(profile.function_metadata)}
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

function ModelMetric({
  icon,
  label,
  value,
  meta
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-200 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="truncate text-sm font-semibold">{value}</div>
      <div className="truncate text-xs text-zinc-500">{meta}</div>
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

function formatModalities(capabilities: { input_modalities?: string[] } | null | undefined) {
  const modalities = capabilities?.input_modalities?.length
    ? capabilities.input_modalities
    : ["text"];
  return modalities.join("+");
}

function formatProfileMetadata(value: unknown): string {
  const metadata = toRecord(value);
  const embeddingModel =
    typeof metadata.embedding_model === "string" ? metadata.embedding_model : "-";
  const rerankModel = typeof metadata.rerank_model === "string" ? metadata.rerank_model : "-";
  const embeddingCapabilities = toRecord(metadata.embedding_capabilities);
  const maxTokens =
    typeof embeddingCapabilities.max_tokens === "number"
      ? ` · max ${embeddingCapabilities.max_tokens} tokens`
      : "";
  return `Embedding ${embeddingModel} · ${formatModalities(embeddingCapabilities)}${maxTokens} · Rerank ${rerankModel}`;
}

function formatRebuildReason(reason: string): string {
  if (reason === "embedding_dim_mismatch") return "Embedding dimension changed.";
  if (reason === "embedding_model_mismatch") return "Embedding model changed.";
  if (reason === "embedding_modality_mismatch") return "Embedding input modality changed.";
  if (reason === "dense_vector_missing") return "Active profile has no dense vector field.";
  if (reason === "embedding_function_mismatch") return "Embedding function configuration changed.";
  if (reason === "no_active_profile") return "No active dense index profile.";
  return "Index profile no longer matches current embedding configuration.";
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

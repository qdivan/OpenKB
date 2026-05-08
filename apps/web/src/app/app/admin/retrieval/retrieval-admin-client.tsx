"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  createMilvusRebuildJob,
  getRetrievalSettings,
  isUnauthorized,
  probeRetrievalModels,
  updateRetrievalSettings,
  type ModelProbeResult,
  type RetrievalMode,
  type RetrievalSettingsStatus
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const MODE_LABELS: Record<RetrievalMode, string> = {
  bm25: "BM25",
  dense: "Dense",
  dense_rerank: "Dense + Rerank",
  hybrid: "Hybrid",
  hybrid_rerank: "Hybrid + Rerank"
};

export function RetrievalAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [status, setStatus] = useState<RetrievalSettingsStatus | null>(null);
  const [selectedMode, setSelectedMode] = useState<RetrievalMode>("bm25");
  const [probe, setProbe] = useState<{
    embedding: ModelProbeResult;
    rerank: ModelProbeResult;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const modeByName = useMemo(
    () => new Map(status?.modes.map((mode) => [mode.mode, mode]) ?? []),
    [status]
  );

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setIsLoading(true);
    setMessage("");
    try {
      const next = await getRetrievalSettings();
      setStatus(next);
      setSelectedMode(next.mode);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setMessage("");
    try {
      const next = await updateRetrievalSettings({ mode: selectedMode });
      setStatus(next);
      setSelectedMode(next.mode);
      setMessage(t("Retrieval mode saved."));
    } catch (error) {
      handleError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleProbe() {
    setIsProbing(true);
    setMessage("");
    try {
      setProbe(await probeRetrievalModels());
    } catch (error) {
      handleError(error);
    } finally {
      setIsProbing(false);
    }
  }

  async function handleRebuild() {
    setIsRebuilding(true);
    setMessage("");
    try {
      const job = await createMilvusRebuildJob();
      setMessage(t("Index rebuild job queued: {id}", { id: job.id }));
      await loadStatus();
    } catch (error) {
      handleError(error);
    } finally {
      setIsRebuilding(false);
    }
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(t("Admin role is required."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Retrieval")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Configure retrieval mode, probe model endpoints, and queue index rebuilds.")}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => void loadStatus()}
          title={t("Refresh")}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-4">
          <Panel title={t("Mode")} icon={<Search className="h-4 w-4" />}>
            {isLoading && !status ? (
              <InlineStatus icon={<LoaderCircle className="h-4 w-4 animate-spin" />}>
                {t("Loading")}
              </InlineStatus>
            ) : null}
            {status ? (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  {status.supported_modes.map((mode) => {
                    const capability = modeByName.get(mode);
                    const disabled = !capability?.enabled;
                    return (
                      <button
                        key={mode}
                        className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                          selectedMode === mode
                            ? "border-emerald-600 bg-emerald-50 text-emerald-950"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300"
                        } disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400`}
                        disabled={disabled || isSaving}
                        onClick={() => setSelectedMode(mode)}
                        type="button"
                      >
                        <span className="block font-medium">{MODE_LABELS[mode]}</span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          {disabled
                            ? t(formatDisabledReason(capability?.disabled_reason))
                            : t("Ready")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                    disabled={isSaving || selectedMode === status.mode}
                    onClick={() => void handleSave()}
                    type="button"
                  >
                    {isSaving ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {t("Save")}
                  </button>
                  <StatusPill tone={status.effective_mode === status.mode ? "green" : "amber"}>
                    {t("effective: {mode}", { mode: MODE_LABELS[status.effective_mode] })}
                  </StatusPill>
                </div>
              </>
            ) : null}
          </Panel>

          <Panel title={t("Index")} icon={<Database className="h-4 w-4" />}>
            {status ? (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <Metric label={t("Alias")} value={status.active_alias} />
                  <Metric
                    label={t("Dense index")}
                    value={status.dense_index_ready ? t("Ready") : t("Not ready")}
                  />
                  <Metric
                    label={t("Vector dim")}
                    value={status.active_profile ? String(status.active_profile.vector_dim) : "-"}
                  />
                </div>
                <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                  <p className="truncate font-mono text-zinc-800">
                    {status.active_profile?.collection_name ?? t("No active collection")}
                  </p>
                  <p className="mt-1 truncate">
                    {t("next rebuild")}:{" "}
                    <span className="font-mono">{status.next_rebuild_collection}</span>
                  </p>
                </div>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 disabled:bg-zinc-100 disabled:text-zinc-400"
                  disabled={isRebuilding}
                  onClick={() => void handleRebuild()}
                  type="button"
                >
                  {isRebuilding ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t("Rebuild index")}
                </button>
              </div>
            ) : null}
          </Panel>
        </section>

        <aside className="space-y-4">
          <Panel title={t("Models")} icon={<Settings2 className="h-4 w-4" />}>
            {status ? (
              <div className="space-y-2">
                <ModelRow
                  label="Embedding"
                  configured={status.embedding.configured}
                  model={status.embedding.model}
                  detail={`${status.embedding.dim} dim`}
                />
                <ModelRow
                  label="Rerank"
                  configured={status.rerank.configured}
                  model={status.rerank.model}
                />
                <button
                  className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 disabled:bg-zinc-100"
                  disabled={isProbing}
                  onClick={() => void handleProbe()}
                  type="button"
                >
                  {isProbing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4" />
                  )}
                  {t("Probe")}
                </button>
              </div>
            ) : null}
          </Panel>

          {probe ? (
            <Panel title={t("Probe")} icon={<Activity className="h-4 w-4" />}>
              <div className="space-y-2">
                <ProbeRow label="Embedding" result={probe.embedding} />
                <ProbeRow label="Rerank" result={probe.rerank} />
              </div>
            </Panel>
          ) : null}

          {message ? (
            <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              {message}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function ModelRow({
  label,
  configured,
  model,
  detail
}: {
  label: string;
  configured: boolean;
  model: string | null;
  detail?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-zinc-500">{configured ? model : t("Not configured")}</p>
      </div>
      <StatusPill tone={configured ? "green" : "zinc"}>
        {detail ?? (configured ? t("on") : t("off"))}
      </StatusPill>
    </div>
  );
}

function ProbeRow({ label, result }: { label: string; result: ModelProbeResult }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <StatusPill tone={result.ok ? "green" : "amber"}>
          {result.ok ? t("ok") : t("check")}
        </StatusPill>
      </div>
      <p className="mt-1 truncate text-xs text-zinc-500">
        {result.ok
          ? `${result.latency_ms ?? 0}ms${result.dim ? `, ${result.dim} dim` : ""}`
          : result.error}
      </p>
    </div>
  );
}

function InlineStatus({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-zinc-600">
      {icon}
      {children}
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "green" | "amber" | "zinc"; children: ReactNode }) {
  const classes = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    zinc: "bg-zinc-100 text-zinc-600"
  };
  const icon =
    tone === "green" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : tone === "amber" ? (
      <AlertTriangle className="h-3.5 w-3.5" />
    ) : (
      <ShieldCheck className="h-3.5 w-3.5" />
    );

  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium ${classes[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

function formatDisabledReason(value: string | null | undefined): string {
  if (value === "embedding_not_configured") {
    return "Embedding not configured";
  }
  if (value === "index_rebuild_required") {
    return "Rebuild required";
  }
  if (value === "rerank_not_configured") {
    return "Rerank not configured";
  }
  return "Unavailable";
}

"use client";

import {
  BrainCircuit,
  CheckCircle2,
  EyeOff,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  TriangleAlert
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  clearAdminModelSecret,
  isUnauthorized,
  listAdminModelSettings,
  probeAdminModel,
  updateAdminModelSetting,
  type AdminModelProbeResult,
  type AdminModelSetting,
  type ModelKind,
  type ModelProvider,
  type UpdateAdminModelSettingInput
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const MODEL_COPY: Record<
  ModelKind,
  {
    title: string;
    description: string;
    formatLabel: string;
    formatDescription: string;
    endpointPlaceholder: string;
    modelPlaceholder: string;
  }
> = {
  embedding: {
    title: "Embedding",
    description: "Dense retrieval vectors. Changing model or dimension requires a rebuild.",
    formatLabel: "Embedding request format",
    formatDescription:
      "Choose OpenAI-compatible JSON or DashScope native multimodal embedding JSON.",
    endpointPlaceholder: "https://api.openai.com/v1/embeddings",
    modelPlaceholder: "text-embedding-3-large"
  },
  rerank: {
    title: "Rerank",
    description: "Optional final ranking pass after Milvus candidates are permission-checked.",
    formatLabel: "Rerank request format",
    formatDescription: "Choose OpenKB rerank JSON or DashScope native text-rerank JSON.",
    endpointPlaceholder: "https://provider.example/v1/rerank",
    modelPlaceholder: "rerank-model"
  },
  language: {
    title: "Language",
    description: "Instance-level LLM endpoint. OpenKB currently probes connectivity only.",
    formatLabel: "Request format",
    formatDescription: "Choose the wire format used by the language endpoint.",
    endpointPlaceholder: "https://api.openai.com/v1/responses",
    modelPlaceholder: "gpt-4.1-mini"
  }
};

const EMBEDDING_RERANK_PROVIDER_OPTIONS: Array<{
  value: ModelProvider;
  label: string;
  description: string;
}> = [
  {
    value: "openai_compatible",
    label: "OpenAI-compatible",
    description: "Embedding sends model plus input. Rerank sends model, query, and documents."
  },
  {
    value: "dashscope",
    label: "DashScope",
    description: "Uses Alibaba Cloud native qwen3-vl-embedding and qwen3-vl-rerank request formats."
  }
];

const LANGUAGE_PROVIDER_OPTIONS: Array<{
  value: ModelProvider;
  label: string;
  description: string;
}> = [
  {
    value: "openai_responses",
    label: "OpenAI Responses",
    description: "Sends model, input, store:false, max_output_tokens, and temperature."
  },
  {
    value: "openai_chat_completions",
    label: "OpenAI Chat Completions",
    description: "Sends model, messages, max_tokens, and temperature."
  },
  {
    value: "anthropic_messages",
    label: "Anthropic Messages",
    description: "Sends model, max_tokens, and messages with Anthropic API key headers."
  }
];

const MODEL_PROVIDER_DEFAULT_ENDPOINTS: Record<
  ModelKind,
  Partial<Record<ModelProvider, string>>
> = {
  embedding: {
    dashscope:
      "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding"
  },
  rerank: {
    dashscope: "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
  },
  language: {
    openai_responses: "https://api.openai.com/v1/responses",
    openai_chat_completions: "https://api.openai.com/v1/chat/completions",
    anthropic_messages: "https://api.anthropic.com/v1/messages"
  }
};

const MODEL_PROVIDER_DEFAULT_MODELS: Record<ModelKind, Partial<Record<ModelProvider, string>>> = {
  embedding: {
    dashscope: "qwen3-vl-embedding"
  },
  rerank: {
    dashscope: "qwen3-vl-rerank"
  },
  language: {}
};

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

type ModelFormState = {
  provider: ModelProvider;
  enabled: boolean;
  endpoint: string;
  model: string;
  timeout_ms: string;
  embedding_dim: string;
  embedding_batch_size: string;
  llm_temperature: string;
  llm_max_output_tokens: string;
  api_key: string;
};

export function ModelsAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [settings, setSettings] = useState<AdminModelSetting[]>([]);
  const [forms, setForms] = useState<Record<ModelKind, ModelFormState>>(
    () =>
      Object.fromEntries(
        (["embedding", "rerank", "language"] as ModelKind[]).map((kind) => [kind, emptyForm(kind)])
      ) as Record<ModelKind, ModelFormState>
  );
  const [probeResults, setProbeResults] = useState<
    Partial<Record<ModelKind, AdminModelProbeResult>>
  >({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<ModelKind | null>(null);

  const settingByKind = useMemo(
    () => new Map(settings.map((setting) => [setting.kind, setting])),
    [settings]
  );

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await listAdminModelSettings();
      setSettings(response.items);
      setForms(
        Object.fromEntries(
          response.items.map((setting) => [setting.kind, toForm(setting)])
        ) as Record<ModelKind, ModelFormState>
      );
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSetting(kind: ModelKind) {
    const validation = validateModelProbeForm(kind, forms[kind], t);
    if (validation) {
      setMessage(validation);
      setProbeResults((current) => ({
        ...current,
        [kind]: { configured: true, ok: false, error: validation }
      }));
      return;
    }

    setBusyKind(kind);
    setMessage("");
    try {
      const saved = await updateAdminModelSetting(kind, createModelSettingInput(kind, forms[kind]));
      updateSetting(saved);
      updateForm(kind, { api_key: "" });
      setMessage(t("{title} model saved.", { title: t(MODEL_COPY[kind].title) }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKind(null);
    }
  }

  async function probe(kind: ModelKind) {
    setBusyKind(kind);
    setMessage("");
    try {
      const validation = validateModelProbeForm(kind, forms[kind], t);
      if (validation) {
        setProbeResults((current) => ({
          ...current,
          [kind]: { configured: true, ok: false, error: validation }
        }));
        return;
      }

      const result = await probeAdminModel(kind, createModelSettingInput(kind, forms[kind]));
      setProbeResults((current) => ({ ...current, [kind]: result }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKind(null);
    }
  }

  async function clearSecret(kind: ModelKind) {
    setBusyKind(kind);
    setMessage("");
    try {
      const next = await clearAdminModelSecret(kind);
      updateSetting(next);
      setMessage(t("{title} secret cleared.", { title: t(MODEL_COPY[kind].title) }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKind(null);
    }
  }

  function updateForm(kind: ModelKind, patch: Partial<ModelFormState>) {
    setForms((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        ...patch
      }
    }));
  }

  function updateSetting(setting: AdminModelSetting) {
    setSettings((current) => current.map((item) => (item.kind === setting.kind ? setting : item)));
  }

  function handleProviderChange(kind: ModelKind, provider: ModelProvider) {
    const currentEndpoint = forms[kind].endpoint.trim();
    const currentModel = forms[kind].model.trim();
    const defaultEndpoints = Object.values(MODEL_PROVIDER_DEFAULT_ENDPOINTS[kind]).filter(Boolean);
    const defaultModels = Object.values(MODEL_PROVIDER_DEFAULT_MODELS[kind]).filter(Boolean);
    const nextEndpoint = MODEL_PROVIDER_DEFAULT_ENDPOINTS[kind][provider];
    const nextModel = MODEL_PROVIDER_DEFAULT_MODELS[kind][provider];
    updateForm(kind, {
      provider,
      ...(nextEndpoint && (!currentEndpoint || defaultEndpoints.includes(currentEndpoint))
        ? { endpoint: nextEndpoint }
        : {}),
      ...(nextModel && (!currentModel || defaultModels.includes(currentModel))
        ? { model: nextModel }
        : {})
    });
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(t("Only system admins can configure models."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Models")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            {t(
              "Configure instance-level model endpoints and encrypted API keys. Knowledge base owners cannot override these settings."
            )}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => void loadSettings()}
          title={t("Refresh")}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {message ? (
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          {message}
        </div>
      ) : null}

      <div className="space-y-4">
        {(["embedding", "rerank", "language"] as ModelKind[]).map((kind) => {
          const setting = settingByKind.get(kind);
          const form = forms[kind];
          const probeResult = probeResults[kind];
          return (
            <section
              className="grid min-w-0 gap-4 rounded-md border border-zinc-200 bg-white p-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
              key={kind}
            >
              <div className="flex items-start justify-between gap-3 lg:block">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-emerald-700" />
                    <h2 className="text-base font-semibold">{t(MODEL_COPY[kind].title)}</h2>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600">{t(MODEL_COPY[kind].description)}</p>
                  <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                    <p className="font-medium text-zinc-800">{t(MODEL_COPY[kind].formatLabel)}</p>
                    <p className="mt-1">{t(MODEL_COPY[kind].formatDescription)}</p>
                  </div>
                </div>
                <SourcePill source={setting?.source ?? "none"} />
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                  <input
                    checked={form.enabled}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                    onChange={(event) => updateForm(kind, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  {t("Enable database setting")}
                  <HelpTip text={t("Enable database setting help")} />
                </label>

                {kind === "language" ? (
                  <Field label={t("Request format")}>
                    <select
                      className={inputClass}
                      onChange={(event) =>
                        handleProviderChange(kind, event.target.value as ModelProvider)
                      }
                      value={form.provider}
                    >
                      {LANGUAGE_PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t(
                        LANGUAGE_PROVIDER_OPTIONS.find((option) => option.value === form.provider)
                          ?.description ?? MODEL_COPY.language.formatDescription
                      )}
                    </p>
                  </Field>
                ) : null}

                {kind === "embedding" || kind === "rerank" ? (
                  <Field label={t("Request format")}>
                    <select
                      className={inputClass}
                      onChange={(event) =>
                        handleProviderChange(kind, event.target.value as ModelProvider)
                      }
                      value={form.provider}
                    >
                      {EMBEDDING_RERANK_PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t(
                        EMBEDDING_RERANK_PROVIDER_OPTIONS.find(
                          (option) => option.value === form.provider
                        )?.description ?? MODEL_COPY[kind].formatDescription
                      )}
                    </p>
                  </Field>
                ) : null}

                <Field label={t("Endpoint")}>
                  <input
                    className={inputClass}
                    onChange={(event) => updateForm(kind, { endpoint: event.target.value })}
                    placeholder={getEndpointPlaceholder(kind, form.provider)}
                    value={form.endpoint}
                  />
                </Field>

                <Field label={t("Model")}>
                  <input
                    className={inputClass}
                    onChange={(event) => updateForm(kind, { model: event.target.value })}
                    placeholder={getModelPlaceholder(kind, form.provider)}
                    value={form.model}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("Timeout ms")}>
                    <input
                      className={inputClass}
                      inputMode="numeric"
                      onChange={(event) => updateForm(kind, { timeout_ms: event.target.value })}
                      value={form.timeout_ms}
                    />
                  </Field>

                  {kind === "embedding" ? (
                    <>
                      <Field label={t("Vector dim")}>
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          onChange={(event) =>
                            updateForm(kind, { embedding_dim: event.target.value })
                          }
                          value={form.embedding_dim}
                        />
                      </Field>
                      <Field label={t("Batch size")} help={t("Embedding batch size help")}>
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          onChange={(event) =>
                            updateForm(kind, { embedding_batch_size: event.target.value })
                          }
                          value={form.embedding_batch_size}
                        />
                      </Field>
                    </>
                  ) : null}

                  {kind === "language" ? (
                    <>
                      <Field label={t("Temperature")}>
                        <input
                          className={inputClass}
                          inputMode="decimal"
                          onChange={(event) =>
                            updateForm(kind, { llm_temperature: event.target.value })
                          }
                          value={form.llm_temperature}
                        />
                      </Field>
                      <Field label={t("Max output")}>
                        <input
                          className={inputClass}
                          inputMode="numeric"
                          onChange={(event) =>
                            updateForm(kind, { llm_max_output_tokens: event.target.value })
                          }
                          value={form.llm_max_output_tokens}
                        />
                      </Field>
                    </>
                  ) : null}
                </div>

                <Field label={t("API key")}>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      onChange={(event) => updateForm(kind, { api_key: event.target.value })}
                      placeholder={
                        setting?.has_secret
                          ? t("Configured secret placeholder", {
                              suffix: setting.api_key_last4 ? `...${setting.api_key_last4}` : ""
                            })
                          : t("Paste a new key")
                      }
                      type="password"
                      value={form.api_key}
                    />
                    <button
                      className="icon-button"
                      disabled={busyKind === kind || !setting?.has_secret}
                      onClick={() => void clearSecret(kind)}
                      title={t("Clear secret")}
                      type="button"
                    >
                      <EyeOff className="h-4 w-4" />
                    </button>
                  </div>
                </Field>

                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-zinc-500" />
                    <span>
                      {t("Secret")}: {setting?.has_secret ? setting.secret_source : t("not set")}
                      {setting?.api_key_last4 ? ` ...${setting.api_key_last4}` : ""}
                    </span>
                  </div>
                  {kind === "embedding" && setting?.index_rebuild_required ? (
                    <div className="mt-2 flex items-center gap-2 text-amber-700">
                      <TriangleAlert className="h-4 w-4" />
                      <span>{t("Index rebuild required after this embedding configuration.")}</span>
                    </div>
                  ) : null}
                </div>

                {probeResult ? <ProbeResult result={probeResult} /> : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                    disabled={busyKind === kind}
                    onClick={() => void saveSetting(kind)}
                    type="button"
                  >
                    {busyKind === kind ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {t("Save")}
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
                    disabled={busyKind === kind}
                    onClick={() => void probe(kind)}
                    type="button"
                  >
                    <FlaskConical className="h-4 w-4" />
                    {t("Probe")}
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-1 font-medium text-zinc-700">
        {label}
        {help ? <HelpTip text={help} /> : null}
      </span>
      {children}
    </label>
  );
}

function SourcePill({ source }: { source: AdminModelSetting["source"] }) {
  const { t } = useI18n();
  const tone =
    source === "db"
      ? "bg-emerald-50 text-emerald-700"
      : source === "env"
        ? "bg-sky-50 text-sky-700"
        : "bg-zinc-100 text-zinc-500";
  const label = source === "db" ? "DB" : source === "env" ? "ENV" : t("Not configured");
  const help =
    source === "db"
      ? t("Model source db help")
      : source === "env"
        ? t("Model source env help")
        : t("Model source none help");
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{label}</span>
      <HelpTip text={help} />
    </span>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group/help relative inline-flex">
      <button
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] font-semibold leading-none text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        type="button"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 w-64 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-normal leading-5 text-zinc-700 opacity-0 shadow-lg transition group-hover/help:opacity-100 group-focus-within/help:opacity-100">
        {text}
      </span>
    </span>
  );
}

function ProbeResult({ result }: { result: AdminModelProbeResult }) {
  const { t } = useI18n();
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
        <span>{result.ok ? t("Probe succeeded") : t("Probe failed")}</span>
      </div>
      <p className="mt-1 text-xs">
        {result.ok
          ? t("{model} responded in {latency}ms.", {
              model: result.model ?? "model",
              latency: result.latency_ms ?? 0
            })
          : (result.error ?? t("Model probe failed."))}
      </p>
      {result.capabilities ? (
        <p className="mt-2 text-xs">
          {[
            result.capabilities.dimensions ? `dim ${result.capabilities.dimensions}` : null,
            result.capabilities.max_tokens ? `max ${result.capabilities.max_tokens} tokens` : null,
            result.capabilities.input_modalities.length
              ? result.capabilities.input_modalities.join("+")
              : null,
            result.capabilities.languages.length ? result.capabilities.languages.join("/") : null
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {result.capability_warnings?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
          {result.capability_warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function emptyForm(kind: ModelKind): ModelFormState {
  return {
    provider: kind === "language" ? "openai_responses" : "openai_compatible",
    enabled: false,
    endpoint: kind === "language" ? "https://api.openai.com/v1/responses" : "",
    model: "",
    timeout_ms: kind === "rerank" ? "15000" : "30000",
    embedding_dim: "2048",
    embedding_batch_size: "16",
    llm_temperature: "0",
    llm_max_output_tokens: "64",
    api_key: ""
  };
}

function getEndpointPlaceholder(kind: ModelKind, provider: ModelProvider): string {
  return MODEL_PROVIDER_DEFAULT_ENDPOINTS[kind][provider] ?? MODEL_COPY[kind].endpointPlaceholder;
}

function getModelPlaceholder(kind: ModelKind, provider: ModelProvider): string {
  return MODEL_PROVIDER_DEFAULT_MODELS[kind][provider] ?? MODEL_COPY[kind].modelPlaceholder;
}

function toForm(setting: AdminModelSetting): ModelFormState {
  const provider =
    (setting.provider as string) === "openai" ? "openai_responses" : setting.provider;
  return {
    provider,
    enabled: setting.source === "db" ? setting.enabled : false,
    endpoint: setting.endpoint ?? "",
    model: setting.model ?? "",
    timeout_ms: String(setting.timeout_ms),
    embedding_dim: setting.embedding_dim ? String(setting.embedding_dim) : "2048",
    embedding_batch_size: setting.embedding_batch_size
      ? String(setting.embedding_batch_size)
      : "16",
    llm_temperature: setting.llm_temperature !== null ? String(setting.llm_temperature) : "0",
    llm_max_output_tokens:
      setting.llm_max_output_tokens !== null ? String(setting.llm_max_output_tokens) : "64",
    api_key: ""
  };
}

function createModelSettingInput(
  kind: ModelKind,
  form: ModelFormState
): UpdateAdminModelSettingInput {
  return {
    provider: form.provider,
    enabled: form.enabled,
    endpoint: nullableString(form.endpoint),
    model: nullableString(form.model),
    timeout_ms: parseOptionalInt(form.timeout_ms),
    embedding_dim: kind === "embedding" ? parseOptionalInt(form.embedding_dim) : null,
    embedding_batch_size: kind === "embedding" ? parseOptionalInt(form.embedding_batch_size) : null,
    llm_temperature: kind === "language" ? parseOptionalFloat(form.llm_temperature) : null,
    llm_max_output_tokens:
      kind === "language" ? parseOptionalInt(form.llm_max_output_tokens) : null,
    api_key: nullableString(form.api_key)
  };
}

function validateModelProbeForm(
  kind: ModelKind,
  form: ModelFormState,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
): string | null {
  if (!form.enabled) {
    return null;
  }

  const endpoint = form.endpoint.trim();
  const providerDefaultEndpoint = MODEL_PROVIDER_DEFAULT_ENDPOINTS[kind][form.provider];
  if (!endpoint && !providerDefaultEndpoint) {
    return t("Endpoint is required for database model checks.");
  }
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return t("Endpoint must start with http:// or https://.");
      }
    } catch {
      return t("Endpoint must be a valid URL.");
    }
  }

  if (!form.model.trim()) {
    return t("Model name is required for database model checks.");
  }

  const timeoutError = validateIntegerRange(form.timeout_ms, 1000, 600000, t("Timeout ms"), t);
  if (timeoutError) {
    return timeoutError;
  }

  if (kind === "embedding") {
    return (
      validateIntegerRange(form.embedding_dim, 1, 65536, t("Vector dim"), t) ??
      validateIntegerRange(form.embedding_batch_size, 1, 2048, t("Batch size"), t)
    );
  }

  if (kind === "language") {
    return (
      validateFloatRange(form.llm_temperature, 0, 2, t("Temperature"), t) ??
      validateIntegerRange(form.llm_max_output_tokens, 1, 200000, t("Max output"), t)
    );
  }

  return null;
}

function validateIntegerRange(
  value: string,
  min: number,
  max: number,
  label: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) {
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!normalized || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    return t("{label} must be an integer from {min} to {max}.", { label, min, max });
  }
  return null;
}

function validateFloatRange(
  value: string,
  min: number,
  max: number,
  label: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) {
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!normalized || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    return t("{label} must be a number from {min} to {max}.", { label, min, max });
  }
  return null;
}

function nullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function parseOptionalInt(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseOptionalFloat(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

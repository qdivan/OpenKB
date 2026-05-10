"use client";

import {
  CheckCircle2,
  EyeOff,
  FileCog,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  Save,
  TriangleAlert
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  clearAdminImportToolSecret,
  isUnauthorized,
  listAdminImportTools,
  probeAdminImportTool,
  updateAdminImportFormatRoute,
  updateAdminImportTool,
  type AdminImportFormatRoute,
  type AdminImportToolProbeResult,
  type AdminImportToolSetting,
  type ComplexImportFormat,
  type ImportToolKey,
  type ImportToolMode
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const TOOL_ORDER: ImportToolKey[] = ["markitdown", "mineru", "pandoc", "tesseract_ocr"];
const FORMAT_ORDER: ComplexImportFormat[] = ["pdf", "docx", "pptx", "xlsx", "image"];
const TOOL_SUPPORT: Record<ImportToolKey, ComplexImportFormat[]> = {
  markitdown: ["pdf", "docx", "pptx", "xlsx", "image"],
  mineru: ["pdf", "docx", "pptx", "xlsx", "image"],
  pandoc: ["docx", "pptx", "xlsx"],
  tesseract_ocr: ["image"]
};

const TOOL_COPY: Record<ImportToolKey, { title: string; description: string }> = {
  markitdown: {
    title: "MarkItDown",
    description: "Default local bridge for PDF, Office, workbook, and image conversion."
  },
  mineru: {
    title: "MinerU",
    description: "HTTP adapter for private or hosted MinerU conversion and OCR."
  },
  pandoc: {
    title: "Pandoc",
    description: "Local CLI fallback for Office documents, exporting GFM Markdown."
  },
  tesseract_ocr: {
    title: "Tesseract OCR",
    description: "Local OCR fallback for image files. Layout and table recovery are limited."
  }
};

type ToolForm = {
  enabled: boolean;
  mode: ImportToolMode;
  endpoint: string;
  command: string;
  timeout_ms: string;
  max_file_mb: string;
  api_key: string;
  options_text: string;
};

type RouteForm = {
  enabled: boolean;
  primary_tool: ImportToolKey;
  fallback_tools: ImportToolKey[];
};

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function ImportToolsAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [tools, setTools] = useState<AdminImportToolSetting[]>([]);
  const [toolForms, setToolForms] = useState<Record<ImportToolKey, ToolForm>>(
    () =>
      Object.fromEntries(TOOL_ORDER.map((tool) => [tool, emptyToolForm(tool)])) as Record<
        ImportToolKey,
        ToolForm
      >
  );
  const [routeForms, setRouteForms] = useState<Record<ComplexImportFormat, RouteForm>>(() =>
    createEmptyRouteForms()
  );
  const [probeResults, setProbeResults] = useState<
    Partial<Record<ImportToolKey, AdminImportToolProbeResult>>
  >({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toolByKey = useMemo(() => new Map(tools.map((tool) => [tool.tool_key, tool])), [tools]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await listAdminImportTools();
      setTools(response.tools);
      setToolForms(
        Object.fromEntries(
          response.tools.map((tool) => [tool.tool_key, toToolForm(tool)])
        ) as Record<ImportToolKey, ToolForm>
      );
      setRouteForms(
        Object.fromEntries(
          response.routes.map((route) => [route.format, toRouteForm(route)])
        ) as Record<ComplexImportFormat, RouteForm>
      );
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveTool(toolKey: ImportToolKey) {
    const form = toolForms[toolKey];
    const validation = validateToolForm(toolKey, form, t);
    if (validation) {
      setMessage(validation);
      return;
    }
    setBusyKey(`save:${toolKey}`);
    setMessage("");
    try {
      const saved = await updateAdminImportTool(toolKey, {
        enabled: form.enabled,
        mode: form.mode,
        endpoint: nullableString(form.endpoint),
        command: nullableString(form.command),
        timeout_ms: parseRequiredInt(form.timeout_ms),
        max_file_mb: parseRequiredInt(form.max_file_mb),
        api_key: nullableString(form.api_key),
        options: parseOptions(form.options_text)
      });
      updateTool(saved);
      updateToolForm(toolKey, { api_key: "" });
      setMessage(t("{tool} import tool saved.", { tool: TOOL_COPY[toolKey].title }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKey(null);
    }
  }

  async function probeTool(toolKey: ImportToolKey) {
    setBusyKey(`probe:${toolKey}`);
    setMessage("");
    try {
      const result = await probeAdminImportTool(toolKey);
      setProbeResults((current) => ({ ...current, [toolKey]: result }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKey(null);
    }
  }

  async function clearSecret(toolKey: ImportToolKey) {
    setBusyKey(`secret:${toolKey}`);
    setMessage("");
    try {
      const updated = await clearAdminImportToolSecret(toolKey);
      updateTool(updated);
      setMessage(t("{tool} secret cleared.", { tool: TOOL_COPY[toolKey].title }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKey(null);
    }
  }

  async function saveRoute(format: ComplexImportFormat) {
    const form = routeForms[format];
    const validation = validateRouteForm(format, form, toolByKey, t);
    if (validation) {
      setMessage(validation);
      return;
    }
    setBusyKey(`route:${format}`);
    setMessage("");
    try {
      const saved = await updateAdminImportFormatRoute(format, form);
      setMessage(t("{format} route saved.", { format: format.toUpperCase() }));
      updateRouteForm(format, toRouteForm(saved));
    } catch (error) {
      handleError(error);
    } finally {
      setBusyKey(null);
    }
  }

  function updateTool(tool: AdminImportToolSetting) {
    setTools((current) => current.map((item) => (item.tool_key === tool.tool_key ? tool : item)));
    updateToolForm(tool.tool_key, { api_key: "" });
  }

  function updateToolForm(toolKey: ImportToolKey, patch: Partial<ToolForm>) {
    setToolForms((current) => ({
      ...current,
      [toolKey]: { ...current[toolKey], ...patch }
    }));
  }

  function updateRouteForm(format: ComplexImportFormat, patch: Partial<RouteForm>) {
    setRouteForms((current) => ({
      ...current,
      [format]: { ...current[format], ...patch }
    }));
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(t("Only system admins can configure import tools."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("Import Tools")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            {t(
              "Configure instance-level conversion tools and route complex formats through MarkItDown, MinerU, Pandoc, or OCR."
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
      </div>

      {message ? (
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
          {message}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FileCog className="h-4 w-4 text-zinc-500" />
          <h2 className="text-base font-semibold">{t("Tools")}</h2>
        </div>
        <div className="space-y-4">
          {TOOL_ORDER.map((toolKey) => {
            const tool = toolByKey.get(toolKey);
            const form = toolForms[toolKey];
            const probe = probeResults[toolKey];
            return (
              <section
                className="grid gap-4 rounded-md border border-zinc-200 bg-white p-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
                key={toolKey}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold">{TOOL_COPY[toolKey].title}</h3>
                      <p className="mt-1 text-sm text-zinc-600">
                        {t(TOOL_COPY[toolKey].description)}
                      </p>
                    </div>
                    <SourcePill source={tool?.source ?? "none"} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TOOL_SUPPORT[toolKey].map((format) => (
                      <span
                        className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium uppercase text-zinc-600"
                        key={format}
                      >
                        {format}
                      </span>
                    ))}
                  </div>
                  {probe ? <ProbeResult result={probe} /> : null}
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                    <input
                      checked={form.enabled}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                      onChange={(event) =>
                        updateToolForm(toolKey, { enabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                    {t("Enable database setting")}
                  </label>

                  {tool?.modes.length && tool.modes.length > 1 ? (
                    <Field label={t("Mode")}>
                      <select
                        className={inputClass}
                        onChange={(event) =>
                          updateToolForm(toolKey, { mode: event.target.value as ImportToolMode })
                        }
                        value={form.mode}
                      >
                        {tool.modes.map((mode) => (
                          <option key={mode} value={mode}>
                            {t(mode)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}

                  {form.mode === "http_api" ? (
                    <Field label={t("Endpoint")}>
                      <input
                        className={inputClass}
                        onChange={(event) =>
                          updateToolForm(toolKey, { endpoint: event.target.value })
                        }
                        placeholder="https://mineru.example/api/convert"
                        value={form.endpoint}
                      />
                    </Field>
                  ) : (
                    <Field label={t("Command")}>
                      <input
                        className={inputClass}
                        onChange={(event) =>
                          updateToolForm(toolKey, { command: event.target.value })
                        }
                        placeholder={toolKey === "markitdown" ? "markitdown" : toolKey}
                        value={form.command}
                      />
                    </Field>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("Timeout ms")}>
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateToolForm(toolKey, { timeout_ms: event.target.value })
                        }
                        value={form.timeout_ms}
                      />
                    </Field>
                    <Field label={t("Max file MB")}>
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        onChange={(event) =>
                          updateToolForm(toolKey, { max_file_mb: event.target.value })
                        }
                        value={form.max_file_mb}
                      />
                    </Field>
                  </div>

                  {form.mode === "http_api" ? (
                    <Field label={t("API key")}>
                      <div className="flex gap-2">
                        <input
                          className={inputClass}
                          onChange={(event) =>
                            updateToolForm(toolKey, { api_key: event.target.value })
                          }
                          placeholder={
                            tool?.has_secret
                              ? t("Configured secret placeholder", {
                                  suffix: tool.api_key_last4 ? `...${tool.api_key_last4}` : ""
                                })
                              : t("Paste a new key")
                          }
                          type="password"
                          value={form.api_key}
                        />
                        <button
                          className="icon-button"
                          disabled={busyKey === `secret:${toolKey}` || !tool?.has_secret}
                          onClick={() => void clearSecret(toolKey)}
                          title={t("Clear secret")}
                          type="button"
                        >
                          <EyeOff className="h-4 w-4" />
                        </button>
                      </div>
                    </Field>
                  ) : null}

                  <Field label={t("Options JSON")}>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      onChange={(event) =>
                        updateToolForm(toolKey, { options_text: event.target.value })
                      }
                      value={form.options_text}
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                      disabled={Boolean(busyKey)}
                      onClick={() => void saveTool(toolKey)}
                      type="button"
                    >
                      {busyKey === `save:${toolKey}` ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {t("Save")}
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
                      disabled={Boolean(busyKey)}
                      onClick={() => void probeTool(toolKey)}
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
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t("Format routes")}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {t("Choose the primary converter and fallback order for each complex file format.")}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {FORMAT_ORDER.map((format) => {
            const form = routeForms[format];
            return (
              <div
                className="grid gap-3 rounded-md border border-zinc-200 p-3 lg:grid-cols-[120px_minmax(0,220px)_minmax(0,1fr)_auto]"
                key={format}
              >
                <label className="flex items-center gap-2 text-sm font-semibold uppercase text-zinc-800">
                  <input
                    checked={form.enabled}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                    onChange={(event) => updateRouteForm(format, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  {format}
                </label>
                <select
                  className={inputClass}
                  onChange={(event) =>
                    updateRouteForm(format, {
                      primary_tool: event.target.value as ImportToolKey,
                      fallback_tools: form.fallback_tools.filter(
                        (tool) => tool !== event.target.value
                      )
                    })
                  }
                  value={form.primary_tool}
                >
                  {toolsForFormat(format, toolByKey).map((tool) => (
                    <option key={tool} value={tool}>
                      {TOOL_COPY[tool].title}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  {toolsForFormat(format, toolByKey)
                    .filter((tool) => tool !== form.primary_tool)
                    .map((tool) => (
                      <label
                        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700"
                        key={tool}
                      >
                        <input
                          checked={form.fallback_tools.includes(tool)}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...form.fallback_tools, tool]
                              : form.fallback_tools.filter((item) => item !== tool);
                            updateRouteForm(format, { fallback_tools: next });
                          }}
                          type="checkbox"
                        />
                        {TOOL_COPY[tool].title}
                      </label>
                    ))}
                </div>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
                  disabled={Boolean(busyKey)}
                  onClick={() => void saveRoute(format)}
                  type="button"
                >
                  {busyKey === `route:${format}` ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("Save")}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function SourcePill({ source }: { source: AdminImportToolSetting["source"] }) {
  const { t } = useI18n();
  const tone =
    source === "db"
      ? "bg-emerald-50 text-emerald-700"
      : source === "env" || source === "default"
        ? "bg-sky-50 text-sky-700"
        : "bg-zinc-100 text-zinc-500";
  const label =
    source === "db"
      ? "DB"
      : source === "env"
        ? "ENV"
        : source === "default"
          ? t("Default")
          : t("Not configured");
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function ProbeResult({ result }: { result: AdminImportToolProbeResult }) {
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
          ? t("Tool responded in {latency}ms.", { latency: result.latency_ms ?? 0 })
          : (result.error ?? t("Import tool probe failed."))}
      </p>
    </div>
  );
}

function emptyToolForm(toolKey: ImportToolKey): ToolForm {
  return {
    enabled: false,
    mode: toolKey === "mineru" ? "http_api" : "local_cli",
    endpoint: "",
    command:
      toolKey === "markitdown" ? "markitdown" : toolKey === "pandoc" ? "pandoc" : "tesseract",
    timeout_ms: "120000",
    max_file_mb: "100",
    api_key: "",
    options_text: "{}"
  };
}

function createEmptyRouteForms(): Record<ComplexImportFormat, RouteForm> {
  return Object.fromEntries(
    FORMAT_ORDER.map((format) => [
      format,
      { enabled: true, primary_tool: "markitdown", fallback_tools: [] }
    ])
  ) as unknown as Record<ComplexImportFormat, RouteForm>;
}

function toToolForm(tool: AdminImportToolSetting): ToolForm {
  return {
    enabled: tool.source === "db" ? tool.enabled : false,
    mode: tool.mode,
    endpoint: tool.endpoint ?? "",
    command: tool.command ?? "",
    timeout_ms: String(tool.timeout_ms),
    max_file_mb: String(tool.max_file_mb),
    api_key: "",
    options_text: JSON.stringify(tool.options ?? {}, null, 2)
  };
}

function toRouteForm(route: AdminImportFormatRoute): RouteForm {
  return {
    enabled: route.enabled,
    primary_tool: route.primary_tool,
    fallback_tools: route.fallback_tools
  };
}

function toolsForFormat(
  format: ComplexImportFormat,
  toolByKey: Map<ImportToolKey, AdminImportToolSetting>
): ImportToolKey[] {
  return TOOL_ORDER.filter((tool) => {
    const setting = toolByKey.get(tool);
    return (
      TOOL_SUPPORT[tool].includes(format) &&
      setting?.enabled !== false &&
      setting?.configured !== false
    );
  });
}

function validateToolForm(
  toolKey: ImportToolKey,
  form: ToolForm,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
): string | null {
  if (form.enabled && form.mode === "http_api") {
    const endpoint = form.endpoint.trim();
    if (!endpoint) return t("Endpoint is required.");
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return t("Endpoint must start with http:// or https://.");
      }
    } catch {
      return t("Endpoint must be a valid URL.");
    }
  }
  if (form.enabled && form.mode === "local_cli" && !form.command.trim()) {
    return t("Command is required.");
  }
  return (
    validateIntegerRange(form.timeout_ms, 1000, 600000, t("Timeout ms"), t) ??
    validateIntegerRange(form.max_file_mb, 1, 2048, t("Max file MB"), t) ??
    validateOptions(form.options_text, t) ??
    (toolKey === "mineru" && form.mode !== "http_api" ? t("MinerU must use HTTP API mode.") : null)
  );
}

function validateRouteForm(
  format: ComplexImportFormat,
  form: RouteForm,
  toolByKey: Map<ImportToolKey, AdminImportToolSetting>,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
): string | null {
  if (!form.enabled) return null;
  const selected = [form.primary_tool, ...form.fallback_tools];
  if (selected.length !== new Set(selected).size) return t("Route tools must be unique.");
  const invalid = selected.find((tool) => !TOOL_SUPPORT[tool].includes(format));
  if (invalid) return t("{tool} does not support {format}.", { tool: invalid, format });
  const unavailable = selected.find((tool) => {
    const setting = toolByKey.get(tool);
    return !setting?.enabled || !setting.configured;
  });
  return unavailable
    ? t("{tool} is disabled or not configured.", { tool: TOOL_COPY[unavailable].title })
    : null;
}

function validateIntegerRange(
  value: string,
  min: number,
  max: number,
  label: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return t("{label} must be an integer from {min} to {max}.", { label, min, max });
  }
  return null;
}

function validateOptions(
  value: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string
) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? null
      : t("Options must be a JSON object.");
  } catch {
    return t("Options must be valid JSON.");
  }
}

function parseOptions(value: string): Record<string, unknown> {
  return JSON.parse(value || "{}") as Record<string, unknown>;
}

function parseRequiredInt(value: string): number {
  return Number.parseInt(value, 10);
}

function nullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

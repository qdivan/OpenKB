"use client";

import { Copy, KeyRound, LoaderCircle, RefreshCw, RotateCcw, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  createDifyApiKey,
  getDifyFilterableMetadata,
  getDifySetupSummary,
  isUnauthorized,
  listDifyApiKeys,
  listDifyMappings,
  revealDifyApiKey,
  revokeDifyApiKey,
  rotateDifyApiKey,
  upsertDifyMapping,
  type DifyApiKey,
  type DifyFilterableMetadataField,
  type DifyKnowledgeMapping,
  type DifySetupSummary
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function DifyAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [keys, setKeys] = useState<DifyApiKey[]>([]);
  const [mappings, setMappings] = useState<DifyKnowledgeMapping[]>([]);
  const [setup, setSetup] = useState<DifySetupSummary | null>(null);
  const [filterableFields, setFilterableFields] = useState<DifyFilterableMetadataField[]>([]);
  const [form, setForm] = useState({
    name: "",
    knowledge_id: "",
    knowledge_base_id: "",
    allowed_knowledge_base_ids: "",
    retrieval_top_k_limit: "20",
    expires_at: ""
  });
  const [mappingForm, setMappingForm] = useState({
    dify_knowledge_id: "",
    knowledge_base_id: "",
    status: "active"
  });
  const [revealedSecret, setRevealedSecret] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const [nextKeys, nextMappings] = await Promise.all([
        listDifyApiKeys({ limit: 100 }),
        listDifyMappings({ limit: 100 })
      ]);
      const [nextSetup, nextFilterable] = await Promise.all([
        getDifySetupSummary(),
        getDifyFilterableMetadata()
      ]);
      setKeys(nextKeys.items);
      setMappings(nextMappings.items);
      setSetup(nextSetup);
      setFilterableFields(nextFilterable.fields);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setMessage("");
    setRevealedSecret("");
    try {
      const result = await createDifyApiKey({
        name: form.name.trim(),
        knowledge_id: form.knowledge_id.trim(),
        knowledge_base_id: form.knowledge_base_id.trim(),
        allowed_knowledge_base_ids: parseCsv(
          form.allowed_knowledge_base_ids || form.knowledge_base_id
        ),
        retrieval_top_k_limit: Number.parseInt(form.retrieval_top_k_limit, 10) || 20,
        expires_at: form.expires_at || null
      });
      setRevealedSecret(result.api_key ?? "");
      setForm({
        name: "",
        knowledge_id: "",
        knowledge_base_id: "",
        allowed_knowledge_base_ids: "",
        retrieval_top_k_limit: "20",
        expires_at: ""
      });
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setIsCreating(false);
    }
  }

  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await upsertDifyMapping(mappingForm);
      setMappingForm({ dify_knowledge_id: "", knowledge_base_id: "", status: "active" });
      await load();
    } catch (error) {
      handleError(error);
    }
  }

  async function runKeyAction(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setMessage("");
    setRevealedSecret("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "api_key" in result) {
        setRevealedSecret(String(result.api_key ?? ""));
      }
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!revealedSecret) return;
    await navigator.clipboard.writeText(revealedSecret);
    setMessage(t("Secret copied."));
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage(t("Copied."));
  }

  function buildCurl(knowledgeId: string) {
    const endpoint = setup?.endpoint_base_url ?? "http://localhost:4200";
    return [
      `curl -X POST ${endpoint}/retrieval`,
      `  -H "Authorization: Bearer <DIFY_API_KEY>"`,
      `  -H "Content-Type: application/json"`,
      `  -d '{"knowledge_id":"${knowledgeId}","query":"赤壁之战","retrieval_setting":{"top_k":5,"score_threshold":0},"metadata_condition":null}'`
    ].join(" \\\n");
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
          <h1 className="mt-1 text-2xl font-semibold">{t("Dify")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Manage External Knowledge API keys and knowledge mappings.")}
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

      {revealedSecret ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">{t("Secret reveal")}</div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <code className="max-w-full overflow-auto rounded bg-white px-2 py-1 text-xs">
              {revealedSecret}
            </code>
            <button
              className="icon-button"
              onClick={() => void copySecret()}
              title={t("Copy")}
              type="button"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title={t("Dify configuration guide")}>
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-zinc-50 p-3">
              <div className="text-xs font-medium uppercase text-zinc-500">
                {t("API endpoint for Dify")}
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <code className="max-w-full overflow-auto rounded bg-white px-2 py-1 text-xs">
                  {setup?.endpoint_for_dify_ui ?? "http://localhost:4200"}
                </code>
                <button
                  className="icon-button"
                  onClick={() =>
                    void copyText(setup?.endpoint_for_dify_ui ?? "http://localhost:4200")
                  }
                  title={t("Copy")}
                  type="button"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {t("Dify stores the base URL and appends /retrieval automatically.")}
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {(setup?.mappings ?? []).slice(0, 4).map((mapping) => (
                <div className="rounded-md border border-zinc-200 p-3" key={mapping.id}>
                  <div className="text-xs text-zinc-500">{t("External Knowledge ID")}</div>
                  <div className="mt-1 font-mono text-xs">{mapping.dify_knowledge_id}</div>
                  <div className="mt-2 text-xs text-zinc-500">
                    {mapping.knowledge_base_title ?? mapping.knowledge_base_id}
                  </div>
                  <button
                    className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-50"
                    onClick={() => void copyText(buildCurl(mapping.dify_knowledge_id))}
                    type="button"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("Copy test curl")}
                  </button>
                </div>
              ))}
              {setup && setup.mappings.length === 0 ? (
                <Empty>{t("Create a mapping first to get an External Knowledge ID.")}</Empty>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel title={t("Filterable metadata")}>
          <p className="text-xs text-zinc-500">
            {t(
              "These fields can be used in Dify metadata_condition. Document metadata is preferred; openkb_* fields are diagnostics."
            )}
          </p>
          <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
            {filterableFields.map((field) => (
              <div
                className="rounded-md border border-zinc-200 p-2 text-xs"
                key={`${field.source}:${field.name}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{field.name}</strong>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5">{field.type}</span>
                </div>
                <div className="mt-1 text-zinc-500">{field.source}</div>
                <div className="mt-1 text-zinc-500">{field.description}</div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={createKey}>
          <h2 className="text-sm font-semibold">{t("Create Dify API key")}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput
              label={t("Name")}
              onChange={(value) => setForm({ ...form, name: value })}
              value={form.name}
            />
            <TextInput
              label={t("Dify knowledge id")}
              onChange={(value) => setForm({ ...form, knowledge_id: value })}
              value={form.knowledge_id}
            />
            <TextInput
              label={t("Knowledge base id")}
              onChange={(value) => setForm({ ...form, knowledge_base_id: value })}
              value={form.knowledge_base_id}
            />
            <TextInput
              label={t("Allowed KB ids")}
              onChange={(value) => setForm({ ...form, allowed_knowledge_base_ids: value })}
              value={form.allowed_knowledge_base_ids}
            />
            <TextInput
              label={t("Top K limit")}
              onChange={(value) => setForm({ ...form, retrieval_top_k_limit: value })}
              value={form.retrieval_top_k_limit}
            />
            <TextInput
              label={t("Expires at")}
              onChange={(value) => setForm({ ...form, expires_at: value })}
              type="datetime-local"
              value={form.expires_at}
            />
          </div>
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("Create key")}
          </button>
        </form>

        <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={saveMapping}>
          <h2 className="text-sm font-semibold">{t("Knowledge mapping")}</h2>
          <div className="mt-3 space-y-3">
            <TextInput
              label={t("Dify knowledge id")}
              onChange={(value) => setMappingForm({ ...mappingForm, dify_knowledge_id: value })}
              value={mappingForm.dify_knowledge_id}
            />
            <TextInput
              label={t("Knowledge base id")}
              onChange={(value) => setMappingForm({ ...mappingForm, knowledge_base_id: value })}
              value={mappingForm.knowledge_base_id}
            />
            <select
              className={inputClass}
              onChange={(event) => setMappingForm({ ...mappingForm, status: event.target.value })}
              value={mappingForm.status}
            >
              <option value="active">{t("Active")}</option>
              <option value="disabled">{t("Disabled")}</option>
            </select>
            <button
              className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
              type="submit"
            >
              {t("Save mapping")}
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title={t("API keys")}>
          {keys.map((key) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={key.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{key.name}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{key.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                last4 {key.api_key_last4 ?? "----"} · top_k {key.retrieval_top_k_limit}
              </p>
              <p className="mt-1 truncate text-xs text-zinc-500">
                {key.allowed_knowledge_base_ids.join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <SmallButton
                  disabled={!key.can_reveal || busyId === key.id}
                  onClick={() => runKeyAction(key.id, () => revealDifyApiKey(key.id))}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {t("Reveal")}
                </SmallButton>
                <SmallButton
                  disabled={busyId === key.id}
                  onClick={() => runKeyAction(key.id, () => rotateDifyApiKey(key.id))}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("Rotate")}
                </SmallButton>
                <SmallButton
                  disabled={busyId === key.id}
                  onClick={() => runKeyAction(key.id, () => revokeDifyApiKey(key.id))}
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  {t("Revoke")}
                </SmallButton>
              </div>
            </article>
          ))}
          {!keys.length && !isLoading ? <Empty>{t("No Dify API keys")}</Empty> : null}
        </Panel>

        <Panel title={t("Mappings")}>
          {mappings.map((mapping) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={mapping.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{mapping.dify_knowledge_id}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                  {mapping.status}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-zinc-500">{mapping.knowledge_base_id}</p>
            </article>
          ))}
          {!mappings.length && !isLoading ? <Empty>{t("No mappings")}</Empty> : null}
        </Panel>
      </section>
      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}

function TextInput({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SmallButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-500">{children}</div>;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

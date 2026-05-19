"use client";

import {
  CircleHelp,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldOff
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  createDifyApiKey,
  getDifyFilterableMetadata,
  getDifySetupSummary,
  isUnauthorized,
  listKnowledgeBases,
  listDifyApiKeys,
  listDifyMappings,
  revealDifyApiKey,
  revokeDifyApiKey,
  rotateDifyApiKey,
  upsertDifyMapping,
  type DifyApiKey,
  type DifyFilterableMetadataField,
  type DifyKnowledgeMapping,
  type DifySetupSummary,
  type KnowledgeBase
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
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [form, setForm] = useState({
    name: "",
    knowledge_id: "",
    knowledge_base_id: "",
    allowed_knowledge_base_ids: [] as string[],
    retrieval_top_k_limit: "20",
    expires_at: ""
  });
  const [knowledgeIdTouched, setKnowledgeIdTouched] = useState(false);
  const [mappingForm, setMappingForm] = useState({
    dify_knowledge_id: "",
    knowledge_base_id: "",
    status: "active"
  });
  const [mappingKnowledgeIdTouched, setMappingKnowledgeIdTouched] = useState(false);
  const [secretDialog, setSecretDialog] = useState<{
    keyName?: string;
    secret: string;
    title: string;
  } | null>(null);
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
      const [nextKeys, nextMappings, nextKnowledgeBases] = await Promise.all([
        listDifyApiKeys({ limit: 100 }),
        listDifyMappings({ limit: 100 }),
        listKnowledgeBases()
      ]);
      const [nextSetup, nextFilterable] = await Promise.all([
        getDifySetupSummary(),
        getDifyFilterableMetadata()
      ]);
      setKeys(nextKeys.items);
      setMappings(nextMappings.items);
      setSetup(nextSetup);
      setFilterableFields(nextFilterable.fields);
      setKnowledgeBases(nextKnowledgeBases);
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
    try {
      const allowedKnowledgeBaseIds = form.allowed_knowledge_base_ids.length
        ? form.allowed_knowledge_base_ids
        : form.knowledge_base_id
          ? [form.knowledge_base_id]
          : [];
      const result = await createDifyApiKey({
        name: form.name.trim(),
        knowledge_id: form.knowledge_id.trim(),
        knowledge_base_id: form.knowledge_base_id.trim(),
        allowed_knowledge_base_ids: allowedKnowledgeBaseIds,
        retrieval_top_k_limit: Number.parseInt(form.retrieval_top_k_limit, 10) || 20,
        expires_at: form.expires_at || null
      });
      if (result.api_key) {
        setSecretDialog({
          keyName: result.item.name,
          secret: result.api_key,
          title: t("Dify API key created")
        });
      }
      upsertKeyInList(result.item);
      setForm({
        name: "",
        knowledge_id: "",
        knowledge_base_id: "",
        allowed_knowledge_base_ids: [],
        retrieval_top_k_limit: "20",
        expires_at: ""
      });
      setKnowledgeIdTouched(false);
      await refreshDifyRelations();
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
      setMappingKnowledgeIdTouched(false);
      await refreshDifyRelations();
    } catch (error) {
      handleError(error);
    }
  }

  async function revealKey(key: DifyApiKey) {
    setBusyId(key.id);
    setMessage("");
    try {
      const result = await revealDifyApiKey(key.id);
      upsertKeyInList(result.item);
      if (result.api_key) {
        setSecretDialog({
          keyName: result.item.name,
          secret: result.api_key,
          title: t("Secret reveal")
        });
      }
    } catch (error) {
      handleError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function rotateKey(key: DifyApiKey) {
    setBusyId(key.id);
    setMessage("");
    try {
      const result = await rotateDifyApiKey(key.id);
      upsertKeyInList(result.item);
      if (result.api_key) {
        setSecretDialog({
          keyName: result.item.name,
          secret: result.api_key,
          title: t("Dify API key rotated")
        });
      }
    } catch (error) {
      handleError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function revokeKey(key: DifyApiKey) {
    setBusyId(key.id);
    setMessage("");
    try {
      const result = await revokeDifyApiKey(key.id);
      upsertKeyInList(result);
    } catch (error) {
      handleError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function refreshDifyRelations() {
    const [nextMappings, nextSetup] = await Promise.all([
      listDifyMappings({ limit: 100 }),
      getDifySetupSummary()
    ]);
    setMappings(nextMappings.items);
    setSetup(nextSetup);
  }

  function upsertKeyInList(key: DifyApiKey) {
    setKeys((items) => [key, ...items.filter((item) => item.id !== key.id)]);
  }

  async function copySecret(secret = secretDialog?.secret ?? "") {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
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

  function selectCreateKnowledgeBase(knowledgeBaseId: string) {
    const knowledgeBase = knowledgeBases.find((item) => item.id === knowledgeBaseId);
    const existingMapping = mappings.find((item) => item.knowledge_base_id === knowledgeBaseId);
    const nextKnowledgeId = knowledgeIdTouched
      ? form.knowledge_id
      : existingMapping?.dify_knowledge_id ||
        (knowledgeBase ? suggestDifyKnowledgeId(knowledgeBase) : "");
    setForm({
      ...form,
      knowledge_id: nextKnowledgeId,
      knowledge_base_id: knowledgeBaseId,
      allowed_knowledge_base_ids: knowledgeBaseId ? [knowledgeBaseId] : []
    });
  }

  function selectMappingKnowledgeBase(knowledgeBaseId: string) {
    const knowledgeBase = knowledgeBases.find((item) => item.id === knowledgeBaseId);
    const existingMapping = mappings.find((item) => item.knowledge_base_id === knowledgeBaseId);
    const nextDifyKnowledgeId = mappingKnowledgeIdTouched
      ? mappingForm.dify_knowledge_id
      : existingMapping?.dify_knowledge_id ||
        (knowledgeBase ? suggestDifyKnowledgeId(knowledgeBase) : "");
    setMappingForm({
      ...mappingForm,
      dify_knowledge_id: nextDifyKnowledgeId,
      knowledge_base_id: knowledgeBaseId
    });
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

      {secretDialog ? (
        <SecretDialog
          keyName={secretDialog.keyName}
          onClose={() => setSecretDialog(null)}
          onCopy={() => void copySecret(secretDialog.secret)}
          secret={secretDialog.secret}
          title={secretDialog.title}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          help={t(
            "Use this guide when configuring Dify External Knowledge. Dify stores the endpoint and sends knowledge_id plus the bearer key to OpenKB."
          )}
          title={t("Dify configuration guide")}
        >
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-zinc-50 p-3">
              <HelpLabel
                help={t(
                  "Paste this base URL into Dify's External Knowledge API Endpoint. Dify 1.14 appends /retrieval itself, so do not add it in the Dify UI."
                )}
                label={t("API endpoint for Dify")}
                tone="uppercase"
              />
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
                  <HelpLabel
                    help={t(
                      "This is the External Knowledge ID configured in Dify. OpenKB maps it to one OpenKB knowledge base."
                    )}
                    label={t("External Knowledge ID")}
                  />
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

        <Panel
          help={t(
            "These are fields Dify can send in metadata_condition. Business metadata comes from document metadata; openkb_* fields are diagnostics."
          )}
          title={t("Filterable metadata")}
        >
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
          <div className="space-y-1">
            <HelpLabel
              help={t(
                "Create an OpenKB bearer key for Dify. Copy the revealed key into Dify's External Knowledge API Key field. Creating a key also creates or updates the matching knowledge mapping."
              )}
              label={t("Create Dify API key")}
              size="section"
            />
            <p className="text-xs text-zinc-500">
              {t(
                "Pick an OpenKB knowledge base first. OpenKB will suggest an External Knowledge ID and keep the API key scoped to the selected knowledge base."
              )}
            </p>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput
              help={t("A local label for admins. Dify does not see this name.")}
              label={t("Name")}
              onChange={(value) => setForm({ ...form, name: value })}
              value={form.name}
            />
            <TextInput
              help={t(
                "The External Knowledge ID you will enter in Dify. It is not an OpenKB UUID; it is a stable identifier such as sanguo-openkb."
              )}
              label={t("Dify knowledge id")}
              onChange={(value) => {
                setKnowledgeIdTouched(true);
                setForm({ ...form, knowledge_id: value });
              }}
              value={form.knowledge_id}
            />
            <KnowledgeBaseSelect
              help={t("Select the OpenKB knowledge base that this Dify knowledge_id should read.")}
              knowledgeBases={knowledgeBases}
              label={t("Knowledge base id")}
              onChange={selectCreateKnowledgeBase}
              value={form.knowledge_base_id}
            />
            <AllowedKnowledgeBaseSelector
              help={t(
                "This is the security scope for the key. Keep it to the selected knowledge base unless the same Dify key must query several OpenKB knowledge bases."
              )}
              knowledgeBases={knowledgeBases}
              label={t("Allowed KB ids")}
              onChange={(value) => setForm({ ...form, allowed_knowledge_base_ids: value })}
              value={form.allowed_knowledge_base_ids}
            />
            <SelectField
              help={t(
                "Maximum records this key may return to Dify, regardless of Dify's requested top_k."
              )}
              label={t("Top K limit")}
              options={[
                { label: "3", value: "3" },
                { label: "5", value: "5" },
                { label: "10", value: "10" },
                { label: "20", value: "20" },
                { label: "50", value: "50" }
              ]}
              onChange={(value) => setForm({ ...form, retrieval_top_k_limit: value })}
              value={form.retrieval_top_k_limit}
            />
            <TextInput
              help={t("Optional. Leave blank for a non-expiring development key.")}
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
          <HelpLabel
            help={t(
              "A mapping tells OpenKB which OpenKB knowledge base should answer when Dify sends a specific knowledge_id."
            )}
            label={t("Knowledge mapping")}
            size="section"
          />
          <div className="mt-3 space-y-3">
            <TextInput
              help={t("The same External Knowledge ID configured in Dify.")}
              label={t("Dify knowledge id")}
              onChange={(value) => {
                setMappingKnowledgeIdTouched(true);
                setMappingForm({ ...mappingForm, dify_knowledge_id: value });
              }}
              value={mappingForm.dify_knowledge_id}
            />
            <KnowledgeBaseSelect
              help={t(
                "Select the OpenKB knowledge base that should answer this Dify knowledge_id."
              )}
              knowledgeBases={knowledgeBases}
              label={t("Knowledge base id")}
              onChange={selectMappingKnowledgeBase}
              value={mappingForm.knowledge_base_id}
            />
            <SelectField
              label={t("Status")}
              onChange={(value) => setMappingForm({ ...mappingForm, status: value })}
              options={[
                { label: t("Active"), value: "active" },
                { label: t("Disabled"), value: "disabled" }
              ]}
              value={mappingForm.status}
            />
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
                {key.allowed_knowledge_base_ids
                  .map((id) => formatKnowledgeBaseLabel(id, knowledgeBases))
                  .join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <SmallButton
                  disabled={!key.can_reveal || busyId === key.id}
                  onClick={() => void revealKey(key)}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {t("Reveal")}
                </SmallButton>
                <SmallButton disabled={busyId === key.id} onClick={() => void rotateKey(key)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("Rotate")}
                </SmallButton>
                <SmallButton disabled={busyId === key.id} onClick={() => void revokeKey(key)}>
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
              <p className="mt-1 truncate text-xs text-zinc-500">
                {formatKnowledgeBaseLabel(mapping.knowledge_base_id, knowledgeBases)}
              </p>
            </article>
          ))}
          {!mappings.length && !isLoading ? <Empty>{t("No mappings")}</Empty> : null}
        </Panel>
      </section>
      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}

function SecretDialog({
  keyName,
  onClose,
  onCopy,
  secret,
  title
}: {
  keyName?: string;
  onClose: () => void;
  onCopy: () => void;
  secret: string;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/30 px-4 py-6">
      <section
        aria-modal="true"
        className="w-full max-w-lg rounded-md border border-zinc-200 bg-white shadow-xl"
        role="dialog"
      >
        <div className="border-b border-zinc-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
              {keyName ? <p className="mt-1 text-sm text-zinc-500">{keyName}</p> : null}
            </div>
            <button aria-label={t("Close")} className="icon-button" onClick={onClose} type="button">
              ×
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            {t(
              "Copy this key into Dify's External Knowledge API Key field. Store it safely; it grants access to the allowed knowledge bases."
            )}
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <code className="block max-h-36 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            {secret}
          </code>
          <div className="rounded-md bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
            {t(
              "For safety, this dialog is the only place the raw key is shown during this action. Revealing it again requires an explicit admin action."
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-4">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            onClick={onClose}
            type="button"
          >
            {t("Close")}
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={onCopy}
            type="button"
          >
            <Copy className="h-4 w-4" />
            {t("Copy")}
          </button>
        </div>
      </section>
    </div>
  );
}

function TextInput({
  help,
  label,
  onChange,
  type = "text",
  value
}: {
  help?: string;
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm">
      <HelpLabel help={help} label={label} />
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function KnowledgeBaseSelect({
  help,
  knowledgeBases,
  label,
  onChange,
  value
}: {
  help?: string;
  knowledgeBases: KnowledgeBase[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <label className="block text-sm">
      <HelpLabel help={help} label={label} />
      <select
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">{t("Select knowledge base")}</option>
        {knowledgeBases.map((knowledgeBase) => (
          <option key={knowledgeBase.id} value={knowledgeBase.id}>
            {formatKnowledgeBaseLabel(knowledgeBase.id, knowledgeBases)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AllowedKnowledgeBaseSelector({
  help,
  knowledgeBases,
  label,
  onChange,
  value
}: {
  help?: string;
  knowledgeBases: KnowledgeBase[];
  label: string;
  onChange: (value: string[]) => void;
  value: string[];
}) {
  const { t } = useI18n();
  function toggle(knowledgeBaseId: string) {
    onChange(
      value.includes(knowledgeBaseId)
        ? value.filter((item) => item !== knowledgeBaseId)
        : [...value, knowledgeBaseId]
    );
  }

  return (
    <div className="block text-sm">
      <HelpLabel help={help} label={label} />
      <div className="max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white p-2">
        {knowledgeBases.length ? (
          <div className="space-y-2">
            {knowledgeBases.map((knowledgeBase) => (
              <label
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-zinc-50"
                key={knowledgeBase.id}
              >
                <input
                  checked={value.includes(knowledgeBase.id)}
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-600"
                  onChange={() => toggle(knowledgeBase.id)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-700">
                    {knowledgeBase.title}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-zinc-500">
                    {knowledgeBase.id}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">{t("No knowledge bases available")}</div>
        )}
      </div>
    </div>
  );
}

function SelectField({
  help,
  label,
  onChange,
  options,
  value
}: {
  help?: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="block text-sm">
      <HelpLabel help={help} label={label} />
      <select
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function HelpLabel({
  help,
  label,
  size = "field",
  tone = "normal"
}: {
  help?: string;
  label: string;
  size?: "field" | "section";
  tone?: "normal" | "uppercase";
}) {
  const labelClass =
    size === "section"
      ? "text-sm font-semibold text-zinc-900"
      : tone === "uppercase"
        ? "text-xs font-medium uppercase text-zinc-500"
        : "mb-1 font-medium text-zinc-700";
  return (
    <span className={`flex items-center gap-1.5 ${labelClass}`}>
      <span>{label}</span>
      {help ? (
        <span
          aria-label={help}
          className="group relative inline-flex h-5 w-5 items-center justify-center text-zinc-400 outline-none hover:text-zinc-700 focus:text-zinc-700"
          tabIndex={0}
          title={help}
        >
          <CircleHelp className="h-3.5 w-3.5" />
          <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-2 text-left text-xs normal-case leading-5 text-zinc-700 shadow-lg group-hover:block group-focus:block">
            {help}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 bg-white p-4">
      <HelpLabel help={help} label={title} size="section" />
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

function formatKnowledgeBaseLabel(id: string, knowledgeBases: KnowledgeBase[]) {
  const knowledgeBase = knowledgeBases.find((item) => item.id === id);
  if (!knowledgeBase) {
    return id;
  }
  return `${knowledgeBase.title} (${knowledgeBase.slug || id.slice(0, 8)})`;
}

function suggestDifyKnowledgeId(knowledgeBase: KnowledgeBase) {
  const base = knowledgeBase.slug || knowledgeBase.title || knowledgeBase.id;
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || knowledgeBase.id;
}

"use client";

import {
  BarChart3,
  CheckCircle2,
  Database,
  FileText,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Tags,
  Trash2
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n-provider";
import {
  createChunkRebuildJob,
  createKnowledgeBaseMetadataField,
  deleteKnowledgeBaseMetadataField,
  getChunkSettings,
  getKnowledgeBaseOverview,
  listKnowledgeBaseMetadataFields,
  listKnowledgeBaseChunks,
  searchKnowledge,
  updateChunkSettings,
  type ChunkSettings,
  type DocumentChunk,
  type DocumentSummary,
  type KnowledgeBaseMetadataField,
  type KnowledgeBaseMetadataFieldType,
  type KnowledgeBaseMetadataFieldsResponse,
  type KnowledgeBaseOverview,
  type RetrievalContextMode,
  type SearchResponse
} from "@/lib/openkb-api";

type DashboardTab = "overview" | "chunks" | "lab" | "metadata" | "settings";
const formControlClass =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500";

export function KnowledgeBaseDashboard({
  documents,
  knowledgeBaseId,
  onCreateDocument,
  onError,
  onOpenDocument
}: {
  documents: DocumentSummary[];
  knowledgeBaseId: string;
  onCreateDocument: () => void;
  onError: (error: unknown) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [overview, setOverview] = useState<KnowledgeBaseOverview | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [selectedChunkDocumentId, setSelectedChunkDocumentId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ChunkSettings | null>(null);
  const [metadataFields, setMetadataFields] = useState<KnowledgeBaseMetadataFieldsResponse | null>(
    null
  );
  const [metadataForm, setMetadataForm] = useState<{
    name: string;
    type: KnowledgeBaseMetadataFieldType;
  }>({ name: "", type: "string" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [labQuery, setLabQuery] = useState("");
  const [labTopK, setLabTopK] = useState(5);
  const [labContextMode, setLabContextMode] = useState<RetrievalContextMode>("parent_child");
  const [labResponse, setLabResponse] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const pageDocuments = useMemo(
    () => documents.filter((document) => document.type === "page"),
    [documents]
  );
  const chunkCountByDocument = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chunk of chunks) {
      counts.set(chunk.document_id, (counts.get(chunk.document_id) ?? 0) + 1);
    }
    return counts;
  }, [chunks]);
  const selectedChunkDocument =
    pageDocuments.find((document) => document.id === selectedChunkDocumentId) ?? null;
  const selectedDocumentChunks = useMemo(
    () => chunks.filter((chunk) => chunk.document_id === selectedChunkDocumentId),
    [chunks, selectedChunkDocumentId]
  );

  useEffect(() => {
    void load();
  }, [knowledgeBaseId]);

  useEffect(() => {
    if (pageDocuments.length === 0) {
      if (selectedChunkDocumentId) {
        setSelectedChunkDocumentId(null);
      }
      return;
    }

    const currentStillExists = pageDocuments.some(
      (document) => document.id === selectedChunkDocumentId
    );
    if (currentStillExists) {
      return;
    }

    const fallbackDocument = pageDocuments[0];
    if (!fallbackDocument) {
      return;
    }

    const firstWithChunks =
      pageDocuments.find((document) => (chunkCountByDocument.get(document.id) ?? 0) > 0) ??
      fallbackDocument;
    setSelectedChunkDocumentId(firstWithChunks.id);
  }, [chunkCountByDocument, pageDocuments, selectedChunkDocumentId]);

  async function load() {
    setIsLoading(true);
    try {
      const [nextOverview, nextSettings, nextChunks] = await Promise.all([
        getKnowledgeBaseOverview(knowledgeBaseId),
        getChunkSettings(knowledgeBaseId),
        listKnowledgeBaseChunks(knowledgeBaseId, { limit: 500 })
      ]);
      setOverview(nextOverview);
      setSettings(nextSettings);
      setChunks(nextChunks);
      setLabContextMode(nextSettings.parent_mode === "full_doc" ? "full_text" : "parent_child");
      void loadMetadataFields();
    } catch (error) {
      onError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMetadataFields() {
    try {
      setMetadataFields(await listKnowledgeBaseMetadataFields(knowledgeBaseId));
    } catch (error) {
      onError(error);
    }
  }

  async function createMetadataField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!metadataForm.name.trim()) {
      return;
    }
    try {
      await createKnowledgeBaseMetadataField(knowledgeBaseId, {
        name: metadataForm.name.trim(),
        type: metadataForm.type
      });
      setMetadataForm({ name: "", type: "string" });
      await loadMetadataFields();
    } catch (error) {
      onError(error);
    }
  }

  async function archiveMetadataField(field: KnowledgeBaseMetadataField) {
    if (!field.id) {
      return;
    }
    try {
      await deleteKnowledgeBaseMetadataField(knowledgeBaseId, field.id);
      await loadMetadataFields();
    } catch (error) {
      onError(error);
    }
  }

  async function saveSettings() {
    if (!settings) {
      return;
    }
    setIsSaving(true);
    try {
      const updated = await updateChunkSettings(knowledgeBaseId, {
        mode: settings.mode,
        parent_mode: settings.parent_mode,
        parent_delimiter: settings.parent_delimiter,
        child_delimiter: settings.child_delimiter,
        parent_max_characters: settings.parent_max_characters,
        child_max_characters: settings.child_max_characters,
        child_overlap_characters: settings.child_overlap_characters
      });
      setSettings(updated);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function queueRebuild() {
    setIsRebuilding(true);
    try {
      await createChunkRebuildJob(knowledgeBaseId);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setIsRebuilding(false);
    }
  }

  async function runLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!labQuery.trim()) {
      setLabResponse(null);
      return;
    }
    setIsSearching(true);
    try {
      setLabResponse(
        await searchKnowledge({
          query: labQuery.trim(),
          knowledge_base_ids: [knowledgeBaseId],
          top_k: labTopK,
          filters: {},
          context_mode: labContextMode
        })
      );
    } catch (error) {
      onError(error);
    } finally {
      setIsSearching(false);
    }
  }

  if (isLoading && !overview) {
    return (
      <div className="flex min-h-[680px] items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-[680px] bg-white px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{overview?.knowledge_base.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Badge tone="zinc">{t("Knowledge base")}</Badge>
            <Badge tone="sky">
              {t("visibility: {value}", {
                value: t(overview?.knowledge_base.visibility ?? "")
              })}
            </Badge>
            <Badge tone="emerald">
              {t("status: {value}", { value: t(overview?.knowledge_base.status ?? "") })}
            </Badge>
            {overview?.needs_chunk_rebuild ? <Badge tone="amber">{t("chunks stale")}</Badge> : null}
            {overview?.needs_index_rebuild ? (
              <Badge tone="sky">{t("index rebuild needed")}</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            {t("Refresh")}
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
            onClick={onCreateDocument}
            type="button"
          >
            <FileText className="h-4 w-4" />
            {t("New doc")}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TabButton
          active={tab === "overview"}
          icon={<BarChart3 />}
          onClick={() => setTab("overview")}
        >
          {t("Overview")}
        </TabButton>
        <TabButton active={tab === "chunks"} icon={<Layers3 />} onClick={() => setTab("chunks")}>
          {t("Chunks")}
        </TabButton>
        <TabButton active={tab === "lab"} icon={<Search />} onClick={() => setTab("lab")}>
          {t("Retrieval Lab")}
        </TabButton>
        <TabButton
          active={tab === "metadata"}
          icon={<Tags />}
          onClick={() => {
            setTab("metadata");
            if (!metadataFields) void loadMetadataFields();
          }}
        >
          {t("Metadata")}
        </TabButton>
        <TabButton
          active={tab === "settings"}
          icon={<Settings2 />}
          onClick={() => setTab("settings")}
        >
          {t("Settings")}
        </TabButton>
      </div>

      {tab === "overview" && overview ? (
        <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<FileText />} label={t("Documents")} value={overview.documents.total} />
          <Metric
            icon={<CheckCircle2 />}
            label={t("Published")}
            value={overview.documents.published}
          />
          <Metric icon={<Layers3 />} label={t("Chunks")} value={overview.chunks.total} />
          <Metric icon={<Database />} label={t("Child chunks")} value={overview.chunks.child} />
        </section>
      ) : null}

      {tab === "overview" && overview ? (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title={t("Recent imports")}>
            <div className="space-y-2">
              {overview.latest_import_jobs.length > 0 ? (
                overview.latest_import_jobs.map((job) => (
                  <Row key={job.id} title={job.title ?? job.converter} meta={t(job.status)} />
                ))
              ) : (
                <EmptyLine>{t("No imports")}</EmptyLine>
              )}
            </div>
          </Panel>
          <Panel title={t("Index state")}>
            <div className="space-y-2">
              <Row
                title={t("Chunk rebuild")}
                meta={t(overview.latest_chunk_rebuild_job?.status ?? "none")}
              />
              <Row
                title={t("Milvus rebuild")}
                meta={t(overview.latest_index_rebuild_job?.status ?? "none")}
              />
              <Row title={t("Settings revision")} meta={String(overview.chunk_settings.revision)} />
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "chunks" ? (
        <section className="mt-5">
          <Panel title={t("Chunk map")}>
            <div className="grid min-h-[260px] gap-3 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]">
              <div className="max-h-[620px] overflow-y-auto rounded-md border border-zinc-200 bg-white p-2">
                <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs font-medium text-zinc-500">
                  <span>{t("Documents")}</span>
                  <span>{t("{count} items", { count: pageDocuments.length })}</span>
                </div>
                <div className="space-y-1">
                  {pageDocuments.length > 0 ? (
                    pageDocuments.map((document) => {
                      const count = chunkCountByDocument.get(document.id) ?? 0;
                      const selected = document.id === selectedChunkDocumentId;
                      return (
                        <button
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm ${
                            selected ? "bg-sky-50 text-sky-800" : "text-zinc-700 hover:bg-zinc-50"
                          }`}
                          key={document.id}
                          onClick={() => setSelectedChunkDocumentId(document.id)}
                          type="button"
                        >
                          <span className="min-w-0 truncate">{document.title}</span>
                          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                            {count}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <EmptyLine>{t("No documents")}</EmptyLine>
                  )}
                </div>
              </div>

              <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-3">
                {selectedChunkDocument ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-zinc-900">
                        {selectedChunkDocument.title}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        {t("{count} chunks", { count: selectedDocumentChunks.length })}
                      </p>
                    </div>
                    <button
                      className="inline-flex h-8 shrink-0 items-center rounded-md border border-zinc-300 px-2.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                      onClick={() => onOpenDocument(selectedChunkDocument.id)}
                      type="button"
                    >
                      {t("Open document")}
                    </button>
                  </div>
                ) : null}

                <div className="max-h-[560px] space-y-2 overflow-y-auto">
                  {selectedDocumentChunks.length > 0 ? (
                    selectedDocumentChunks.map((chunk) => (
                      <button
                        key={chunk.id}
                        className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-left hover:border-sky-200 hover:bg-sky-50/40"
                        onClick={() => onOpenDocument(chunk.document_id)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <Badge tone={chunk.chunk_type === "parent" ? "emerald" : "zinc"}>
                            {t(chunk.chunk_type)}
                          </Badge>
                          <span>#{chunk.ordinal}</span>
                          <span>{t("{count} tokens", { count: chunk.token_count ?? 0 })}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-zinc-700">
                          {chunk.content_text}
                        </p>
                      </button>
                    ))
                  ) : (
                    <EmptyLine>
                      {selectedChunkDocument
                        ? t("No chunks for this document")
                        : t("Select a document to inspect chunks")}
                    </EmptyLine>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "lab" ? (
        <section className="mt-5">
          <Panel title={t("Retrieval Lab")}>
            <form
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_auto]"
              onSubmit={runLab}
            >
              <input
                className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                onChange={(event) => setLabQuery(event.target.value)}
                placeholder={t("Search this knowledge base")}
                value={labQuery}
              />
              <input
                className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                max={20}
                min={1}
                onChange={(event) => setLabTopK(Number(event.target.value))}
                type="number"
                value={labTopK}
              />
              <select
                className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                onChange={(event) => setLabContextMode(event.target.value as RetrievalContextMode)}
                value={labContextMode}
              >
                <option value="chunk">{t("Chunk")}</option>
                <option value="parent_child">{t("Parent child")}</option>
                <option value="paragraph_parent_child">{t("Paragraph parent")}</option>
                <option value="full_text">{t("Full text")}</option>
              </select>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white"
                disabled={isSearching}
                type="submit"
              >
                {isSearching ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t("Run")}
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {labResponse?.results.map((result) => (
                <button
                  key={`${result.chunk_id}:${result.document_id}`}
                  className="block w-full rounded-md border border-zinc-200 px-3 py-3 text-left hover:border-sky-200 hover:bg-sky-50/40"
                  onClick={() => onOpenDocument(result.document_id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{result.title}</span>
                    <Badge tone="zinc">{result.score.toFixed(3)}</Badge>
                    <Badge tone="sky">
                      {result.context_mode ?? labResponse.context_mode ?? "chunk"}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-600">
                    {result.content}
                  </p>
                  <p className="mt-2 truncate text-xs text-zinc-500">
                    {result.parent_chunk?.chunk_id
                      ? t("parent {id}", { id: result.parent_chunk.chunk_id })
                      : t("match {id}", { id: result.match_chunk?.chunk_id ?? result.chunk_id })}
                  </p>
                </button>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "metadata" ? (
        <section className="mt-5">
          <Panel title={t("Dify metadata schema")}>
            <p className="text-sm text-zinc-600">
              {t(
                "These fields become document metadata and can be used by Dify metadata_condition."
              )}
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-3">
                <div className="rounded-md border border-zinc-200 bg-white p-3">
                  <h3 className="text-sm font-semibold">{t("Built-in fields")}</h3>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {(metadataFields?.built_in ?? []).map((field) => (
                      <MetadataFieldCard field={field} key={field.name} />
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-200 bg-white p-3">
                  <h3 className="text-sm font-semibold">{t("Custom fields")}</h3>
                  <div className="mt-2 space-y-2">
                    {(metadataFields?.custom ?? []).map((field) => (
                      <div
                        className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2"
                        key={field.id ?? field.name}
                      >
                        <MetadataFieldCard field={field} compact />
                        <button
                          className="icon-button text-red-600"
                          onClick={() => void archiveMetadataField(field)}
                          title={t("Archive field")}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {metadataFields && metadataFields.custom.length === 0 ? (
                      <EmptyLine>{t("No custom metadata fields")}</EmptyLine>
                    ) : null}
                  </div>
                </div>
              </div>

              <form
                className="rounded-md border border-zinc-200 bg-white p-3"
                onSubmit={createMetadataField}
              >
                <h3 className="text-sm font-semibold">{t("Add metadata field")}</h3>
                <div className="mt-3 space-y-3">
                  <TextField
                    label={t("Field name")}
                    onChange={(value) => setMetadataForm({ ...metadataForm, name: value })}
                    value={metadataForm.name}
                  />
                  <Field label={t("Field type")}>
                    <select
                      className={formControlClass}
                      onChange={(event) =>
                        setMetadataForm({
                          ...metadataForm,
                          type: event.target.value as KnowledgeBaseMetadataFieldType
                        })
                      }
                      value={metadataForm.type}
                    >
                      <option value="string">{t("String")}</option>
                      <option value="number">{t("Number")}</option>
                      <option value="time">{t("Time")}</option>
                    </select>
                  </Field>
                  <button
                    className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
                    type="submit"
                  >
                    {t("Add field")}
                  </button>
                </div>
              </form>
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "settings" && settings ? (
        <section className="mt-5">
          <Panel title={t("Chunk settings")}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("Mode")}>
                <select
                  className={formControlClass}
                  onChange={(event) =>
                    setSettings({ ...settings, mode: event.target.value as ChunkSettings["mode"] })
                  }
                  value={settings.mode}
                >
                  <option value="parent_child">{t("Parent child")}</option>
                  <option value="general">{t("General")}</option>
                </select>
              </Field>
              <Field label={t("Parent mode")}>
                <select
                  className={formControlClass}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      parent_mode: event.target.value as ChunkSettings["parent_mode"]
                    })
                  }
                  value={settings.parent_mode}
                >
                  <option value="paragraph">{t("Paragraph")}</option>
                  <option value="full_doc">{t("Full doc")}</option>
                </select>
              </Field>
              <NumberField
                label={t("Parent chars")}
                onChange={(value) => setSettings({ ...settings, parent_max_characters: value })}
                value={settings.parent_max_characters}
              />
              <TextField
                label={t("Parent delimiter")}
                onChange={(value) =>
                  setSettings({ ...settings, parent_delimiter: decodeDelimiter(value) })
                }
                value={encodeDelimiter(settings.parent_delimiter)}
              />
              <NumberField
                label={t("Child chars")}
                onChange={(value) => setSettings({ ...settings, child_max_characters: value })}
                value={settings.child_max_characters}
              />
              <NumberField
                label={t("Child overlap")}
                onChange={(value) => setSettings({ ...settings, child_overlap_characters: value })}
                value={settings.child_overlap_characters}
              />
              <TextField
                label={t("Child delimiter")}
                onChange={(value) =>
                  setSettings({ ...settings, child_delimiter: decodeDelimiter(value) })
                }
                value={encodeDelimiter(settings.child_delimiter)}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
                disabled={isSaving}
                onClick={() => void saveSettings()}
                type="button"
              >
                {isSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("Save settings")}
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800"
                disabled={isRebuilding}
                onClick={() => void queueRebuild()}
                type="button"
              >
                {isRebuilding ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t("Rebuild chunks")}
              </button>
            </div>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  children,
  icon,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium leading-none ${
        active ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      {children}
    </button>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-4">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-4">
      <div className="flex items-center justify-between text-zinc-500">
        <span className="text-xs font-medium">{label}</span>
        <span className="h-4 w-4">{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function Row({ meta, title }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">
      <span className="truncate text-zinc-700">{title}</span>
      <span className="shrink-0 text-xs text-zinc-500">{meta}</span>
    </div>
  );
}

function MetadataFieldCard({
  compact = false,
  field
}: {
  compact?: boolean;
  field: KnowledgeBaseMetadataField;
}) {
  return (
    <div className={compact ? "min-w-0 flex-1" : "rounded-md border border-zinc-200 p-2"}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-zinc-800">{field.name}</span>
        <Badge tone={field.source === "built_in" ? "sky" : "zinc"}>{field.type}</Badge>
      </div>
      {field.description ? (
        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{field.description}</p>
      ) : null}
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <Field label={label}>
      <input
        className={formControlClass}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </Field>
  );
}

function TextField({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field label={label}>
      <input
        className={formControlClass}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </Field>
  );
}

function Badge({
  children,
  tone
}: {
  children: ReactNode;
  tone: "amber" | "emerald" | "sky" | "zinc";
}) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-50 text-amber-700"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "sky"
          ? "bg-sky-50 text-sky-700"
          : "bg-zinc-100 text-zinc-600";
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${toneClass}`}>{children}</span>;
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-white px-3 py-2 text-sm text-zinc-500">{children}</p>;
}

function encodeDelimiter(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function decodeDelimiter(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

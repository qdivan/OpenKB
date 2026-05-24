"use client";

import {
  BarChart3,
  CheckCircle2,
  Database,
  FileText,
  Image as ImageIcon,
  Info,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Trash2
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n-provider";
import {
  createKnowledgeBaseMetadataField,
  deleteKnowledgeBaseMetadataField,
  getChunkSettings,
  getKnowledgeBaseOverview,
  listKnowledgeBaseMetadataFields,
  listKnowledgeBaseChunks,
  reprocessDocument,
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
  type SearchResult,
  type SearchResponse
} from "@/lib/openkb-api";

type DashboardTab = "overview" | "segments" | "lab" | "settings";
type SettingsTab = "processing" | "chunking" | "retrieval" | "metadata" | "summary" | "reprocess";
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("processing");
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
  const [labQuery, setLabQuery] = useState("");
  const [labTopK, setLabTopK] = useState(5);
  const [labContextMode, setLabContextMode] = useState<RetrievalContextMode>("parent_child");
  const [labResponse, setLabResponse] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [reprocessingDocumentId, setReprocessingDocumentId] = useState<string | null>(null);

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
  const needsReprocessDocuments = useMemo(
    () => pageDocuments.filter((document) => document.processing_status === "needs_reprocess"),
    [pageDocuments]
  );
  const retrievalWeights = useMemo(
    () => parseHybridWeights(settings?.retrieval_model?.weights),
    [settings?.retrieval_model?.weights]
  );
  const processRulePreview = useMemo(
    () => formatJsonPreview(settings ? buildSettingsProcessRule(settings) : undefined),
    [settings]
  );
  const isTextKnowledgeBase = settings?.doc_form === "text_model";
  const isHierarchicalKnowledgeBase = settings?.doc_form === "hierarchical_model";
  const isQaKnowledgeBase = settings?.doc_form === "qa_model";

  useEffect(() => {
    void load();
  }, [knowledgeBaseId]);

  useEffect(() => {
    if (settings?.retrieval_model?.top_k) {
      setLabTopK(settings.retrieval_model.top_k);
    }
  }, [settings?.retrieval_model?.top_k]);

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
        indexing_technique: settings.indexing_technique,
        process_rule_mode: settings.process_rule_mode,
        retrieval_model: settings.retrieval_model,
        summary_index_setting: settings.summary_index_setting,
        process_rule: buildSettingsProcessRule(settings),
        parent_delimiter: settings.parent_delimiter,
        child_delimiter: settings.child_delimiter,
        parent_max_characters: settings.parent_max_characters,
        chunk_overlap_characters: getParentOverlapCharacters(settings),
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

  async function reprocessPageDocument(documentId: string) {
    setReprocessingDocumentId(documentId);
    try {
      await reprocessDocument(documentId);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setReprocessingDocumentId(null);
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
            {overview?.needs_chunk_rebuild ? (
              <Badge tone="amber">{t("segments stale")}</Badge>
            ) : null}
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
        <TabButton
          active={tab === "segments"}
          icon={<Layers3 />}
          onClick={() => setTab("segments")}
        >
          {t("Segments")}
        </TabButton>
        <TabButton active={tab === "lab"} icon={<Search />} onClick={() => setTab("lab")}>
          {t("Retrieval Lab")}
        </TabButton>
        <TabButton
          active={tab === "settings"}
          icon={<Settings2 />}
          onClick={() => {
            setTab("settings");
            if (settingsTab === "metadata" && !metadataFields) void loadMetadataFields();
          }}
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
          <Metric icon={<Layers3 />} label={t("Segments")} value={overview.chunks.total} />
          <Metric icon={<Database />} label={t("Child segments")} value={overview.chunks.child} />
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

      {tab === "segments" ? (
        <section className="mt-5">
          <Panel title={t("Segment map")}>
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
                        {t("{count} segments", { count: selectedDocumentChunks.length })}
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
                          <Badge tone={chunk.status === "active" ? "emerald" : "amber"}>
                            {t(chunk.status)}
                          </Badge>
                          {chunk.has_override ? <Badge tone="sky">{t("override")}</Badge> : null}
                          {chunk.index_role === "summary" ? (
                            <Badge tone="sky">{t("summary hit")}</Badge>
                          ) : null}
                          {chunk.index_role === "asset_image" ? (
                            <Badge tone="emerald">{t("image hit")}</Badge>
                          ) : null}
                          {chunk.index_role === "asset_attachment" ? (
                            <Badge tone="emerald">{t("attachment hit")}</Badge>
                          ) : null}
                          <span>#{chunk.ordinal}</span>
                          <span>{t("{count} tokens", { count: chunk.token_count ?? 0 })}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-zinc-700">
                          {chunk.content_text}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {t(
                            "Open the document Segments panel to manage segment status or overrides."
                          )}
                        </p>
                      </button>
                    ))
                  ) : (
                    <EmptyLine>
                      {selectedChunkDocument
                        ? t("No segments for this document")
                        : t("Select a document to inspect segments")}
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
                    <SearchHitBadge result={result} />
                  </div>
                  <SearchAssetPreview result={result} />
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

      {tab === "settings" && settings ? (
        <section className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["processing", "Processing mode"],
                ["chunking", "Chunk rules"],
                ["retrieval", "Retrieval policy"],
                ["metadata", "Metadata"],
                ["summary", "Summary"],
                ["reprocess", "Reprocess"]
              ] as const
            ).map(([item, label]) => (
              <SettingsTabButton
                active={settingsTab === item}
                key={item}
                onClick={() => {
                  setSettingsTab(item);
                  if (item === "metadata" && !metadataFields) void loadMetadataFields();
                }}
              >
                {t(label)}
              </SettingsTabButton>
            ))}
          </div>

          {settingsTab === "processing" ? (
            <Panel title={t("Processing mode")}>
              <p className="mb-4 text-sm text-zinc-600">
                {t(
                  "Knowledge base type decides the broad processing shape. It is selected at creation and does not configure model secrets."
                )}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  help={t(
                    "Knowledge base type is selected at creation. Create another knowledge base or migrate content if the type is wrong."
                  )}
                  label={t("Knowledge base type")}
                >
                  <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                    {t(docFormLabel(settings.doc_form))}
                  </div>
                </Field>
                <Field
                  help={t(
                    "This is derived from the knowledge base type. It explains how PostgreSQL segments are shaped after explicit reprocess."
                  )}
                  label={t("Derived segment layout")}
                >
                  <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                    {t(derivedSegmentLayoutLabel(settings))}
                  </div>
                </Field>
                <Field
                  help={t(
                    "Indexing quality tier. Economy uses keyword or BM25 retrieval; high quality uses embedding, hybrid search, and rerank when configured."
                  )}
                  label={t("Indexing technique")}
                >
                  <select
                    className={formControlClass}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        indexing_technique: event.target
                          .value as ChunkSettings["indexing_technique"]
                      })
                    }
                    value={settings.indexing_technique}
                  >
                    <option value="economy">{t("Economy keyword/BM25")}</option>
                    <option value="high_quality">{t("High quality Embedding/Hybrid")}</option>
                  </select>
                </Field>
                <Field
                  help={t("Parent-child mode is configured per document in the Segments page.")}
                  label={t("Document-level parent-child mode")}
                >
                  <div className="flex min-h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                    {isHierarchicalKnowledgeBase
                      ? t(
                          "Set paragraph parent-child or full-doc parent-child on each document's Segments page."
                        )
                      : t("Not used by this knowledge base type.")}
                  </div>
                </Field>
                <ReadOnlyField label={t("Settings revision")} value={String(settings.revision)} />
              </div>
            </Panel>
          ) : null}

          {settingsTab === "chunking" ? (
            <Panel title={t("Chunk rules")}>
              <p className="mb-4 text-sm text-zinc-600">
                {t(
                  "Segmentation rules are scoped to the knowledge base type. Parent-child mode itself is set per document."
                )}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {isTextKnowledgeBase ? (
                  <Field
                    help={t(
                      "Automatic and custom segmentation are the two processing rule choices for segment knowledge bases."
                    )}
                    label={t("Segmentation mode")}
                  >
                    <select
                      className={formControlClass}
                      onChange={(event) =>
                        setSettings(
                          updateProcessRuleMode(
                            settings,
                            event.target.value as ChunkSettings["process_rule_mode"]
                          )
                        )
                      }
                      value={settings.process_rule_mode}
                    >
                      {processRuleModeOptions(settings.doc_form).map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.label)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field
                    help={
                      isHierarchicalKnowledgeBase
                        ? t(
                            "Parent-child knowledge bases always use hierarchical segmentation. Choose paragraph parent-child or full-doc parent-child per document."
                          )
                        : t("QA knowledge bases index active QA pairs instead of body segments.")
                    }
                    label={t("Segmentation mode")}
                  >
                    <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                      {t(segmentationModeLabel(settings.doc_form, settings.process_rule_mode))}
                    </div>
                  </Field>
                )}

                {!isQaKnowledgeBase ? (
                  <>
                    <NumberField
                      label={isHierarchicalKnowledgeBase ? t("Parent chars") : t("Segment chars")}
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "parent", { max_tokens: value })
                        )
                      }
                      value={settings.parent_max_characters}
                    />
                    <TextField
                      label={isHierarchicalKnowledgeBase ? t("Parent delimiter") : t("Delimiter")}
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "parent", {
                            separator: decodeDelimiter(value)
                          })
                        )
                      }
                      value={encodeDelimiter(settings.parent_delimiter)}
                    />
                    <NumberField
                      label={
                        isHierarchicalKnowledgeBase ? t("Parent overlap") : t("Segment overlap")
                      }
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "parent", { chunk_overlap: value })
                        )
                      }
                      value={getParentOverlapCharacters(settings)}
                    />
                  </>
                ) : (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800 md:col-span-2">
                    {t(
                      "QA knowledge bases use manual, CSV, mock, or LLM generated QA pairs. Reprocess indexes active QA questions and returns answers."
                    )}
                  </div>
                )}

                {isHierarchicalKnowledgeBase ? (
                  <>
                    <NumberField
                      label={t("Child chars")}
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "child", { max_tokens: value })
                        )
                      }
                      value={settings.child_max_characters}
                    />
                    <NumberField
                      label={t("Child overlap")}
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "child", { chunk_overlap: value })
                        )
                      }
                      value={settings.child_overlap_characters}
                    />
                    <TextField
                      label={t("Child delimiter")}
                      onChange={(value) =>
                        setSettings(
                          updateSegmentationRule(settings, "child", {
                            separator: decodeDelimiter(value)
                          })
                        )
                      }
                      value={encodeDelimiter(settings.child_delimiter)}
                    />
                  </>
                ) : null}
              </div>
              <div className="mt-4 rounded-md border border-zinc-200 bg-white p-3">
                <h3 className="text-xs font-semibold text-zinc-700">{t("Process rule preview")}</h3>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950 p-3 text-xs leading-5 text-zinc-50">
                  {processRulePreview}
                </pre>
              </div>
            </Panel>
          ) : null}

          {settingsTab === "retrieval" ? (
            <Panel title={t("Retrieval policy")}>
              <p className="mb-4 text-sm text-zinc-600">
                {t(
                  "This is the knowledge base default retrieval policy. Requests may override top K and filters, but model endpoints stay system-admin only."
                )}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("Search method")}>
                  <select
                    className={formControlClass}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        retrieval_model: {
                          ...(settings.retrieval_model ?? {}),
                          search_method: event.target.value as NonNullable<
                            ChunkSettings["retrieval_model"]["search_method"]
                          >
                        }
                      })
                    }
                    value={settings.retrieval_model?.search_method ?? "hybrid_search"}
                  >
                    <option value="semantic_search">{t("Semantic search")}</option>
                    <option value="full_text_search">{t("Full text search")}</option>
                    <option value="hybrid_search">{t("Hybrid search")}</option>
                    <option value="keyword_search">{t("Keyword search")}</option>
                  </select>
                </Field>
                <NumberField
                  label={t("Default top K")}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      retrieval_model: { ...(settings.retrieval_model ?? {}), top_k: value }
                    })
                  }
                  value={settings.retrieval_model?.top_k ?? 10}
                />
                <NumberField
                  label={t("Score threshold")}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      retrieval_model: {
                        ...(settings.retrieval_model ?? {}),
                        score_threshold: value / 100
                      }
                    })
                  }
                  value={Math.round((settings.retrieval_model?.score_threshold ?? 0) * 100)}
                />
                <Field label={t("Enable score threshold")}>
                  <ToggleLine
                    checked={settings.retrieval_model?.score_threshold_enabled === true}
                    label={t("Apply threshold after permission final check")}
                    onChange={(checked) =>
                      setSettings({
                        ...settings,
                        retrieval_model: {
                          ...(settings.retrieval_model ?? {}),
                          score_threshold_enabled: checked
                        }
                      })
                    }
                  />
                </Field>
                <NumberField
                  label={t("Keyword weight")}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      retrieval_model: {
                        ...(settings.retrieval_model ?? {}),
                        weights: buildHybridWeights(value / 100, retrievalWeights.vector)
                      }
                    })
                  }
                  value={Math.round(retrievalWeights.keyword * 100)}
                />
                <NumberField
                  label={t("Vector weight")}
                  onChange={(value) =>
                    setSettings({
                      ...settings,
                      retrieval_model: {
                        ...(settings.retrieval_model ?? {}),
                        weights: buildHybridWeights(retrievalWeights.keyword, value / 100)
                      }
                    })
                  }
                  value={Math.round(retrievalWeights.vector * 100)}
                />
                <Field label={t("Rerank")}>
                  <ToggleLine
                    checked={settings.retrieval_model?.reranking_enable === true}
                    label={t("Enable rerank after candidate retrieval")}
                    onChange={(checked) =>
                      setSettings({
                        ...settings,
                        retrieval_model: {
                          ...(settings.retrieval_model ?? {}),
                          reranking_enable: checked
                        }
                      })
                    }
                  />
                </Field>
              </div>
            </Panel>
          ) : null}

          {settingsTab === "metadata" ? (
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
          ) : null}

          {settingsTab === "summary" ? (
            <Panel title={t("Summary index")}>
              <p className="mb-4 text-sm text-zinc-600">
                {t(
                  "Summary index settings decide whether generated summaries can participate in retrieval. They never trigger LLM generation automatically."
                )}
              </p>
              <div className="space-y-3">
                <Field label={t("Summary index")}>
                  <ToggleLine
                    checked={settings.summary_index_setting?.enable === true}
                    label={t("Allow manually generated summaries to be indexed")}
                    onChange={(checked) =>
                      setSettings({
                        ...settings,
                        summary_index_setting: {
                          ...(settings.summary_index_setting ?? {}),
                          enable: checked
                        }
                      })
                    }
                  />
                </Field>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-zinc-600">
                    {t("Summary prompt")}
                  </span>
                  <textarea
                    className="min-h-28 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        summary_index_setting: {
                          ...(settings.summary_index_setting ?? {}),
                          summary_prompt: event.target.value
                        }
                      })
                    }
                    placeholder={t("Optional system prompt for explicit summary generation")}
                    value={settings.summary_index_setting?.summary_prompt ?? ""}
                  />
                </label>
              </div>
            </Panel>
          ) : null}

          {settingsTab === "reprocess" ? (
            <Panel title={t("Reprocess documents")}>
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                {t(
                  "Reprocess rebuilds PostgreSQL segments from Markdown. Search, MCP, and Dify still need a Milvus index rebuild before they use the new segments."
                )}
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge tone={needsReprocessDocuments.length > 0 ? "amber" : "emerald"}>
                  {t("{count} documents need reprocess", {
                    count: needsReprocessDocuments.length
                  })}
                </Badge>
                <Badge tone="zinc">
                  {t("{count} page documents", { count: pageDocuments.length })}
                </Badge>
              </div>
              <div className="space-y-2">
                {pageDocuments.map((document) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                    key={document.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{document.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <Badge
                          tone={
                            document.processing_status === "needs_reprocess" ? "amber" : "emerald"
                          }
                        >
                          {t(document.processing_status ?? "current")}
                        </Badge>
                        {document.processing_revision ? (
                          <span>
                            {t("Processing revision")}: {document.processing_revision}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                        onClick={() => onOpenDocument(document.id)}
                        type="button"
                      >
                        {t("Open document")}
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-950 px-2.5 text-xs font-medium text-white disabled:bg-zinc-300"
                        disabled={reprocessingDocumentId === document.id}
                        onClick={() => void reprocessPageDocument(document.id)}
                        type="button"
                      >
                        {reprocessingDocumentId === document.id ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {t("Reprocess")}
                      </button>
                    </div>
                  </div>
                ))}
                {pageDocuments.length === 0 ? (
                  <EmptyLine>{t("No page documents")}</EmptyLine>
                ) : null}
              </div>
            </Panel>
          ) : null}

          {settingsTab !== "metadata" && settingsTab !== "reprocess" ? (
            <div className="flex flex-wrap gap-2">
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
            </div>
          ) : null}
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

function SettingsTabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-8 items-center rounded-md px-3 text-xs font-medium ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
      onClick={onClick}
      type="button"
    >
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

function Field({ children, help, label }: { children: ReactNode; help?: string; label: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="flex items-center gap-1 text-xs font-medium text-zinc-500">
        {label}
        {help ? <HelpTip text={help} /> : null}
      </span>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600">
        {value}
      </div>
    </Field>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group/help relative inline-flex">
      <button
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        type="button"
      >
        <Info className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute left-0 top-5 z-30 w-72 rounded-md border border-zinc-200 bg-white p-2 text-xs font-normal leading-5 text-zinc-600 opacity-0 shadow-lg transition group-hover/help:opacity-100 group-focus-within/help:opacity-100">
        {text}
      </span>
    </span>
  );
}

function ToggleLine({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700">
      <input
        checked={checked}
        className="h-4 w-4 rounded border-zinc-300"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
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

function SearchAssetPreview({ result }: { result: SearchResult }) {
  const previewUrl = metadataString(result.metadata, "asset_preview_url");
  if (metadataString(result.metadata, "hit_type") !== "image" || !previewUrl) {
    return null;
  }
  const filename = metadataString(result.metadata, "asset_filename") ?? result.title;
  return (
    <div className="mt-3 flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <img
        alt={filename}
        className="h-20 w-28 rounded object-cover"
        loading="lazy"
        src={previewUrl}
      />
      <div className="min-w-0 pt-1 text-xs text-zinc-500">
        <div className="flex items-center gap-1 font-medium text-zinc-700">
          <ImageIcon className="h-3.5 w-3.5" />
          <span className="truncate">{filename}</span>
        </div>
        <p className="mt-1 truncate">{metadataString(result.metadata, "asset_mime_type")}</p>
      </div>
    </div>
  );
}

function SearchHitBadge({ result }: { result: SearchResult }) {
  const hitType = metadataString(result.metadata, "hit_type");
  if (hitType !== "image" && hitType !== "attachment") {
    return null;
  }
  return (
    <Badge tone="emerald">
      <span className="inline-flex items-center gap-1">
        {hitType === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
        {hitType}
      </span>
    </Badge>
  );
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value ? value : null;
}

function encodeDelimiter(value: string): string {
  return value.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function decodeDelimiter(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function formatJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function docFormLabel(docForm: ChunkSettings["doc_form"]) {
  if (docForm === "hierarchical_model") {
    return "Parent-child knowledge base";
  }
  if (docForm === "qa_model") {
    return "QA knowledge base";
  }
  return "Segment knowledge base";
}

function derivedSegmentLayoutLabel(settings: ChunkSettings) {
  if (settings.doc_form === "hierarchical_model") {
    return "Parent and child segments";
  }
  if (settings.doc_form === "qa_model") {
    return "QA pairs as retrieval segments";
  }
  return "Standalone segments";
}

function segmentationModeLabel(
  docForm: ChunkSettings["doc_form"],
  processRuleMode: ChunkSettings["process_rule_mode"]
) {
  if (docForm === "hierarchical_model") {
    return "Hierarchical segmentation";
  }
  if (docForm === "qa_model") {
    return "QA pair indexing";
  }
  return processRuleMode === "automatic" ? "Automatic segmentation" : "Custom segmentation";
}

function updateProcessRuleMode(
  settings: ChunkSettings,
  processRuleMode: ChunkSettings["process_rule_mode"]
): ChunkSettings {
  const allowed = processRuleModeOptions(settings.doc_form).some(
    (option) => option.value === processRuleMode
  );
  const nextMode = allowed ? processRuleMode : processRuleModeOptions(settings.doc_form)[0]!.value;
  return { ...settings, process_rule_mode: nextMode };
}

function updateSegmentationRule(
  settings: ChunkSettings,
  target: "parent" | "child",
  patch: { separator?: string; max_tokens?: number; chunk_overlap?: number }
): ChunkSettings {
  const processRule = buildSettingsProcessRule(settings);
  const key = target === "parent" ? "segmentation" : "subchunk_segmentation";
  const previous = toRecord(processRule[key]);
  const nextProcessRule = {
    ...processRule,
    [key]: {
      ...previous,
      ...patch
    }
  };
  return {
    ...settings,
    ...(target === "parent"
      ? {
          parent_delimiter: stringFrom(patch.separator, settings.parent_delimiter),
          parent_max_characters: numberFrom(patch.max_tokens, settings.parent_max_characters),
          chunk_overlap_characters: numberFrom(
            patch.chunk_overlap,
            getParentOverlapCharacters(settings)
          )
        }
      : {
          child_delimiter: stringFrom(patch.separator, settings.child_delimiter),
          child_max_characters: numberFrom(patch.max_tokens, settings.child_max_characters),
          child_overlap_characters: numberFrom(
            patch.chunk_overlap,
            settings.child_overlap_characters
          )
        }),
    process_rule: nextProcessRule
  };
}

function buildSettingsProcessRule(settings: ChunkSettings): Record<string, unknown> {
  const processRule = toRecord(settings.process_rule);
  const segmentation = toRecord(processRule.segmentation);
  const subchunkSegmentation = toRecord(processRule.subchunk_segmentation);
  return {
    ...processRule,
    parent_mode: toDifyParentMode(settings.parent_mode),
    segmentation: {
      ...segmentation,
      separator: settings.parent_delimiter,
      max_tokens: settings.parent_max_characters,
      chunk_overlap: getParentOverlapCharacters(settings)
    },
    subchunk_segmentation: {
      ...subchunkSegmentation,
      separator: settings.child_delimiter,
      max_tokens: settings.child_max_characters,
      chunk_overlap: settings.child_overlap_characters
    }
  };
}

function processRuleModeOptions(docForm: ChunkSettings["doc_form"]) {
  if (docForm === "hierarchical_model") {
    return [{ value: "hierarchical", label: "Hierarchical segmentation" }] as const;
  }
  return [
    { value: "automatic", label: "Automatic segmentation" },
    { value: "custom", label: "Custom segmentation" }
  ] as const;
}

function getParentOverlapCharacters(settings: ChunkSettings): number {
  if (typeof settings.chunk_overlap_characters === "number") {
    return settings.chunk_overlap_characters;
  }
  const processRule = toRecord(settings.process_rule);
  const segmentation = toRecord(processRule.segmentation);
  return numberFrom(
    segmentation.chunk_overlap,
    settings.doc_form === "hierarchical_model" ? 0 : 50
  );
}

function toDifyParentMode(value: ChunkSettings["parent_mode"]) {
  return value === "full_doc" ? "full-doc" : "paragraph";
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseHybridWeights(value: unknown): { keyword: number; vector: number } {
  if (!value || typeof value !== "object") {
    return { keyword: 0.5, vector: 0.5 };
  }
  const record = value as Record<string, unknown>;
  const keywordSetting = toRecord(record.keyword_setting);
  const vectorSetting = toRecord(record.vector_setting);
  return {
    keyword: normalizeWeight(keywordSetting.keyword_weight, 0.5),
    vector: normalizeWeight(vectorSetting.vector_weight, 0.5)
  };
}

function buildHybridWeights(keyword: number, vector: number) {
  return {
    keyword_setting: { keyword_weight: clampWeight(keyword) },
    vector_setting: { vector_weight: clampWeight(vector) }
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeWeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampWeight(value) : fallback;
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0.01, value));
}

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
  Settings2
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createChunkRebuildJob,
  getChunkSettings,
  getKnowledgeBaseOverview,
  listKnowledgeBaseChunks,
  searchKnowledge,
  updateChunkSettings,
  type ChunkSettings,
  type DocumentChunk,
  type DocumentSummary,
  type KnowledgeBaseOverview,
  type RetrievalContextMode,
  type SearchResponse
} from "@/lib/openkb-api";

type DashboardTab = "overview" | "chunks" | "lab" | "settings";
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
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [overview, setOverview] = useState<KnowledgeBaseOverview | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [settings, setSettings] = useState<ChunkSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [labQuery, setLabQuery] = useState("");
  const [labTopK, setLabTopK] = useState(5);
  const [labContextMode, setLabContextMode] = useState<RetrievalContextMode>("parent_child");
  const [labResponse, setLabResponse] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  );

  useEffect(() => {
    void load();
  }, [knowledgeBaseId]);

  async function load() {
    setIsLoading(true);
    try {
      const [nextOverview, nextSettings, nextChunks] = await Promise.all([
        getKnowledgeBaseOverview(knowledgeBaseId),
        getChunkSettings(knowledgeBaseId),
        listKnowledgeBaseChunks(knowledgeBaseId, { limit: 160 })
      ]);
      setOverview(nextOverview);
      setSettings(nextSettings);
      setChunks(nextChunks);
      setLabContextMode(nextSettings.parent_mode === "full_doc" ? "full_text" : "parent_child");
    } catch (error) {
      onError(error);
    } finally {
      setIsLoading(false);
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
            <Badge tone="zinc">knowledge base</Badge>
            <Badge tone="sky">visibility: {overview?.knowledge_base.visibility}</Badge>
            <Badge tone="emerald">status: {overview?.knowledge_base.status}</Badge>
            {overview?.needs_chunk_rebuild ? <Badge tone="amber">chunks stale</Badge> : null}
            {overview?.needs_index_rebuild ? <Badge tone="sky">index rebuild needed</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white"
            onClick={onCreateDocument}
            type="button"
          >
            <FileText className="h-4 w-4" />
            New doc
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <TabButton
          active={tab === "overview"}
          icon={<BarChart3 />}
          onClick={() => setTab("overview")}
        >
          Overview
        </TabButton>
        <TabButton active={tab === "chunks"} icon={<Layers3 />} onClick={() => setTab("chunks")}>
          Chunks
        </TabButton>
        <TabButton active={tab === "lab"} icon={<Search />} onClick={() => setTab("lab")}>
          Retrieval Lab
        </TabButton>
        <TabButton
          active={tab === "settings"}
          icon={<Settings2 />}
          onClick={() => setTab("settings")}
        >
          Settings
        </TabButton>
      </div>

      {tab === "overview" && overview ? (
        <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<FileText />} label="Documents" value={overview.documents.total} />
          <Metric icon={<CheckCircle2 />} label="Published" value={overview.documents.published} />
          <Metric icon={<Layers3 />} label="Chunks" value={overview.chunks.total} />
          <Metric icon={<Database />} label="Child chunks" value={overview.chunks.child} />
        </section>
      ) : null}

      {tab === "overview" && overview ? (
        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Recent imports">
            <div className="space-y-2">
              {overview.latest_import_jobs.length > 0 ? (
                overview.latest_import_jobs.map((job) => (
                  <Row key={job.id} title={job.title ?? job.converter} meta={job.status} />
                ))
              ) : (
                <EmptyLine>No imports</EmptyLine>
              )}
            </div>
          </Panel>
          <Panel title="Index state">
            <div className="space-y-2">
              <Row
                title="Chunk rebuild"
                meta={overview.latest_chunk_rebuild_job?.status ?? "none"}
              />
              <Row
                title="Milvus rebuild"
                meta={overview.latest_index_rebuild_job?.status ?? "none"}
              />
              <Row title="Settings revision" meta={String(overview.chunk_settings.revision)} />
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "chunks" ? (
        <section className="mt-5">
          <Panel title="Chunk map">
            <div className="max-h-[620px] space-y-2 overflow-y-auto">
              {chunks.length > 0 ? (
                chunks.map((chunk) => (
                  <button
                    key={chunk.id}
                    className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-left hover:border-sky-200 hover:bg-sky-50/40"
                    onClick={() => onOpenDocument(chunk.document_id)}
                    type="button"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <Badge tone={chunk.chunk_type === "parent" ? "emerald" : "zinc"}>
                        {chunk.chunk_type}
                      </Badge>
                      <span>{documentById.get(chunk.document_id)?.title ?? chunk.document_id}</span>
                      <span>#{chunk.ordinal}</span>
                      <span>{chunk.token_count ?? 0} tokens</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-700">{chunk.content_text}</p>
                  </button>
                ))
              ) : (
                <EmptyLine>
                  No chunks yet. Rebuild chunks or save a document to generate searchable chunks.
                </EmptyLine>
              )}
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "lab" ? (
        <section className="mt-5">
          <Panel title="Retrieval Lab">
            <form
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px_auto]"
              onSubmit={runLab}
            >
              <input
                className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
                onChange={(event) => setLabQuery(event.target.value)}
                placeholder="Search this knowledge base"
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
                <option value="chunk">Chunk</option>
                <option value="parent_child">Parent child</option>
                <option value="paragraph_parent_child">Paragraph parent</option>
                <option value="full_text">Full text</option>
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
                Run
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
                      ? `parent ${result.parent_chunk.chunk_id}`
                      : `match ${result.match_chunk?.chunk_id ?? result.chunk_id}`}
                  </p>
                </button>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "settings" && settings ? (
        <section className="mt-5">
          <Panel title="Chunk settings">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Mode">
                <select
                  className={formControlClass}
                  onChange={(event) =>
                    setSettings({ ...settings, mode: event.target.value as ChunkSettings["mode"] })
                  }
                  value={settings.mode}
                >
                  <option value="parent_child">Parent child</option>
                  <option value="general">General</option>
                </select>
              </Field>
              <Field label="Parent mode">
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
                  <option value="paragraph">Paragraph</option>
                  <option value="full_doc">Full doc</option>
                </select>
              </Field>
              <NumberField
                label="Parent chars"
                onChange={(value) => setSettings({ ...settings, parent_max_characters: value })}
                value={settings.parent_max_characters}
              />
              <TextField
                label="Parent delimiter"
                onChange={(value) =>
                  setSettings({ ...settings, parent_delimiter: decodeDelimiter(value) })
                }
                value={encodeDelimiter(settings.parent_delimiter)}
              />
              <NumberField
                label="Child chars"
                onChange={(value) => setSettings({ ...settings, child_max_characters: value })}
                value={settings.child_max_characters}
              />
              <NumberField
                label="Child overlap"
                onChange={(value) => setSettings({ ...settings, child_overlap_characters: value })}
                value={settings.child_overlap_characters}
              />
              <TextField
                label="Child delimiter"
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
                Save settings
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
                Rebuild chunks
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
      className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
        active ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="h-4 w-4">{icon}</span>
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

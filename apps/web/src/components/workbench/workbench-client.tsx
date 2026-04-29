"use client";

import {
  createEditorSavePayload,
  extractMarkdownOutline,
  validateMarkdownSource,
  type MarkdownOutlineItem
} from "@openkb/editor";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { MilkdownEditor } from "@/components/workbench/milkdown-editor";
import {
  ApiRequestError,
  createDocument,
  createKnowledgeBase,
  createWorkspace,
  deleteDocument,
  getDocument,
  getKnowledgeBase,
  getKnowledgeBaseTree,
  getMe,
  isUnauthorized,
  listKnowledgeBases,
  listWorkspaces,
  logout,
  updateDocument,
  updateWorkspace,
  type AuthMe,
  type DocumentDetail,
  type DocumentSummary,
  type KnowledgeBase,
  type Workspace
} from "@/lib/openkb-api";

export type WorkbenchClientProps = {
  initialWorkspaceId?: string;
  initialKnowledgeBaseId?: string;
  initialDocumentId?: string;
};

type EditorMode = "read" | "edit" | "source";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
type TreeNode = DocumentSummary & { children: TreeNode[] };

export function WorkbenchClient({
  initialWorkspaceId,
  initialKnowledgeBaseId,
  initialDocumentId
}: WorkbenchClientProps) {
  const router = useRouter();
  const saveRunRef = useRef(0);
  const latestDraftRef = useRef({ title: "", markdown: "" });
  const [me, setMe] = useState<AuthMe | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [currentDocument, setCurrentDocument] = useState<DocumentDetail | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [savedMarkdown, setSavedMarkdown] = useState("");
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedKnowledgeBase = knowledgeBases.find(
    (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId
  );
  const tree = useMemo(() => buildDocumentTree(documents), [documents]);
  const outline = useMemo(() => extractMarkdownOutline(draftMarkdown), [draftMarkdown]);

  useEffect(() => {
    latestDraftRef.current = { title: draftTitle, markdown: draftMarkdown };
  }, [draftMarkdown, draftTitle]);

  const handleApiError = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        router.replace("/login");
        return;
      }
      if (error instanceof ApiRequestError) {
        setMessage(error.body.message || error.body.error || "Request failed.");
        return;
      }
      setMessage(error instanceof Error ? error.message : "Unexpected error.");
    },
    [router]
  );

  const clearDocumentState = useCallback(() => {
    setCurrentDocument(null);
    setDraftTitle("");
    setSavedTitle("");
    setDraftMarkdown("");
    setSavedMarkdown("");
    setBaseVersionId(null);
    setSaveState("idle");
    setEditorResetKey((key) => key + 1);
  }, []);

  const openDocument = useCallback(async (documentId: string) => {
    const document = await getDocument(documentId);
    setCurrentDocument(document);
    setDraftTitle(document.title);
    setSavedTitle(document.title);
    setDraftMarkdown(document.currentVersion?.markdown ?? "");
    setSavedMarkdown(document.currentVersion?.markdown ?? "");
    setBaseVersionId(document.currentVersion?.id ?? null);
    setSaveState("idle");
    setMessage("");
    setEditorResetKey((key) => key + 1);
    return document;
  }, []);

  const loadKnowledgeBase = useCallback(
    async (knowledgeBaseId: string, preferredDocumentId?: string) => {
      const [knowledgeBase, treeDocuments] = await Promise.all([
        getKnowledgeBase(knowledgeBaseId),
        getKnowledgeBaseTree(knowledgeBaseId)
      ]);
      setSelectedKnowledgeBaseId(knowledgeBase.id);
      setKnowledgeBases((items) =>
        items.some((item) => item.id === knowledgeBase.id) ? items : [knowledgeBase, ...items]
      );
      setDocuments(treeDocuments);

      const targetDocument =
        treeDocuments.find((document) => document.id === preferredDocumentId) ??
        treeDocuments.find((document) => document.type === "page") ??
        treeDocuments[0] ??
        null;

      if (targetDocument) {
        await openDocument(targetDocument.id);
      } else {
        clearDocumentState();
      }
    },
    [clearDocumentState, openDocument]
  );

  const boot = useCallback(async () => {
    setIsBooting(true);
    setMessage("");

    try {
      const [nextMe, nextWorkspaces] = await Promise.all([getMe(), listWorkspaces()]);
      setMe(nextMe);
      setWorkspaces(nextWorkspaces);

      const workspace =
        nextWorkspaces.find((item) => item.id === initialWorkspaceId) ?? nextWorkspaces[0] ?? null;
      setSelectedWorkspaceId(workspace?.id ?? null);

      if (!workspace) {
        setKnowledgeBases([]);
        setDocuments([]);
        clearDocumentState();
        return;
      }

      const nextKnowledgeBases = await listKnowledgeBases(workspace.id);
      setKnowledgeBases(nextKnowledgeBases);
      const knowledgeBase =
        nextKnowledgeBases.find((item) => item.id === initialKnowledgeBaseId) ??
        nextKnowledgeBases[0] ??
        null;

      if (knowledgeBase) {
        await loadKnowledgeBase(knowledgeBase.id, initialDocumentId);
      } else {
        setSelectedKnowledgeBaseId(null);
        setDocuments([]);
        clearDocumentState();
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBooting(false);
    }
  }, [
    handleApiError,
    clearDocumentState,
    initialDocumentId,
    initialKnowledgeBaseId,
    initialWorkspaceId,
    loadKnowledgeBase
  ]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const persistDraft = useCallback(async () => {
    if (!currentDocument || saveState === "conflict") {
      return;
    }
    const isPage = currentDocument.type === "page";
    const nextTitle = draftTitle.trim();
    const nextMarkdown = draftMarkdown;
    const titleChanged = nextTitle !== savedTitle;
    const markdownChanged = isPage && draftMarkdown !== savedMarkdown;
    if (!titleChanged && !markdownChanged) {
      return;
    }
    if (!nextTitle) {
      setSaveState("error");
      setMessage("Title is required.");
      return;
    }

    const runId = saveRunRef.current + 1;
    saveRunRef.current = runId;
    setSaveState("saving");
    setMessage("");

    try {
      if (isPage) {
        const validation = validateMarkdownSource(draftMarkdown);
        if (!validation.ok) {
          const firstIssue = validation.issues[0];
          setSaveState("error");
          setMessage(
            firstIssue
              ? `${firstIssue.message} Line ${firstIssue.line}.`
              : "Markdown source is invalid."
          );
          return;
        }
      }

      const payload = isPage
        ? await createEditorSavePayload({
            document_id: currentDocument.id,
            base_version_id: baseVersionId,
            title: nextTitle,
            markdown: nextMarkdown
          })
        : null;
      const updated = await updateDocument(currentDocument.id, {
        title: nextTitle,
        ...(payload
          ? {
              markdown: payload.markdown,
              markdown_hash: payload.markdown_hash,
              base_version_id: payload.base_version_id
            }
          : {})
      });

      if (saveRunRef.current !== runId) {
        return;
      }

      setCurrentDocument(updated);
      setSavedTitle(updated.title);
      setSavedMarkdown(updated.currentVersion?.markdown ?? "");
      setBaseVersionId(updated.currentVersion?.id ?? null);
      setDocuments((items) => updateDocumentInList(items, updated));

      const latestDraft = latestDraftRef.current;
      const titleStillCurrent = latestDraft.title.trim() === nextTitle;
      const markdownStillCurrent = latestDraft.markdown === nextMarkdown;
      if (titleStillCurrent) {
        setDraftTitle(updated.title);
      }
      if (markdownStillCurrent) {
        setDraftMarkdown(updated.currentVersion?.markdown ?? "");
      }
      setSaveState(titleStillCurrent && markdownStillCurrent ? "saved" : "dirty");
    } catch (error) {
      if (error instanceof ApiRequestError && error.body.error === "VERSION_CONFLICT") {
        setSaveState("conflict");
        setMessage("This document changed elsewhere. Your draft is still here.");
        return;
      }
      setSaveState("error");
      handleApiError(error);
    }
  }, [
    baseVersionId,
    currentDocument,
    draftMarkdown,
    draftTitle,
    handleApiError,
    saveState,
    savedMarkdown,
    savedTitle
  ]);

  useEffect(() => {
    if (!currentDocument || saveState === "conflict") {
      return;
    }

    const isPage = currentDocument.type === "page";
    const dirty = draftTitle.trim() !== savedTitle || (isPage && draftMarkdown !== savedMarkdown);
    if (!dirty) {
      return;
    }

    setSaveState("dirty");
    const timer = window.setTimeout(() => {
      void persistDraft();
    }, 1100);

    return () => window.clearTimeout(timer);
  }, [
    currentDocument,
    draftMarkdown,
    draftTitle,
    persistDraft,
    saveState,
    savedMarkdown,
    savedTitle
  ]);

  async function selectWorkspace(workspaceId: string) {
    setIsBusy(true);
    setMessage("");
    try {
      setSelectedWorkspaceId(workspaceId);
      const nextKnowledgeBases = await listKnowledgeBases(workspaceId);
      setKnowledgeBases(nextKnowledgeBases);
      const firstKnowledgeBase = nextKnowledgeBases[0] ?? null;
      if (firstKnowledgeBase) {
        router.push(`/app/kb/${firstKnowledgeBase.id}`);
        await loadKnowledgeBase(firstKnowledgeBase.id);
      } else {
        router.push(`/app/workspaces/${workspaceId}`);
        setSelectedKnowledgeBaseId(null);
        setDocuments([]);
        clearDocumentState();
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function selectKnowledgeBase(knowledgeBaseId: string) {
    setIsBusy(true);
    setMessage("");
    try {
      router.push(`/app/kb/${knowledgeBaseId}`);
      await loadKnowledgeBase(knowledgeBaseId);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function selectDocument(documentId: string) {
    setIsBusy(true);
    setMessage("");
    try {
      const document = await openDocument(documentId);
      router.push(`/app/kb/${document.knowledge_base_id}/docs/${document.id}`);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateWorkspace() {
    const name = window.prompt("Workspace name");
    if (!name?.trim()) {
      return;
    }

    setIsBusy(true);
    try {
      const workspace = await createWorkspace({
        name: name.trim(),
        slug: slugFromTitle(name, "workspace")
      });
      setWorkspaces((items) => [...items, workspace]);
      await selectWorkspace(workspace.id);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!selectedWorkspace) {
      return;
    }
    const name = window.prompt("Workspace name", selectedWorkspace.name);
    if (!name?.trim() || name.trim() === selectedWorkspace.name) {
      return;
    }

    setIsBusy(true);
    try {
      const workspace = await updateWorkspace(selectedWorkspace.id, { name: name.trim() });
      setWorkspaces((items) =>
        items.map((item) => (item.id === workspace.id ? { ...item, ...workspace } : item))
      );
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateKnowledgeBase() {
    if (!selectedWorkspaceId) {
      return;
    }
    const title = window.prompt("Knowledge base title");
    if (!title?.trim()) {
      return;
    }

    setIsBusy(true);
    try {
      const knowledgeBase = await createKnowledgeBase({
        workspace_id: selectedWorkspaceId,
        title: title.trim(),
        slug: slugFromTitle(title, "kb"),
        visibility: "workspace"
      });
      setKnowledgeBases((items) => [...items, knowledgeBase]);
      router.push(`/app/kb/${knowledgeBase.id}`);
      await loadKnowledgeBase(knowledgeBase.id);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateDocument(type: "folder" | "page") {
    if (!selectedKnowledgeBaseId) {
      return;
    }
    const title = window.prompt(type === "folder" ? "Folder title" : "Document title");
    if (!title?.trim()) {
      return;
    }

    const parentId = currentDocument?.type === "folder" ? currentDocument.id : null;
    setIsBusy(true);
    try {
      const document = await createDocument({
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: parentId,
        type,
        title: title.trim(),
        slug: slugFromTitle(title, type),
        markdown: type === "page" ? `# ${title.trim()}\n` : ""
      });
      const nextTree = await getKnowledgeBaseTree(selectedKnowledgeBaseId);
      setDocuments(nextTree);
      await openDocument(document.id);
      router.push(`/app/kb/${selectedKnowledgeBaseId}/docs/${document.id}`);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteDocument() {
    if (!currentDocument) {
      return;
    }
    if (!window.confirm(`Delete "${currentDocument.title}"?`)) {
      return;
    }

    setIsBusy(true);
    try {
      await deleteDocument(currentDocument.id);
      const nextTree = selectedKnowledgeBaseId
        ? await getKnowledgeBaseTree(selectedKnowledgeBaseId)
        : [];
      setDocuments(nextTree);
      const nextDocument = nextTree.find((document) => document.type === "page") ?? nextTree[0];
      if (nextDocument) {
        await openDocument(nextDocument.id);
        router.push(`/app/kb/${nextDocument.knowledge_base_id}/docs/${nextDocument.id}`);
      } else {
        clearDocumentState();
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  async function reloadCurrentDocument() {
    if (!currentDocument) {
      return;
    }
    try {
      await openDocument(currentDocument.id);
    } catch (error) {
      handleApiError(error);
    }
  }

  const statusText = saveStatusText(saveState);

  return (
    <main className="flex min-h-screen bg-zinc-50 text-zinc-950">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white">
            OK
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">OpenKB</p>
            <p className="truncate text-xs text-zinc-500">{me?.user.email ?? "Loading"}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <PanelHeader title="Workspaces" onAdd={handleCreateWorkspace} disabled={isBusy} />
          <div className="space-y-1">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                className={navButtonClass(workspace.id === selectedWorkspaceId)}
                onClick={() => void selectWorkspace(workspace.id)}
                type="button"
              >
                <BookOpen className="h-4 w-4" />
                <span className="truncate">{workspace.name}</span>
              </button>
            ))}
          </div>

          <div className="mt-6">
            <PanelHeader
              title="Knowledge Bases"
              onAdd={handleCreateKnowledgeBase}
              disabled={isBusy}
            />
            <div className="space-y-1">
              {knowledgeBases.map((knowledgeBase) => (
                <button
                  key={knowledgeBase.id}
                  className={navButtonClass(knowledgeBase.id === selectedKnowledgeBaseId)}
                  onClick={() => void selectKnowledgeBase(knowledgeBase.id)}
                  type="button"
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="truncate">{knowledgeBase.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white md:hidden">
              OK
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {selectedWorkspace?.name ?? "OpenKB Workspace"}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {selectedKnowledgeBase?.title ?? "No knowledge base selected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="icon-button" title="Search" type="button">
              <Search className="h-4 w-4" />
            </button>
            <button className="icon-button" title="Collaborators" type="button">
              <Users className="h-4 w-4" />
            </button>
            <button className="icon-button" title="Share" type="button">
              <Share2 className="h-4 w-4" />
            </button>
            <button
              className="icon-button"
              onClick={() => void handleLogout()}
              title="Log out"
              type="button"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {isBooting ? (
          <LoadingState />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_240px]">
            <aside className="min-h-0 border-b border-zinc-200 bg-zinc-50/70 lg:border-b-0 lg:border-r">
              <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Documents</p>
                  <p className="truncate text-xs text-zinc-500">{documents.length} items</p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="icon-button"
                    disabled={!selectedKnowledgeBaseId || isBusy}
                    onClick={() => void handleCreateDocument("folder")}
                    title="New folder"
                    type="button"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!selectedKnowledgeBaseId || isBusy}
                    onClick={() => void handleCreateDocument("page")}
                    title="New document"
                    type="button"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto px-2 py-3 lg:max-h-none">
                {tree.length > 0 ? (
                  tree.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      activeId={currentDocument?.id ?? null}
                      collapsedFolders={collapsedFolders}
                      onToggle={(id) => {
                        setCollapsedFolders((items) => toggleSet(items, id));
                      }}
                      onSelect={(id) => void selectDocument(id)}
                    />
                  ))
                ) : (
                  <EmptyPanel title="No documents" action="Create a page or folder to start." />
                )}
              </div>
            </aside>

            <article className="min-w-0 bg-white">
              {currentDocument ? (
                <div className="flex h-full min-h-[680px] flex-col">
                  <div className="border-b border-zinc-200 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeButton active={mode === "read"} onClick={() => setMode("read")}>
                        Read
                      </ModeButton>
                      <ModeButton active={mode === "edit"} onClick={() => setMode("edit")}>
                        Edit
                      </ModeButton>
                      <ModeButton active={mode === "source"} onClick={() => setMode("source")}>
                        Source
                      </ModeButton>
                      <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                        <span className={saveStateClass(saveState)}>{statusText}</span>
                        <button
                          className="icon-button"
                          disabled={saveState === "saving"}
                          onClick={() => void persistDraft()}
                          title="Save now"
                          type="button"
                        >
                          {saveState === "saving" ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => void handleDeleteDocument()}
                          title="Delete document"
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <input
                      className="mt-4 w-full border-none bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-zinc-300"
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder="Untitled"
                      value={draftTitle}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>{currentDocument.type}</span>
                      <span>Version {currentDocument.currentVersion?.version_no ?? 0}</span>
                      <span>{currentDocument.role ?? "viewer"}</span>
                    </div>
                  </div>

                  {saveState === "conflict" ? (
                    <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span>{message}</span>
                      <button
                        className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white"
                        onClick={() => void reloadCurrentDocument()}
                        type="button"
                      >
                        Load server version
                      </button>
                    </div>
                  ) : message ? (
                    <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {message}
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1 px-5 py-5">
                    {currentDocument.type === "folder" ? (
                      <EmptyPanel
                        title="Folder selected"
                        action="Create or select a page inside the tree."
                      />
                    ) : mode === "source" ? (
                      <textarea
                        className="h-full min-h-[520px] w-full resize-none rounded-md border border-zinc-200 bg-zinc-950 p-4 font-mono text-sm leading-6 text-zinc-50 outline-none focus:border-emerald-500"
                        onChange={(event) => setDraftMarkdown(event.target.value)}
                        spellCheck={false}
                        value={draftMarkdown}
                      />
                    ) : (
                      <div className="openkb-milkdown-shell">
                        <MilkdownEditor
                          key={`${currentDocument.id}:${mode}:${editorResetKey}`}
                          editable={mode === "edit"}
                          markdown={draftMarkdown}
                          onChange={setDraftMarkdown}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyMain
                  hasKnowledgeBase={Boolean(selectedKnowledgeBaseId)}
                  onCreate={() => void handleCreateDocument("page")}
                />
              )}
            </article>

            <aside className="hidden min-h-0 border-l border-zinc-200 bg-zinc-50/70 xl:block">
              <div className="border-b border-zinc-200 px-4 py-3">
                <p className="text-sm font-semibold">Outline</p>
                <p className="text-xs text-zinc-500">{outline.length} headings</p>
              </div>
              <Outline items={outline} />
              <div className="border-t border-zinc-200 px-4 py-4">
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => void handleRenameWorkspace()}
                  type="button"
                >
                  <Pencil className="h-4 w-4" />
                  Rename workspace
                </button>
              </div>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

function PanelHeader({
  title,
  onAdd,
  disabled
}: {
  title: string;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <p className="text-xs font-semibold uppercase text-zinc-500">{title}</p>
      <button
        className="icon-button h-7 w-7"
        disabled={disabled}
        onClick={() => onAdd()}
        title={`Add ${title.toLowerCase()}`}
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function TreeItem({
  node,
  activeId,
  collapsedFolders,
  onToggle,
  onSelect,
  depth = 0
}: {
  node: TreeNode;
  activeId: string | null;
  collapsedFolders: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const isFolder = node.type === "folder";
  const collapsed = collapsedFolders.has(node.id);

  return (
    <div>
      <div className="flex items-center">
        <button
          className={treeButtonClass(node.id === activeId)}
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          type="button"
        >
          {isFolder ? (
            <span
              className="mr-1 flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.id);
              }}
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          ) : (
            <span className="mr-1 h-5 w-5" />
          )}
          {isFolder ? <Folder className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          <span className="truncate">{node.title}</span>
        </button>
      </div>
      {isFolder && !collapsed
        ? node.children.map((child) => (
            <TreeItem
              key={child.id}
              activeId={activeId}
              collapsedFolders={collapsedFolders}
              depth={depth + 1}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}

function Outline({ items }: { items: MarkdownOutlineItem[] }) {
  if (items.length === 0) {
    return <EmptyPanel title="No outline" action="Add headings to this page." />;
  }

  return (
    <div className="space-y-1 px-3 py-3">
      {items.map((item) => (
        <div
          key={`${item.id}:${item.line}`}
          className="truncate rounded-md px-2 py-1 text-xs text-zinc-600"
          style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
          title={item.title}
        >
          {item.title}
        </div>
      ))}
    </div>
  );
}

function ModeButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyMain({
  hasKnowledgeBase,
  onCreate
}: {
  hasKnowledgeBase: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex min-h-[680px] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <FileText className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">
          {hasKnowledgeBase ? "No document selected" : "No knowledge base yet"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {hasKnowledgeBase
            ? "Create a page from the document tree."
            : "Create a workspace and knowledge base from the left rail."}
        </p>
        {hasKnowledgeBase ? (
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={onCreate}
            type="button"
          >
            <Plus className="h-4 w-4" />
            New document
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyPanel({ title, action }: { title: string; action: string }) {
  return (
    <div className="px-3 py-8 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      <p className="mt-1 text-xs text-zinc-500">{action}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 shadow-sm">
        <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
        Loading workspace
      </div>
    </div>
  );
}

function buildDocumentTree(documents: DocumentSummary[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const document of documents) {
    nodes.set(document.id, { ...document, children: [] });
  }

  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (items: TreeNode[]) => {
    items.sort(
      (left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title)
    );
    items.forEach((item) => sort(item.children));
  };
  sort(roots);

  return roots;
}

function updateDocumentInList(
  documents: DocumentSummary[],
  updated: DocumentDetail
): DocumentSummary[] {
  return documents.map((document) =>
    document.id === updated.id
      ? {
          ...document,
          title: updated.title,
          current_version_id: updated.current_version_id,
          updated_at: updated.updated_at
        }
      : document
  );
}

function toggleSet(items: Set<string>, id: string): Set<string> {
  const next = new Set(items);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function navButtonClass(active: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
    active ? "bg-sky-50 text-sky-800" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
  }`;
}

function treeButtonClass(active: boolean): string {
  return `flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition ${
    active ? "bg-sky-50 text-sky-800" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
  }`;
}

function saveStatusText(state: SaveState): string {
  switch (state) {
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "conflict":
      return "Conflict";
    case "error":
      return "Needs attention";
    default:
      return "Ready";
  }
}

function saveStateClass(state: SaveState): string {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-1";
  if (state === "saved") {
    return `${base} bg-emerald-50 text-emerald-700`;
  }
  if (state === "conflict") {
    return `${base} bg-amber-50 text-amber-800`;
  }
  if (state === "error") {
    return `${base} bg-red-50 text-red-700`;
  }
  return `${base} bg-zinc-100 text-zinc-600`;
}

function slugFromTitle(title: string, fallback: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${fallback}-${Date.now()}`;
}

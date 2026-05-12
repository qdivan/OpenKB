"use client";

import {
  clearBasicMarkdownFormatting,
  createAssetLinkMarkdown,
  createAssetImageMarkdown,
  createEditorSavePayload,
  createMarkdownDateText,
  extractMarkdownReferences,
  extractMarkdownOutline,
  normalizeMarkdownSource,
  prepareMarkdownForMilkdown,
  replaceMarkdownText,
  restoreMarkdownFromMilkdown,
  validateMarkdownSource,
  type MarkdownOutlineItem,
  type MarkdownReferenceExtraction
} from "@openkb/editor";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock3,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  ImageIcon,
  Info,
  Link2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Share2,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  XCircle
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type LazyExoticComponent,
  type MouseEvent,
  type ReactNode,
  type RefAttributes
} from "react";
import { useRouter } from "next/navigation";

import { useDialog } from "@/components/dialog-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { KnowledgeBaseDashboard } from "@/components/workbench/knowledge-base-dashboard";
import { AccessPanel, type AccessTarget } from "@/components/workbench/access-panel";
import { EditorToolbar, type EditorToolbarAction } from "@/components/workbench/editor-toolbar";
import { SharePanel } from "@/components/workbench/share-panel";
import type {
  MilkdownCommandBridge,
  MilkdownEditorProps
} from "@/components/workbench/milkdown-editor";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  createDocument,
  createImportJob,
  createKnowledgeBase,
  createWorkspace,
  deleteDocument,
  getDocument,
  getImportJob,
  getKnowledgeBase,
  getKnowledgeBaseTree,
  getDocumentVersion,
  getMe,
  isUnauthorized,
  listDocumentVersions,
  listKnowledgeBaseChunks,
  listKnowledgeBases,
  listImportJobs,
  listWorkspaces,
  logout,
  publishDocument,
  restoreDocumentVersion,
  updateDocument,
  updateWorkspace,
  unpublishDocument,
  uploadFile,
  type AuthMe,
  type AccessObjectType,
  type DocumentDetail,
  type DocumentChunk,
  type DocumentSummary,
  type DocumentVersion,
  type DocumentVersionSummary,
  type ImportJob,
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
type DocumentSideTab = "outline" | "chunks" | "versions";
type TreeNode = DocumentSummary & { children: TreeNode[] };
type TreeDropPosition = "before" | "inside" | "after";
type DocumentMoveUpdate = {
  id: string;
  parent_id: string | null;
  sort_order: number;
};

const LazyMilkdownEditor = lazy(async () => {
  const module = await import("@/components/workbench/milkdown-editor");
  return { default: module.MilkdownEditor };
}) as LazyExoticComponent<
  ForwardRefExoticComponent<MilkdownEditorProps & RefAttributes<MilkdownCommandBridge>>
>;

function pushWorkbenchUrl(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath === path) {
    return;
  }

  // Workbench content switches have already loaded the target state locally.
  // Updating history directly keeps shareable URLs without remounting the whole workbench.
  window.history.pushState({ openkbWorkbench: true }, "", path);
}

export function WorkbenchClient({
  initialWorkspaceId,
  initialKnowledgeBaseId,
  initialDocumentId
}: WorkbenchClientProps) {
  const { t } = useI18n();
  const dialog = useDialog();
  const router = useRouter();
  const saveRunRef = useRef(0);
  const latestDraftRef = useRef({ title: "", markdown: "" });
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const milkdownEditorRef = useRef<MilkdownCommandBridge | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentFileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [draggingDocumentId, setDraggingDocumentId] = useState<string | null>(null);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findReplaceMatchCase, setFindReplaceMatchCase] = useState(false);
  const [activeWorkbenchPanel, setActiveWorkbenchPanel] = useState<"access" | "share" | null>(null);
  const [documentSideTab, setDocumentSideTab] = useState<DocumentSideTab>("outline");
  const [documentChunks, setDocumentChunks] = useState<DocumentChunk[]>([]);
  const [documentChunksLoading, setDocumentChunksLoading] = useState(false);
  const [documentVersions, setDocumentVersions] = useState<DocumentVersionSummary[]>([]);
  const [documentVersionsLoading, setDocumentVersionsLoading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [selectedVersionLoading, setSelectedVersionLoading] = useState(false);
  const [documentSideRefreshKey, setDocumentSideRefreshKey] = useState(0);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedKnowledgeBase = knowledgeBases.find(
    (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId
  );
  const tree = useMemo(() => buildDocumentTree(documents), [documents]);
  const hasActiveImportJobs = importJobs.some(
    (job) => job.status === "pending" || job.status === "running"
  );
  const outline = useMemo(() => extractMarkdownOutline(draftMarkdown), [draftMarkdown]);
  const markdownReferences = useMemo(
    () => extractMarkdownReferences(draftMarkdown),
    [draftMarkdown]
  );
  const milkdownMarkdown = useMemo(
    () => prepareMarkdownForMilkdown(draftMarkdown),
    [draftMarkdown]
  );
  const hasUnsavedChanges =
    Boolean(currentDocument) &&
    (saveState === "conflict" ||
      draftTitle.trim() !== savedTitle ||
      (currentDocument?.type === "page" &&
        normalizeMarkdownSource(draftMarkdown) !== savedMarkdown));
  const canEditCurrentDocument = currentDocument
    ? canEditDocumentRole(currentDocument.role)
    : false;
  const accessTargets = useMemo(
    () => buildAccessTargets(selectedWorkspace, selectedKnowledgeBase, currentDocument, t),
    [currentDocument, selectedKnowledgeBase, selectedWorkspace, t]
  );
  const defaultAccessTargetType: AccessObjectType = currentDocument
    ? "document"
    : selectedKnowledgeBase
      ? "knowledge_base"
      : "workspace";

  useEffect(() => {
    latestDraftRef.current = { title: draftTitle, markdown: draftMarkdown };
  }, [draftMarkdown, draftTitle]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    // Browsers only allow native beforeunload prompts for tab close/refresh.
    // All in-app navigation confirmations use the OpenKB DialogProvider instead.
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (currentDocument && !canEditCurrentDocument && mode !== "read") {
      setMode("read");
    }
  }, [canEditCurrentDocument, currentDocument, mode]);

  useEffect(() => {
    setDocumentChunks([]);
    setDocumentVersions([]);
    setSelectedVersion(null);
    setSelectedVersionId(null);
  }, [currentDocument?.id]);

  useEffect(() => {
    if (documentSideTab !== "chunks" || !currentDocument || !selectedKnowledgeBaseId) {
      return;
    }

    let cancelled = false;
    setDocumentChunksLoading(true);
    listKnowledgeBaseChunks(selectedKnowledgeBaseId, {
      document_id: currentDocument.id,
      limit: 200
    })
      .then((chunks) => {
        if (!cancelled) {
          setDocumentChunks(chunks);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentChunksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideRefreshKey, documentSideTab, selectedKnowledgeBaseId]);

  useEffect(() => {
    if (documentSideTab !== "versions" || !currentDocument) {
      return;
    }

    let cancelled = false;
    setDocumentVersionsLoading(true);
    listDocumentVersions(currentDocument.id)
      .then((versions) => {
        if (cancelled) {
          return;
        }
        setDocumentVersions(versions);
        setSelectedVersionId((current) => {
          if (current && versions.some((version) => version.id === current)) {
            return current;
          }
          return versions.find((version) => version.is_current)?.id ?? versions[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentVersionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideRefreshKey, documentSideTab]);

  useEffect(() => {
    if (documentSideTab !== "versions" || !currentDocument || !selectedVersionId) {
      setSelectedVersion(null);
      return;
    }

    let cancelled = false;
    setSelectedVersionLoading(true);
    getDocumentVersion(currentDocument.id, selectedVersionId)
      .then((version) => {
        if (!cancelled) {
          setSelectedVersion(version);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedVersionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideTab, selectedVersionId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const headings = Array.from(
        editorPaneRef.current?.querySelectorAll<HTMLHeadingElement>(
          ".milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6"
        ) ?? []
      );

      headings.forEach((heading, index) => {
        const item = outline[index];
        if (!item) {
          return;
        }
        heading.id = `openkb-heading-${item.id}`;
        heading.dataset.outlineId = item.id;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [draftMarkdown, editorResetKey, mode, outline]);

  useEffect(() => {
    if (outline.length === 0) {
      setActiveOutlineId(null);
      return;
    }

    let frame = 0;
    const updateActiveHeading = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const headings = Array.from(
          editorPaneRef.current?.querySelectorAll<HTMLHeadingElement>("[data-outline-id]") ?? []
        );
        const active =
          headings
            .map((heading) => ({
              id: heading.dataset.outlineId ?? "",
              top: heading.getBoundingClientRect().top
            }))
            .filter((item) => item.top <= 112)
            .at(-1)?.id ??
          outline[0]?.id ??
          null;

        setActiveOutlineId(active);
      });
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [outline]);

  const handleApiError = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        router.replace("/login");
        return;
      }
      if (error instanceof ApiRequestError) {
        setMessage(error.body.message || error.body.error || t("Request failed."));
        return;
      }
      setMessage(error instanceof Error ? error.message : t("Unexpected error."));
    },
    [router, t]
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

  const confirmDiscardDraft = useCallback(async () => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return dialog.requestConfirmation({
      title: t("Unsaved changes"),
      description: t("You have unsaved changes. Leave this document anyway?"),
      confirmLabel: t("Leave"),
      tone: "danger"
    });
  }, [dialog, hasUnsavedChanges, t]);

  const openDocument = useCallback(async (documentId: string) => {
    const document = await getDocument(documentId);
    setCurrentDocument(document);
    setDraftTitle(document.title);
    setSavedTitle(document.title);
    setDraftMarkdown(document.currentVersion?.markdown ?? "");
    setSavedMarkdown(document.currentVersion?.markdown ?? "");
    setBaseVersionId(document.currentVersion?.id ?? null);
    setMode(canEditDocumentRole(document.role) ? "edit" : "read");
    setSaveState("idle");
    setMessage("");
    setEditorResetKey((key) => key + 1);
    return document;
  }, []);

  const loadKnowledgeBase = useCallback(
    async (knowledgeBaseId: string, preferredDocumentId?: string) => {
      const [knowledgeBase, treeDocuments, jobs] = await Promise.all([
        getKnowledgeBase(knowledgeBaseId),
        getKnowledgeBaseTree(knowledgeBaseId),
        listImportJobs(knowledgeBaseId)
      ]);
      setSelectedKnowledgeBaseId(knowledgeBase.id);
      setKnowledgeBases((items) =>
        items.some((item) => item.id === knowledgeBase.id) ? items : [knowledgeBase, ...items]
      );
      setDocuments(treeDocuments);
      setImportJobs(jobs);

      const targetDocument = preferredDocumentId
        ? (treeDocuments.find((document) => document.id === preferredDocumentId) ?? null)
        : null;

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
      const [nextMe, nextWorkspaces, requestedKnowledgeBase] = await Promise.all([
        getMe(),
        listWorkspaces(),
        initialKnowledgeBaseId ? getKnowledgeBase(initialKnowledgeBaseId) : Promise.resolve(null)
      ]);
      setMe(nextMe);
      setWorkspaces(nextWorkspaces);

      const workspace =
        (requestedKnowledgeBase
          ? (nextWorkspaces.find((item) => item.id === requestedKnowledgeBase.workspace_id) ?? null)
          : null) ??
        nextWorkspaces.find((item) => item.id === initialWorkspaceId) ??
        nextWorkspaces[0] ??
        null;
      setSelectedWorkspaceId(workspace?.id ?? null);

      if (!workspace) {
        setKnowledgeBases(requestedKnowledgeBase ? [requestedKnowledgeBase] : []);
        if (requestedKnowledgeBase) {
          await loadKnowledgeBase(requestedKnowledgeBase.id, initialDocumentId);
        } else {
          setDocuments([]);
          setImportJobs([]);
          clearDocumentState();
        }
        return;
      }

      const nextKnowledgeBases = await listKnowledgeBases(workspace.id);
      const visibleKnowledgeBases =
        requestedKnowledgeBase &&
        !nextKnowledgeBases.some((item) => item.id === requestedKnowledgeBase.id)
          ? [requestedKnowledgeBase, ...nextKnowledgeBases]
          : nextKnowledgeBases;
      setKnowledgeBases(visibleKnowledgeBases);
      const knowledgeBase =
        requestedKnowledgeBase ??
        visibleKnowledgeBases.find((item) => item.id === initialKnowledgeBaseId) ??
        visibleKnowledgeBases[0] ??
        null;

      if (knowledgeBase) {
        await loadKnowledgeBase(knowledgeBase.id, initialDocumentId);
      } else {
        setSelectedKnowledgeBaseId(null);
        setDocuments([]);
        setImportJobs([]);
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
    if (!currentDocument || saveState === "conflict" || saveState === "saving") {
      return;
    }
    const isPage = currentDocument.type === "page";
    const nextTitle = draftTitle.trim();
    const nextMarkdown = normalizeMarkdownSource(draftMarkdown);
    const titleChanged = nextTitle !== savedTitle;
    const markdownChanged = isPage && nextMarkdown !== savedMarkdown;
    if (!titleChanged && !markdownChanged) {
      return;
    }
    if (!nextTitle) {
      setSaveState("error");
      setMessage(t("Title is required."));
      return;
    }

    const runId = saveRunRef.current + 1;
    saveRunRef.current = runId;
    setSaveState("saving");
    setMessage("");

    try {
      if (isPage) {
        const validation = validateMarkdownSource(nextMarkdown);
        if (!validation.ok) {
          const firstIssue = validation.issues[0];
          setSaveState("error");
          setMessage(
            firstIssue
              ? t("{message} Line {line}.", { message: firstIssue.message, line: firstIssue.line })
              : t("Markdown source is invalid.")
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
        setMessage(t("This document changed elsewhere. Your draft is still here."));
        return;
      }
      if (error instanceof ApiRequestError && error.body.error === "MARKDOWN_DIALECT_ERROR") {
        setSaveState("error");
        setMessage(describeMarkdownDialectError(error.body.details));
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
    savedTitle,
    t
  ]);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      if (canEditCurrentDocument && currentDocument) {
        void persistDraft();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [canEditCurrentDocument, currentDocument, persistDraft]);

  useEffect(() => {
    if (!currentDocument || saveState === "conflict" || saveState === "saving") {
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

  useEffect(() => {
    if (!selectedKnowledgeBaseId || !hasActiveImportJobs) {
      return;
    }

    let cancelled = false;
    const refreshJobs = async () => {
      try {
        const jobs = await listImportJobs(selectedKnowledgeBaseId);
        if (cancelled) {
          return;
        }
        setImportJobs(jobs);
        if (jobs.some((job) => job.status === "succeeded" && job.document_id)) {
          setDocuments(await getKnowledgeBaseTree(selectedKnowledgeBaseId));
        }
      } catch (error) {
        if (!cancelled) {
          handleApiError(error);
        }
      }
    };

    const timer = window.setInterval(() => void refreshJobs(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [handleApiError, hasActiveImportJobs, selectedKnowledgeBaseId]);

  async function selectWorkspace(workspaceId: string) {
    if (workspaceId === selectedWorkspaceId) {
      return;
    }
    if (!(await confirmDiscardDraft())) {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      setSelectedWorkspaceId(workspaceId);
      const nextKnowledgeBases = await listKnowledgeBases(workspaceId);
      setKnowledgeBases(nextKnowledgeBases);
      const firstKnowledgeBase = nextKnowledgeBases[0] ?? null;
      if (firstKnowledgeBase) {
        pushWorkbenchUrl(`/app/kb/${firstKnowledgeBase.id}`);
        await loadKnowledgeBase(firstKnowledgeBase.id);
      } else {
        pushWorkbenchUrl(`/app/workspaces/${workspaceId}`);
        setSelectedKnowledgeBaseId(null);
        setDocuments([]);
        setImportJobs([]);
        clearDocumentState();
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function selectKnowledgeBase(knowledgeBaseId: string) {
    if (knowledgeBaseId === selectedKnowledgeBaseId) {
      if (!currentDocument) {
        return;
      }
      if (!(await confirmDiscardDraft())) {
        return;
      }
      setIsBusy(true);
      setMessage("");
      try {
        pushWorkbenchUrl(`/app/kb/${knowledgeBaseId}`);
        clearDocumentState();
      } finally {
        setIsBusy(false);
      }
      return;
    }
    if (!(await confirmDiscardDraft())) {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      await loadKnowledgeBase(knowledgeBaseId);
      pushWorkbenchUrl(`/app/kb/${knowledgeBaseId}`);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function selectDocument(documentId: string) {
    if (documentId === currentDocument?.id) {
      return;
    }
    if (!(await confirmDiscardDraft())) {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      const document = await openDocument(documentId);
      pushWorkbenchUrl(`/app/kb/${document.knowledge_base_id}/docs/${document.id}`);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateWorkspace() {
    const name = await dialog.requestTextInput({
      title: t("Create workspace"),
      label: t("Workspace name"),
      placeholder: t("Workspace name"),
      confirmLabel: t("Create")
    });
    if (!name) {
      return;
    }

    setIsBusy(true);
    try {
      const workspace = await createWorkspace({
        name,
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
    const name = await dialog.requestTextInput({
      title: t("Rename workspace"),
      label: t("Workspace name"),
      defaultValue: selectedWorkspace.name,
      confirmLabel: t("Rename")
    });
    if (!name || name === selectedWorkspace.name) {
      return;
    }

    setIsBusy(true);
    try {
      const workspace = await updateWorkspace(selectedWorkspace.id, { name });
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
    const title = await dialog.requestTextInput({
      title: t("Create knowledge base"),
      label: t("Knowledge base title"),
      placeholder: t("Knowledge base title"),
      confirmLabel: t("Create")
    });
    if (!title) {
      return;
    }

    setIsBusy(true);
    try {
      const knowledgeBase = await createKnowledgeBase({
        workspace_id: selectedWorkspaceId,
        title,
        slug: slugFromTitle(title, "kb"),
        visibility: "workspace"
      });
      setKnowledgeBases((items) => [...items, knowledgeBase]);
      await loadKnowledgeBase(knowledgeBase.id);
      pushWorkbenchUrl(`/app/kb/${knowledgeBase.id}`);
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
    const title = await dialog.requestTextInput({
      title: type === "folder" ? t("Create folder") : t("Create document"),
      label: type === "folder" ? t("Folder title") : t("Document title"),
      placeholder: type === "folder" ? t("Folder title") : t("Document title"),
      confirmLabel: t("Create")
    });
    if (!title) {
      return;
    }

    const parentId = currentDocument?.type === "folder" ? currentDocument.id : null;
    setIsBusy(true);
    try {
      const document = await createDocument({
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: parentId,
        type,
        title,
        slug: slugFromTitle(title, type),
        markdown: type === "page" ? `# ${title}\n` : ""
      });
      const nextTree = await getKnowledgeBaseTree(selectedKnowledgeBaseId);
      setDocuments(nextTree);
      await openDocument(document.id);
      pushWorkbenchUrl(`/app/kb/${selectedKnowledgeBaseId}/docs/${document.id}`);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleImportClick() {
    if (!selectedKnowledgeBaseId || isImporting || isBusy) {
      return;
    }
    importFileInputRef.current?.click();
  }

  async function handleImportFile(file: File | null) {
    if (!file || !selectedKnowledgeBaseId) {
      return;
    }

    const parentId = currentDocument?.type === "folder" ? currentDocument.id : null;
    const defaultTitle = file.name.replace(/\.[^.]+$/, "");
    const title = await dialog.requestTextInput({
      title: t("Import file"),
      label: t("Imported document title"),
      defaultValue: defaultTitle,
      confirmLabel: t("Import")
    });
    if (title === null) {
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
      return;
    }

    setIsImporting(true);
    setMessage("");
    try {
      const asset = await uploadFile({
        file,
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: parentId
      });
      const job = await createImportJob({
        source_asset_id: asset.id,
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: parentId,
        title: title || defaultTitle,
        converter: "auto"
      });
      setImportJobs((items) => [job, ...items.filter((item) => item.id !== job.id)]);
      setMessage(t("Import job queued. The import worker will convert it to Markdown."));
      void pollImportJob(job.id, selectedKnowledgeBaseId);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsImporting(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  }

  async function handleToolbarAction(action: EditorToolbarAction) {
    if (currentDocument?.type !== "page" || mode !== "edit") {
      return;
    }

    const editor = milkdownEditorRef.current;
    switch (action) {
      case "undo":
        editor?.undo();
        break;
      case "redo":
        editor?.redo();
        break;
      case "paragraph":
        editor?.paragraph();
        break;
      case "heading_1":
      case "heading_2":
      case "heading_3":
      case "heading_4":
      case "heading_5":
      case "heading_6":
        editor?.heading(Number(action.at(-1)) as 1 | 2 | 3 | 4 | 5 | 6);
        break;
      case "bold":
        editor?.bold();
        break;
      case "italic":
        editor?.italic();
        break;
      case "strikethrough":
        editor?.strikethrough();
        break;
      case "inline_code":
        editor?.inlineCode();
        break;
      case "clear_format": {
        const shouldClear = await dialog.requestConfirmation({
          title: t("Clear basic formatting"),
          description: t("Clear basic inline Markdown formatting in this document?"),
          confirmLabel: t("Clear"),
          tone: "danger"
        });
        if (!shouldClear) {
          break;
        }
        const result = clearBasicMarkdownFormatting(draftMarkdown);
        if (!result.changed) {
          setMessage(t("No basic formatting found."));
          break;
        }
        setDraftMarkdown(result.markdown);
        setEditorResetKey((key) => key + 1);
        setMessage(t("Basic formatting cleared."));
        break;
      }
      case "link": {
        const href = await dialog.requestTextInput({
          title: t("Insert link"),
          label: t("Link URL"),
          placeholder: "https://example.com",
          confirmLabel: t("Insert")
        });
        if (href) {
          if (!editor?.link(href)) {
            editor?.insertMarkdown(`[${t("Link")}](${href})`, true);
          }
        }
        break;
      }
      case "blockquote":
        if (!editor?.blockquote()) {
          editor?.insertMarkdown(`\n> ${t("Quote")}\n`);
        }
        break;
      case "divider":
        if (!editor?.divider()) {
          editor?.insertMarkdown("\n---\n");
        }
        break;
      case "insert_code_block":
        if (!editor?.codeBlock()) {
          editor?.insertMarkdown("\n```ts\n\n```\n");
        }
        break;
      case "bullet_list":
        if (!editor?.bulletList()) {
          editor?.insertMarkdown(`\n- ${t("Item")}\n`);
        }
        break;
      case "ordered_list":
        if (!editor?.orderedList()) {
          editor?.insertMarkdown(`\n1. ${t("Item")}\n`);
        }
        break;
      case "indent":
        editor?.indent();
        break;
      case "outdent":
        editor?.outdent();
        break;
      case "task_list":
        editor?.taskList();
        break;
      case "insert_table":
        if (!editor?.table()) {
          editor?.insertMarkdown(
            `\n| ${t("Column")} | ${t("Value")} |\n| --- | --- |\n| ${t("Item")} | ${t(
              "Value"
            )} |\n`
          );
        }
        break;
      case "insert_image":
        imageFileInputRef.current?.click();
        break;
      case "insert_attachment":
        attachmentFileInputRef.current?.click();
        break;
      case "insert_date": {
        const dateText = createMarkdownDateText();
        if (!editor?.insertMarkdown(dateText, true)) {
          setDraftMarkdown((current) => normalizeMarkdownSource(`${current}${dateText}`));
          setEditorResetKey((key) => key + 1);
        }
        break;
      }
      case "find_replace":
        setFindReplaceOpen((open) => !open);
        break;
      default:
        break;
    }
  }

  async function handleInsertImageFile(file: File | null) {
    if (!file || !selectedKnowledgeBaseId || currentDocument?.type !== "page") {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      const asset = await uploadFile({
        file,
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: currentDocument.parent_id
      });
      const markdown = createAssetImageMarkdown(asset.id, file.name);
      const inserted =
        milkdownEditorRef.current?.image(`asset://${asset.id}`, file.name) ??
        milkdownEditorRef.current?.insertMarkdown(`\n${markdown}\n`);
      if (!inserted) {
        setDraftMarkdown((current) => normalizeMarkdownSource(`${current}\n${markdown}\n`));
        setEditorResetKey((key) => key + 1);
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
      if (imageFileInputRef.current) {
        imageFileInputRef.current.value = "";
      }
    }
  }

  async function handleInsertAttachmentFile(file: File | null) {
    if (!file || !selectedKnowledgeBaseId || currentDocument?.type !== "page") {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      const asset = await uploadFile({
        file,
        knowledge_base_id: selectedKnowledgeBaseId,
        parent_id: currentDocument.parent_id
      });
      const markdown = createAssetLinkMarkdown(asset.id, file.name);
      if (!milkdownEditorRef.current?.insertMarkdown(`\n${markdown}\n`)) {
        setDraftMarkdown((current) => normalizeMarkdownSource(`${current}\n${markdown}\n`));
        setEditorResetKey((key) => key + 1);
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
      if (attachmentFileInputRef.current) {
        attachmentFileInputRef.current.value = "";
      }
    }
  }

  function handleReplaceDraftMarkdown(replaceAll: boolean) {
    const result = replaceMarkdownText(draftMarkdown, findText, replaceText, {
      matchCase: findReplaceMatchCase,
      replaceAll
    });

    if (result.count === 0) {
      setMessage(t("No matches found."));
      return;
    }

    setDraftMarkdown(result.markdown);
    setEditorResetKey((key) => key + 1);
    setMessage(t("Replaced {count} matches.", { count: result.count }));
  }

  async function pollImportJob(importJobId: string, knowledgeBaseId: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await delay(1500);

      try {
        const job = await getImportJob(importJobId);
        setImportJobs((items) => [job, ...items.filter((item) => item.id !== job.id)]);
        if (job.status === "succeeded") {
          const nextTree = await getKnowledgeBaseTree(knowledgeBaseId);
          setDocuments(nextTree);
          if (job.document_id) {
            await openDocument(job.document_id);
            pushWorkbenchUrl(`/app/kb/${knowledgeBaseId}/docs/${job.document_id}`);
          }
          setMessage("");
          return;
        }
        if (job.status === "failed") {
          setMessage(
            job.error ? t("Import failed: {error}", { error: job.error }) : t("Import failed.")
          );
          return;
        }
      } catch (error) {
        handleApiError(error);
        return;
      }
    }
  }

  async function handleDeleteDocument() {
    if (!currentDocument) {
      return;
    }
    const shouldDelete = await dialog.requestConfirmation({
      title: t("Delete document"),
      description: t('Delete "{title}"?', { title: currentDocument.title }),
      confirmLabel: t("Delete"),
      tone: "danger"
    });
    if (!shouldDelete) {
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
        pushWorkbenchUrl(`/app/kb/${nextDocument.knowledge_base_id}/docs/${nextDocument.id}`);
      } else {
        clearDocumentState();
        if (selectedKnowledgeBaseId) {
          pushWorkbenchUrl(`/app/kb/${selectedKnowledgeBaseId}`);
        }
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleTogglePublishDocument() {
    if (!currentDocument || currentDocument.type !== "page") {
      return;
    }
    if (hasUnsavedChanges || saveState === "saving") {
      setMessage(t("Save the document before changing publish state."));
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      const updated =
        currentDocument.status === "published"
          ? await unpublishDocument(currentDocument.id)
          : await publishDocument(currentDocument.id);
      setCurrentDocument(updated);
      setSavedTitle(updated.title);
      setSavedMarkdown(updated.currentVersion?.markdown ?? "");
      setBaseVersionId(updated.currentVersion?.id ?? null);
      setDocuments((items) => updateDocumentInList(items, updated));
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        updated.status === "published"
          ? t(
              "Document published. PostgreSQL chunks are ready; rebuild the Milvus index when retrieval needs to reflect this change."
            )
          : t("Document unpublished. Rebuild the search index to remove stale retrieval results.")
      );
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    if (!(await confirmDiscardDraft())) {
      return;
    }

    try {
      await logout();
    } catch {
      // Local sign-out should still clear the current UI even if the API is offline.
    } finally {
      router.replace("/login");
    }
  }

  async function handleOpenSearch() {
    if (!(await confirmDiscardDraft())) {
      return;
    }
    router.push(
      selectedKnowledgeBaseId
        ? `/app/search?kb_id=${encodeURIComponent(selectedKnowledgeBaseId)}`
        : "/app/search"
    );
  }

  async function handleOpenAdmin() {
    if (!(await confirmDiscardDraft())) {
      return;
    }
    router.push("/app/admin");
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

  async function handleRestoreVersion(versionId: string) {
    if (!currentDocument) {
      return;
    }
    const confirmed = await dialog.requestConfirmation({
      title: t("Restore version"),
      description: t("Restore this version as a new current version?"),
      confirmLabel: t("Restore"),
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      const restored = await restoreDocumentVersion(currentDocument.id, versionId);
      setCurrentDocument(restored);
      setDraftTitle(restored.title);
      setSavedTitle(restored.title);
      setDraftMarkdown(restored.currentVersion?.markdown ?? "");
      setSavedMarkdown(restored.currentVersion?.markdown ?? "");
      setBaseVersionId(restored.currentVersion?.id ?? null);
      setSaveState("saved");
      setEditorResetKey((value) => value + 1);
      setDocuments((items) => updateDocumentInList(items, restored));
      setSelectedVersionId(restored.currentVersion?.id ?? null);
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        t("Version restored. Rebuild chunks and search index if this document is published.")
      );
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  function jumpToOutlineItem(item: MarkdownOutlineItem) {
    const headings = Array.from(
      editorPaneRef.current?.querySelectorAll<HTMLElement>("[data-outline-id]") ?? []
    );
    const target = headings.find((heading) => heading.dataset.outlineId === item.id);
    if (!target) {
      return;
    }

    const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 88);
    window.scrollTo({ top, behavior: "smooth" });
    setActiveOutlineId(item.id);
  }

  function handleDocumentPaneClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    if (!href.startsWith("openkb://document/")) {
      return;
    }

    event.preventDefault();
    const documentId = href.replace("openkb://document/", "").trim();
    if (documentId) {
      void selectDocument(documentId);
    }
  }

  async function handleTreeDrop(draggedId: string, targetId: string, position: TreeDropPosition) {
    const updates = planDocumentMove(documents, draggedId, targetId, position);
    setDraggingDocumentId(null);
    if (updates.length === 0) {
      setMessage(t("Document cannot be moved there."));
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      for (const update of updates) {
        await updateDocument(update.id, {
          parent_id: update.parent_id,
          sort_order: update.sort_order
        });
      }
      const nextTree = selectedKnowledgeBaseId
        ? await getKnowledgeBaseTree(selectedKnowledgeBaseId)
        : [];
      setDocuments(nextTree);
      const nextCurrent = nextTree.find((document) => document.id === currentDocument?.id);
      if (currentDocument && nextCurrent) {
        setCurrentDocument({ ...currentDocument, ...nextCurrent });
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMoveDocumentByStep(documentId: string, direction: "up" | "down") {
    const updates = planDocumentStepMove(documents, documentId, direction);
    if (updates.length === 0) {
      return;
    }

    setIsBusy(true);
    setMessage("");
    try {
      for (const update of updates) {
        await updateDocument(update.id, {
          parent_id: update.parent_id,
          sort_order: update.sort_order
        });
      }
      const nextTree = selectedKnowledgeBaseId
        ? await getKnowledgeBaseTree(selectedKnowledgeBaseId)
        : [];
      setDocuments(nextTree);
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  const statusText = t(saveStatusText(saveState));
  const isAdmin = Boolean(
    me?.roles.some((role) => role === "system_admin" || role === "tenant_admin")
  );

  return (
    <main className="flex min-h-screen bg-zinc-50 text-zinc-950">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white">
            OK
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">OpenKB</p>
            <p className="truncate text-xs text-zinc-500">{me?.user.email ?? t("Loading")}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <PanelHeader title={t("Workspaces")} onAdd={handleCreateWorkspace} disabled={isBusy} />
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
              title={t("Knowledge Bases")}
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
                {selectedWorkspace?.name ?? t("OpenKB Workspace")}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {selectedKnowledgeBase?.title ?? t("No knowledge base selected")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <button
              className="icon-button"
              onClick={() => void handleOpenSearch()}
              title={t("Search")}
              type="button"
            >
              <Search className="h-4 w-4" />
            </button>
            {isAdmin ? (
              <button
                className="icon-button"
                onClick={() => void handleOpenAdmin()}
                title={t("Admin")}
                type="button"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            ) : null}
            <button
              className="icon-button"
              disabled={accessTargets.length === 0}
              onClick={() => setActiveWorkbenchPanel("access")}
              title={t("Collaborators")}
              type="button"
            >
              <Users className="h-4 w-4" />
            </button>
            <button
              className="icon-button"
              disabled={accessTargets.length === 0}
              onClick={() => setActiveWorkbenchPanel("share")}
              title={t("Share")}
              type="button"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              className="icon-button"
              onClick={() => void handleLogout()}
              title={t("Log out")}
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
                  <p className="truncate text-sm font-semibold">{t("Documents")}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {t("{count} items", { count: documents.length })}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="icon-button"
                    disabled={!selectedKnowledgeBaseId || isBusy || isImporting}
                    onClick={() => void handleImportClick()}
                    title={t("Import file")}
                    type="button"
                  >
                    {isImporting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    disabled={!selectedKnowledgeBaseId || isBusy}
                    onClick={() => void handleCreateDocument("folder")}
                    title={t("New folder")}
                    type="button"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!selectedKnowledgeBaseId || isBusy}
                    onClick={() => void handleCreateDocument("page")}
                    title={t("New document")}
                    type="button"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <input
                ref={importFileInputRef}
                accept=".md,.markdown,.txt,.html,.htm,.csv,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
                className="hidden"
                onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <input
                ref={imageFileInputRef}
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(event) => void handleInsertImageFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <input
                ref={attachmentFileInputRef}
                className="hidden"
                onChange={(event) =>
                  void handleInsertAttachmentFile(event.target.files?.[0] ?? null)
                }
                type="file"
              />

              <div className="max-h-72 overflow-y-auto px-2 py-3 lg:max-h-none">
                {tree.length > 0 ? (
                  tree.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      activeId={currentDocument?.id ?? null}
                      collapsedFolders={collapsedFolders}
                      draggingId={draggingDocumentId}
                      isBusy={isBusy}
                      onDragEnd={() => setDraggingDocumentId(null)}
                      onDragStart={(id) => setDraggingDocumentId(id)}
                      onDropItem={(draggedId, targetId, position) =>
                        void handleTreeDrop(draggedId, targetId, position)
                      }
                      onMoveStep={(id, direction) => void handleMoveDocumentByStep(id, direction)}
                      onToggle={(id) => {
                        setCollapsedFolders((items) => toggleSet(items, id));
                      }}
                      onSelect={(id) => void selectDocument(id)}
                    />
                  ))
                ) : (
                  <EmptyPanel
                    title={t("No documents")}
                    action={t("Create a page or folder to start.")}
                  />
                )}
                <ImportJobsPanel jobs={importJobs} />
              </div>
            </aside>

            <article className="min-w-0 bg-white">
              {currentDocument ? (
                <div className="flex h-full min-h-[680px] flex-col">
                  <div className="border-b border-zinc-200 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {currentDocument.type === "page" && canEditCurrentDocument ? (
                        <ModeSwitch
                          mode={mode === "source" ? "source" : "edit"}
                          onChange={(nextMode) => setMode(nextMode)}
                        />
                      ) : (
                        <span className="inline-flex h-8 items-center rounded-md bg-zinc-100 px-2.5 text-xs font-medium text-zinc-600">
                          {t("View only")}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                        <span className={saveStateClass(saveState)}>{statusText}</span>
                        {currentDocument.type === "page" ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${
                                currentDocument.status === "published"
                                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                              }`}
                              disabled={!canEditCurrentDocument || isBusy || saveState === "saving"}
                              onClick={() => void handleTogglePublishDocument()}
                              type="button"
                            >
                              {currentDocument.status === "published"
                                ? t("Published")
                                : t("Publish")}
                            </button>
                            <HelpTip text={t("Publish indexing help")} />
                          </span>
                        ) : null}
                        <button
                          className="icon-button"
                          disabled={!canEditCurrentDocument || saveState === "saving"}
                          onClick={() => void persistDraft()}
                          title={t("Save now (Ctrl+S)")}
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
                          disabled={!canEditCurrentDocument || isBusy}
                          onClick={() => void handleDeleteDocument()}
                          title={t("Delete document")}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <input
                      className="mt-4 w-full border-none bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-zinc-300 read-only:cursor-default"
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder={t("Untitled")}
                      readOnly={!canEditCurrentDocument}
                      value={draftTitle}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>{t(currentDocument.type)}</span>
                      <span>{t(currentDocument.status)}</span>
                      <span>
                        {t("Version {version}", {
                          version: currentDocument.currentVersion?.version_no ?? 0
                        })}
                      </span>
                      <span>{t(currentDocument.role ?? "viewer")}</span>
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
                        {t("Load server version")}
                      </button>
                    </div>
                  ) : message ? (
                    <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {message}
                    </div>
                  ) : null}

                  {currentDocument.type === "page" && canEditCurrentDocument && mode === "edit" ? (
                    <div className="border-b border-zinc-200 bg-white px-5 py-2">
                      <EditorToolbar
                        disabled={isBusy || saveState === "saving"}
                        onAction={handleToolbarAction}
                      />
                      {findReplaceOpen ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                          <input
                            className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-emerald-500"
                            onChange={(event) => setFindText(event.target.value)}
                            placeholder={t("Find")}
                            value={findText}
                          />
                          <input
                            className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-emerald-500"
                            onChange={(event) => setReplaceText(event.target.value)}
                            placeholder={t("Replace")}
                            value={replaceText}
                          />
                          <label className="inline-flex h-8 items-center gap-1.5 text-xs text-zinc-600">
                            <input
                              checked={findReplaceMatchCase}
                              onChange={(event) => setFindReplaceMatchCase(event.target.checked)}
                              type="checkbox"
                            />
                            {t("Match case")}
                          </label>
                          <button
                            className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            disabled={!findText}
                            onClick={() => handleReplaceDraftMarkdown(false)}
                            type="button"
                          >
                            {t("Replace")}
                          </button>
                          <button
                            className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                            disabled={!findText}
                            onClick={() => handleReplaceDraftMarkdown(true)}
                            type="button"
                          >
                            {t("Replace all")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    ref={editorPaneRef}
                    className="min-h-0 flex-1 px-5 py-5"
                    onClick={handleDocumentPaneClick}
                  >
                    {currentDocument.type === "folder" ? (
                      <EmptyPanel
                        title={t("Folder selected")}
                        action={t("Create or select a page inside the tree.")}
                      />
                    ) : mode === "source" && canEditCurrentDocument ? (
                      <textarea
                        className="h-full min-h-[520px] w-full resize-none rounded-md border border-zinc-200 bg-zinc-950 p-4 font-mono text-sm leading-6 text-zinc-50 outline-none focus:border-emerald-500"
                        onChange={(event) => setDraftMarkdown(event.target.value)}
                        spellCheck={false}
                        value={draftMarkdown}
                      />
                    ) : (
                      <div className="openkb-milkdown-shell">
                        <Suspense fallback={<EditorLoadingFallback />}>
                          <LazyMilkdownEditor
                            ref={milkdownEditorRef}
                            key={`${currentDocument.id}:${mode}:${editorResetKey}`}
                            editable={mode === "edit" && canEditCurrentDocument}
                            markdown={milkdownMarkdown.markdown}
                            onChange={(nextMarkdown) =>
                              setDraftMarkdown(
                                restoreMarkdownFromMilkdown(nextMarkdown, milkdownMarkdown)
                              )
                            }
                          />
                        </Suspense>
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedKnowledgeBaseId ? (
                <KnowledgeBaseDashboard
                  documents={documents}
                  knowledgeBaseId={selectedKnowledgeBaseId}
                  onCreateDocument={() => void handleCreateDocument("page")}
                  onError={handleApiError}
                  onOpenDocument={(documentId) => void selectDocument(documentId)}
                />
              ) : (
                <EmptyMain
                  hasKnowledgeBase={Boolean(selectedKnowledgeBaseId)}
                  onCreate={() => void handleCreateDocument("page")}
                />
              )}
            </article>

            <aside className="hidden min-h-0 border-l border-zinc-200 bg-zinc-50/70 xl:block">
              <DocumentSidePanel
                activeOutlineId={activeOutlineId}
                chunks={documentChunks}
                chunksLoading={documentChunksLoading}
                currentDocument={currentDocument}
                currentMarkdown={savedMarkdown}
                onOpenDashboard={() => {
                  if (selectedKnowledgeBaseId) {
                    void selectKnowledgeBase(selectedKnowledgeBaseId);
                  }
                }}
                onRestoreVersion={(versionId) => void handleRestoreVersion(versionId)}
                onSelectOutline={jumpToOutlineItem}
                onSelectTab={setDocumentSideTab}
                onSelectVersion={setSelectedVersionId}
                outline={outline}
                references={markdownReferences}
                selectedVersion={selectedVersion}
                selectedVersionId={selectedVersionId}
                selectedVersionLoading={selectedVersionLoading}
                tab={documentSideTab}
                versions={documentVersions}
                versionsLoading={documentVersionsLoading}
                onOpenDocument={(documentId) => void selectDocument(documentId)}
              />
              <div className="border-t border-zinc-200 px-4 py-4">
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => void handleRenameWorkspace()}
                  type="button"
                >
                  <Pencil className="h-4 w-4" />
                  {t("Rename workspace")}
                </button>
              </div>
            </aside>
          </div>
        )}
      </section>
      {activeWorkbenchPanel === "access" && accessTargets.length > 0 ? (
        <AccessPanel
          initialTargetType={defaultAccessTargetType}
          onClose={() => setActiveWorkbenchPanel(null)}
          targets={accessTargets}
        />
      ) : null}
      {activeWorkbenchPanel === "share" && accessTargets.length > 0 ? (
        <SharePanel
          initialTargetType={defaultAccessTargetType}
          onClose={() => setActiveWorkbenchPanel(null)}
          targets={accessTargets}
        />
      ) : null}
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
  const { t } = useI18n();
  return (
    <div className="mb-2 flex items-center justify-between">
      <p className="text-xs font-semibold uppercase text-zinc-500">{title}</p>
      <button
        className="icon-button h-7 w-7"
        disabled={disabled}
        onClick={() => onAdd()}
        title={t("Add {title}", { title: title.toLowerCase() })}
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
  draggingId,
  isBusy,
  onToggle,
  onSelect,
  onDragStart,
  onDragEnd,
  onDropItem,
  onMoveStep,
  depth = 0
}: {
  node: TreeNode;
  activeId: string | null;
  collapsedFolders: Set<string>;
  draggingId: string | null;
  isBusy: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropItem: (draggedId: string, targetId: string, position: TreeDropPosition) => void;
  onMoveStep: (id: string, direction: "up" | "down") => void;
  depth?: number;
}) {
  const { t } = useI18n();
  const isFolder = node.type === "folder";
  const collapsed = collapsedFolders.has(node.id);
  const isDragging = draggingId === node.id;

  return (
    <div>
      <div className="group relative flex items-center gap-1">
        <TreeGuides depth={depth} />
        <button
          className={`${treeButtonClass(node.id === activeId, isDragging)} relative z-10`}
          draggable={!isBusy}
          onClick={() => onSelect(node.id)}
          onDragEnd={() => onDragEnd()}
          onDragOver={(event) => event.preventDefault()}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/openkb-document-id", node.id);
            onDragStart(node.id);
          }}
          onDrop={(event) => {
            event.preventDefault();
            const draggedDocumentId =
              event.dataTransfer.getData("text/openkb-document-id") || draggingId;
            if (draggedDocumentId) {
              onDropItem(
                draggedDocumentId,
                node.id,
                getTreeDropPosition(event.currentTarget, event.clientY, isFolder)
              );
            }
          }}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          type="button"
        >
          <GripVertical className="h-4 w-4 shrink-0 text-zinc-400" />
          {isFolder ? (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-200"
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
            <span className="h-5 w-5 shrink-0" />
          )}
          {isFolder ? (
            <Folder className="h-4 w-4 shrink-0" />
          ) : (
            <FileText className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{node.title}</span>
        </button>
        <button
          className="icon-button h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
          disabled={isBusy}
          onClick={() => onMoveStep(node.id, "up")}
          title={t("Move up")}
          type="button"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          className="icon-button h-7 w-7 shrink-0 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
          disabled={isBusy}
          onClick={() => onMoveStep(node.id, "down")}
          title={t("Move down")}
          type="button"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {isFolder && !collapsed
        ? node.children.map((child) => (
            <TreeItem
              key={child.id}
              activeId={activeId}
              collapsedFolders={collapsedFolders}
              draggingId={draggingId}
              depth={depth + 1}
              isBusy={isBusy}
              node={child}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onDropItem={onDropItem}
              onMoveStep={onMoveStep}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}

function TreeGuides({ depth }: { depth: number }) {
  if (depth <= 0) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute inset-y-0 left-0 z-20">
      {Array.from({ length: depth }).map((_, index) => (
        <span
          className="absolute inset-y-0 w-px bg-zinc-200"
          key={index}
          style={{ left: `${18 + index * 18}px` }}
        />
      ))}
    </span>
  );
}

function DocumentSidePanel({
  activeOutlineId,
  chunks,
  chunksLoading,
  currentDocument,
  currentMarkdown,
  onOpenDashboard,
  onOpenDocument,
  onRestoreVersion,
  onSelectOutline,
  onSelectTab,
  onSelectVersion,
  outline,
  references,
  selectedVersion,
  selectedVersionId,
  selectedVersionLoading,
  tab,
  versions,
  versionsLoading
}: {
  activeOutlineId: string | null;
  chunks: DocumentChunk[];
  chunksLoading: boolean;
  currentDocument: DocumentDetail | null;
  currentMarkdown: string;
  onOpenDashboard: () => void;
  onOpenDocument: (documentId: string) => void;
  onRestoreVersion: (versionId: string) => void;
  onSelectOutline: (item: MarkdownOutlineItem) => void;
  onSelectTab: (tab: DocumentSideTab) => void;
  onSelectVersion: (versionId: string) => void;
  outline: MarkdownOutlineItem[];
  references: MarkdownReferenceExtraction;
  selectedVersion: DocumentVersion | null;
  selectedVersionId: string | null;
  selectedVersionLoading: boolean;
  tab: DocumentSideTab;
  versions: DocumentVersionSummary[];
  versionsLoading: boolean;
}) {
  const { t } = useI18n();
  const canRestore = currentDocument ? canEditDocumentRole(currentDocument.role) : false;
  const selectedVersionSummary = versions.find((version) => version.id === selectedVersionId);
  const diff = selectedVersion
    ? summarizeMarkdownDiff(currentMarkdown, selectedVersion.markdown)
    : null;

  return (
    <div className="min-h-0">
      <div className="border-b border-zinc-200 px-3 py-3">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-1">
          {(["outline", "chunks", "versions"] as const).map((item) => (
            <button
              className={`rounded px-2 py-1.5 text-xs font-medium ${
                tab === item
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-950"
              }`}
              key={item}
              onClick={() => onSelectTab(item)}
              type="button"
            >
              {t(sideTabLabel(item))}
            </button>
          ))}
        </div>
      </div>

      {tab === "outline" ? (
        <>
          <div className="border-b border-zinc-200 px-4 py-3">
            <p className="text-sm font-semibold">{t("Outline")}</p>
            <p className="text-xs text-zinc-500">
              {t("{count} headings", { count: outline.length })}
            </p>
          </div>
          <Outline activeId={activeOutlineId} items={outline} onSelect={onSelectOutline} />
          <ReferencesPanel references={references} onOpenDocument={onOpenDocument} />
        </>
      ) : null}

      {tab === "chunks" ? (
        <div className="space-y-3 px-4 py-4">
          <div>
            <p className="text-sm font-semibold">{t("Document chunks")}</p>
            <p className="text-xs text-zinc-500">
              {currentDocument
                ? t("{count} chunks", { count: chunks.length })
                : t("No document selected")}
            </p>
          </div>
          {chunksLoading ? (
            <EmptyPanel title={t("Loading chunks")} action={t("Reading PostgreSQL chunks.")} />
          ) : chunks.length > 0 ? (
            <div className="space-y-2">
              {chunks.map((chunk) => (
                <div
                  className="rounded-md border border-zinc-200 bg-white p-2 text-xs"
                  key={chunk.id}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-zinc-500">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                      {t(chunk.chunk_type)}
                    </span>
                    <span>#{chunk.ordinal}</span>
                    <span>{t("{count} tokens", { count: chunk.token_count ?? 0 })}</span>
                  </div>
                  <p className="mt-1 line-clamp-4 text-zinc-700">{chunk.content_text}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-400" title={chunk.version_id}>
                    {t("Version id")}: {chunk.version_id}
                  </p>
                  {chunk.heading_path.length > 0 ? (
                    <p className="mt-1 truncate text-[11px] text-sky-700">
                      {chunk.heading_path.join(" / ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <EmptyPanel
                title={t("No chunks for this document")}
                action={t("Publish or rebuild chunks before this document can be searched.")}
              />
              <button
                className="inline-flex w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={onOpenDashboard}
                type="button"
              >
                {t("Open KB dashboard")}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {tab === "versions" ? (
        <div className="space-y-3 px-4 py-4">
          <div>
            <p className="text-sm font-semibold">{t("Versions")}</p>
            <p className="text-xs text-zinc-500">
              {versionsLoading
                ? t("Loading versions")
                : t("{count} versions", { count: versions.length })}
            </p>
          </div>

          {versions.length > 0 ? (
            <div className="space-y-1">
              {versions.map((version) => (
                <button
                  className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                    selectedVersionId === version.id
                      ? "border-sky-300 bg-sky-50 text-sky-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  key={version.id}
                  onClick={() => onSelectVersion(version.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t("Version {version}", { version: version.version_no })}
                    </span>
                    {version.is_current ? (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        {t("Current")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-zinc-500">
                    {formatDateTime(version.created_at)}
                  </span>
                </button>
              ))}
            </div>
          ) : versionsLoading ? (
            <EmptyPanel title={t("Loading versions")} action={t("Reading document history.")} />
          ) : (
            <EmptyPanel title={t("No versions")} action={t("Save the page to create history.")} />
          )}

          {selectedVersion ? (
            <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">
                  {t("Version {version}", { version: selectedVersion.version_no })}
                </p>
                <span className="text-zinc-400">{selectedVersion.source_type}</span>
              </div>
              {diff ? (
                <p className="mt-2 text-zinc-500">
                  {diff.changed === 0
                    ? t("No Markdown changes from current version.")
                    : t("{count} changed lines", { count: diff.changed })}
                </p>
              ) : null}
              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950 p-2 text-[11px] leading-5 text-zinc-50">
                {selectedVersion.markdown || " "}
              </pre>
              <button
                className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                disabled={
                  !canRestore || selectedVersionSummary?.is_current || selectedVersionLoading
                }
                onClick={() => onRestoreVersion(selectedVersion.id)}
                type="button"
              >
                {selectedVersionLoading ? t("Loading...") : t("Restore")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sideTabLabel(tab: DocumentSideTab): string {
  if (tab === "chunks") {
    return "Chunks";
  }
  if (tab === "versions") {
    return "Versions";
  }
  return "Outline";
}

function summarizeMarkdownDiff(currentMarkdown: string, versionMarkdown: string) {
  const currentLines = currentMarkdown.split(/\r?\n/);
  const versionLines = versionMarkdown.split(/\r?\n/);
  const maxLines = Math.max(currentLines.length, versionLines.length);
  let changed = 0;
  for (let index = 0; index < maxLines; index += 1) {
    if ((currentLines[index] ?? "") !== (versionLines[index] ?? "")) {
      changed += 1;
    }
  }
  return { changed };
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Outline({
  activeId,
  items,
  onSelect
}: {
  activeId: string | null;
  items: MarkdownOutlineItem[];
  onSelect: (item: MarkdownOutlineItem) => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return <EmptyPanel title={t("No outline")} action={t("Add headings to this page.")} />;
  }

  return (
    <div className="space-y-1 px-3 py-3">
      {items.map((item) => (
        <button
          key={`${item.id}:${item.line}`}
          className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs transition ${
            activeId === item.id
              ? "bg-sky-50 font-medium text-sky-800"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
          }`}
          onClick={() => onSelect(item)}
          style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
          title={item.title}
          type="button"
        >
          {item.title}
        </button>
      ))}
    </div>
  );
}

function ReferencesPanel({
  references,
  onOpenDocument
}: {
  references: MarkdownReferenceExtraction;
  onOpenDocument: (documentId: string) => void;
}) {
  const { t } = useI18n();
  const total =
    references.internalLinks.length +
    references.assetReferences.length +
    references.externalLinks.length;

  if (total === 0) {
    return null;
  }

  return (
    <div className="border-t border-zinc-200 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t("References")}</p>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{total}</span>
      </div>

      <div className="mt-3 space-y-3">
        {references.internalLinks.length > 0 ? (
          <ReferenceGroup
            icon={<Link2 className="h-3.5 w-3.5" />}
            title={t("OpenKB links")}
            count={references.internalLinks.length}
          >
            {references.internalLinks.map((link) => (
              <button
                key={`${link.documentId}:${link.line}`}
                className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                onClick={() => onOpenDocument(link.documentId)}
                title={link.rawUrl}
                type="button"
              >
                {link.label || link.documentId}
              </button>
            ))}
          </ReferenceGroup>
        ) : null}

        {references.assetReferences.length > 0 ? (
          <ReferenceGroup
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            title={t("Assets")}
            count={references.assetReferences.length}
          >
            {references.assetReferences.map((asset) => (
              <div
                key={`${asset.assetId}:${asset.line}`}
                className="truncate rounded-md px-2 py-1 text-xs text-zinc-600"
                title={asset.rawUrl}
              >
                {asset.alt || asset.assetId}
              </div>
            ))}
          </ReferenceGroup>
        ) : null}

        {references.externalLinks.length > 0 ? (
          <ReferenceGroup
            icon={<Link2 className="h-3.5 w-3.5" />}
            title={t("External")}
            count={references.externalLinks.length}
          >
            {references.externalLinks.map((link) => (
              <a
                key={`${link.url}:${link.line}`}
                className="block truncate rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                href={link.url}
                rel="noreferrer"
                target="_blank"
                title={link.url}
              >
                {link.label || link.url}
              </a>
            ))}
          </ReferenceGroup>
        ) : null}
      </div>
    </div>
  );
}

function ImportJobsPanel({ jobs }: { jobs: ImportJob[] }) {
  const { t } = useI18n();
  const visibleJobs = jobs.slice(0, 4);
  if (visibleJobs.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-zinc-200 pt-3">
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="text-xs font-semibold uppercase text-zinc-500">{t("Imports")}</p>
        <span className="text-xs text-zinc-400">{jobs.length}</span>
      </div>
      <div className="space-y-1">
        {visibleJobs.map((job) => (
          <div
            key={job.id}
            className="rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-600"
          >
            <div className="flex items-center gap-2">
              <ImportStatusIcon status={job.status} />
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-700">
                {job.title || job.converter}
              </span>
              <span className={importStatusClass(job.status)}>{t(job.status)}</span>
            </div>
            {job.error ? <p className="mt-1 truncate text-red-600">{job.error}</p> : null}
            {extractImportWarnings(job).length > 0 ? (
              <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-amber-700">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {extractImportWarnings(job)[0]?.message ?? t("Import warning")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportStatusIcon({ status }: { status: ImportJob["status"] }) {
  if (status === "succeeded") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />;
  }
  if (status === "running") {
    return <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-600" />;
  }
  return <Clock3 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />;
}

function ReferenceGroup({
  children,
  count,
  icon,
  title
}: {
  children: ReactNode;
  count: number;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
        {icon}
        <span>{title}</span>
        <span>{count}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function ModeSwitch({
  mode,
  onChange
}: {
  mode: "edit" | "source";
  onChange: (mode: "edit" | "source") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="editor-mode-switch" aria-label={t("Editor mode")}>
      <button
        className={
          mode === "edit" ? "editor-mode-switch-button-active" : "editor-mode-switch-button"
        }
        onClick={() => onChange("edit")}
        type="button"
      >
        {t("Edit")}
      </button>
      <button
        className={
          mode === "source" ? "editor-mode-switch-button-active" : "editor-mode-switch-button"
        }
        onClick={() => onChange("source")}
        type="button"
      >
        {t("Source")}
      </button>
    </div>
  );
}

function EmptyMain({
  hasKnowledgeBase,
  onCreate
}: {
  hasKnowledgeBase: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[680px] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <FileText className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">
          {hasKnowledgeBase ? t("No document selected") : t("No knowledge base yet")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {hasKnowledgeBase
            ? t("Create a page from the document tree.")
            : t("Create a workspace and knowledge base from the left rail.")}
        </p>
        {hasKnowledgeBase ? (
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={onCreate}
            type="button"
          >
            <Plus className="h-4 w-4" />
            {t("New document")}
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
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 shadow-sm">
        <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
        {t("Loading workspace")}
      </div>
    </div>
  );
}

function EditorLoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
      {t("Loading...")}
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

function buildAccessTargets(
  workspace: Workspace | undefined,
  knowledgeBase: KnowledgeBase | undefined,
  document: DocumentDetail | null,
  t: (key: string) => string
): AccessTarget[] {
  const targets: AccessTarget[] = [];
  if (workspace) {
    targets.push({
      type: "workspace",
      id: workspace.id,
      title: workspace.name,
      subtitle: t("Workspace members")
    });
  }
  if (knowledgeBase) {
    targets.push({
      type: "knowledge_base",
      id: knowledgeBase.id,
      title: knowledgeBase.title,
      subtitle: t("Knowledge base collaborators")
    });
  }
  if (document) {
    targets.push({
      type: "document",
      id: document.id,
      title: document.title,
      subtitle: t("Document collaborators")
    });
  }
  return targets;
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
          status: updated.status,
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

function canEditDocumentRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "editor";
}

function navButtonClass(active: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
    active ? "bg-sky-50 text-sky-800" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
  }`;
}

function treeButtonClass(active: boolean, dragging = false): string {
  return `flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition ${
    active ? "bg-sky-50 text-sky-800" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
  } ${dragging ? "opacity-50 ring-1 ring-sky-300" : ""}`;
}

function getTreeDropPosition(
  target: HTMLElement,
  clientY: number,
  targetIsFolder: boolean
): TreeDropPosition {
  const rect = target.getBoundingClientRect();
  const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;

  if (targetIsFolder && ratio > 0.25 && ratio < 0.75) {
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}

function planDocumentStepMove(
  documents: DocumentSummary[],
  documentId: string,
  direction: "up" | "down"
): DocumentMoveUpdate[] {
  const document = documents.find((item) => item.id === documentId);
  if (!document) {
    return [];
  }

  const siblings = getOrderedSiblings(documents, document.parent_id);
  const index = siblings.findIndex((item) => item.id === documentId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  const target = siblings[targetIndex];
  if (index < 0 || !target) {
    return [];
  }

  return planDocumentMove(
    documents,
    documentId,
    target.id,
    direction === "up" ? "before" : "after"
  );
}

function planDocumentMove(
  documents: DocumentSummary[],
  draggedId: string,
  targetId: string,
  position: TreeDropPosition
): DocumentMoveUpdate[] {
  const dragged = documents.find((document) => document.id === draggedId);
  const target = documents.find((document) => document.id === targetId);
  if (!dragged || !target || dragged.id === target.id) {
    return [];
  }

  const nextPosition = position === "inside" && target.type !== "folder" ? "after" : position;
  const nextParentId = nextPosition === "inside" ? target.id : target.parent_id;
  if (nextParentId === dragged.id || isDocumentDescendant(documents, nextParentId, dragged.id)) {
    return [];
  }

  const siblings = getOrderedSiblings(documents, nextParentId).filter(
    (document) => document.id !== dragged.id
  );
  const inserted = { ...dragged, parent_id: nextParentId };

  if (nextPosition === "inside") {
    siblings.push(inserted);
  } else {
    const targetIndex = siblings.findIndex((document) => document.id === target.id);
    if (targetIndex < 0) {
      return [];
    }
    siblings.splice(nextPosition === "before" ? targetIndex : targetIndex + 1, 0, inserted);
  }

  return siblings
    .map((document, index) => ({
      id: document.id,
      parent_id: document.id === dragged.id ? nextParentId : document.parent_id,
      sort_order: index * 1000
    }))
    .filter((update) => {
      const current = documents.find((document) => document.id === update.id);
      return (
        current !== undefined &&
        (current.parent_id !== update.parent_id || current.sort_order !== update.sort_order)
      );
    });
}

function getOrderedSiblings(
  documents: DocumentSummary[],
  parentId: string | null
): DocumentSummary[] {
  return documents
    .filter((document) => document.parent_id === parentId)
    .slice()
    .sort(
      (left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title)
    );
}

function isDocumentDescendant(
  documents: DocumentSummary[],
  candidateId: string | null,
  ancestorId: string
): boolean {
  let cursor = candidateId ? documents.find((document) => document.id === candidateId) : undefined;
  let guard = 0;

  while (cursor?.parent_id) {
    if (cursor.parent_id === ancestorId) {
      return true;
    }
    guard += 1;
    if (guard > documents.length) {
      return true;
    }
    const nextParentId = cursor.parent_id;
    cursor = documents.find((document) => document.id === nextParentId);
  }

  return false;
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

function importStatusClass(status: ImportJob["status"]): string {
  const base = "rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (status === "succeeded") {
    return `${base} bg-emerald-50 text-emerald-700`;
  }
  if (status === "failed") {
    return `${base} bg-red-50 text-red-700`;
  }
  if (status === "running") {
    return `${base} bg-sky-50 text-sky-700`;
  }
  return `${base} bg-zinc-100 text-zinc-600`;
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="group/help relative inline-flex">
      <button
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        type="button"
      >
        <Info className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute right-0 top-5 z-30 w-72 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-normal leading-5 text-zinc-700 opacity-0 shadow-lg transition group-hover/help:opacity-100 group-focus-within/help:opacity-100">
        {text}
      </span>
    </span>
  );
}

function extractImportWarnings(job: ImportJob): Array<{ code?: string; message?: string }> {
  return Array.isArray(job.warnings)
    ? job.warnings.filter((warning): warning is { code?: string; message?: string } =>
        Boolean(warning && typeof warning === "object")
      )
    : [];
}

function describeMarkdownDialectError(details: unknown): string {
  const firstIssue =
    typeof details === "object" && details !== null && "issues" in details
      ? (details as { issues?: Array<{ message?: string; line?: number }> }).issues?.[0]
      : undefined;

  if (!firstIssue) {
    return "Markdown is outside the enabled Milkdown dialect.";
  }

  return `${firstIssue.message ?? "Markdown is invalid."} Line ${firstIssue.line ?? "unknown"}.`;
}

function slugFromTitle(title: string, fallback: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${fallback}-${Date.now()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

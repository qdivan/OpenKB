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
  type FormEvent,
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
  createDocumentQaPair,
  createKnowledgeBase,
  createWorkspace,
  deleteDocument,
  generateDocumentQaPairs,
  generateDocumentSummary,
  getDocument,
  getDocumentMetadata,
  getImportJob,
  getKnowledgeBase,
  getKnowledgeBaseTree,
  getDocumentVersion,
  getMe,
  importDocumentQaPairs,
  isUnauthorized,
  listDocumentQaPairs,
  listDocumentSummaries,
  listDocumentVersions,
  listKnowledgeBaseChunks,
  listKnowledgeBases,
  listImportJobs,
  listWorkspaces,
  logout,
  publishDocument,
  reprocessDocument,
  restoreDocumentVersion,
  takeoverContentAccess,
  updateDocument,
  updateDocumentQaPair,
  updateDocumentProcessing,
  updateDocumentSegment,
  updateDocumentMetadata,
  updateWorkspace,
  unpublishDocument,
  uploadFile,
  type AuthMe,
  type AccessObjectType,
  type DocumentDetail,
  type DocumentChunk,
  type DocumentSummary,
  type DocumentQaPair,
  type DocumentSummariesResponse,
  type DocumentMetadataResponse,
  type DocumentVersion,
  type DocumentVersionSummary,
  type ImportJob,
  type ChunkSettings,
  type KnowledgeBase,
  type Workspace
} from "@/lib/openkb-api";

export type WorkbenchClientProps = {
  initialWorkspaceId?: string;
  initialKnowledgeBaseId?: string;
  initialDocumentId?: string;
};

type EditorMode = "read" | "edit" | "segments" | "source";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
type DocumentSideTab =
  | "outline"
  | "processing"
  | "chunks"
  | "qa"
  | "summary"
  | "versions"
  | "metadata";
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
  const [showDeletedSegments, setShowDeletedSegments] = useState(false);
  const [documentQaPairs, setDocumentQaPairs] = useState<DocumentQaPair[]>([]);
  const [documentQaLoading, setDocumentQaLoading] = useState(false);
  const [documentSummaries, setDocumentSummaries] = useState<DocumentSummariesResponse | null>(
    null
  );
  const [documentSummariesLoading, setDocumentSummariesLoading] = useState(false);
  const [documentVersions, setDocumentVersions] = useState<DocumentVersionSummary[]>([]);
  const [documentVersionsLoading, setDocumentVersionsLoading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null);
  const [selectedVersionLoading, setSelectedVersionLoading] = useState(false);
  const [documentMetadata, setDocumentMetadata] = useState<DocumentMetadataResponse | null>(null);
  const [documentMetadataDraft, setDocumentMetadataDraft] = useState<Record<string, string>>({});
  const [documentMetadataLoading, setDocumentMetadataLoading] = useState(false);
  const [documentMetadataSaving, setDocumentMetadataSaving] = useState(false);
  const [documentSideRefreshKey, setDocumentSideRefreshKey] = useState(0);
  const [createKbDialogOpen, setCreateKbDialogOpen] = useState(false);
  const [createKbTitle, setCreateKbTitle] = useState("");
  const [createKbDocForm, setCreateKbDocForm] = useState<ChunkSettings["doc_form"]>("text_model");

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectedKnowledgeBase = knowledgeBases.find(
    (knowledgeBase) => knowledgeBase.id === selectedKnowledgeBaseId
  );
  const selectedKnowledgeBaseContentLocked = Boolean(
    selectedKnowledgeBase?.requires_takeover || selectedKnowledgeBase?.can_read_content === false
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
    if (currentDocument && !canEditCurrentDocument && mode !== "read" && mode !== "segments") {
      setMode("read");
    }
  }, [canEditCurrentDocument, currentDocument, mode]);

  useEffect(() => {
    setDocumentChunks([]);
    setDocumentVersions([]);
    setSelectedVersion(null);
    setSelectedVersionId(null);
    setDocumentMetadata(null);
    setDocumentMetadataDraft({});
    setDocumentQaPairs([]);
    setDocumentSummaries(null);
    setShowDeletedSegments(false);
  }, [currentDocument?.id]);

  useEffect(() => {
    if (
      documentSideTab !== "outline" &&
      documentSideTab !== "metadata" &&
      documentSideTab !== "versions"
    ) {
      setDocumentSideTab("outline");
    }
  }, [documentSideTab]);

  useEffect(() => {
    if (mode !== "segments" || !currentDocument || !selectedKnowledgeBaseId) {
      return;
    }

    let cancelled = false;
    setDocumentChunksLoading(true);
    listKnowledgeBaseChunks(selectedKnowledgeBaseId, {
      document_id: currentDocument.id,
      limit: 200,
      status: showDeletedSegments ? "all" : undefined
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
  }, [currentDocument, documentSideRefreshKey, mode, selectedKnowledgeBaseId, showDeletedSegments]);

  useEffect(() => {
    if (mode !== "segments" || !currentDocument) {
      return;
    }

    let cancelled = false;
    setDocumentQaLoading(true);
    listDocumentQaPairs(currentDocument.id)
      .then((pairs) => {
        if (!cancelled) {
          setDocumentQaPairs(pairs);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentQaLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideRefreshKey, mode]);

  useEffect(() => {
    if (mode !== "segments" || !currentDocument) {
      return;
    }

    let cancelled = false;
    setDocumentSummariesLoading(true);
    listDocumentSummaries(currentDocument.id)
      .then((summaries) => {
        if (!cancelled) {
          setDocumentSummaries(summaries);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentSummariesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideRefreshKey, mode]);

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
    if (documentSideTab !== "metadata" || !currentDocument) {
      return;
    }

    let cancelled = false;
    setDocumentMetadataLoading(true);
    getDocumentMetadata(currentDocument.id)
      .then((metadata) => {
        if (cancelled) {
          return;
        }
        setDocumentMetadata(metadata);
        setDocumentMetadataDraft(toEditableMetadataValues(metadata));
      })
      .catch((error) => {
        if (!cancelled) {
          handleApiError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDocumentMetadataLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument, documentSideRefreshKey, documentSideTab]);

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
      const knowledgeBase = await getKnowledgeBase(knowledgeBaseId);
      setSelectedKnowledgeBaseId(knowledgeBase.id);
      setKnowledgeBases((items) =>
        items.some((item) => item.id === knowledgeBase.id) ? items : [knowledgeBase, ...items]
      );
      if (knowledgeBase.requires_takeover || knowledgeBase.can_read_content === false) {
        setDocuments([]);
        setImportJobs([]);
        clearDocumentState();
        setMessage(t("Admin visible knowledge base requires audited takeover before reading."));
        return;
      }
      const [treeDocuments, jobs] = await Promise.all([
        getKnowledgeBaseTree(knowledgeBaseId),
        listImportJobs(knowledgeBaseId)
      ]);
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
    [clearDocumentState, openDocument, t]
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

  async function handleTakeoverKnowledgeBase() {
    if (!selectedKnowledgeBaseId || !selectedKnowledgeBase?.requires_takeover) {
      return;
    }
    const confirmed = await dialog.requestConfirmation({
      title: t("Audited content access takeover"),
      description: t(
        "This will add you as a viewer collaborator and write an audit log before private content is readable."
      ),
      confirmLabel: t("Take over access")
    });
    if (!confirmed) {
      return;
    }
    setIsBusy(true);
    setMessage("");
    try {
      await takeoverContentAccess("knowledge_base", selectedKnowledgeBaseId, {
        reason: "System admin audited content access takeover",
        role: "viewer"
      });
      await loadKnowledgeBase(selectedKnowledgeBaseId);
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
    setCreateKbTitle("");
    setCreateKbDocForm("text_model");
    setCreateKbDialogOpen(true);
  }

  async function handleSubmitCreateKnowledgeBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspaceId) {
      return;
    }
    const title = createKbTitle.trim();
    if (!title) {
      return;
    }

    setIsBusy(true);
    try {
      const knowledgeBase = await createKnowledgeBase({
        workspace_id: selectedWorkspaceId,
        title,
        slug: slugFromTitle(title, "kb"),
        visibility: "workspace",
        doc_form: createKbDocForm
      });
      setKnowledgeBases((items) => [...items, knowledgeBase]);
      setCreateKbDialogOpen(false);
      setCreateKbTitle("");
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
        markdown: ""
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
              "Document published and segments reprocessed. Rebuild the Milvus index when retrieval should update."
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
      setMessage(t("Version restored. Reprocess segments before rebuilding the search index."));
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReprocessDocument() {
    if (!currentDocument || currentDocument.type !== "page") {
      return;
    }
    if (hasUnsavedChanges || saveState === "saving") {
      setMessage(t("Save the document before reprocessing segments."));
      return;
    }
    setIsBusy(true);
    setMessage("");
    try {
      const updated = await reprocessDocument(currentDocument.id);
      setCurrentDocument(updated);
      setDocuments((items) => updateDocumentInList(items, updated));
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        t("Document segments reprocessed. Rebuild Milvus index when retrieval should update.")
      );
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateDocumentParentMode(parentMode: "paragraph" | "full_doc") {
    await handleUpdateDocumentProcessingSettings({ parent_mode: parentMode });
  }

  async function handleUpdateDocumentProcessingSettings(input: {
    parent_mode?: "paragraph" | "full_doc";
    process_rule?: unknown;
  }) {
    if (!currentDocument || currentDocument.type !== "page") {
      return;
    }
    if (hasUnsavedChanges || saveState === "saving") {
      setMessage(t("Save the document before changing processing settings."));
      return;
    }
    setIsBusy(true);
    setMessage("");
    try {
      await updateDocumentProcessing(currentDocument.id, input);
      const updated = await getDocument(currentDocument.id);
      setCurrentDocument(updated);
      setDocuments((items) => updateDocumentInList(items, updated));
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(t("Document processing settings updated. Reprocess segments to apply them."));
    } catch (error) {
      handleApiError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateDocumentSegment(
    chunk: DocumentChunk,
    patch: Parameters<typeof updateDocumentSegment>[2]
  ) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      const updated = await updateDocumentSegment(currentDocument.id, chunk.id, patch);
      setDocumentChunks((items) => {
        const nextItems = items.map((item) => (item.id === updated.id ? updated : item));
        return showDeletedSegments
          ? nextItems
          : nextItems.filter((item) => item.status !== "deleted");
      });
      setMessage(t(updated.rebuild_hint));
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleCreateQaPair(input: {
    question: string;
    answer: string;
    source_chunk_id?: string | null;
  }) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      const created = await createDocumentQaPair(currentDocument.id, input);
      setDocumentQaPairs((items) => [created, ...items]);
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        t("QA updated. Reprocess segments, then rebuild Milvus index before retrieval updates.")
      );
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleUpdateQaPair(
    qaPair: DocumentQaPair,
    patch: Parameters<typeof updateDocumentQaPair>[2]
  ) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      const updated = await updateDocumentQaPair(currentDocument.id, qaPair.id, patch);
      setDocumentQaPairs((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(
        t("QA updated. Reprocess segments, then rebuild Milvus index before retrieval updates.")
      );
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleImportQaPairs(csv: string) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      const result = await importDocumentQaPairs(currentDocument.id, { csv });
      setDocumentQaPairs((items) => [...result.items, ...items]);
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        result.errors.length > 0
          ? t("Imported {created} QA pairs with {errors} errors.", {
              created: result.created,
              errors: result.errors.length
            })
          : t("Imported {count} QA pairs.", { count: result.created })
      );
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleGenerateQaPairs(input: {
    mode: "llm" | "mock";
    scope: "document" | "segments";
    count?: number;
    overwrite?: boolean;
  }) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      const result = await generateDocumentQaPairs(currentDocument.id, input);
      setDocumentQaPairs((items) => (input.overwrite ? result.items : [...result.items, ...items]));
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(
        result.warnings.length > 0
          ? t("Generated {count} QA pairs with warnings.", { count: result.created })
          : t("Generated {count} QA pairs.", { count: result.created })
      );
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleGenerateSummary(input: Parameters<typeof generateDocumentSummary>[1]) {
    if (!currentDocument) {
      return;
    }
    setMessage("");
    try {
      await generateDocumentSummary(currentDocument.id, input);
      const summaries = await listDocumentSummaries(currentDocument.id);
      setDocumentSummaries(summaries);
      setDocumentSideRefreshKey((value) => value + 1);
      setMessage(t("Summary updated. Rebuild Milvus index before retrieval updates."));
    } catch (error) {
      handleApiError(error);
    }
  }

  async function handleSaveDocumentMetadata() {
    if (!currentDocument) {
      return;
    }
    setDocumentMetadataSaving(true);
    setMessage("");
    try {
      const updated = await updateDocumentMetadata(currentDocument.id, {
        values: documentMetadataDraft
      });
      setDocumentMetadata(updated);
      setDocumentMetadataDraft(toEditableMetadataValues(updated));
      setMessage(t("Metadata saved."));
    } catch (error) {
      handleApiError(error);
    } finally {
      setDocumentMetadataSaving(false);
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
    <main className="flex h-screen overflow-hidden bg-zinc-50 text-zinc-950">
      <aside className="hidden h-full w-64 shrink-0 overflow-hidden border-r border-zinc-200 bg-white md:flex md:flex-col">
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
                  {knowledgeBase.requires_takeover ? (
                    <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      {t("Admin visible")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
          <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_240px]">
            <aside className="flex min-h-0 flex-col overflow-hidden border-b border-zinc-200 bg-zinc-50/70 lg:border-b-0 lg:border-r">
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
                    disabled={
                      !selectedKnowledgeBaseId ||
                      selectedKnowledgeBaseContentLocked ||
                      isBusy ||
                      isImporting
                    }
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
                    disabled={
                      !selectedKnowledgeBaseId || selectedKnowledgeBaseContentLocked || isBusy
                    }
                    onClick={() => void handleCreateDocument("folder")}
                    title={t("New folder")}
                    type="button"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </button>
                  <button
                    className="icon-button"
                    disabled={
                      !selectedKnowledgeBaseId || selectedKnowledgeBaseContentLocked || isBusy
                    }
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

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
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

            <article className="min-h-0 min-w-0 overflow-hidden bg-white">
              {currentDocument ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-zinc-200 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {currentDocument.type === "page" ? (
                        <ModeSwitch
                          canEdit={canEditCurrentDocument}
                          mode={
                            mode === "source"
                              ? "source"
                              : mode === "segments"
                                ? "segments"
                                : canEditCurrentDocument
                                  ? "edit"
                                  : "read"
                          }
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
                            <HelpTip
                              text={t(
                                "Publish indexing help",
                                undefined,
                                "Publishing automatically reprocesses this document's PostgreSQL segments. It does not write Milvus embeddings or switch the Milvus alias; rebuild the Milvus index when search, MCP, or Dify should use the new content."
                              )}
                            />
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
                    className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
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
                    ) : mode === "segments" ? (
                      <DocumentSegmentsView
                        chunks={documentChunks}
                        currentDocument={currentDocument}
                        documentQaLoading={documentQaLoading}
                        documentQaPairs={documentQaPairs}
                        documentSummaries={documentSummaries}
                        documentSummariesLoading={documentSummariesLoading}
                        hasUnsavedChanges={hasUnsavedChanges}
                        loading={documentChunksLoading}
                        onCreateQaPair={(input) => void handleCreateQaPair(input)}
                        onGenerateQaPairs={(input) => void handleGenerateQaPairs(input)}
                        onGenerateSummary={(input) => void handleGenerateSummary(input)}
                        onImportQaPairs={(csv) => void handleImportQaPairs(csv)}
                        onReprocessDocument={() => void handleReprocessDocument()}
                        onUpdateDocumentProcessing={(input) =>
                          void handleUpdateDocumentProcessingSettings(input)
                        }
                        onUpdateQaPair={(qaPair, patch) => void handleUpdateQaPair(qaPair, patch)}
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
              ) : selectedKnowledgeBase?.requires_takeover ? (
                <AdminVisibleKnowledgeBasePanel
                  isBusy={isBusy}
                  onTakeover={() => void handleTakeoverKnowledgeBase()}
                />
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

            <aside className="hidden min-h-0 overflow-hidden border-l border-zinc-200 bg-zinc-50/70 xl:flex xl:flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                {currentDocument ? (
                  <DocumentSidePanel
                    activeOutlineId={activeOutlineId}
                    chunks={documentChunks}
                    chunksLoading={documentChunksLoading}
                    currentDocument={currentDocument}
                    currentMarkdown={savedMarkdown}
                    documentQaPairs={documentQaPairs}
                    documentQaLoading={documentQaLoading}
                    documentSummaries={documentSummaries}
                    documentSummariesLoading={documentSummariesLoading}
                    metadata={documentMetadata}
                    metadataDraft={documentMetadataDraft}
                    metadataLoading={documentMetadataLoading}
                    metadataSaving={documentMetadataSaving}
                    onIncludeDeletedSegmentsChange={setShowDeletedSegments}
                    onOpenDashboard={() => {
                      if (selectedKnowledgeBaseId) {
                        void selectKnowledgeBase(selectedKnowledgeBaseId);
                      }
                    }}
                    onMetadataDraftChange={(name, value) =>
                      setDocumentMetadataDraft((current) => ({ ...current, [name]: value }))
                    }
                    onCreateQaPair={(input) => void handleCreateQaPair(input)}
                    onGenerateQaPairs={(input) => void handleGenerateQaPairs(input)}
                    onGenerateSummary={(input) => void handleGenerateSummary(input)}
                    onImportQaPairs={(csv) => void handleImportQaPairs(csv)}
                    onReprocessDocument={() => void handleReprocessDocument()}
                    onRestoreVersion={(versionId) => void handleRestoreVersion(versionId)}
                    onSaveMetadata={() => void handleSaveDocumentMetadata()}
                    onSelectOutline={jumpToOutlineItem}
                    onSelectTab={setDocumentSideTab}
                    onSelectVersion={setSelectedVersionId}
                    onUpdateDocumentParentMode={(parentMode) =>
                      void handleUpdateDocumentParentMode(parentMode)
                    }
                    onUpdateQaPair={(qaPair, patch) => void handleUpdateQaPair(qaPair, patch)}
                    onUpdateSegment={(chunk, patch) =>
                      void handleUpdateDocumentSegment(chunk, patch)
                    }
                    outline={outline}
                    references={markdownReferences}
                    selectedVersion={selectedVersion}
                    selectedVersionId={selectedVersionId}
                    selectedVersionLoading={selectedVersionLoading}
                    showDeletedSegments={showDeletedSegments}
                    tab={documentSideTab}
                    versions={documentVersions}
                    versionsLoading={documentVersionsLoading}
                    onOpenDocument={(documentId) => void selectDocument(documentId)}
                  />
                ) : (
                  <KnowledgeBaseSidePanel
                    contentLocked={selectedKnowledgeBaseContentLocked}
                    documents={documents}
                    isBusy={isBusy}
                    knowledgeBase={selectedKnowledgeBase}
                    onCreateDocument={() => void handleCreateDocument("page")}
                    onCreateFolder={() => void handleCreateDocument("folder")}
                    onOpenAccess={() => setActiveWorkbenchPanel("access")}
                    onOpenShare={() => setActiveWorkbenchPanel("share")}
                    workspace={selectedWorkspace}
                  />
                )}
              </div>
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
      {createKbDialogOpen ? (
        <CreateKnowledgeBaseDialog
          disabled={isBusy}
          docForm={createKbDocForm}
          onClose={() => setCreateKbDialogOpen(false)}
          onDocFormChange={setCreateKbDocForm}
          onSubmit={handleSubmitCreateKnowledgeBase}
          onTitleChange={setCreateKbTitle}
          title={createKbTitle}
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

function CreateKnowledgeBaseDialog({
  disabled,
  docForm,
  onClose,
  onDocFormChange,
  onSubmit,
  onTitleChange,
  title
}: {
  disabled: boolean;
  docForm: ChunkSettings["doc_form"];
  onClose: () => void;
  onDocFormChange: (value: ChunkSettings["doc_form"]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  title: string;
}) {
  const { t } = useI18n();
  const options: Array<{
    docForm: ChunkSettings["doc_form"];
    icon: ReactNode;
    title: string;
    description: string;
  }> = [
    {
      docForm: "text_model",
      icon: <FileText className="h-4 w-4" />,
      title: "Segment knowledge base",
      description: "Use standard segmentation for ordinary Markdown documents."
    },
    {
      docForm: "hierarchical_model",
      icon: <BookOpen className="h-4 w-4" />,
      title: "Parent-child knowledge base",
      description: "Use paragraph parent-child or full-doc parent-child retrieval."
    },
    {
      docForm: "qa_model",
      icon: <Sparkles className="h-4 w-4" />,
      title: "QA knowledge base",
      description: "Index questions and return answers through search, MCP, and Dify."
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <form
        className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-5 shadow-xl"
        onSubmit={onSubmit}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">{t("Create knowledge base")}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t(
                "Choose a knowledge base type first. It cannot be changed directly later; create another knowledge base or migrate content if the type is wrong."
              )}
            </p>
          </div>
          <button
            className="icon-button"
            disabled={disabled}
            onClick={onClose}
            title={t("Cancel")}
            type="button"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-5 block text-sm">
          <span className="mb-1 block font-medium text-zinc-600">{t("Knowledge base title")}</span>
          <input
            autoFocus
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500"
            disabled={disabled}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={t("Knowledge base title")}
            value={title}
          />
        </label>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {options.map((option) => {
            const selected = docForm === option.docForm;
            return (
              <button
                className={`rounded-md border p-3 text-left transition ${
                  selected
                    ? "border-emerald-400 bg-emerald-50 text-emerald-950"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
                disabled={disabled}
                key={option.docForm}
                onClick={() => onDocFormChange(option.docForm)}
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${
                      selected ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {option.icon}
                  </span>
                  {t(option.title)}
                </span>
                <span className="mt-2 block text-xs leading-5 text-zinc-500">
                  {t(option.description)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            disabled={disabled}
            onClick={onClose}
            type="button"
          >
            {t("Cancel")}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            disabled={disabled || !title.trim()}
            type="submit"
          >
            {t("Create")}
          </button>
        </div>
      </form>
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

function KnowledgeBaseSidePanel({
  contentLocked,
  documents,
  isBusy,
  knowledgeBase,
  onCreateDocument,
  onCreateFolder,
  onOpenAccess,
  onOpenShare,
  workspace
}: {
  contentLocked: boolean;
  documents: DocumentSummary[];
  isBusy: boolean;
  knowledgeBase: KnowledgeBase | undefined;
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onOpenAccess: () => void;
  onOpenShare: () => void;
  workspace: Workspace | undefined;
}) {
  const { t } = useI18n();
  const pages = documents.filter((document) => document.type === "page").length;
  const folders = documents.filter((document) => document.type === "folder").length;
  const needsReprocess = documents.filter(
    (document) => document.processing_status === "needs_reprocess"
  ).length;
  const canCreate = Boolean(knowledgeBase) && !contentLocked && !isBusy;

  return (
    <div className="min-h-0">
      <div className="border-b border-zinc-200 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <BookOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-950">
              {knowledgeBase?.title ?? t("No knowledge base selected")}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {workspace?.name ?? t("No workspace selected")}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          {t(
            "This side panel follows the knowledge base home. Select a page to view document outline, segments, QA, summary, metadata, and versions."
          )}
        </p>
      </div>

      {knowledgeBase ? (
        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <KnowledgeBaseSideMetric
              icon={<FileText className="h-4 w-4" />}
              label={t("Pages")}
              value={pages}
            />
            <KnowledgeBaseSideMetric
              icon={<Folder className="h-4 w-4" />}
              label={t("Folders")}
              value={folders}
            />
          </div>

          <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
            <div className="grid gap-2">
              <SnapshotRow label={t("Visibility")} value={t(knowledgeBase.visibility)} />
              <SnapshotRow label={t("Status")} value={t(knowledgeBase.status)} />
              <SnapshotRow label={t("Role")} value={t(knowledgeBase.role ?? "-")} />
              <SnapshotRow
                label={t("Needs reprocess")}
                value={t("{count} documents", { count: needsReprocess })}
              />
            </div>
          </div>

          {contentLocked ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <p className="font-semibold">{t("Admin visible, content locked")}</p>
              <p className="mt-1">
                {t(
                  "You can manage metadata here, but private content requires an audited takeover before document panels are available."
                )}
              </p>
            </div>
          ) : null}

          <div className="grid gap-2">
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-zinc-300"
              disabled={!canCreate}
              onClick={onCreateDocument}
              type="button"
            >
              <Plus className="h-4 w-4" />
              {t("New document")}
            </button>
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
              disabled={!canCreate}
              onClick={onCreateFolder}
              type="button"
            >
              <FolderPlus className="h-4 w-4" />
              {t("New folder")}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={onOpenAccess}
              type="button"
            >
              <Users className="h-3.5 w-3.5" />
              {t("Access")}
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={onOpenShare}
              type="button"
            >
              <Share2 className="h-3.5 w-3.5" />
              {t("Share")}
            </button>
          </div>
        </div>
      ) : (
        <EmptyPanel
          title={t("No knowledge base selected")}
          action={t("Select or create a knowledge base from the left rail.")}
        />
      )}
    </div>
  );
}

function KnowledgeBaseSideMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function DocumentSegmentsView({
  chunks,
  currentDocument,
  documentQaLoading,
  documentQaPairs,
  documentSummaries,
  documentSummariesLoading,
  hasUnsavedChanges,
  loading,
  onCreateQaPair,
  onGenerateQaPairs,
  onGenerateSummary,
  onImportQaPairs,
  onReprocessDocument,
  onUpdateDocumentProcessing,
  onUpdateQaPair
}: {
  chunks: DocumentChunk[];
  currentDocument: DocumentDetail;
  documentQaLoading: boolean;
  documentQaPairs: DocumentQaPair[];
  documentSummaries: DocumentSummariesResponse | null;
  documentSummariesLoading: boolean;
  hasUnsavedChanges: boolean;
  loading: boolean;
  onCreateQaPair: (input: {
    question: string;
    answer: string;
    source_chunk_id?: string | null;
  }) => void;
  onGenerateQaPairs: (input: {
    mode: "llm" | "mock";
    scope: "document" | "segments";
    count?: number;
    overwrite?: boolean;
  }) => void;
  onGenerateSummary: (input: Parameters<typeof generateDocumentSummary>[1]) => void;
  onImportQaPairs: (csv: string) => void;
  onReprocessDocument: () => void;
  onUpdateDocumentProcessing: (input: {
    parent_mode?: "paragraph" | "full_doc";
    process_rule?: unknown;
  }) => void;
  onUpdateQaPair: (
    qaPair: DocumentQaPair,
    patch: Parameters<typeof updateDocumentQaPair>[2]
  ) => void;
}) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const visibleSegments = chunks.filter(
    (chunk) => chunk.status !== "deleted" && isMeaningfulDocumentSegment(chunk)
  );
  const parents = visibleSegments.filter((chunk) => chunk.chunk_type === "parent");
  const children = visibleSegments.filter((chunk) => chunk.chunk_type === "child");
  const generalSegments = visibleSegments.filter((chunk) => chunk.chunk_type === "general");
  const childrenByParent = new Map<string, DocumentChunk[]>();
  for (const child of children) {
    if (!child.parent_chunk_id) {
      continue;
    }
    const current = childrenByParent.get(child.parent_chunk_id) ?? [];
    current.push(child);
    childrenByParent.set(child.parent_chunk_id, current);
  }
  const parentSegments = parents.map((parent) => ({
    children: childrenByParent.get(parent.id) ?? [],
    parent
  }));
  const parentCount = parents.length;
  const childCount = children.length;
  const generalCount = generalSegments.length;
  const hasSegments = generalSegments.length > 0 || parentSegments.length > 0;
  const canManageDerivedContent = canEditDocumentRole(currentDocument.role);
  const isQaDocument = currentDocument.doc_form === "qa_model";
  const isParentChildDocument = currentDocument.doc_form === "hierarchical_model";
  const parentExpansionKey = parentSegments
    .map(({ children, parent }) => `${parent.id}:${children.length}`)
    .join("|");
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(() => new Set());
  const lastParentExpansionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const parentSetChanged = lastParentExpansionKeyRef.current !== parentExpansionKey;
    lastParentExpansionKeyRef.current = parentExpansionKey;
    setExpandedParentIds((current) => {
      const visibleParentIds = new Set(parentSegments.map(({ parent }) => parent.id));
      const next = new Set([...current].filter((id) => visibleParentIds.has(id)));
      if (parentSetChanged && next.size === 0) {
        const firstExpandableParent = parentSegments.find(({ children }) => children.length > 0)
          ?.parent.id;
        if (firstExpandableParent) {
          next.add(firstExpandableParent);
        }
      }
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, [parentExpansionKey, parentSegments]);

  function toggleParentSegment(parentId: string) {
    setExpandedParentIds((current) => {
      const next = new Set(current);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">{t("Document segments")}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {t(
                "Segments are generated from saved Markdown during publish or explicit reprocess. They are retrieval inputs, not editable body content."
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SegmentCountBadge label={t("general")} value={generalCount} />
            <SegmentCountBadge label={t("parent")} value={parentCount} />
            <SegmentCountBadge label={t("child")} value={childCount} />
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => setSettingsOpen((value) => !value)}
              type="button"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t("Segment settings")}
            </button>
          </div>
        </div>
      </div>

      {settingsOpen ? (
        <DocumentSegmentSettingsPanel
          canManage={canManageDerivedContent}
          currentDocument={currentDocument}
          hasUnsavedChanges={hasUnsavedChanges}
          onReprocessDocument={onReprocessDocument}
          onSave={onUpdateDocumentProcessing}
        />
      ) : null}

      {hasUnsavedChanges ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {t(
            "Unsaved edits are not reflected here. Save and publish or reprocess to regenerate segments."
          )}
        </div>
      ) : null}

      {currentDocument.processing_status === "needs_reprocess" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span>{t("This document changed after its segments were generated.")}</span>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800 disabled:bg-amber-200 disabled:text-amber-500"
            disabled={!canManageDerivedContent}
            onClick={onReprocessDocument}
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Reprocess document segments")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <EditorLoadingFallback />
      ) : !hasSegments ? (
        <EmptyPanel
          title={t("No segments for this document")}
          action={t("Publish or reprocess this document to generate segments.")}
        />
      ) : (
        <div className="space-y-3">
          {generalSegments.map((chunk) => (
            <SegmentCard chunk={chunk} key={chunk.id} />
          ))}
          {parentSegments.map(({ parent, children }) => (
            <ParentSegmentCard
              childrenSegments={children}
              isExpanded={expandedParentIds.has(parent.id)}
              key={parent.id}
              onToggle={() => toggleParentSegment(parent.id)}
              parent={parent}
            />
          ))}
        </div>
      )}

      {isQaDocument ? (
        <DocumentQaWorkspace
          canManage={canManageDerivedContent}
          documentQaLoading={documentQaLoading}
          documentQaPairs={documentQaPairs}
          onCreateQaPair={onCreateQaPair}
          onGenerateQaPairs={onGenerateQaPairs}
          onImportQaPairs={onImportQaPairs}
          onUpdateQaPair={onUpdateQaPair}
        />
      ) : isParentChildDocument ? (
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-xs leading-5 text-zinc-500">
          {t(
            "Parent-child knowledge bases show child segments inside each parent segment. Edit segment status and overrides from the segment settings workflow."
          )}
        </div>
      ) : null}

      <DocumentSummaryWorkspace
        canManage={canManageDerivedContent}
        documentSummaries={documentSummaries}
        documentSummariesLoading={documentSummariesLoading}
        onGenerateSummary={onGenerateSummary}
      />
    </div>
  );
}

type SegmentRuleDraft = {
  parentMode: "paragraph" | "full_doc";
  removeExtraSpaces: boolean;
  removeUrlsEmails: boolean;
  parentSeparator: string;
  parentMaxTokens: number;
  parentOverlap: number;
  childSeparator: string;
  childMaxTokens: number;
  childOverlap: number;
};

function DocumentSegmentSettingsPanel({
  canManage,
  currentDocument,
  hasUnsavedChanges,
  onReprocessDocument,
  onSave
}: {
  canManage: boolean;
  currentDocument: DocumentDetail;
  hasUnsavedChanges: boolean;
  onReprocessDocument: () => void;
  onSave: (input: { parent_mode?: "paragraph" | "full_doc"; process_rule?: unknown }) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SegmentRuleDraft>(() =>
    createSegmentRuleDraft(currentDocument)
  );
  const docForm = currentDocument.doc_form ?? "text_model";
  const isParentChild = docForm === "hierarchical_model";
  const isQa = docForm === "qa_model";

  useEffect(() => {
    setDraft(createSegmentRuleDraft(currentDocument));
  }, [currentDocument.id, currentDocument.process_rule_snapshot]);

  function updateDraft(patch: Partial<SegmentRuleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleSaveSettings() {
    const processRule = {
      pre_processing_rules: [
        { id: "remove_extra_spaces", enabled: draft.removeExtraSpaces },
        { id: "remove_urls_emails", enabled: draft.removeUrlsEmails }
      ],
      parent_mode: draft.parentMode === "full_doc" ? "full-doc" : "paragraph",
      segmentation: {
        separator: parseSeparatorInput(draft.parentSeparator),
        max_tokens: draft.parentMaxTokens,
        chunk_overlap: draft.parentOverlap
      },
      subchunk_segmentation: {
        separator: parseSeparatorInput(draft.childSeparator),
        max_tokens: draft.childMaxTokens,
        chunk_overlap: draft.childOverlap
      }
    };
    onSave({
      parent_mode: draft.parentMode,
      process_rule: processRule
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950">{t("Segment settings")}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {canManage
              ? t(
                  "These settings are saved as a document processing override. They take effect after explicit reprocess and never rewrite Markdown."
                )
              : t(
                  "This is a read-only snapshot of the document processing settings. Editors can save overrides and reprocess segments."
                )}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            currentDocument.processing_status === "needs_reprocess"
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {t(currentDocument.processing_status ?? "current")}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-700">{t("Text preprocessing rules")}</p>
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
              <input
                checked={draft.removeExtraSpaces}
                className="h-4 w-4 rounded border-zinc-300"
                disabled={!canManage}
                onChange={(event) => updateDraft({ removeExtraSpaces: event.target.checked })}
                type="checkbox"
              />
              {t("Remove extra spaces")}
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
              <input
                checked={draft.removeUrlsEmails}
                className="h-4 w-4 rounded border-zinc-300"
                disabled={!canManage}
                onChange={(event) => updateDraft({ removeUrlsEmails: event.target.checked })}
                type="checkbox"
              />
              {t("Remove bare URLs and emails")}
            </label>
          </div>

          {isParentChild ? (
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-zinc-600">{t("Parent-child mode")}</span>
              <select
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-500"
                disabled={!canManage}
                onChange={(event) =>
                  updateDraft({ parentMode: event.target.value as "paragraph" | "full_doc" })
                }
                value={draft.parentMode}
              >
                <option value="paragraph">{t("Paragraph parent-child")}</option>
                <option value="full_doc">{t("Full-doc parent-child")}</option>
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <SegmentNumberInput
              disabled={!canManage}
              label={isParentChild ? t("Parent chars") : t("Segment chars")}
              onChange={(value) => updateDraft({ parentMaxTokens: value })}
              value={draft.parentMaxTokens}
            />
            <SegmentNumberInput
              disabled={!canManage}
              label={t("Parent/standard overlap")}
              onChange={(value) => updateDraft({ parentOverlap: value })}
              value={draft.parentOverlap}
            />
            <label className="block text-xs sm:col-span-1">
              <span className="mb-1 block font-medium text-zinc-600">
                {isParentChild ? t("Parent delimiter") : t("Delimiter")}
              </span>
              <input
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 font-mono outline-none focus:border-emerald-500"
                disabled={!canManage}
                onChange={(event) => updateDraft({ parentSeparator: event.target.value })}
                value={draft.parentSeparator}
              />
            </label>
          </div>
        </div>

        <div className="space-y-3">
          {isParentChild ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <SegmentNumberInput
                disabled={!canManage}
                label={t("Child chars")}
                onChange={(value) => updateDraft({ childMaxTokens: value })}
                value={draft.childMaxTokens}
              />
              <SegmentNumberInput
                disabled={!canManage}
                label={t("Child overlap")}
                onChange={(value) => updateDraft({ childOverlap: value })}
                value={draft.childOverlap}
              />
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-zinc-600">{t("Child delimiter")}</span>
                <input
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 font-mono outline-none focus:border-emerald-500"
                  disabled={!canManage}
                  onChange={(event) => updateDraft({ childSeparator: event.target.value })}
                  value={draft.childSeparator}
                />
              </label>
            </div>
          ) : isQa ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
              {t(
                "QA knowledge bases index active QA questions during reprocess and return answers in retrieval."
              )}
            </div>
          ) : (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
              {t("Standard segmentation uses one segment level.")}
            </div>
          )}

          <div className="rounded-md border border-zinc-200 bg-zinc-950 p-3">
            <p className="text-xs font-semibold text-zinc-200">{t("Process rule preview")}</p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-zinc-50">
              {formatJsonForPanel({
                pre_processing_rules: [
                  { id: "remove_extra_spaces", enabled: draft.removeExtraSpaces },
                  { id: "remove_urls_emails", enabled: draft.removeUrlsEmails }
                ],
                parent_mode: draft.parentMode === "full_doc" ? "full-doc" : "paragraph",
                segmentation: {
                  separator: parseSeparatorInput(draft.parentSeparator),
                  max_tokens: draft.parentMaxTokens,
                  chunk_overlap: draft.parentOverlap
                },
                subchunk_segmentation: {
                  separator: parseSeparatorInput(draft.childSeparator),
                  max_tokens: draft.childMaxTokens,
                  chunk_overlap: draft.childOverlap
                }
              })}
            </pre>
          </div>
        </div>
      </div>

      {hasUnsavedChanges ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("Save the document before changing processing settings.")}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          disabled={!canManage}
          onClick={onReprocessDocument}
          type="button"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("Reprocess document segments")}
        </button>
        <button
          className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800"
          disabled={!canManage || hasUnsavedChanges}
          onClick={handleSaveSettings}
          type="button"
        >
          {t("Save segment settings")}
        </button>
      </div>
    </section>
  );
}

function SegmentNumberInput({
  disabled,
  label,
  onChange,
  value
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-zinc-600">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-500"
        disabled={disabled}
        min={0}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        type="number"
        value={value}
      />
    </label>
  );
}

function DocumentQaWorkspace({
  canManage,
  documentQaLoading,
  documentQaPairs,
  onCreateQaPair,
  onGenerateQaPairs,
  onImportQaPairs,
  onUpdateQaPair
}: {
  canManage: boolean;
  documentQaLoading: boolean;
  documentQaPairs: DocumentQaPair[];
  onCreateQaPair: (input: {
    question: string;
    answer: string;
    source_chunk_id?: string | null;
  }) => void;
  onGenerateQaPairs: (input: {
    mode: "llm" | "mock";
    scope: "document" | "segments";
    count?: number;
    overwrite?: boolean;
  }) => void;
  onImportQaPairs: (csv: string) => void;
  onUpdateQaPair: (
    qaPair: DocumentQaPair,
    patch: Parameters<typeof updateDocumentQaPair>[2]
  ) => void;
}) {
  const { t } = useI18n();
  const [questionDraft, setQuestionDraft] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [csvDraft, setCsvDraft] = useState("");

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950">{t("QA pairs")}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {t("Questions are indexed; answers are returned to search, MCP, and Dify.")}
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
          {t("Requires reprocess")}
        </span>
      </div>

      {canManage ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-zinc-600">{t("Question")}</span>
              <input
                className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 outline-none focus:border-emerald-500"
                onChange={(event) => setQuestionDraft(event.target.value)}
                value={questionDraft}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-zinc-600">{t("Answer")}</span>
              <textarea
                className="min-h-24 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 outline-none focus:border-emerald-500"
                onChange={(event) => setAnswerDraft(event.target.value)}
                value={answerDraft}
              />
            </label>
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
              disabled={!questionDraft.trim() || !answerDraft.trim()}
              onClick={() => {
                onCreateQaPair({ question: questionDraft, answer: answerDraft });
                setQuestionDraft("");
                setAnswerDraft("");
              }}
              type="button"
            >
              {t("Add QA pair")}
            </button>
          </div>

          <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3" open>
            <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
              {t("CSV import and generation")}
            </summary>
            <div className="mt-3 space-y-3">
              <textarea
                className="min-h-24 w-full rounded-md border border-zinc-300 bg-white px-2 py-2 font-mono text-xs outline-none focus:border-emerald-500"
                onChange={(event) => setCsvDraft(event.target.value)}
                placeholder="question,answer"
                value={csvDraft}
              />
              <button
                className="inline-flex h-8 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                disabled={!csvDraft.trim()}
                onClick={() => {
                  onImportQaPairs(csvDraft);
                  setCsvDraft("");
                }}
                type="button"
              >
                {t("Import CSV")}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => onGenerateQaPairs({ mode: "mock", scope: "segments", count: 6 })}
                  type="button"
                >
                  {t("Generate mock QA")}
                </button>
                <button
                  className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => onGenerateQaPairs({ mode: "llm", scope: "document", count: 6 })}
                  type="button"
                >
                  {t("Generate LLM QA")}
                </button>
              </div>
            </div>
          </details>
        </div>
      ) : null}

      {documentQaLoading ? (
        <EditorLoadingFallback />
      ) : documentQaPairs.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {documentQaPairs.map((pair) => (
            <article
              className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs"
              key={pair.id}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                  {t(pair.source)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    pair.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : pair.status === "deleted"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {t(pair.status)}
                </span>
              </div>
              <p className="mt-2 font-semibold text-zinc-900">{pair.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-zinc-600">{pair.answer}</p>
              {canManage ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() =>
                      onUpdateQaPair(pair, {
                        status: pair.status === "active" ? "disabled" : "active"
                      })
                    }
                    type="button"
                  >
                    {pair.status === "active" ? t("Disable") : t("Enable")}
                  </button>
                  <button
                    className="inline-flex h-8 items-center rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    onClick={() => onUpdateQaPair(pair, { status: "deleted" })}
                    type="button"
                  >
                    {t("Delete")}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyPanel title={t("No QA pairs")} action={t("Add QA manually or import CSV.")} />
      )}
    </section>
  );
}

function DocumentSummaryWorkspace({
  canManage,
  documentSummaries,
  documentSummariesLoading,
  onGenerateSummary
}: {
  canManage: boolean;
  documentSummaries: DocumentSummariesResponse | null;
  documentSummariesLoading: boolean;
  onGenerateSummary: (input: Parameters<typeof generateDocumentSummary>[1]) => void;
}) {
  const { t } = useI18n();
  const [summaryDraft, setSummaryDraft] = useState("");

  return (
    <details className="rounded-md border border-zinc-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-950">
        {t("Summaries")}
      </summary>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        {t("Summaries are derived retrieval indexes and never rewrite Markdown.")}
      </p>
      {canManage ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <textarea
            className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            onChange={(event) => setSummaryDraft(event.target.value)}
            placeholder={t("Document summary")}
            value={summaryDraft}
          />
          <div className="grid gap-2">
            <button
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
              disabled={!summaryDraft.trim()}
              onClick={() => {
                onGenerateSummary({
                  scope: "document",
                  mode: "manual",
                  summary: summaryDraft
                });
                setSummaryDraft("");
              }}
              type="button"
            >
              {t("Save document summary")}
            </button>
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => onGenerateSummary({ scope: "document", mode: "mock" })}
              type="button"
            >
              {t("Mock document summary")}
            </button>
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => onGenerateSummary({ scope: "all_segments", mode: "mock" })}
              type="button"
            >
              {t("Mock all segment summaries")}
            </button>
          </div>
        </div>
      ) : null}
      {documentSummariesLoading ? (
        <EditorLoadingFallback />
      ) : documentSummaries ? (
        <div className="mt-3 grid gap-3">
          {documentSummaries.document_summary ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
              <p className="font-semibold text-zinc-900">{t("Document summary")}</p>
              <p className="mt-2 whitespace-pre-wrap text-zinc-600">
                {documentSummaries.document_summary.summary}
              </p>
            </div>
          ) : null}
          {documentSummaries.segment_summaries.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700">
                {t("Segment summaries")} ({documentSummaries.segment_summaries.length})
              </p>
              {documentSummaries.segment_summaries.map((summary) => (
                <div
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs"
                  key={summary.id}
                >
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    {t(summary.status)}
                  </span>
                  <p className="mt-2 whitespace-pre-wrap text-zinc-600">{summary.summary}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function createSegmentRuleDraft(currentDocument: DocumentDetail): SegmentRuleDraft {
  const snapshot = toPanelRecord(currentDocument.process_rule_snapshot);
  const processRule = toPanelRecord(snapshot.process_rule ?? snapshot);
  const segmentation = toPanelRecord(processRule.segmentation);
  const subchunkSegmentation = toPanelRecord(processRule.subchunk_segmentation);
  const preProcessingRules = Array.isArray(processRule.pre_processing_rules)
    ? processRule.pre_processing_rules
    : [];
  const docForm = currentDocument.doc_form ?? "text_model";
  const parentMode =
    readPanelParentMode(processRule.parent_mode ?? snapshot.parent_mode) ?? "paragraph";
  return {
    parentMode,
    removeExtraSpaces: readPreProcessingRule(preProcessingRules, "remove_extra_spaces", true),
    removeUrlsEmails: readPreProcessingRule(preProcessingRules, "remove_urls_emails", false),
    parentSeparator: formatSeparatorForInput(readString(segmentation.separator, "\n\n")),
    parentMaxTokens: readNumber(
      segmentation.max_tokens,
      docForm === "hierarchical_model" ? 1024 : 1024
    ),
    parentOverlap: readNumber(
      segmentation.chunk_overlap,
      docForm === "hierarchical_model" ? 0 : 50
    ),
    childSeparator: formatSeparatorForInput(readString(subchunkSegmentation.separator, "\n")),
    childMaxTokens: readNumber(subchunkSegmentation.max_tokens, 512),
    childOverlap: readNumber(subchunkSegmentation.chunk_overlap, 50)
  };
}

function readPreProcessingRule(
  rules: unknown[],
  id: "remove_extra_spaces" | "remove_urls_emails",
  fallback: boolean
) {
  const found = rules.find((rule) => toPanelRecord(rule).id === id);
  return found ? toPanelRecord(found).enabled === true : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatSeparatorForInput(value: string): string {
  return value.replace(/\t/g, "\\t").replace(/\n/g, "\\n");
}

function parseSeparatorInput(value: string): string {
  return value.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
}

function SegmentCountBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-600">
      {label}: {value}
    </span>
  );
}

function SegmentCard({ chunk }: { chunk: DocumentChunk }) {
  const { t } = useI18n();
  const effectiveText = effectiveSegmentText(chunk);
  const sourceText = chunk.source_content_text ?? effectiveText;
  return (
    <article
      className={`rounded-md border bg-white p-4 ${
        chunk.status === "disabled" ? "border-zinc-200 opacity-70" : "border-zinc-200"
      }`}
    >
      <SegmentHeader chunk={chunk} />
      {chunk.heading_path.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-500">{chunk.heading_path.join(" / ")}</p>
      ) : null}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-800">{effectiveText}</p>
      {chunk.has_override && sourceText !== effectiveText ? (
        <details className="mt-3 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
          <summary className="cursor-pointer font-medium">{t("Source segment")}</summary>
          <p className="mt-2 whitespace-pre-wrap leading-5">{sourceText}</p>
        </details>
      ) : null}
    </article>
  );
}

function ParentSegmentCard({
  childrenSegments,
  isExpanded,
  onToggle,
  parent
}: {
  childrenSegments: DocumentChunk[];
  isExpanded: boolean;
  onToggle: () => void;
  parent: DocumentChunk;
}) {
  const { t } = useI18n();
  const effectiveText = effectiveSegmentText(parent);
  const parentNumber = String((parent.parent_ordinal ?? parent.ordinal) + 1).padStart(2, "0");
  const characterCount = effectiveText.length;
  const canExpand = childrenSegments.length > 0;
  return (
    <article
      className={`rounded-md border bg-zinc-50/80 px-4 py-3 ${
        parent.status === "disabled" ? "border-zinc-200 opacity-70" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-800">
              {t("Segment-{number}", { number: parentNumber })}
            </span>
            <span>·</span>
            <span>{t("{count} characters", { count: characterCount })}</span>
            {parent.token_count ? (
              <>
                <span>·</span>
                <span>{t("{count} tokens", { count: parent.token_count })}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{t("Recall count not available")}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                parent.status === "active"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {t(parent.status)}
            </span>
            {parent.has_override ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                {t("override")}
              </span>
            ) : null}
          </div>
          {effectiveText ? (
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-zinc-900">
              {effectiveText}
            </p>
          ) : null}
        </div>
      </div>

      {canExpand ? (
        <div className="mt-2">
          <button
            aria-label={t(isExpanded ? "Collapse child segments" : "Expand child segments")}
            aria-expanded={isExpanded}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-2 text-xs font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 hover:bg-zinc-50"
            onClick={onToggle}
            title={t(isExpanded ? "Collapse child segments" : "Expand child segments")}
            type="button"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {t("{count} child segments", { count: childrenSegments.length })}
          </button>
        </div>
      ) : null}

      {canExpand && isExpanded ? (
        <div className="mt-2 space-y-1.5 pl-4">
          {childrenSegments.map((child, index) => (
            <div
              className="flex gap-2 rounded-md bg-white px-2.5 py-1.5 text-xs leading-5 ring-1 ring-zinc-200"
              key={child.id}
            >
              <span className="h-6 shrink-0 rounded bg-emerald-600 px-1.5 text-[11px] font-semibold leading-6 text-white">
                C-{(child.child_ordinal ?? index) + 1}
              </span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-700">
                {effectiveSegmentText(child)}
              </p>
              {child.status !== "active" ? (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  {t(child.status)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {!canExpand ? <p className="mt-3 text-xs text-zinc-500">{t("No child segments")}</p> : null}
    </article>
  );
}

function SegmentHeader({
  chunk,
  hideTokenCount = false
}: {
  chunk: DocumentChunk;
  hideTokenCount?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
          #{chunk.ordinal}
        </span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
          {t(chunk.chunk_type)}
        </span>
        <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-zinc-500">{t(chunk.status)}</span>
        {chunk.index_role && chunk.index_role !== "content" ? (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
            {t(chunk.index_role)}
          </span>
        ) : null}
        {chunk.has_override ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
            {t("override")}
          </span>
        ) : null}
      </div>
      {!hideTokenCount ? (
        <div className="text-xs text-zinc-500">
          {chunk.token_count ? t("{count} tokens", { count: chunk.token_count }) : null}
        </div>
      ) : null}
    </div>
  );
}

function effectiveSegmentText(chunk: DocumentChunk) {
  return chunk.content_text || chunk.content_markdown;
}

function isMeaningfulDocumentSegment(chunk: DocumentChunk) {
  const text = effectiveSegmentText(chunk)
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0;
}

function DocumentSidePanel({
  activeOutlineId,
  chunks,
  chunksLoading,
  currentDocument,
  currentMarkdown,
  documentQaLoading,
  documentQaPairs,
  documentSummaries,
  documentSummariesLoading,
  metadata,
  metadataDraft,
  metadataLoading,
  metadataSaving,
  onIncludeDeletedSegmentsChange,
  onCreateQaPair,
  onGenerateQaPairs,
  onGenerateSummary,
  onImportQaPairs,
  onMetadataDraftChange,
  onOpenDashboard,
  onOpenDocument,
  onReprocessDocument,
  onRestoreVersion,
  onSaveMetadata,
  onSelectOutline,
  onSelectTab,
  onSelectVersion,
  onUpdateDocumentParentMode,
  onUpdateQaPair,
  onUpdateSegment,
  outline,
  references,
  selectedVersion,
  selectedVersionId,
  selectedVersionLoading,
  showDeletedSegments,
  tab,
  versions,
  versionsLoading
}: {
  activeOutlineId: string | null;
  chunks: DocumentChunk[];
  chunksLoading: boolean;
  currentDocument: DocumentDetail | null;
  currentMarkdown: string;
  documentQaLoading: boolean;
  documentQaPairs: DocumentQaPair[];
  documentSummaries: DocumentSummariesResponse | null;
  documentSummariesLoading: boolean;
  metadata: DocumentMetadataResponse | null;
  metadataDraft: Record<string, string>;
  metadataLoading: boolean;
  metadataSaving: boolean;
  onIncludeDeletedSegmentsChange: (value: boolean) => void;
  onCreateQaPair: (input: {
    question: string;
    answer: string;
    source_chunk_id?: string | null;
  }) => void;
  onGenerateQaPairs: (input: {
    mode: "llm" | "mock";
    scope: "document" | "segments";
    count?: number;
    overwrite?: boolean;
  }) => void;
  onGenerateSummary: (input: Parameters<typeof generateDocumentSummary>[1]) => void;
  onImportQaPairs: (csv: string) => void;
  onMetadataDraftChange: (name: string, value: string) => void;
  onOpenDashboard: () => void;
  onOpenDocument: (documentId: string) => void;
  onReprocessDocument: () => void;
  onRestoreVersion: (versionId: string) => void;
  onSaveMetadata: () => void;
  onSelectOutline: (item: MarkdownOutlineItem) => void;
  onSelectTab: (tab: DocumentSideTab) => void;
  onSelectVersion: (versionId: string) => void;
  onUpdateDocumentParentMode: (parentMode: "paragraph" | "full_doc") => void;
  onUpdateQaPair: (
    qaPair: DocumentQaPair,
    patch: Parameters<typeof updateDocumentQaPair>[2]
  ) => void;
  onUpdateSegment: (
    chunk: DocumentChunk,
    patch: Parameters<typeof updateDocumentSegment>[2]
  ) => void;
  outline: MarkdownOutlineItem[];
  references: MarkdownReferenceExtraction;
  selectedVersion: DocumentVersion | null;
  selectedVersionId: string | null;
  selectedVersionLoading: boolean;
  showDeletedSegments: boolean;
  tab: DocumentSideTab;
  versions: DocumentVersionSummary[];
  versionsLoading: boolean;
}) {
  const { t } = useI18n();
  const dialog = useDialog();
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [segmentOverrideDraft, setSegmentOverrideDraft] = useState("");
  const [qaQuestionDraft, setQaQuestionDraft] = useState("");
  const [qaAnswerDraft, setQaAnswerDraft] = useState("");
  const [qaCsvDraft, setQaCsvDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const canRestore = currentDocument ? canEditDocumentRole(currentDocument.role) : false;
  const canManageSegments = currentDocument ? canEditDocumentRole(currentDocument.role) : false;
  const canManageDerivedContent = currentDocument
    ? canEditDocumentRole(currentDocument.role)
    : false;
  const selectedVersionSummary = versions.find((version) => version.id === selectedVersionId);
  const diff = selectedVersion
    ? summarizeMarkdownDiff(currentMarkdown, selectedVersion.markdown)
    : null;
  const hasManagedSegments = chunks.some(
    (chunk) => chunk.status !== "active" || chunk.has_override
  );
  const processingSnapshot = toPanelRecord(currentDocument?.process_rule_snapshot);
  const snapshotRule = toPanelRecord(processingSnapshot.process_rule);
  const snapshotSegmentation = toPanelRecord(snapshotRule.segmentation);
  const snapshotSubchunkSegmentation = toPanelRecord(snapshotRule.subchunk_segmentation);
  const snapshotParentMode = readPanelParentMode(
    processingSnapshot.parent_mode ?? snapshotRule.parent_mode
  );
  const documentParentMode = snapshotParentMode ?? "paragraph";
  const isParentChildDocument = currentDocument?.doc_form === "hierarchical_model";
  const visibleTab: "outline" | "metadata" | "versions" =
    tab === "metadata" || tab === "versions" ? tab : "outline";
  const visibleTabs = ["outline", "metadata", "versions"] as const;

  async function confirmSegmentAction(
    title: string,
    description: string,
    confirmLabel: string,
    tone: "default" | "danger" = "default"
  ) {
    return dialog.requestConfirmation({
      title: t(title),
      description: t(description),
      confirmLabel: t(confirmLabel),
      tone
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-200 px-3 py-3">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-zinc-100 p-1">
          {visibleTabs.map((item) => (
            <button
              className={`min-w-0 rounded px-2 py-1.5 text-center text-xs font-medium whitespace-nowrap ${
                visibleTab === item
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleTab === "outline" ? (
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

        {tab === "processing" ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-semibold">{t("Processing snapshot")}</p>
              <p className="text-xs text-zinc-500">
                {t(
                  "Dify-like document processing is snapshotted per document version and reprocessed explicitly."
                )}
              </p>
            </div>
            {currentDocument ? (
              <div className="space-y-3">
                <div
                  className={`rounded-md border p-3 text-xs leading-5 ${
                    currentDocument.processing_status === "needs_reprocess"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{t("Processing status")}</span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">
                      {t(currentDocument.processing_status ?? "current")}
                    </span>
                  </div>
                  <p className="mt-2">
                    {t(
                      "Publishing automatically reprocesses this document's PostgreSQL segments. Milvus index rebuild is still separate and updates search, MCP, and Dify."
                    )}
                  </p>
                </div>

                <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-zinc-950">{t("Parent-child mode")}</p>
                      <p className="mt-1 leading-5 text-zinc-500">
                        {t(
                          "Dify uses paragraph parent-child or full-doc parent-child at the document level. Changing this only marks segments stale until you reprocess."
                        )}
                      </p>
                    </div>
                    <select
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 disabled:bg-zinc-50 disabled:text-zinc-400"
                      disabled={!canManageSegments || !isParentChildDocument}
                      onChange={(event) =>
                        onUpdateDocumentParentMode(event.target.value as "paragraph" | "full_doc")
                      }
                      value={documentParentMode}
                    >
                      <option value="paragraph">{t("Paragraph parent-child")}</option>
                      <option value="full_doc">{t("Full-doc parent-child")}</option>
                    </select>
                  </div>
                  {!isParentChildDocument ? (
                    <p className="mt-2 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-500">
                      {t("Only parent-child documents use this setting.")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
                  <div className="grid gap-2">
                    <SnapshotRow
                      label={t("Document form")}
                      value={t(currentDocument.doc_form ?? "-")}
                    />
                    <SnapshotRow
                      label={t("Processing revision")}
                      value={String(currentDocument.processing_revision ?? "-")}
                    />
                    <SnapshotRow
                      label={t("Current version id")}
                      value={shortId(currentDocument.currentVersion?.id)}
                    />
                    <SnapshotRow
                      label={t("Current version hash")}
                      value={shortId(currentDocument.currentVersion?.markdown_hash)}
                    />
                    <SnapshotRow
                      label={t("Snapshot settings revision")}
                      value={String(processingSnapshot.settings_revision ?? "-")}
                    />
                    <SnapshotRow
                      label={t("Snapshot parent mode")}
                      value={t(formatParentModeLabel(snapshotParentMode))}
                    />
                    <SnapshotRow
                      label={t("Snapshot parent overlap")}
                      value={String(snapshotSegmentation.chunk_overlap ?? "-")}
                    />
                    <SnapshotRow
                      label={t("Snapshot child overlap")}
                      value={String(snapshotSubchunkSegmentation.chunk_overlap ?? "-")}
                    />
                  </div>
                </div>

                <details className="rounded-md border border-zinc-200 bg-white p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                    {t("Process rule snapshot")}
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-950 p-3 text-[11px] leading-5 text-zinc-50">
                    {formatJsonForPanel(currentDocument.process_rule_snapshot)}
                  </pre>
                </details>

                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                  disabled={!canManageSegments || currentDocument.type !== "page"}
                  onClick={onReprocessDocument}
                  type="button"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("Reprocess document segments")}
                </button>
              </div>
            ) : (
              <EmptyPanel
                title={t("No document selected")}
                action={t("Select a page document first.")}
              />
            )}
          </div>
        ) : null}

        {tab === "chunks" ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t("Document segments")}</p>
                {currentDocument?.processing_status === "needs_reprocess" ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    {t("Needs reprocess")}
                  </span>
                ) : currentDocument ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    {t(currentDocument.processing_status ?? "current")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-zinc-500">
                {currentDocument
                  ? t("{count} segments", { count: chunks.length })
                  : t("No document selected")}
              </p>
            </div>
            {currentDocument?.processing_status === "needs_reprocess" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p>{t("This document changed after its segments were generated.")}</p>
                <button
                  className="mt-2 inline-flex h-8 items-center rounded-md bg-amber-600 px-3 text-xs font-medium text-white hover:bg-amber-700"
                  onClick={onReprocessDocument}
                  type="button"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {t("Reprocess document segments")}
                </button>
              </div>
            ) : null}
            {hasManagedSegments ? (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                {t(
                  "Segment changes are stored in PostgreSQL. Rebuild the Milvus index before search, MCP, or Dify use them."
                )}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input
                checked={showDeletedSegments}
                className="h-4 w-4 rounded border-zinc-300"
                onChange={(event) => onIncludeDeletedSegmentsChange(event.target.checked)}
                type="checkbox"
              />
              {t("Show deleted segments")}
            </label>
            {chunksLoading ? (
              <EmptyPanel
                title={t("Loading segments")}
                action={t("Reading PostgreSQL segments.")}
              />
            ) : chunks.length > 0 ? (
              <div className="space-y-2">
                {chunks.map((chunk) => {
                  const isEditing = editingSegmentId === chunk.id;
                  const sourceText = chunk.source_content_text ?? chunk.content_text;
                  return (
                    <div
                      className={`rounded-md border bg-white p-2 text-xs ${
                        chunk.status === "deleted" ? "border-red-200" : "border-zinc-200"
                      }`}
                      key={chunk.id}
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-zinc-500">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                          {t(chunk.chunk_type)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            chunk.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : chunk.status === "deleted"
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {t(chunk.status)}
                        </span>
                        {chunk.has_override ? (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                            {t("override")}
                          </span>
                        ) : null}
                        <span>#{chunk.ordinal}</span>
                        <span>{t("{count} tokens", { count: chunk.token_count ?? 0 })}</span>
                      </div>
                      <div className="mt-2 space-y-2">
                        <div>
                          <p className="text-[11px] font-medium text-zinc-500">
                            {t("Effective retrieval content")}
                          </p>
                          <p className="mt-1 line-clamp-4 text-zinc-700">{chunk.content_text}</p>
                        </div>
                        {chunk.has_override ? (
                          <details className="rounded-md bg-zinc-50 p-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-zinc-500">
                              {t("Source content")}
                            </summary>
                            <p className="mt-1 line-clamp-4 text-zinc-600">{sourceText}</p>
                          </details>
                        ) : null}
                      </div>
                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            className="min-h-28 w-full rounded-md border border-zinc-300 px-2 py-2 text-xs outline-none focus:border-emerald-500"
                            onChange={(event) => setSegmentOverrideDraft(event.target.value)}
                            value={segmentOverrideDraft}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="inline-flex h-8 items-center rounded-md bg-zinc-950 px-2.5 text-xs font-medium text-white"
                              disabled={!canManageSegments}
                              onClick={() => {
                                onUpdateSegment(chunk, {
                                  override_content_markdown: segmentOverrideDraft,
                                  override_content_text: segmentOverrideDraft
                                });
                                setEditingSegmentId(null);
                              }}
                              type="button"
                            >
                              {t("Save")}
                            </button>
                            <button
                              className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700"
                              onClick={() => setEditingSegmentId(null)}
                              type="button"
                            >
                              {t("Cancel")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <p
                        className="mt-2 truncate text-[11px] text-zinc-400"
                        title={chunk.version_id}
                      >
                        {t("Version id")}: {chunk.version_id} · {t("Settings revision")}{" "}
                        {chunk.settings_revision}
                      </p>
                      {chunk.heading_path.length > 0 ? (
                        <p className="mt-1 truncate text-[11px] text-sky-700">
                          {chunk.heading_path.join(" / ")}
                        </p>
                      ) : null}
                      {canManageSegments ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {chunk.status === "active" ? (
                            <button
                              className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                              onClick={async () => {
                                const confirmed = await confirmSegmentAction(
                                  "Disable segment",
                                  "Disabled segments stay in PostgreSQL but are excluded from retrieval after the next Milvus rebuild.",
                                  "Disable segment"
                                );
                                if (confirmed) onUpdateSegment(chunk, { status: "disabled" });
                              }}
                              type="button"
                            >
                              {t("Disable segment")}
                            </button>
                          ) : (
                            <button
                              className="inline-flex h-8 items-center rounded-md border border-emerald-200 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              onClick={() => onUpdateSegment(chunk, { status: "active" })}
                              type="button"
                            >
                              {chunk.status === "deleted"
                                ? t("Restore segment")
                                : t("Enable segment")}
                            </button>
                          )}
                          <button
                            className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            onClick={() => {
                              setEditingSegmentId(chunk.id);
                              setSegmentOverrideDraft(chunk.content_text);
                            }}
                            type="button"
                          >
                            {t("Edit retrieval content")}
                          </button>
                          {chunk.has_override ? (
                            <button
                              className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                              onClick={async () => {
                                const confirmed = await confirmSegmentAction(
                                  "Reset override",
                                  "Reset this segment override and return retrieval content to the source chunk?",
                                  "Reset override"
                                );
                                if (confirmed) onUpdateSegment(chunk, { reset_override: true });
                              }}
                              type="button"
                            >
                              {t("Reset override")}
                            </button>
                          ) : null}
                          {chunk.status !== "deleted" ? (
                            <button
                              className="inline-flex h-8 items-center rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50"
                              onClick={async () => {
                                const confirmed = await confirmSegmentAction(
                                  "Soft delete segment",
                                  "Soft-deleted segments are hidden by default and excluded from retrieval after the next Milvus rebuild.",
                                  "Soft delete segment",
                                  "danger"
                                );
                                if (confirmed) onUpdateSegment(chunk, { status: "deleted" });
                              }}
                              type="button"
                            >
                              {t("Soft delete segment")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyPanel
                  title={t("No segments for this document")}
                  action={t("Reprocess segments before this document can be searched.")}
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

        {tab === "qa" ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-semibold">{t("QA pairs")}</p>
              <p className="text-xs text-zinc-500">
                {t("Questions are indexed; answers are returned to search, MCP, and Dify.")}
              </p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {t(
                "QA changes require reprocess and then Milvus index rebuild before retrieval updates."
              )}
            </div>
            {canManageDerivedContent ? (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-3">
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-zinc-600">{t("Question")}</span>
                  <input
                    className="h-8 w-full rounded-md border border-zinc-200 px-2 outline-none focus:border-emerald-500"
                    onChange={(event) => setQaQuestionDraft(event.target.value)}
                    value={qaQuestionDraft}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-zinc-600">{t("Answer")}</span>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-zinc-200 px-2 py-2 outline-none focus:border-emerald-500"
                    onChange={(event) => setQaAnswerDraft(event.target.value)}
                    value={qaAnswerDraft}
                  />
                </label>
                <button
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
                  disabled={!qaQuestionDraft.trim() || !qaAnswerDraft.trim()}
                  onClick={() => {
                    onCreateQaPair({
                      question: qaQuestionDraft,
                      answer: qaAnswerDraft
                    });
                    setQaQuestionDraft("");
                    setQaAnswerDraft("");
                  }}
                  type="button"
                >
                  {t("Add QA pair")}
                </button>
              </div>
            ) : null}
            {canManageDerivedContent ? (
              <details className="rounded-md border border-zinc-200 bg-white p-3">
                <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                  {t("CSV import and generation")}
                </summary>
                <div className="mt-3 space-y-3">
                  <textarea
                    className="min-h-24 w-full rounded-md border border-zinc-200 px-2 py-2 font-mono text-xs outline-none focus:border-emerald-500"
                    onChange={(event) => setQaCsvDraft(event.target.value)}
                    placeholder="question,answer"
                    value={qaCsvDraft}
                  />
                  <button
                    className="inline-flex h-8 w-full items-center justify-center rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
                    disabled={!qaCsvDraft.trim()}
                    onClick={() => {
                      onImportQaPairs(qaCsvDraft);
                      setQaCsvDraft("");
                    }}
                    type="button"
                  >
                    {t("Import CSV")}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() =>
                        onGenerateQaPairs({ mode: "mock", scope: "segments", count: 6 })
                      }
                      type="button"
                    >
                      {t("Generate mock QA")}
                    </button>
                    <button
                      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() =>
                        onGenerateQaPairs({ mode: "llm", scope: "document", count: 6 })
                      }
                      type="button"
                    >
                      {t("Generate LLM QA")}
                    </button>
                  </div>
                </div>
              </details>
            ) : null}
            {documentQaLoading ? (
              <EmptyPanel title={t("Loading QA")} action={t("Reading QA pairs.")} />
            ) : documentQaPairs.length > 0 ? (
              <div className="space-y-2">
                {documentQaPairs.map((pair) => (
                  <div
                    className="rounded-md border border-zinc-200 bg-white p-3 text-xs"
                    key={pair.id}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                        {t(pair.source)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          pair.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : pair.status === "deleted"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {t(pair.status)}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold text-zinc-900">{pair.question}</p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-600">{pair.answer}</p>
                    {pair.source_chunk_id ? (
                      <p className="mt-2 truncate text-[11px] text-zinc-400">
                        {t("Source chunk")}: {pair.source_chunk_id}
                      </p>
                    ) : null}
                    {canManageDerivedContent ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                          onClick={() =>
                            onUpdateQaPair(pair, {
                              status: pair.status === "active" ? "disabled" : "active"
                            })
                          }
                          type="button"
                        >
                          {pair.status === "active" ? t("Disable") : t("Enable")}
                        </button>
                        <button
                          className="inline-flex h-8 items-center rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          onClick={() => onUpdateQaPair(pair, { status: "deleted" })}
                          type="button"
                        >
                          {t("Delete")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanel title={t("No QA pairs")} action={t("Add QA manually or import CSV.")} />
            )}
          </div>
        ) : null}

        {tab === "summary" ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-semibold">{t("Summaries")}</p>
              <p className="text-xs text-zinc-500">
                {t("Summaries are derived retrieval indexes and never rewrite Markdown.")}
              </p>
            </div>
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
              {t(
                "Summary changes require a Milvus index rebuild before search, MCP, or Dify use them."
              )}
            </div>
            {canManageDerivedContent ? (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-3">
                <label className="block text-xs">
                  <span className="mb-1 block font-medium text-zinc-600">
                    {t("Document summary")}
                  </span>
                  <textarea
                    className="min-h-24 w-full rounded-md border border-zinc-200 px-2 py-2 outline-none focus:border-emerald-500"
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    value={summaryDraft}
                  />
                </label>
                <button
                  className="inline-flex h-8 w-full items-center justify-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white disabled:bg-zinc-300"
                  disabled={!summaryDraft.trim()}
                  onClick={() => {
                    onGenerateSummary({
                      scope: "document",
                      mode: "manual",
                      summary: summaryDraft
                    });
                    setSummaryDraft("");
                  }}
                  type="button"
                >
                  {t("Save document summary")}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => onGenerateSummary({ scope: "document", mode: "mock" })}
                    type="button"
                  >
                    {t("Mock document summary")}
                  </button>
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => onGenerateSummary({ scope: "document", mode: "llm" })}
                    type="button"
                  >
                    {t("LLM document summary")}
                  </button>
                </div>
                <button
                  className="inline-flex h-8 w-full items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => onGenerateSummary({ scope: "all_segments", mode: "mock" })}
                  type="button"
                >
                  {t("Mock all segment summaries")}
                </button>
              </div>
            ) : null}
            {documentSummariesLoading ? (
              <EmptyPanel title={t("Loading summaries")} action={t("Reading summaries.")} />
            ) : documentSummaries ? (
              <div className="space-y-3">
                {documentSummaries.document_summary ? (
                  <div className="rounded-md border border-zinc-200 bg-white p-3 text-xs">
                    <p className="font-semibold text-zinc-900">{t("Document summary")}</p>
                    <p className="mt-2 whitespace-pre-wrap text-zinc-600">
                      {documentSummaries.document_summary.summary}
                    </p>
                  </div>
                ) : (
                  <EmptyPanel
                    title={t("No document summary")}
                    action={t("Create one manually or generate it explicitly.")}
                  />
                )}
                <div>
                  <p className="mb-2 text-xs font-semibold text-zinc-700">
                    {t("Segment summaries")} ({documentSummaries.segment_summaries.length})
                  </p>
                  <div className="space-y-2">
                    {documentSummaries.segment_summaries.map((summary) => (
                      <div
                        className="rounded-md border border-zinc-200 bg-white p-2 text-xs"
                        key={summary.id}
                      >
                        <div className="flex flex-wrap items-center gap-1.5 text-zinc-500">
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${
                              summary.status === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : summary.status === "deleted"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {t(summary.status)}
                          </span>
                          <span className="truncate">{summary.chunk_id}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-zinc-600">{summary.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyPanel title={t("No summaries")} action={t("Select a page document first.")} />
            )}
          </div>
        ) : null}

        {visibleTab === "metadata" ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-semibold">{t("Metadata")}</p>
              <p className="text-xs text-zinc-500">
                {t("Dify-native document metadata for filtering.")}
              </p>
            </div>
            {metadataLoading ? (
              <EmptyPanel title={t("Loading metadata")} action={t("Reading document metadata.")} />
            ) : metadata ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  {metadata.fields.built_in.map((field) => (
                    <label className="block text-xs" key={field.name}>
                      <span className="mb-1 flex items-center justify-between gap-2 text-zinc-500">
                        <span>{field.name}</span>
                        <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                          {t("Built-in")}
                        </span>
                      </span>
                      <input
                        className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs text-zinc-500"
                        readOnly
                        value={String(metadata.values[field.name] ?? "")}
                      />
                    </label>
                  ))}
                </div>
                <div className="space-y-2 border-t border-zinc-200 pt-3">
                  {metadata.fields.custom.map((field) => (
                    <label className="block text-xs" key={field.id ?? field.name}>
                      <span className="mb-1 flex items-center justify-between gap-2 text-zinc-600">
                        <span>{field.name}</span>
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                          {field.type}
                        </span>
                      </span>
                      <input
                        className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs outline-none focus:border-emerald-500"
                        onChange={(event) => onMetadataDraftChange(field.name, event.target.value)}
                        type={
                          field.type === "number"
                            ? "number"
                            : field.type === "time"
                              ? "datetime-local"
                              : "text"
                        }
                        value={metadataDraft[field.name] ?? ""}
                      />
                    </label>
                  ))}
                  {metadata.fields.custom.length === 0 ? (
                    <EmptyPanel
                      title={t("No custom metadata fields")}
                      action={t("Add fields in the knowledge base Metadata tab.")}
                    />
                  ) : null}
                </div>
                {metadata.fields.custom.length > 0 ? (
                  <button
                    className="inline-flex w-full items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300"
                    disabled={metadataSaving}
                    onClick={onSaveMetadata}
                    type="button"
                  >
                    {metadataSaving ? t("Saving...") : t("Save metadata")}
                  </button>
                ) : null}
              </div>
            ) : (
              <EmptyPanel title={t("No metadata")} action={t("Select a page document first.")} />
            )}
          </div>
        ) : null}

        {visibleTab === "versions" ? (
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
    </div>
  );
}

function sideTabLabel(tab: DocumentSideTab): string {
  if (tab === "processing") {
    return "Processing";
  }
  if (tab === "chunks") {
    return "Segments";
  }
  if (tab === "qa") {
    return "QA";
  }
  if (tab === "summary") {
    return "Summary";
  }
  if (tab === "versions") {
    return "Versions";
  }
  if (tab === "metadata") {
    return "Metadata";
  }
  return "Outline";
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-2 py-1.5">
      <span className="text-zinc-500">{label}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-zinc-800" title={value}>
        {value}
      </span>
    </div>
  );
}

function toEditableMetadataValues(metadata: DocumentMetadataResponse): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of metadata.fields.custom) {
    const value = metadata.values[field.name];
    if (value === null || value === undefined) {
      values[field.name] = "";
    } else if (field.type === "time") {
      values[field.name] = toDateTimeLocalValue(String(value));
    } else {
      values[field.name] = String(value);
    }
  }
  return values;
}

function toDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 16);
}

function shortId(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatJsonForPanel(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function toPanelRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPanelParentMode(value: unknown): "paragraph" | "full_doc" | null {
  if (value === "full_doc" || value === "full-doc") {
    return "full_doc";
  }
  if (value === "paragraph") {
    return "paragraph";
  }
  return null;
}

function formatParentModeLabel(value: "paragraph" | "full_doc" | null): string {
  if (value === "full_doc") {
    return "Full-doc parent-child";
  }
  if (value === "paragraph") {
    return "Paragraph parent-child";
  }
  return "-";
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
  canEdit,
  mode,
  onChange
}: {
  canEdit: boolean;
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="editor-mode-switch" aria-label={t("Editor mode")}>
      <button
        className={
          mode === "edit" || mode === "read"
            ? "editor-mode-switch-button-active"
            : "editor-mode-switch-button"
        }
        onClick={() => onChange(canEdit ? "edit" : "read")}
        type="button"
      >
        {canEdit ? t("Edit") : t("Read")}
      </button>
      <button
        className={
          mode === "segments" ? "editor-mode-switch-button-active" : "editor-mode-switch-button"
        }
        onClick={() => onChange("segments")}
        type="button"
      >
        {t("Segments")}
      </button>
      <button
        className={
          mode === "source" ? "editor-mode-switch-button-active" : "editor-mode-switch-button"
        }
        disabled={!canEdit}
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

function AdminVisibleKnowledgeBasePanel({
  isBusy,
  onTakeover
}: {
  isBusy: boolean;
  onTakeover: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[680px] items-center justify-center px-6">
      <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-5 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-white text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-amber-950">
          {t("Admin visible, content locked")}
        </h1>
        <p className="mt-2 text-sm text-amber-900">
          {t(
            "You can manage this knowledge base metadata, but private documents require an audited takeover before reading."
          )}
        </p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:bg-amber-300"
          disabled={isBusy}
          onClick={onTakeover}
          type="button"
        >
          <Users className="h-4 w-4" />
          {t("Take over access")}
        </button>
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

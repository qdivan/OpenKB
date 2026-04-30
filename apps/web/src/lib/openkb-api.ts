import { authApiUrl } from "./auth-api";

export type ApiErrorBody = {
  error?: string;
  message?: string;
  details?: unknown;
};

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody
  ) {
    super(body.message || `Request failed with status ${status}.`);
  }
}

export type AuthMe = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
  };
  tenantId: string;
  roles: string[];
};

export type Workspace = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  role?: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBase = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  slug: string;
  visibility: "private" | "workspace" | "public";
  status: string;
  role?: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentSummary = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  type: "folder" | "page";
  title: string;
  slug: string;
  status: string;
  permission_mode: string;
  visibility: string | null;
  current_version_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  version_no: number;
  markdown: string;
  markdown_hash: string;
  created_at: string;
};

export type DocumentDetail = DocumentSummary & {
  currentVersion: DocumentVersion | null;
  role?: string | null;
};

export type DocumentAsset = {
  id: string;
  tenant_id: string;
  document_id: string | null;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: string;
  checksum_sha256: string | null;
  storage_bucket: string;
  metadata: unknown;
  created_by: string;
  created_at: string;
};

export type ImportJob = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  source_asset_id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  converter: string;
  title: string | null;
  document_id: string | null;
  output_version_id: string | null;
  error: string | null;
  warnings: Array<{ code?: string; message?: string }> | unknown;
  metadata: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type SearchResult = {
  chunk_id: string;
  document_id: string;
  knowledge_base_id: string;
  workspace_id: string;
  title: string;
  path: string[];
  heading_path: string[];
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type SearchResponse = {
  query: string;
  top_k: number;
  results: SearchResult[];
};

export type RetrievalMode = "bm25" | "dense" | "dense_rerank" | "hybrid" | "hybrid_rerank";

export type RetrievalModeCapability = {
  mode: RetrievalMode;
  enabled: boolean;
  disabled_reason: string | null;
};

export type RetrievalSettingsStatus = {
  mode: RetrievalMode;
  effective_mode: RetrievalMode;
  supported_modes: RetrievalMode[];
  modes: RetrievalModeCapability[];
  embedding: {
    configured: boolean;
    model: string | null;
    dim: number;
  };
  rerank: {
    configured: boolean;
    model: string | null;
  };
  active_alias: string;
  next_rebuild_collection: string;
  active_profile: {
    id: string;
    tenant_id: string | null;
    alias: string;
    collection_name: string;
    schema_version: string;
    vector_dim: number;
    embedding_function_name: string;
    bm25_function_name: string | null;
    rerank_function_name: string | null;
    status: string;
    function_metadata: unknown;
    created_by: string;
    created_at: string;
    activated_at: string | null;
  } | null;
  latest_rebuild_job: IndexRebuildJob | null;
  dense_index_ready: boolean;
  needs_rebuild: boolean;
};

export type ModelProbeResult = {
  configured: boolean;
  ok: boolean;
  model?: string;
  dim?: number;
  latency_ms?: number;
  error?: string;
};

export type RetrievalProbeResponse = {
  embedding: ModelProbeResult;
  rerank: ModelProbeResult;
};

export type IndexRebuildJob = {
  id: string;
  tenant_id: string | null;
  target_collection: string;
  target_alias: string;
  status: string;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

export type UpdateDocumentInput = {
  title?: string;
  parent_id?: string | null;
  sort_order?: number;
  markdown?: string;
  markdown_hash?: string;
  base_version_id?: string | null;
};

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init.body !== undefined && init.body instanceof FormData;
  const response = await fetch(authApiUrl(path), {
    ...init,
    headers: {
      ...(init.body && !isFormData ? { "content-type": "application/json" } : {}),
      ...init.headers
    },
    credentials: "include"
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiRequestError(response.status, body as ApiErrorBody);
  }

  return body as T;
}

export function getMe() {
  return apiFetch<AuthMe>("/api/auth/me");
}

export function logout() {
  return apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function listWorkspaces() {
  return apiFetch<Workspace[]>("/api/workspaces");
}

export function createWorkspace(input: { name: string; slug?: string }) {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateWorkspace(id: string, input: { name?: string; slug?: string }) {
  return apiFetch<Workspace>(`/api/workspaces/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listKnowledgeBases(workspaceId?: string) {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return apiFetch<KnowledgeBase[]>(`/api/knowledge-bases${query}`);
}

export function createKnowledgeBase(input: {
  workspace_id: string;
  title: string;
  slug?: string;
  visibility?: KnowledgeBase["visibility"];
}) {
  return apiFetch<KnowledgeBase>("/api/knowledge-bases", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getKnowledgeBase(id: string) {
  return apiFetch<KnowledgeBase>(`/api/knowledge-bases/${id}`);
}

export function getKnowledgeBaseTree(id: string) {
  return apiFetch<DocumentSummary[]>(`/api/knowledge-bases/${id}/tree`);
}

export function createDocument(input: {
  knowledge_base_id: string;
  parent_id?: string | null;
  type: "folder" | "page";
  title: string;
  slug?: string;
  markdown?: string;
}) {
  return apiFetch<DocumentDetail>("/api/documents", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getDocument(id: string) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}`);
}

export function updateDocument(id: string, input: UpdateDocumentInput) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteDocument(id: string) {
  return apiFetch<{ ok: true }>(`/api/documents/${id}`, { method: "DELETE" });
}

export function uploadFile(input: {
  file: File;
  knowledge_base_id: string;
  parent_id?: string | null;
}) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("knowledge_base_id", input.knowledge_base_id);
  if (input.parent_id) {
    formData.append("parent_id", input.parent_id);
  }

  return apiFetch<DocumentAsset>("/api/uploads", {
    method: "POST",
    body: formData
  });
}

export function createImportJob(input: {
  source_asset_id: string;
  knowledge_base_id: string;
  parent_id?: string | null;
  title?: string;
  converter?: "auto" | "markdown" | "text" | "html" | "csv";
}) {
  return apiFetch<ImportJob>("/api/import-jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getImportJob(id: string) {
  return apiFetch<ImportJob>(`/api/import-jobs/${id}`);
}

export function listImportJobs(knowledgeBaseId: string) {
  return apiFetch<ImportJob[]>(
    `/api/import-jobs?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`
  );
}

export function getAssetUrl(id: string) {
  return apiFetch<{ url: string; asset: DocumentAsset }>(`/api/assets/${id}/url`);
}

export function searchKnowledge(input: {
  query: string;
  knowledge_base_ids?: string[];
  top_k?: number;
  filters?: Record<string, unknown>;
}) {
  return apiFetch<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getRetrievalSettings() {
  return apiFetch<RetrievalSettingsStatus>("/api/admin/retrieval-settings");
}

export function updateRetrievalSettings(input: { mode: RetrievalMode }) {
  return apiFetch<RetrievalSettingsStatus>("/api/admin/retrieval-settings", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function probeRetrievalModels() {
  return apiFetch<RetrievalProbeResponse>("/api/admin/retrieval-settings/probe", {
    method: "POST"
  });
}

export function createMilvusRebuildJob(
  input: {
    target_collection?: string;
    target_alias?: string;
  } = {}
) {
  return apiFetch<IndexRebuildJob>("/api/admin/milvus/rebuild-jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

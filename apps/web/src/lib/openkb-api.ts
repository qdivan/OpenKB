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
    emailVerifiedAt?: string | null;
  };
  tenantId: string;
  roles: string[];
};

export type AdminUserStatus =
  | "pending_email_verification"
  | "pending_activation"
  | "active"
  | "suspended"
  | "deleted";

export type TenantRole = "system_admin" | "tenant_admin" | "member";

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  emailVerifiedAt: string | null;
  tenantRole: TenantRole | null;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListResponse = {
  items: AdminUser[];
  limit: number;
  offset: number;
  total: number;
};

export type AuditLogEntry = {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorType: string;
  action: string;
  objectType: string | null;
  objectId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type AuditLogListResponse = {
  items: AuditLogEntry[];
  limit: number;
  offset: number;
  total: number;
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
  context_mode?: RetrievalContextMode;
  match_chunk?: SearchChunkContext;
  parent_chunk?: SearchChunkContext | null;
};

export type SearchResponse = {
  query: string;
  top_k: number;
  context_mode?: RetrievalContextMode;
  results: SearchResult[];
};

export type RetrievalContextMode =
  | "chunk"
  | "parent_child"
  | "paragraph_parent_child"
  | "full_text";

export type SearchChunkContext = {
  chunk_id: string;
  chunk_type: string;
  heading_path: string[];
  content: string;
  token_count?: number | null;
  start_line?: number | null;
  end_line?: number | null;
  start_char?: number | null;
  end_char?: number | null;
};

export type RetrievalMode = "bm25" | "dense" | "dense_rerank" | "hybrid" | "hybrid_rerank";

export type RetrievalModeCapability = {
  mode: RetrievalMode;
  enabled: boolean;
  disabled_reason: string | null;
};

export type ModelKind = "embedding" | "rerank" | "language";
export type ModelProvider =
  | "openai_compatible"
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages";

export type AdminModelSetting = {
  kind: ModelKind;
  provider: ModelProvider;
  source: "db" | "env" | "none";
  enabled: boolean;
  configured: boolean;
  endpoint: string | null;
  model: string | null;
  timeout_ms: number;
  embedding_dim: number | null;
  embedding_batch_size: number | null;
  llm_temperature: number | null;
  llm_max_output_tokens: number | null;
  has_secret: boolean;
  secret_source: "db" | "env" | "none";
  api_key_last4: string | null;
  db_configured: boolean;
  env_configured: boolean;
  updated_by: string | null;
  updated_at: string | null;
  index_rebuild_required?: boolean;
};

export type AdminModelSettingsResponse = {
  items: AdminModelSetting[];
};

export type UpdateAdminModelSettingInput = {
  provider?: ModelProvider;
  endpoint?: string | null;
  model?: string | null;
  enabled?: boolean;
  timeout_ms?: number | null;
  embedding_dim?: number | null;
  embedding_batch_size?: number | null;
  llm_temperature?: number | null;
  llm_max_output_tokens?: number | null;
  api_key?: string | null;
};

export type AdminModelProbeResult = ModelProbeResult;

export type RetrievalSettingsStatus = {
  mode: RetrievalMode;
  effective_mode: RetrievalMode;
  supported_modes: RetrievalMode[];
  modes: RetrievalModeCapability[];
  embedding: {
    configured: boolean;
    model: string | null;
    dim: number;
    source?: "db" | "env" | "none";
  };
  rerank: {
    configured: boolean;
    model: string | null;
    source?: "db" | "env" | "none";
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

export type ChunkSettings = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  mode: "general" | "parent_child";
  parent_mode: "paragraph" | "full_doc";
  parent_delimiter: string;
  child_delimiter: string;
  parent_max_characters: number;
  child_max_characters: number;
  child_overlap_characters: number;
  revision: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  version_id: string;
  ordinal: number;
  chunk_type: "general" | "parent" | "child";
  parent_chunk_id: string | null;
  settings_revision: number;
  start_line: number | null;
  end_line: number | null;
  start_char: number | null;
  end_char: number | null;
  parent_ordinal: number | null;
  child_ordinal: number | null;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  token_count: number | null;
  metadata: unknown;
  created_at: string;
};

export type ChunkRebuildJob = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  settings_revision: number;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  requested_by: string;
  error: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type KnowledgeBaseOverview = {
  knowledge_base: KnowledgeBase;
  documents: {
    total: number;
    pages: number;
    folders: number;
    published: number;
    draft: number;
  };
  chunks: {
    total: number;
    general: number;
    parent: number;
    child: number;
    stale: number;
  };
  chunk_settings: ChunkSettings;
  latest_import_jobs: ImportJob[];
  latest_chunk_rebuild_job: ChunkRebuildJob | null;
  latest_index_rebuild_job: IndexRebuildJob | null;
  needs_chunk_rebuild: boolean;
  needs_index_rebuild: boolean;
};

export type UpdateDocumentInput = {
  title?: string;
  parent_id?: string | null;
  sort_order?: number;
  markdown?: string;
  markdown_hash?: string;
  base_version_id?: string | null;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const canDedupeGet = method === "GET" && init.body === undefined && init.signal === undefined;
  if (canDedupeGet) {
    const key = `${path}:${JSON.stringify(init.headers ?? {})}`;
    const existing = inFlightGetRequests.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const request = apiFetchRequest<T>(path, init);
    inFlightGetRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (inFlightGetRequests.get(key) === request) {
        inFlightGetRequests.delete(key);
      }
    }
  }

  return apiFetchRequest<T>(path, init);
}

async function apiFetchRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export function confirmPasswordReset(input: { token: string; password: string }) {
  return apiFetch<{ ok: true }>("/api/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
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
  context_mode?: RetrievalContextMode;
}) {
  return apiFetch<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getKnowledgeBaseOverview(id: string) {
  return apiFetch<KnowledgeBaseOverview>(`/api/knowledge-bases/${id}/overview`);
}

export function getChunkSettings(id: string) {
  return apiFetch<ChunkSettings>(`/api/knowledge-bases/${id}/chunk-settings`);
}

export function updateChunkSettings(
  id: string,
  input: Partial<
    Pick<
      ChunkSettings,
      | "mode"
      | "parent_mode"
      | "parent_delimiter"
      | "child_delimiter"
      | "parent_max_characters"
      | "child_max_characters"
      | "child_overlap_characters"
    >
  >
) {
  return apiFetch<ChunkSettings>(`/api/knowledge-bases/${id}/chunk-settings`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listKnowledgeBaseChunks(
  id: string,
  input: { document_id?: string; type?: string; limit?: number } = {}
) {
  const params = new URLSearchParams();
  if (input.document_id) params.set("document_id", input.document_id);
  if (input.type) params.set("type", input.type);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return apiFetch<DocumentChunk[]>(`/api/knowledge-bases/${id}/chunks${query ? `?${query}` : ""}`);
}

export function createChunkRebuildJob(id: string) {
  return apiFetch<ChunkRebuildJob>(`/api/knowledge-bases/${id}/chunk-rebuild-jobs`, {
    method: "POST"
  });
}

export function publishDocument(id: string) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}/publish`, { method: "POST" });
}

export function unpublishDocument(id: string) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}/unpublish`, { method: "POST" });
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

export function listAdminModelSettings() {
  return apiFetch<AdminModelSettingsResponse>("/api/admin/models");
}

export function updateAdminModelSetting(kind: ModelKind, input: UpdateAdminModelSettingInput) {
  return apiFetch<AdminModelSetting>(`/api/admin/models/${kind}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function probeAdminModel(kind: ModelKind, input?: UpdateAdminModelSettingInput) {
  return apiFetch<AdminModelProbeResult>(`/api/admin/models/${kind}/probe`, {
    method: "POST",
    ...(input ? { body: JSON.stringify(input) } : {})
  });
}

export function clearAdminModelSecret(kind: ModelKind) {
  return apiFetch<AdminModelSetting>(`/api/admin/models/${kind}/secret`, {
    method: "DELETE"
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

export function listAdminUsers(
  input: {
    status?: AdminUserStatus | "all";
    role?: TenantRole | "all";
    query?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.role && input.role !== "all") params.set("role", input.role);
  if (input.query) params.set("query", input.query);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<AdminUserListResponse>(`/api/admin/users${query ? `?${query}` : ""}`);
}

export function createAdminUser(input: {
  email: string;
  display_name?: string;
  tenant_role?: TenantRole;
}) {
  return apiFetch<{ user: AdminUser; reset_link: string }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateAdminUser(
  id: string,
  input: { display_name?: string; status?: Exclude<AdminUserStatus, "deleted"> }
) {
  return apiFetch<AdminUser>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function activateAdminUser(id: string) {
  return apiFetch<AdminUser>(`/api/admin/users/${id}/activate`, { method: "POST" });
}

export function suspendAdminUser(id: string) {
  return apiFetch<AdminUser>(`/api/admin/users/${id}/suspend`, { method: "POST" });
}

export function softDeleteAdminUser(id: string) {
  return apiFetch<AdminUser>(`/api/admin/users/${id}/delete`, { method: "POST" });
}

export function createAdminPasswordReset(id: string) {
  return apiFetch<{ ok: true; reset_link: string }>(`/api/admin/users/${id}/password-reset`, {
    method: "POST"
  });
}

export function setAdminUserTenantRole(id: string, role: TenantRole) {
  return apiFetch<{ user: AdminUser; tenant_role: TenantRole }>(
    `/api/admin/users/${id}/tenant-role`,
    {
      method: "PUT",
      body: JSON.stringify({ role })
    }
  );
}

export function revokeAdminUserSessions(id: string) {
  return apiFetch<{ ok: true; revoked_count: number }>(`/api/admin/users/${id}/revoke-sessions`, {
    method: "POST"
  });
}

export function listAuditLogs(
  input: {
    action?: string;
    object_type?: string;
    actor_user_id?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (input.action) params.set("action", input.action);
  if (input.object_type) params.set("object_type", input.object_type);
  if (input.actor_user_id) params.set("actor_user_id", input.actor_user_id);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<AuditLogListResponse>(`/api/admin/audit-logs${query ? `?${query}` : ""}`);
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

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

export type AdminSmtpSettings = {
  id: string | null;
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  from_email: string | null;
  reply_to: string | null;
  has_password: boolean;
  password_last4: string | null;
  source: "db" | "env" | "dev";
  env_configured: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

export type UpdateAdminSmtpSettingsInput = Partial<
  Pick<
    AdminSmtpSettings,
    "enabled" | "host" | "port" | "secure" | "username" | "from_email" | "reply_to"
  >
> & {
  password?: string | null;
  clear_password?: boolean;
};

export type AdminEmailOutboxItem = {
  id: string;
  tenant_id: string | null;
  to_email: string;
  template: string;
  subject: string;
  status: string;
  error: string | null;
  attempts: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
};

export type AdminEmailOutboxListResponse = {
  items: AdminEmailOutboxItem[];
  limit: number;
  offset: number;
  total: number;
};

export type AdminOpsHealth = {
  tenant_id: string;
  database: string;
  redis: string;
  s3: string;
  milvus: string;
  smtp: {
    source: string;
    enabled: boolean;
    ok: boolean;
    error: string | null;
  };
  mcp_oauth: {
    issuer: string | null;
    access_token_ttl_seconds: number;
    refresh_token_ttl_days: number;
  };
  email_outbox: Record<string, number>;
  checked_at: string;
};

export type AdminSecuritySecrets = {
  config_encryption_key_set: boolean;
  items: Array<Record<string, unknown> & { kind: string }>;
};

export type AuthSettingsScope = "instance" | "tenant";

export type AdminAuthSettings = {
  tenant_id: string | null;
  scope: AuthSettingsScope;
  registration_enabled: boolean;
  email_verification_required: boolean;
  default_signup_status: "active" | "pending_activation";
  invited_user_auto_active: boolean;
  allowed_email_domains: string[];
  invite_required: boolean;
  first_user_becomes_admin: boolean;
};

export type UpdateAdminAuthSettingsInput = Partial<
  Pick<
    AdminAuthSettings,
    | "registration_enabled"
    | "email_verification_required"
    | "default_signup_status"
    | "invited_user_auto_active"
    | "allowed_email_domains"
    | "invite_required"
    | "first_user_becomes_admin"
  >
> & {
  scope?: AuthSettingsScope;
  tenant_id?: string | null;
};

export type DifyApiKey = {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  allowed_knowledge_base_ids: string[];
  allowed_metadata_filters: unknown;
  retrieval_top_k_limit: number;
  expires_at: string | null;
  last_used_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  api_key_last4: string | null;
  can_reveal: boolean;
};

export type DifyKnowledgeMapping = {
  id: string;
  tenant_id: string;
  dify_knowledge_id: string;
  knowledge_base_id: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DifyApiKeyListResponse = {
  items: DifyApiKey[];
  limit: number;
  offset: number;
  total: number;
};

export type DifyMappingListResponse = {
  items: DifyKnowledgeMapping[];
  limit: number;
  offset: number;
  total: number;
};

export type DifySetupSummary = {
  endpoint_base_url: string;
  retrieval_path: string;
  endpoint_for_dify_ui: string;
  endpoint_note: string;
  mappings: Array<
    DifyKnowledgeMapping & {
      knowledge_base_title: string | null;
      knowledge_base_slug: string | null;
    }
  >;
  keys: Array<{
    id: string;
    name: string;
    status: string;
    api_key_last4: string | null;
    retrieval_top_k_limit: number;
    allowed_knowledge_bases: Array<{ id: string; title: string | null; slug: string | null }>;
  }>;
  test_request: {
    method: string;
    path: string;
    body: unknown;
  };
};

export type DifyFilterableMetadataField = {
  name: string;
  type: string;
  source: string;
  description: string;
};

export type DifyFilterableMetadataResponse = {
  fields: DifyFilterableMetadataField[];
  note: string;
};

export type SecretCreateResponse<T> = {
  item: T;
  api_key?: string;
  token?: string;
};

export type McpPat = {
  id: string;
  tenant_id: string;
  user_id: string;
  user: UserSummary | null;
  name: string;
  scopes: string[];
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type McpOauthClient = {
  id: string;
  tenant_id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type McpOauthGrant = {
  id: string;
  tenant_id: string;
  user_id: string;
  user: UserSummary | null;
  client_id: string;
  scopes: string[];
  status: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type McpPatListResponse = {
  items: McpPat[];
  limit: number;
  offset: number;
  total: number;
};

export type McpOauthClientListResponse = {
  items: McpOauthClient[];
  limit: number;
  offset: number;
  total: number;
};

export type McpOauthGrantListResponse = {
  items: McpOauthGrant[];
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
  admin_visible?: boolean;
  can_read_content?: boolean;
  requires_takeover?: boolean;
  created_at: string;
  updated_at: string;
};

export type AccessObjectType = "workspace" | "knowledge_base" | "document";
export type UserSummary = {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
};
export type WorkspaceMemberRole = "owner" | "admin" | "member" | "guest";
export type CollaboratorRole = "owner" | "manager" | "editor" | "viewer";
export type InvitationRole =
  | Exclude<WorkspaceMemberRole, "owner">
  | Exclude<CollaboratorRole, "owner">;

export type WorkspaceMember = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  created_at: string;
  user: UserSummary | null;
};

export type Collaborator = {
  id: string;
  tenant_id: string;
  object_type: "knowledge_base" | "document";
  object_id: string;
  subject_type: "user" | "group";
  subject_id: string;
  role: CollaboratorRole;
  source: string;
  created_by: string | null;
  created_at: string;
  user: UserSummary | null;
};

export type Invitation = {
  id: string;
  tenant_id: string;
  object_type: AccessObjectType;
  object_id: string;
  email: string | null;
  invited_user_id: string | null;
  role: InvitationRole;
  status: "pending" | "awaiting_approval" | "accepted" | "revoked";
  require_approval: boolean;
  approved_by: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  invited_by: string;
  created_at: string;
  token?: string;
};

export type InvitationDetail = {
  invitation: Invitation;
  object: {
    type: AccessObjectType;
    id: string;
    title: string;
  };
};

export type ShareLink = {
  id: string;
  tenant_id: string;
  object_type: AccessObjectType;
  object_id: string;
  permission: "view";
  has_password: boolean;
  require_login: boolean;
  restrict_to_workspace_members: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
  token?: string;
  url?: string;
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
  admin_visible?: boolean;
  can_read_content?: boolean;
  requires_takeover?: boolean;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBaseMetadataFieldType = "string" | "number" | "time";

export type KnowledgeBaseMetadataField = {
  id?: string;
  name: string;
  type: KnowledgeBaseMetadataFieldType;
  source: "built_in" | "custom";
  read_only: boolean;
  status?: string;
  sort_order?: number;
  description?: string;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeBaseMetadataFieldsResponse = {
  built_in: KnowledgeBaseMetadataField[];
  custom: KnowledgeBaseMetadataField[];
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
  doc_form?: "text_model" | "hierarchical_model" | "qa_model" | null;
  process_rule_snapshot?: unknown;
  processing_status?: "current" | "needs_reprocess" | "processing" | "failed";
  processing_revision?: number;
  doc_language?: string | null;
  need_summary?: boolean;
  created_at: string;
  updated_at: string;
};

export type DocumentVersion = {
  id: string;
  document_id: string;
  version_no: number;
  markdown: string;
  markdown_hash: string;
  source_type: string;
  source_file_id: string | null;
  created_at: string;
  created_by: string;
  is_current: boolean;
};

export type DocumentVersionSummary = Omit<DocumentVersion, "markdown">;

export type DocumentVersionDiff = {
  added: number;
  removed: number;
  changed: number;
};

export type DocumentDetail = DocumentSummary & {
  currentVersion: DocumentVersion | null;
  role?: string | null;
};

export type DocumentMetadataResponse = {
  knowledge_base_id: string;
  document_id: string;
  fields: KnowledgeBaseMetadataFieldsResponse;
  values: Record<string, unknown>;
};

export type SharedWorkspace = Workspace & {
  knowledge_bases?: KnowledgeBase[];
};

export type SharedKnowledgeBase = KnowledgeBase & {
  documents: DocumentSummary[];
  selectedDocument: DocumentDetail | null;
};

export type ShareResponse = {
  share: ShareLink;
  object: SharedWorkspace | SharedKnowledgeBase | DocumentDetail;
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
  metadata?: {
    effective_retrieval_model?: Record<string, unknown>;
    retrieval_mode?: RetrievalMode;
    requested_retrieval_mode?: RetrievalMode;
    score_source?: "retrieval" | "rerank";
    score_threshold_applied?: number | null;
    mixed_retrieval_model?: boolean;
    hybrid_weights?: {
      keywordWeight: number;
      vectorWeight: number;
    };
    rebuild_required_reason?: string;
  };
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
  | "dashscope"
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages";

export type ImportToolKey = "markitdown" | "mineru" | "pandoc" | "tesseract_ocr";
export type ComplexImportFormat = "pdf" | "docx" | "pptx" | "xlsx" | "image";
export type ImportToolMode = "local_cli" | "http_api";
export type RequestedImportConverter =
  | "auto"
  | "markdown"
  | "text"
  | "html"
  | "csv"
  | ImportToolKey;

export type AdminImportToolSetting = {
  tool_key: ImportToolKey;
  label: string;
  formats: ComplexImportFormat[];
  modes: ImportToolMode[];
  source: "db" | "env" | "default" | "disabled" | "none";
  enabled: boolean;
  configured: boolean;
  mode: ImportToolMode;
  endpoint: string | null;
  command: string | null;
  timeout_ms: number;
  max_file_mb: number;
  has_secret: boolean;
  api_key_last4: string | null;
  options: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string | null;
};

export type AdminImportFormatRoute = {
  format: ComplexImportFormat;
  enabled: boolean;
  source: "db" | "default";
  primary_tool: ImportToolKey;
  fallback_tools: ImportToolKey[];
  updated_by: string | null;
  updated_at: string | null;
};

export type AdminImportToolsResponse = {
  tools: AdminImportToolSetting[];
  routes: AdminImportFormatRoute[];
};

export type UpdateAdminImportToolInput = {
  enabled?: boolean;
  mode?: ImportToolMode;
  endpoint?: string | null;
  command?: string | null;
  timeout_ms?: number | null;
  max_file_mb?: number | null;
  options?: Record<string, unknown>;
  api_key?: string | null;
};

export type UpdateAdminImportFormatRouteInput = {
  enabled?: boolean;
  primary_tool?: ImportToolKey;
  fallback_tools?: ImportToolKey[];
};

export type AdminImportToolProbeResult = {
  configured: boolean;
  ok: boolean;
  latency_ms?: number;
  error?: string;
};

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
  capabilities: ModelCapabilities;
  capabilities_detected_at: string | null;
  capability_warnings: string[];
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

export type ModelCapabilities = {
  input_modalities: Array<"text" | "image" | "audio" | "video">;
  dimensions: number | null;
  max_tokens: number | null;
  languages: string[];
  provider_model_type: string | null;
  supports_batch: boolean | null;
  raw_provider: Record<string, unknown>;
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
    source?: "db" | "env" | "none";
    capabilities?: ModelCapabilities | null;
  };
  rerank: {
    configured: boolean;
    model: string | null;
    source?: "db" | "env" | "none";
    capabilities?: ModelCapabilities | null;
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
  rebuild_required_reason: string | null;
};

export type ModelProbeResult = {
  configured: boolean;
  ok: boolean;
  model?: string;
  dim?: number;
  capabilities?: ModelCapabilities;
  capabilities_detected?: boolean;
  capability_warnings?: string[];
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

export type MilvusIndexProfile = {
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
};

export type MilvusStatusResponse = {
  health: unknown;
  active_alias: string;
  active_profile: MilvusIndexProfile | null;
  alias: unknown;
  model?: {
    embedding: {
      configured: boolean;
      model: string | null;
      dim: number;
      source: "db" | "env" | "none";
      capabilities: ModelCapabilities;
    };
    rerank: {
      configured: boolean;
      model: string | null;
      source: "db" | "env" | "none";
      capabilities: ModelCapabilities;
    };
    dense_profile_compatible: boolean;
    rebuild_required_reason: string | null;
  };
};

export type IndexRebuildJobListResponse = {
  items: IndexRebuildJob[];
  limit: number;
  offset: number;
  total: number;
};

export type ChunkSettings = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  mode: "general" | "parent_child";
  doc_form: "text_model" | "hierarchical_model" | "qa_model";
  indexing_technique: "economy" | "high_quality";
  process_rule_mode: "automatic" | "custom" | "hierarchical";
  process_rule: unknown;
  retrieval_model: {
    search_method?: "semantic_search" | "full_text_search" | "hybrid_search" | "keyword_search";
    top_k?: number;
    score_threshold_enabled?: boolean;
    score_threshold?: number;
    reranking_enable?: boolean;
    reranking_mode?: "weighted_score" | "reranking_model";
    weights?: unknown;
    metadata_filtering_conditions?: unknown;
  };
  summary_index_setting: { enable?: boolean; summary_prompt?: string | null };
  parent_mode: "paragraph" | "full_doc";
  parent_delimiter: string;
  child_delimiter: string;
  parent_max_characters: number;
  chunk_overlap_characters?: number;
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
  index_role?: "content" | "summary";
  source_chunk_id?: string | null;
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
  source_content_text?: string;
  source_content_markdown?: string;
  token_count: number | null;
  metadata: unknown;
  status: "active" | "disabled" | "deleted";
  has_override?: boolean;
  overridden_by?: string | null;
  overridden_at?: string | null;
  disabled_at?: string | null;
  created_at: string;
};

export type DocumentSegmentUpdateResponse = DocumentChunk & {
  needs_index_rebuild: boolean;
  needs_chunk_rebuild: boolean;
  rebuild_hint: string;
};

export type DocumentProcessing = {
  document_id: string;
  knowledge_base_id: string;
  doc_form: "text_model" | "hierarchical_model" | "qa_model";
  parent_mode: "paragraph" | "full_doc" | null;
  process_rule_snapshot: unknown;
  processing_status: "current" | "needs_reprocess" | "processing" | "failed";
  processing_revision: number;
  doc_language: string | null;
  need_summary: boolean;
  knowledge_base_settings: ChunkSettings | null;
};

export type DocumentQaPair = {
  id: string;
  document_id: string;
  question: string;
  answer: string;
  source: "manual" | "csv" | "llm";
  source_chunk_id: string | null;
  status: "active" | "disabled" | "deleted";
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type DocumentSummaryItem = {
  id: string;
  document_id: string;
  summary: string;
  status: "active" | "disabled" | "deleted";
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type DocumentSegmentSummary = {
  id: string;
  document_id: string;
  chunk_id: string;
  summary: string;
  status: "active" | "disabled" | "deleted";
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type DocumentSummariesResponse = {
  document_summary: DocumentSummaryItem | null;
  segment_summaries: DocumentSegmentSummary[];
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
  const method = (init.method ?? "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetch(authApiUrl(path), {
      ...init,
      headers: {
        ...(init.body && !isFormData ? { "content-type": "application/json" } : {}),
        ...csrfHeader(method),
        ...init.headers
      },
      credentials: "include"
    });
  } catch {
    throw new ApiRequestError(0, {
      error: "NETWORK_ERROR",
      message: "API service is unreachable. Please confirm the API server is running."
    });
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new ApiRequestError(response.status, body as ApiErrorBody);
  }

  return body as T;
}

function csrfHeader(method: string): Record<string, string> {
  if (["GET", "HEAD", "OPTIONS"].includes(method) || typeof document === "undefined") {
    return {};
  }
  const token = getCookieValue(csrfCookieName());
  return token ? { "x-openkb-csrf": token } : {};
}

function csrfCookieName(): string {
  return process.env.NEXT_PUBLIC_OPENKB_CSRF_COOKIE_NAME || "openkb_csrf";
}

function getCookieValue(name: string): string | null {
  for (const cookie of document.cookie.split(";")) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
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

export function listWorkspaceMembers(workspaceId: string) {
  return apiFetch<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`);
}

export function updateWorkspaceMember(
  id: string,
  input: { role: Exclude<WorkspaceMemberRole, "owner"> }
) {
  return apiFetch<WorkspaceMember>(`/api/workspace-members/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteWorkspaceMember(id: string) {
  return apiFetch<{ ok: true }>(`/api/workspace-members/${id}`, { method: "DELETE" });
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

export function takeoverContentAccess(
  objectType: "knowledge_base" | "document",
  id: string,
  input: { reason: string; role?: Exclude<CollaboratorRole, "owner"> }
) {
  return apiFetch<{
    ok: true;
    collaborator_id: string;
    object_type: string;
    object_id: string;
    role: string;
  }>(`/api/admin/content-access/${objectType}/${id}/takeover`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getKnowledgeBaseTree(id: string) {
  return apiFetch<DocumentSummary[]>(`/api/knowledge-bases/${id}/tree`);
}

export function listKnowledgeBaseMetadataFields(id: string) {
  return apiFetch<KnowledgeBaseMetadataFieldsResponse>(
    `/api/knowledge-bases/${id}/metadata-fields`
  );
}

export function createKnowledgeBaseMetadataField(
  id: string,
  input: { name: string; type: KnowledgeBaseMetadataFieldType; sort_order?: number }
) {
  return apiFetch<KnowledgeBaseMetadataField>(`/api/knowledge-bases/${id}/metadata-fields`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteKnowledgeBaseMetadataField(id: string, fieldId: string) {
  return apiFetch<KnowledgeBaseMetadataField>(
    `/api/knowledge-bases/${id}/metadata-fields/${fieldId}`,
    { method: "DELETE" }
  );
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

export function getDocumentMetadata(id: string) {
  return apiFetch<DocumentMetadataResponse>(`/api/documents/${id}/metadata`);
}

export function updateDocumentMetadata(id: string, input: { values: Record<string, unknown> }) {
  return apiFetch<DocumentMetadataResponse>(`/api/documents/${id}/metadata`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function updateDocument(id: string, input: UpdateDocumentInput) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listDocumentVersions(id: string) {
  return apiFetch<DocumentVersionSummary[]>(`/api/documents/${id}/versions`);
}

export function getDocumentVersion(id: string, versionId: string) {
  return apiFetch<DocumentVersion>(`/api/documents/${id}/versions/${versionId}`);
}

export function restoreDocumentVersion(id: string, versionId: string) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}/restore/${versionId}`, {
    method: "POST"
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
  converter?: RequestedImportConverter;
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
  score_threshold?: number;
  retrieval_model?: Partial<ChunkSettings["retrieval_model"]>;
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
      | "doc_form"
      | "indexing_technique"
      | "process_rule_mode"
      | "process_rule"
      | "retrieval_model"
      | "summary_index_setting"
      | "parent_mode"
      | "parent_delimiter"
      | "child_delimiter"
      | "parent_max_characters"
      | "chunk_overlap_characters"
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

export function getDocumentProcessing(id: string) {
  return apiFetch<DocumentProcessing>(`/api/documents/${id}/processing`);
}

export function updateDocumentProcessing(
  id: string,
  input: {
    parent_mode?: "paragraph" | "full_doc";
    process_rule?: unknown;
    doc_language?: string | null;
    need_summary?: boolean;
  }
) {
  return apiFetch<DocumentProcessing>(`/api/documents/${id}/processing`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function reprocessDocument(id: string) {
  return apiFetch<DocumentDetail>(`/api/documents/${id}/reprocess`, { method: "POST" });
}

export function updateDocumentSegment(
  documentId: string,
  chunkId: string,
  input: {
    status?: "active" | "disabled" | "deleted";
    override_content_text?: string | null;
    override_content_markdown?: string | null;
    reset_override?: boolean;
  }
) {
  return apiFetch<DocumentSegmentUpdateResponse>(`/api/documents/${documentId}/chunks/${chunkId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listDocumentQaPairs(documentId: string) {
  return apiFetch<DocumentQaPair[]>(`/api/documents/${documentId}/qa`);
}

export function createDocumentQaPair(
  documentId: string,
  input: {
    question: string;
    answer: string;
    source?: "manual" | "csv" | "llm";
    source_chunk_id?: string | null;
    metadata?: unknown;
  }
) {
  return apiFetch<DocumentQaPair>(`/api/documents/${documentId}/qa`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDocumentQaPair(
  documentId: string,
  qaId: string,
  input: {
    question?: string;
    answer?: string;
    status?: "active" | "disabled" | "deleted";
    source_chunk_id?: string | null;
    metadata?: unknown;
  }
) {
  return apiFetch<DocumentQaPair>(`/api/documents/${documentId}/qa/${qaId}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function importDocumentQaPairs(
  documentId: string,
  input: {
    csv?: string;
    rows?: Array<{
      question: string;
      answer: string;
      source_chunk_id?: string | null;
      metadata?: unknown;
    }>;
  }
) {
  return apiFetch<{
    created: number;
    skipped: number;
    errors: Array<{ row: number; error: string }>;
    items: DocumentQaPair[];
  }>(`/api/documents/${documentId}/qa/import`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function generateDocumentQaPairs(
  documentId: string,
  input: {
    mode: "llm" | "mock";
    scope: "document" | "segments";
    count?: number;
    overwrite?: boolean;
  }
) {
  return apiFetch<{
    created: number;
    skipped: number;
    items: DocumentQaPair[];
    warnings: string[];
  }>(`/api/documents/${documentId}/qa/generate`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listDocumentSummaries(documentId: string) {
  return apiFetch<DocumentSummariesResponse>(`/api/documents/${documentId}/summaries`);
}

export function generateDocumentSummary(
  documentId: string,
  input: {
    scope?: "document" | "segment" | "all_segments";
    mode?: "manual" | "llm" | "mock";
    chunk_id?: string;
    summary?: string;
  } = {}
) {
  return apiFetch<
    | (DocumentSummaryItem & {
        needs_index_rebuild?: boolean;
        needs_chunk_rebuild?: boolean;
        rebuild_hint?: string;
      })
    | (DocumentSegmentSummary & {
        needs_index_rebuild?: boolean;
        needs_chunk_rebuild?: boolean;
        rebuild_hint?: string;
      })
    | {
        created: number;
        items: DocumentSegmentSummary[];
        needs_index_rebuild: boolean;
        needs_chunk_rebuild: boolean;
        rebuild_hint: string;
      }
  >(`/api/documents/${documentId}/summaries`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listKnowledgeBaseChunks(
  id: string,
  input: {
    document_id?: string;
    type?: string;
    limit?: number;
    status?: "active" | "disabled" | "deleted" | "all";
  } = {}
) {
  const params = new URLSearchParams();
  if (input.document_id) params.set("document_id", input.document_id);
  if (input.type) params.set("type", input.type);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.status) params.set("status", input.status);
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

export function listCollaborators(objectType: "knowledge_base" | "document", objectId: string) {
  return apiFetch<Collaborator[]>(`/api/objects/${objectType}/${objectId}/collaborators`);
}

export function updateCollaborator(
  id: string,
  input: { role: Exclude<CollaboratorRole, "owner"> }
) {
  return apiFetch<Collaborator>(`/api/collaborators/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteCollaborator(id: string) {
  return apiFetch<{ ok: true }>(`/api/collaborators/${id}`, { method: "DELETE" });
}

export function listInvitations(objectType: AccessObjectType, objectId: string) {
  return apiFetch<Invitation[]>(`/api/objects/${objectType}/${objectId}/invitations`);
}

export function createInvitation(
  objectType: AccessObjectType,
  objectId: string,
  input: {
    email: string;
    role: InvitationRole;
    require_approval?: boolean;
    expires_at?: string | null;
    max_uses?: number | null;
  }
) {
  return apiFetch<Invitation>(`/api/objects/${objectType}/${objectId}/invitations`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getInvitation(token: string) {
  return apiFetch<InvitationDetail>(`/api/invitations/${encodeURIComponent(token)}`);
}

export function acceptInvitation(token: string) {
  return apiFetch<{ ok: true; status: "accepted" | "awaiting_approval" }>(
    `/api/invitations/${encodeURIComponent(token)}/accept`,
    { method: "POST" }
  );
}

export function approveInvitation(id: string) {
  return apiFetch<{ ok: true }>(`/api/invitations/${id}/approve`, { method: "POST" });
}

export function revokeInvitation(id: string) {
  return apiFetch<{ ok: true }>(`/api/invitations/${id}/revoke`, { method: "POST" });
}

export function listShareLinks(objectType: AccessObjectType, objectId: string) {
  return apiFetch<ShareLink[]>(`/api/objects/${objectType}/${objectId}/share-links`);
}

export function createShareLink(
  objectType: AccessObjectType,
  objectId: string,
  input: {
    password?: string | null;
    require_login?: boolean;
    restrict_to_workspace_members?: boolean;
    expires_at?: string | null;
  }
) {
  return apiFetch<ShareLink>(`/api/objects/${objectType}/${objectId}/share-links`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getShare(token: string, documentId?: string | null) {
  const params = new URLSearchParams();
  if (documentId) params.set("document_id", documentId);
  const query = params.toString();
  return apiFetch<ShareResponse>(
    `/api/share/${encodeURIComponent(token)}${query ? `?${query}` : ""}`
  );
}

export function verifySharePassword(token: string, password: string) {
  return apiFetch<{ ok: true }>(`/api/share/${encodeURIComponent(token)}/verify-password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function revokeShareLink(id: string) {
  return apiFetch<{ ok: true }>(`/api/share-links/${id}/revoke`, { method: "POST" });
}

export function resetShareLink(id: string) {
  return apiFetch<ShareLink>(`/api/share-links/${id}/reset`, { method: "POST" });
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

export function listAdminImportTools() {
  return apiFetch<AdminImportToolsResponse>("/api/admin/import-tools");
}

export function updateAdminImportTool(toolKey: ImportToolKey, input: UpdateAdminImportToolInput) {
  return apiFetch<AdminImportToolSetting>(`/api/admin/import-tools/${toolKey}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function probeAdminImportTool(toolKey: ImportToolKey) {
  return apiFetch<AdminImportToolProbeResult>(`/api/admin/import-tools/${toolKey}/probe`, {
    method: "POST"
  });
}

export function clearAdminImportToolSecret(toolKey: ImportToolKey) {
  return apiFetch<AdminImportToolSetting>(`/api/admin/import-tools/${toolKey}/secret`, {
    method: "DELETE"
  });
}

export function updateAdminImportFormatRoute(
  format: ComplexImportFormat,
  input: UpdateAdminImportFormatRouteInput
) {
  return apiFetch<AdminImportFormatRoute>(`/api/admin/import-tools/routes/${format}`, {
    method: "PUT",
    body: JSON.stringify(input)
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

export function getMilvusAdminStatus() {
  return apiFetch<MilvusStatusResponse>("/api/admin/milvus/status");
}

export function listMilvusIndexProfiles() {
  return apiFetch<MilvusIndexProfile[]>("/api/admin/milvus/index-profiles");
}

export function listMilvusRebuildJobs(
  input: { status?: string; limit?: number; offset?: number } = {}
) {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<IndexRebuildJobListResponse>(
    `/api/admin/milvus/rebuild-jobs${query ? `?${query}` : ""}`
  );
}

export function switchMilvusAlias(input: { alias?: string; collection_name: string }) {
  return apiFetch<{ alias: string; collection: string; profile_id: string }>(
    "/api/admin/milvus/aliases/switch",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getAdminAuthSettings(
  input: { scope?: AuthSettingsScope; tenant_id?: string } = {}
) {
  const params = new URLSearchParams();
  if (input.scope) params.set("scope", input.scope);
  if (input.tenant_id) params.set("tenant_id", input.tenant_id);
  const query = params.toString();
  return apiFetch<AdminAuthSettings>(`/api/admin/auth-settings${query ? `?${query}` : ""}`);
}

export function updateAdminAuthSettings(input: UpdateAdminAuthSettingsInput) {
  return apiFetch<AdminAuthSettings>("/api/admin/auth-settings", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listDifyApiKeys(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<DifyApiKeyListResponse>(`/api/admin/dify/api-keys${query ? `?${query}` : ""}`);
}

export function getDifySetupSummary() {
  return apiFetch<DifySetupSummary>("/api/admin/dify/setup");
}

export function getDifyFilterableMetadata(input: { knowledge_base_id?: string } = {}) {
  const params = new URLSearchParams();
  if (input.knowledge_base_id) params.set("knowledge_base_id", input.knowledge_base_id);
  const query = params.toString();
  return apiFetch<DifyFilterableMetadataResponse>(
    `/api/admin/dify/filterable-metadata${query ? `?${query}` : ""}`
  );
}

export function createDifyApiKey(input: {
  name: string;
  knowledge_id: string;
  knowledge_base_id: string;
  allowed_knowledge_base_ids?: string[];
  retrieval_top_k_limit?: number;
  expires_at?: string | null;
}) {
  return apiFetch<SecretCreateResponse<DifyApiKey>>("/api/admin/dify/api-keys", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDifyApiKey(
  id: string,
  input: Partial<
    Pick<
      DifyApiKey,
      "name" | "status" | "allowed_knowledge_base_ids" | "retrieval_top_k_limit" | "expires_at"
    >
  >
) {
  return apiFetch<DifyApiKey>(`/api/admin/dify/api-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function revealDifyApiKey(id: string) {
  return apiFetch<SecretCreateResponse<DifyApiKey>>(`/api/admin/dify/api-keys/${id}/reveal`, {
    method: "POST"
  });
}

export function rotateDifyApiKey(id: string) {
  return apiFetch<SecretCreateResponse<DifyApiKey>>(`/api/admin/dify/api-keys/${id}/rotate`, {
    method: "POST"
  });
}

export function revokeDifyApiKey(id: string) {
  return apiFetch<DifyApiKey>(`/api/admin/dify/api-keys/${id}/revoke`, { method: "POST" });
}

export function listDifyMappings(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<DifyMappingListResponse>(`/api/admin/dify/mappings${query ? `?${query}` : ""}`);
}

export function upsertDifyMapping(input: {
  dify_knowledge_id: string;
  knowledge_base_id: string;
  status?: string;
}) {
  return apiFetch<DifyKnowledgeMapping>("/api/admin/dify/mappings", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateDifyMapping(
  id: string,
  input: Partial<Pick<DifyKnowledgeMapping, "dify_knowledge_id" | "knowledge_base_id" | "status">>
) {
  return apiFetch<DifyKnowledgeMapping>(`/api/admin/dify/mappings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function listMcpPats(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<McpPatListResponse>(`/api/admin/mcp/pats${query ? `?${query}` : ""}`);
}

export function createMcpPat(input: {
  user_email: string;
  name: string;
  scopes?: string[];
  expires_at?: string | null;
}) {
  return apiFetch<SecretCreateResponse<McpPat>>("/api/admin/mcp/pats", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function revokeMcpPat(id: string) {
  return apiFetch<McpPat>(`/api/admin/mcp/pats/${id}/revoke`, { method: "POST" });
}

export function listMcpOauthClients(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<McpOauthClientListResponse>(
    `/api/admin/mcp/oauth-clients${query ? `?${query}` : ""}`
  );
}

export function createMcpOauthClient(input: {
  client_id?: string;
  client_name: string;
  redirect_uris?: string[];
  allowed_scopes?: string[];
  status?: string;
}) {
  return apiFetch<McpOauthClient>("/api/admin/mcp/oauth-clients", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateMcpOauthClient(
  id: string,
  input: Partial<
    Pick<McpOauthClient, "client_name" | "redirect_uris" | "allowed_scopes" | "status">
  >
) {
  return apiFetch<McpOauthClient>(`/api/admin/mcp/oauth-clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function listMcpOauthGrants(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<McpOauthGrantListResponse>(
    `/api/admin/mcp/oauth-grants${query ? `?${query}` : ""}`
  );
}

export function revokeMcpOauthGrant(id: string) {
  return apiFetch<McpOauthGrant>(`/api/admin/mcp/oauth-grants/${id}/revoke`, { method: "POST" });
}

export function getAdminEmailSettings() {
  return apiFetch<AdminSmtpSettings>("/api/admin/email/settings");
}

export function updateAdminEmailSettings(input: UpdateAdminSmtpSettingsInput) {
  return apiFetch<AdminSmtpSettings>("/api/admin/email/settings", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function probeAdminEmailSettings(input: UpdateAdminSmtpSettingsInput = {}) {
  return apiFetch<{
    ok: boolean;
    source: string;
    message: string;
    host: string | null;
    from_email: string | null;
  }>("/api/admin/email/probe", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function sendAdminTestEmail(input: { to?: string; subject?: string; text?: string }) {
  return apiFetch<{ ok: boolean; source: string; message?: string; error?: string }>(
    "/api/admin/email/test-send",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function listAdminEmailOutbox(input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const query = params.toString();
  return apiFetch<AdminEmailOutboxListResponse>(
    `/api/admin/email/outbox${query ? `?${query}` : ""}`
  );
}

export function retryAdminEmailOutbox(id: string) {
  return apiFetch<{ ok: boolean; source: string; message?: string; error?: string }>(
    `/api/admin/email/outbox/${id}/retry`,
    { method: "POST" }
  );
}

export function getAdminOpsHealth() {
  return apiFetch<AdminOpsHealth>("/api/admin/ops/health");
}

export function listAdminSecuritySecrets() {
  return apiFetch<AdminSecuritySecrets>("/api/admin/security/secrets");
}

export function rotateAdminSecuritySecret(kind: string) {
  return apiFetch<{ ok: boolean; kind: string; revoked_count?: number }>(
    `/api/admin/security/rotate/${kind}`,
    { method: "POST" }
  );
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
  return apiFetch<{ user: AdminUser; reset_link: string; setup_link?: string }>(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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
    object_id?: string;
    actor_user_id?: string;
    actor_type?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (input.action) params.set("action", input.action);
  if (input.object_type) params.set("object_type", input.object_type);
  if (input.object_id) params.set("object_id", input.object_id);
  if (input.actor_user_id) params.set("actor_user_id", input.actor_user_id);
  if (input.actor_type) params.set("actor_type", input.actor_type);
  if (input.date_from) params.set("date_from", input.date_from);
  if (input.date_to) params.set("date_to", input.date_to);
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

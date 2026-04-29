CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NULL,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending_email_verification',
    'pending_activation',
    'active',
    'suspended',
    'deleted'
  )),
  email_verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system_admin', 'tenant_admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX tenant_memberships_user_id_idx ON tenant_memberships(user_id);

CREATE TABLE auth_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registration_enabled boolean NOT NULL DEFAULT true,
  email_verification_required boolean NOT NULL DEFAULT true,
  default_signup_status text NOT NULL DEFAULT 'active'
    CHECK (default_signup_status IN ('active', 'pending_activation')),
  invited_user_auto_active boolean NOT NULL DEFAULT true,
  allowed_email_domains text[] NOT NULL DEFAULT '{}',
  invite_required boolean NOT NULL DEFAULT false,
  first_user_becomes_admin boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE UNIQUE INDEX auth_settings_single_instance_default_idx
  ON auth_settings ((1))
  WHERE tenant_id IS NULL;

CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX group_members_tenant_id_idx ON group_members(tenant_id);
CREATE INDEX group_members_user_id_idx ON group_members(user_id);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX workspaces_created_by_idx ON workspaces(created_by);

CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_members_tenant_id_idx ON workspace_members(tenant_id);
CREATE INDEX workspace_members_user_id_idx ON workspace_members(user_id);

CREATE TABLE knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'workspace', 'public')),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX knowledge_bases_tenant_id_idx ON knowledge_bases(tenant_id);
CREATE INDEX knowledge_bases_created_by_idx ON knowledge_bases(created_by);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES documents(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('folder', 'page')),
  title text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived', 'deleted')),
  permission_mode text NOT NULL DEFAULT 'inherit'
    CHECK (permission_mode IN ('inherit', 'custom')),
  visibility text NULL CHECK (
    visibility IS NULL
    OR visibility IN ('private', 'workspace', 'public')
  ),
  current_version_id uuid NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_tenant_id_idx ON documents(tenant_id);
CREATE INDEX documents_workspace_id_idx ON documents(workspace_id);
CREATE INDEX documents_knowledge_base_id_idx ON documents(knowledge_base_id);
CREATE INDEX documents_parent_id_idx ON documents(parent_id);

CREATE TABLE document_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NULL REFERENCES documents(id) ON DELETE SET NULL,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_assets_tenant_id_idx ON document_assets(tenant_id);
CREATE INDEX document_assets_document_id_idx ON document_assets(document_id);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  markdown text NOT NULL,
  markdown_hash text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('manual', 'upload', 'import', 'api')),
  source_file_id uuid NULL REFERENCES document_assets(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

CREATE INDEX document_versions_tenant_id_idx ON document_versions(tenant_id);
CREATE INDEX document_versions_source_file_id_idx ON document_versions(source_file_id);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE TABLE collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('knowledge_base', 'document')),
  object_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'editor', 'viewer')),
  source text NOT NULL CHECK (source IN ('direct', 'invitation', 'system', 'transfer')),
  created_by uuid NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, subject_type, subject_id)
);

CREATE INDEX collaborators_tenant_id_idx ON collaborators(tenant_id);
CREATE INDEX collaborators_subject_idx ON collaborators(subject_type, subject_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('workspace', 'knowledge_base', 'document')),
  object_id uuid NOT NULL,
  email text NULL,
  invited_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  role text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'accepted', 'rejected', 'expired', 'revoked', 'awaiting_approval')
  ),
  require_approval boolean NOT NULL DEFAULT false,
  approved_by uuid NULL REFERENCES users(id),
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NULL,
  max_uses int NULL,
  used_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_role_by_object CHECK (
    (object_type = 'workspace' AND role IN ('admin', 'member', 'guest'))
    OR (object_type IN ('knowledge_base', 'document') AND role IN ('manager', 'editor', 'viewer'))
  )
);

CREATE INDEX invitations_tenant_id_idx ON invitations(tenant_id);
CREATE INDEX invitations_token_hash_idx ON invitations(token_hash);
CREATE INDEX invitations_object_idx ON invitations(object_type, object_id);

CREATE TABLE share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('knowledge_base', 'document')),
  object_id uuid NOT NULL,
  token_hash text NOT NULL,
  permission text NOT NULL DEFAULT 'view' CHECK (permission = 'view'),
  password_hash text NULL,
  require_login boolean NOT NULL DEFAULT false,
  restrict_to_workspace_members boolean NOT NULL DEFAULT false,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX share_links_tenant_id_idx ON share_links(tenant_id);
CREATE INDEX share_links_token_hash_idx ON share_links(token_hash);
CREATE INDEX share_links_object_idx ON share_links(object_type, object_id);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_asset_id uuid NOT NULL REFERENCES document_assets(id),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  converter text NOT NULL,
  error text NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_jobs_tenant_id_idx ON import_jobs(tenant_id);
CREATE INDEX import_jobs_workspace_id_idx ON import_jobs(workspace_id);
CREATE INDEX import_jobs_knowledge_base_id_idx ON import_jobs(knowledge_base_id);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  ordinal int NOT NULL,
  heading_path text[] NOT NULL DEFAULT '{}',
  content_text text NOT NULL,
  content_markdown text NOT NULL,
  token_count int NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, ordinal)
);

CREATE INDEX document_chunks_tenant_id_idx ON document_chunks(tenant_id);
CREATE INDEX document_chunks_workspace_id_idx ON document_chunks(workspace_id);
CREATE INDEX document_chunks_knowledge_base_id_idx ON document_chunks(knowledge_base_id);
CREATE INDEX document_chunks_document_id_idx ON document_chunks(document_id);

CREATE TABLE milvus_index_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alias text NOT NULL,
  collection_name text NOT NULL,
  schema_version text NOT NULL,
  vector_dim int NOT NULL,
  embedding_function_name text NOT NULL,
  bm25_function_name text NULL,
  rerank_function_name text NULL,
  status text NOT NULL CHECK (status IN ('building', 'active', 'deprecated', 'failed')),
  function_metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NULL
);

CREATE INDEX milvus_index_profiles_tenant_id_idx ON milvus_index_profiles(tenant_id);
CREATE INDEX milvus_index_profiles_alias_idx ON milvus_index_profiles(alias);

CREATE TABLE index_rebuild_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_collection text NOT NULL,
  target_alias text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  error text NULL
);

CREATE INDEX index_rebuild_jobs_tenant_id_idx ON index_rebuild_jobs(tenant_id);
CREATE INDEX index_rebuild_jobs_status_idx ON index_rebuild_jobs(status);

CREATE TABLE mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id text UNIQUE NOT NULL,
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  allowed_scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_clients_tenant_id_idx ON mcp_oauth_clients(tenant_id);

CREATE TABLE mcp_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_grants_tenant_id_idx ON mcp_oauth_grants(tenant_id);
CREATE INDEX mcp_oauth_grants_user_id_idx ON mcp_oauth_grants(user_id);
CREATE INDEX mcp_oauth_grants_client_id_idx ON mcp_oauth_grants(client_id);

CREATE TABLE mcp_oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_authorization_codes_tenant_id_idx
  ON mcp_oauth_authorization_codes(tenant_id);
CREATE INDEX mcp_oauth_authorization_codes_grant_id_idx
  ON mcp_oauth_authorization_codes(grant_id);
CREATE INDEX mcp_oauth_authorization_codes_code_hash_idx
  ON mcp_oauth_authorization_codes(code_hash);

CREATE TABLE mcp_oauth_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_oauth_refresh_tokens_tenant_id_idx ON mcp_oauth_refresh_tokens(tenant_id);
CREATE INDEX mcp_oauth_refresh_tokens_grant_id_idx ON mcp_oauth_refresh_tokens(grant_id);
CREATE INDEX mcp_oauth_refresh_tokens_token_hash_idx ON mcp_oauth_refresh_tokens(token_hash);

CREATE TABLE mcp_personal_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamptz NULL,
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mcp_personal_access_tokens_tenant_id_idx ON mcp_personal_access_tokens(tenant_id);
CREATE INDEX mcp_personal_access_tokens_user_id_idx ON mcp_personal_access_tokens(user_id);
CREATE INDEX mcp_personal_access_tokens_token_hash_idx ON mcp_personal_access_tokens(token_hash);

CREATE TABLE dify_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  allowed_knowledge_base_ids uuid[] NOT NULL DEFAULT '{}',
  allowed_metadata_filters jsonb NOT NULL DEFAULT '{}',
  retrieval_top_k_limit int NOT NULL DEFAULT 10,
  expires_at timestamptz NULL,
  last_used_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dify_api_keys_tenant_id_idx ON dify_api_keys(tenant_id);
CREATE INDEX dify_api_keys_key_hash_idx ON dify_api_keys(key_hash);

CREATE TABLE dify_knowledge_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dify_knowledge_id text NOT NULL,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dify_knowledge_id)
);

CREATE INDEX dify_knowledge_mappings_knowledge_base_id_idx
  ON dify_knowledge_mappings(knowledge_base_id);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'api_key', 'system')),
  action text NOT NULL,
  object_type text NULL,
  object_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  ip text NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_id_idx ON audit_logs(tenant_id);
CREATE INDEX audit_logs_actor_user_id_idx ON audit_logs(actor_user_id);
CREATE INDEX audit_logs_object_idx ON audit_logs(object_type, object_id);

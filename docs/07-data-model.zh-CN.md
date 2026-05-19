# 07 — 数据模型

本文件描述核心 PostgreSQL 表。字段名可在实现时微调，但语义不能偏离。

## 1. 用户、租户、注册设置

```sql
users (
  id uuid primary key,
  email text unique not null,
  password_hash text null,
  display_name text not null,
  status text not null check (status in (
    'pending_email_verification',
    'pending_activation',
    'active',
    'suspended',
    'deleted'
  )),
  email_verified_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

tenants (
  id uuid primary key,
  name text not null,
  slug text unique not null,
  created_at timestamptz not null
)

tenant_memberships (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('system_admin', 'tenant_admin', 'member')),
  created_at timestamptz not null,
  unique (tenant_id, user_id)
)

auth_settings (
  id uuid primary key,
  tenant_id uuid null unique,
  -- tenant_id null 表示实例默认设置；tenant_id 非 null 表示租户覆盖。
  registration_enabled boolean not null default true,
  email_verification_required boolean not null default true,
  default_signup_status text not null default 'active' check (default_signup_status in ('active', 'pending_activation')),
  invited_user_auto_active boolean not null default true,
  allowed_email_domains text[] null,
  invite_required boolean not null default false,
  first_user_becomes_admin boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

## 1.1 用户组

用户组用于手动授权，不来自 LDAP/SCIM。

```sql
groups (
  id uuid primary key,
  tenant_id uuid not null,
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, name)
)

group_members (
  id uuid primary key,
  tenant_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null,
  unique (group_id, user_id)
)
```

## 2. 空间和知识库

Workspace 成员角色只存在 `workspace_members` 表。不要把 workspace 成员关系写入 `collaborators`。

```sql
workspaces (
  id uuid primary key,
  tenant_id uuid not null,
  name text not null,
  slug text not null,
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, slug)
)

workspace_members (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'member', 'guest')),
  created_at timestamptz not null,
  unique (workspace_id, user_id)
)

knowledge_bases (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  title text not null,
  slug text not null,
  visibility text not null check (visibility in ('private', 'workspace', 'public')),
  status text not null check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (workspace_id, slug)
)
```

## 3. 文档和版本

OpenKB 不单独建立 `folders` 表。目录树中的目录和文档页统一存在 `documents` 表中，通过 `documents.type = folder | page` 区分。`folder` 行用于目录结构、排序、继承和协作者范围，不保存可编辑正文；`page` 行才保存 Markdown 正文版本。

```sql
documents (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null,
  parent_id uuid null,
  type text not null check (type in ('folder', 'page')),
  title text not null,
  slug text not null,
  status text not null check (status in ('draft', 'published', 'archived', 'deleted')),
  permission_mode text not null default 'inherit' check (permission_mode in ('inherit', 'custom')),
  visibility text null check (visibility is null or visibility in ('private', 'workspace', 'public')),
  current_version_id uuid null,
  sort_order int not null default 0,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

document_versions (
  id uuid primary key,
  tenant_id uuid not null,
  document_id uuid not null,
  version_no int not null,
  markdown text not null,
  markdown_hash text not null,
  source_type text not null check (source_type in ('manual', 'upload', 'import', 'api')),
  source_file_id uuid null,
  created_by uuid not null,
  created_at timestamptz not null,
  unique (document_id, version_no)
)
```

## 4. 协作者和权限

`collaborators` 是语雀式内容对象权限的核心表。它只用于 knowledge_base 和 document。folder 因为也是 `documents.type = folder`，所以按 document 对象处理。

```sql
collaborators (
  id uuid primary key,
  tenant_id uuid not null,
  object_type text not null check (object_type in ('knowledge_base', 'document')),
  object_id uuid not null,
  subject_type text not null check (subject_type in ('user', 'group')),
  subject_id uuid not null,
  role text not null check (role in ('owner', 'manager', 'editor', 'viewer')),
  source text not null check (source in ('direct', 'invitation', 'system', 'transfer', 'admin_takeover')),
  created_by uuid null,
  created_at timestamptz not null,
  unique (object_type, object_id, subject_type, subject_id)
)
```

不使用 OpenFGA/Casbin。workspace 成员关系由 `workspace_members` 表表达，不进入 `collaborators`。

## 5. 邀请和分享

`invitations.role` 根据 `object_type` 使用不同的合法集合：

```text
object_type = workspace: role in admin/member/guest
object_type = knowledge_base/document: role in manager/editor/viewer
```

普通邀请不授予 owner。owner 转让走单独接口和审计。

```sql
invitations (
  id uuid primary key,
  tenant_id uuid not null,
  object_type text not null check (object_type in ('workspace', 'knowledge_base', 'document')),
  object_id uuid not null,
  email text null,
  invited_user_id uuid null,
  role text not null,
  token_hash text not null,
  status text not null check (status in ('pending', 'accepted', 'rejected', 'expired', 'revoked', 'awaiting_approval')),
  require_approval boolean not null default false,
  approved_by uuid null,
  invited_by uuid not null,
  expires_at timestamptz null,
  max_uses int null,
  used_count int not null default 0,
  created_at timestamptz not null,
  constraint invitations_role_by_object check (
    (object_type = 'workspace' and role in ('admin', 'member', 'guest'))
    or (object_type in ('knowledge_base', 'document') and role in ('manager', 'editor', 'viewer'))
  )
)

share_links (
  id uuid primary key,
  tenant_id uuid not null,
  object_type text not null check (object_type in ('knowledge_base', 'document')),
  object_id uuid not null,
  token_hash text not null,
  permission text not null default 'view' check (permission = 'view'),
  password_hash text null,
  require_login boolean not null default false,
  restrict_to_workspace_members boolean not null default false,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid not null,
  created_at timestamptz not null
)
```

`share_links.permission` 字段在 v0.x 固定为 `view`，只是为了和产品语义保持清晰以及未来保留扩展点。当前实现必须通过数据库约束和服务层校验禁止任何链接编辑权限。

## 6. 资源和导入

```sql
document_assets (
  id uuid primary key,
  tenant_id uuid not null,
  document_id uuid null,
  object_key text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_by uuid not null,
  created_at timestamptz not null
)

import_jobs (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null,
  source_asset_id uuid not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed')),
  converter text not null,
  error text null,
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

## 7. Chunks 和索引状态

PostgreSQL 保存 chunk 真相，Milvus 保存索引副本。

```sql
document_chunks (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  ordinal int not null,
  chunk_type text not null default 'general',
  parent_chunk_id uuid null,
  settings_revision int not null default 1,
  start_line int null,
  end_line int null,
  start_char int null,
  end_char int null,
  parent_ordinal int null,
  child_ordinal int null,
  heading_path text[] not null default '{}',
  content_text text not null,
  content_markdown text not null,
  token_count int null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  unique (version_id, ordinal)
)

knowledge_base_chunk_settings (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null unique,
  mode text not null check (mode in ('general', 'parent_child')),
  parent_mode text not null check (parent_mode in ('paragraph', 'full_doc')),
  parent_delimiter text not null default E'\n\n',
  child_delimiter text not null default E'\n\n',
  parent_max_characters int not null,
  child_max_characters int not null,
  child_overlap_characters int not null,
  revision int not null default 1,
  updated_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

chunk_rebuild_jobs (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null,
  settings_revision int not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by uuid not null,
  error text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  finished_at timestamptz null
)

milvus_index_profiles (
  id uuid primary key,
  tenant_id uuid null,
  alias text not null,
  collection_name text not null,
  schema_version text not null,
  vector_dim int not null,
  embedding_function_name text not null,
  bm25_function_name text null,
  rerank_function_name text null,
  status text not null check (status in ('building', 'active', 'deprecated', 'failed')),
  function_metadata jsonb not null default '{}',
  created_by uuid not null,
  created_at timestamptz not null,
  activated_at timestamptz null
)

index_rebuild_jobs (
  id uuid primary key,
  tenant_id uuid null,
  target_collection text not null,
  target_alias text not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  started_by uuid not null,
  started_at timestamptz not null,
  finished_at timestamptz null,
  error text null
)
```

```sql
retrieval_settings (
  id uuid primary key,
  tenant_id uuid null unique,
  mode text not null check (mode in ('bm25', 'dense', 'dense_rerank', 'hybrid', 'hybrid_rerank')),
  updated_by uuid not null,
  updated_at timestamptz not null
)
```

```sql
model_settings (
  id uuid primary key,
  tenant_id uuid null check (tenant_id is null),
  kind text unique not null check (kind in ('embedding', 'rerank', 'language')),
  provider text not null check (
    provider in (
      'openai_compatible',
      'dashscope',
      'openai_responses',
      'openai_chat_completions',
      'anthropic_messages'
    )
  ),
  endpoint text null,
  model text null,
  enabled boolean not null default false,
  timeout_ms int null,
  embedding_dim int null,
  embedding_batch_size int null,
  llm_temperature double precision null,
  llm_max_output_tokens int null,
  encrypted_api_key text null,
  api_key_last4 text null,
  updated_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

OpenKB 不提供知识库级模型配置。模型 endpoint/model/secret 可以由部署环境变量提供，也可以由 `system_admin` 保存实例级 DB enabled 配置；DB secret 只能是 AES-256-GCM 密文，审计日志不记录 raw key。`retrieval_settings` 只保存检索模式。

## 8. MCP OAuth / PAT 持久化

MCP 是用户级能力出口。所有 token、grant 和 PAT 必须能解析到真实 user。

```sql
mcp_oauth_clients (
  id uuid primary key,
  tenant_id uuid not null,
  client_id text unique not null,
  client_name text not null,
  redirect_uris text[] not null default '{}',
  allowed_scopes text[] not null default '{}',
  status text not null check (status in ('active', 'disabled')),
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

mcp_oauth_grants (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  client_id uuid not null,
  scopes text[] not null default '{}',
  status text not null check (status in ('active', 'revoked')),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null
)

mcp_oauth_authorization_codes (
  id uuid primary key,
  tenant_id uuid not null,
  grant_id uuid not null,
  code_hash text not null,
  redirect_uri text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null
)

mcp_oauth_refresh_tokens (
  id uuid primary key,
  tenant_id uuid not null,
  grant_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null
)

mcp_personal_access_tokens (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  name text not null,
  token_hash text not null,
  scopes text[] not null default '{}',
  status text not null check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz null,
  last_used_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null
)
```

MCP access token 可以是短期 JWT，也可以落库；无论采用哪种方式，都不能让 token 脱离 user_id 和 tenant_id。

## 9. Dify scoped API key 持久化

Dify 是应用级检索出口，不是用户级权限出口。

```sql
dify_api_keys (
  id uuid primary key,
  tenant_id uuid not null,
  name text not null,
  key_hash text not null,
  status text not null check (status in ('active', 'disabled', 'revoked')),
  allowed_knowledge_base_ids uuid[] not null default '{}',
  allowed_metadata_filters jsonb not null default '{}',
  retrieval_top_k_limit int not null default 10,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

dify_knowledge_mappings (
  id uuid primary key,
  tenant_id uuid not null,
  dify_knowledge_id text not null,
  knowledge_base_id uuid not null,
  status text not null check (status in ('active', 'disabled')),
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, dify_knowledge_id)
)
```

Dify 请求中的 `knowledge_id` 必须先映射到内部 `knowledge_base_id`，然后再检查当前 API key 是否允许访问该知识库。

## 10. 审计

```sql
audit_logs (
  id uuid primary key,
  tenant_id uuid null,
  actor_user_id uuid null,
  actor_type text not null check (actor_type in ('user', 'api_key', 'system')),
  action text not null,
  object_type text null,
  object_id uuid null,
  metadata jsonb not null default '{}',
  ip text null,
  user_agent text null,
  created_at timestamptz not null
)
```
> Phase 22 补充：Dify 兼容性工作新增 `knowledge_base_chunk_settings.doc_form/indexing_technique/process_rule_mode/process_rule/retrieval_model/summary_index_setting`，`documents.process_rule_snapshot/processing_status/processing_revision/need_summary`，`document_chunks.status/override_content_*`，以及 `document_qa_pairs`、`document_segment_summaries`。正文仍以 `document_versions.markdown` 为真相，chunks/QA/summary 都是派生索引数据。

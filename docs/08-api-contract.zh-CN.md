# 08 — API 合同

API 使用 REST + OpenAPI。所有敏感接口必须经过 Permission Service。

## 1. Auth

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/verify-email
POST /api/auth/password-reset/request
POST /api/auth/password-reset/confirm
```

## 2. Admin

```http
GET  /api/admin/users
POST /api/admin/users
PATCH /api/admin/users/:id
POST /api/admin/users/:id/activate
POST /api/admin/users/:id/suspend
POST /api/admin/users/:id/delete
POST /api/admin/users/:id/password-reset
PUT  /api/admin/users/:id/tenant-role
POST /api/admin/users/:id/revoke-sessions
GET  /api/admin/auth-settings
PUT  /api/admin/auth-settings
GET  /api/admin/audit-logs
```

Milvus 管理只允许 system_admin / tenant_admin：

```http
GET  /api/admin/milvus/status
GET  /api/admin/milvus/index-profiles
POST /api/admin/milvus/rebuild-jobs
GET  /api/admin/milvus/rebuild-jobs/:id
POST /api/admin/milvus/aliases/switch

GET  /api/admin/retrieval-settings
PUT  /api/admin/retrieval-settings
POST /api/admin/retrieval-settings/probe

GET    /api/admin/models
PUT    /api/admin/models/:kind
POST   /api/admin/models/:kind/probe
DELETE /api/admin/models/:kind/secret
```

Milvus 与 Retrieval 设置接口不保存模型 API key，只管理 OpenKB 侧可见的 index profile、job、alias 和检索模式。`/api/admin/models` 仅允许 `system_admin` 使用，可保存实例级 endpoint/model 和加密 secret；响应和审计日志不得返回 raw key。

## 3. Workspace / KB / Document

```http
GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:id
PUT    /api/workspaces/:id

GET    /api/knowledge-bases
POST   /api/knowledge-bases
GET    /api/knowledge-bases/:id
PUT    /api/knowledge-bases/:id

GET    /api/knowledge-bases/:id/overview
GET    /api/knowledge-bases/:id/tree
GET    /api/knowledge-bases/:id/chunk-settings
PUT    /api/knowledge-bases/:id/chunk-settings
POST   /api/knowledge-bases/:id/chunk-preview
GET    /api/knowledge-bases/:id/chunks
POST   /api/knowledge-bases/:id/chunk-rebuild-jobs
GET    /api/chunk-rebuild-jobs/:id

POST   /api/documents
GET    /api/documents/:id
PUT    /api/documents/:id
DELETE /api/documents/:id
POST   /api/documents/:id/publish
POST   /api/documents/:id/unpublish
GET    /api/documents/:id/versions
GET    /api/documents/:id/versions/:versionId
POST   /api/documents/:id/restore/:versionId
```

文档保存示例：

```json
{
  "base_version_id": "ver_123",
  "title": "接入说明",
  "markdown": "# 接入说明\n...",
  "markdown_hash": "sha256..."
}
```

冲突返回：

```json
{
  "error": "VERSION_CONFLICT",
  "current_version_id": "ver_124"
}
```

## 4. 协作者、邀请、分享

```http
GET  /api/workspaces/:id/members
PUT  /api/workspace-members/:id
DELETE /api/workspace-members/:id

GET  /api/objects/:objectType/:objectId/collaborators
POST /api/objects/:objectType/:objectId/collaborators
PUT  /api/collaborators/:id
DELETE /api/collaborators/:id

GET  /api/objects/:objectType/:objectId/invitations
POST /api/objects/:objectType/:objectId/invitations
GET  /api/invitations/:token
POST /api/invitations/:token/accept
POST /api/invitations/:id/approve
POST /api/invitations/:id/revoke

GET  /api/objects/:objectType/:objectId/share-links
POST /api/objects/:objectType/:objectId/share-links
GET  /api/share/:token
POST /api/share/:token/verify-password
POST /api/share-links/:id/reset
POST /api/share-links/:id/revoke
```

Phase 16 已实现最小协作/分享闭环：

- `workspace` 成员仍写入 `workspace_members`，角色只能是 `owner/admin/member/guest`；普通邀请和成员更新不能授予 `owner`。
- `knowledge_base/document` 协作者仍写入 `collaborators`，角色只能是 `owner/manager/editor/viewer`；普通邀请不能授予 `owner`。
- `POST /api/objects/:objectType/:objectId/invitations` 支持 `email`、`role`、`require_approval`、`expires_at`、`max_uses`，并写入开发 `auth_email_outbox`。
- `require_approval=true` 的邀请接受后进入 `awaiting_approval`，审批通过后才写入成员或协作者关系。
- 分享链接 v0.x 固定 `permission=view`，支持 `password`、`require_login`、`restrict_to_workspace_members`、`expires_at`。
- 密码分享通过 `POST /api/share/:token/verify-password` 设置短期 `httpOnly` share cookie；不新增分享会话表。
- `POST /api/share-links/:id/reset` 会关闭旧 token，并创建同配置的新 token；旧 token 立即失效。

## 5. Admin 运维接口（Phase 17）

```http
GET  /api/admin/auth-settings
PUT  /api/admin/auth-settings
GET  /api/admin/audit-logs
GET  /api/admin/milvus/status
GET  /api/admin/milvus/index-profiles
GET  /api/admin/milvus/rebuild-jobs
POST /api/admin/milvus/rebuild-jobs
POST /api/admin/milvus/aliases/switch

GET   /api/admin/dify/api-keys
POST  /api/admin/dify/api-keys
PATCH /api/admin/dify/api-keys/:id
POST  /api/admin/dify/api-keys/:id/reveal
POST  /api/admin/dify/api-keys/:id/rotate
POST  /api/admin/dify/api-keys/:id/revoke
GET   /api/admin/dify/mappings
POST  /api/admin/dify/mappings
PATCH /api/admin/dify/mappings/:id

GET   /api/admin/mcp/pats
POST  /api/admin/mcp/pats
POST  /api/admin/mcp/pats/:id/revoke
GET   /api/admin/mcp/oauth-clients
POST  /api/admin/mcp/oauth-clients
PATCH /api/admin/mcp/oauth-clients/:id
GET   /api/admin/mcp/oauth-grants
POST  /api/admin/mcp/oauth-grants/:id/revoke
```

规则：
- `tenant_admin` 只能管理本租户 Dify/MCP/Auth Settings；`system_admin` 可以管理实例默认和跨租户配置。
- Dify key 认证仍使用 hash；Phase 17 后创建或 rotate 的 key 会额外保存加密密文和 last4，用于显式 reveal。旧 hash-only key 不能 reveal，只能 rotate。
- MCP PAT 仍为 hash-only，创建后只显示一次 raw token；普通 list/detail DTO 不返回 raw secret。
- 敏感操作必须写入 `audit_logs`，metadata 不记录 raw Dify key、PAT、OAuth token 或 password。

## 6. 搜索

```http
POST /api/search
```

请求：

```json
{
  "query": "MCP 怎么接入",
  "knowledge_base_ids": ["kb_1"],
  "top_k": 10,
  "context_mode": "parent_child",
  "filters": {
    "tags": ["mcp"]
  }
}
```

`context_mode` 可选，支持 `chunk`、`parent_child`、`paragraph_parent_child`、`full_text`。响应只能包含当前用户有权限访问且已发布、当前版本的结果；rerank 必须发生在最终权限过滤之后，父块/全文回填发生在 rerank 之后。

## 7. 导入

```http
POST /api/uploads
POST /api/import-jobs
GET  /api/import-jobs/:id
```

导入成功后创建 document version 并进入索引队列。

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
POST /api/admin/users/:id/activate
POST /api/admin/users/:id/suspend
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
```

这些接口不保存模型 API key，只管理 OpenKB 侧可见的 index profile、job、alias 状态。

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

GET    /api/knowledge-bases/:id/tree
POST   /api/documents
GET    /api/documents/:id
PUT    /api/documents/:id
DELETE /api/documents/:id
GET    /api/documents/:id/versions
POST   /api/documents/:id/versions
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
GET  /api/objects/:objectType/:objectId/collaborators
POST /api/objects/:objectType/:objectId/collaborators
PUT  /api/collaborators/:id
DELETE /api/collaborators/:id

POST /api/objects/:objectType/:objectId/invitations
GET  /api/invitations/:token
POST /api/invitations/:token/accept
POST /api/invitations/:id/approve
POST /api/invitations/:id/revoke

POST /api/objects/:objectType/:objectId/share-links
GET  /api/share/:token
POST /api/share/:token/verify-password
POST /api/share-links/:id/revoke
```

## 5. 搜索

```http
POST /api/search
```

请求：

```json
{
  "query": "MCP 怎么接入",
  "knowledge_base_ids": ["kb_1"],
  "top_k": 10,
  "filters": {
    "tags": ["mcp"]
  }
}
```

响应只能包含当前用户有权限访问的结果。

## 6. 导入

```http
POST /api/uploads
POST /api/import-jobs
GET  /api/import-jobs/:id
```

导入成功后创建 document version 并进入索引队列。

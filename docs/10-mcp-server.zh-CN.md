# 10 — MCP Server

## 1. 原则

```text
MCP 是用户级能力出口。
MCP 返回的任何文档范围必须和当前用户在 Web 中可访问范围一致。
MCP 不能使用管理员 key 读全库。
```

MCP 与 Web Search、Dify、附件、导出一样，必须复用同一套 Permission Service。Milvus `access_principals` 只能做候选预过滤，PostgreSQL 权限判断永远是最终真相。

## 2. Transport

主推 Streamable HTTP：

```text
POST /mcp
GET  /.well-known/oauth-protected-resource
```

v0.x 不实现任意 stdio command spawn。即使后续提供语雀式本地快速安装体验，也只能是安全 stdio bridge：

```text
npx openkb-mcp connect --server-url https://kb.example.com/mcp --pat kbpat_xxx
```

stdio bridge 只允许把 MCP JSON-RPC 转发到固定 OpenKB HTTP MCP endpoint，不允许根据用户输入执行 shell 命令，不允许动态连接未配置的任意目标。

## 3. 鉴权

支持两种方式：

### OAuth / remote MCP

```text
MCP client -> OAuth authorize -> access token -> /mcp
```

access token 必须包含或可解析：

```text
user_id
tenant_id
scopes
client_id
grant_id
```

### Personal Access Token

用于简单私有化接入：

```text
Authorization: Bearer kbpat_xxx
```

PAT 绑定真实用户和租户，不绑定管理员全库权限。PAT 数据库存储只能保存 token hash，不能保存明文 token。

## 4. Scopes

当前默认只开放读：

```text
kb:read
kb:search
doc:read
```

Phase 9.2 已新增写能力 scope，但必须单独授权：

```text
profile:read
kb:write
doc:write
toc:write
```

写工具不能复用读 scope。任何 create/update 工具都必须同时满足用户权限、MCP scope、Markdown dialect 校验、版本冲突保护和审计。

## 5. Tools

当前 tools：

```text
kb.get_current_user
kb.search
kb.get_knowledge_base
kb.create_knowledge_base
kb.update_knowledge_base
kb.get_document
kb.get_document_markdown
kb.get_toc
kb.get_knowledge_base_toc
kb.update_knowledge_base_toc
kb.create_document
kb.update_document
kb.list_workspaces
kb.list_knowledge_bases
kb.list_documents
```

工具命名使用 OpenKB 自己的 `kb.*` 命名，不提供 `yuque_*` 兼容别名。对齐语雀 MCP 的目标是能力和使用体验对齐，不追求工具名、参数名逐字兼容。

### kb.search

输入：

```json
{
  "query": "string",
  "knowledge_base_ids": ["optional"],
  "top_k": 5,
  "context_mode": "parent_child",
  "filters": {}
}
```

`context_mode` 可选，支持 `chunk`、`parent_child`、`paragraph_parent_child`、`full_text`。输出只包含当前用户可读且已发布、当前版本的结果，并返回 match/parent chunk metadata。

### kb.get_document_markdown

返回完整 Markdown 前必须调用 `canReadDocument`。

### kb.get_toc

`kb.get_toc` 当前语义是单篇文档 outline，对应 `kb://document/{document_id}/toc`，不是语雀 `yuque_get_toc` 的知识库目录树。

为了对齐语雀知识库 TOC，Phase 9.2 新增：

```text
kb.get_knowledge_base_toc
kb.update_knowledge_base_toc
```

`kb.update_knowledge_base_toc` 只能接受结构化目录操作，例如 move、rename、reorder，不接受语雀 MCP 那种任意 raw `toc_data` 字符串，也不支持 delete/remove。新增目录节点或文档必须走 `kb.create_document`。

## 6. 语雀 MCP 对照

对照来源是公开的 `yuque/yuque-mcp-server` README 和源码，核对日期：2026-04-30。该对照只参考公开产品/API 行为，不复制语雀内部实现。

| 语雀 MCP 工具 | OpenKB 决策 | 状态 |
|---|---|---|
| `yuque_get_user` | `kb.get_current_user`，返回当前 MCP PAT/OAuth 用户、tenant、scopes。 | 已对齐 |
| `yuque_search` | `kb.search`，走 Retrieval Service、Milvus 预过滤、PostgreSQL 终检。 | 已对齐 |
| `yuque_list_books` | `kb.list_knowledge_bases`，可按 workspace 过滤。 | 已对齐 |
| `yuque_get_book` | `kb.get_knowledge_base`，返回单个知识库元数据。 | 已对齐 |
| `yuque_create_book` | `kb.create_knowledge_base`，需要 `kb:write` 和 workspace manage 权限。 | 已对齐 |
| `yuque_update_book` | `kb.update_knowledge_base`，需要 `kb:write` 和 KB manage 权限。 | 已对齐 |
| `yuque_list_docs` | `kb.list_documents`，按 knowledge base / parent 分页列出。 | 已对齐 |
| `yuque_get_doc` | `kb.get_document` / `kb.get_document_markdown`。 | 已对齐 |
| `yuque_create_doc` | `kb.create_document`，只接受 OpenKB Markdown，创建 document version，自动审计。 | 已对齐 |
| `yuque_update_doc` | `kb.update_document`，必须携带 base version 或等价冲突保护，不静默覆盖。 | 已对齐 |
| `yuque_get_toc` | `kb.get_knowledge_base_toc`，返回知识库文档树；现有 `kb.get_toc` 保持文档 outline。 | 已对齐 |
| `yuque_update_toc` | `kb.update_knowledge_base_toc`，只接受结构化目录操作，不支持 delete/remove。 | 已对齐 |
| `yuque_list_notes` | v0.x 不对齐。OpenKB 当前没有独立 note 模型。 | 不对齐 |
| `yuque_get_note` | v0.x 不对齐。可在未来重新评估 note 或 inbox 模型。 | 不对齐 |
| `yuque_create_note` | v0.x 不对齐。不要把 note 偷映射成普通文档以免语义混乱。 | 不对齐 |
| `yuque_update_note` | v0.x 不对齐。 | 不对齐 |

语雀 MCP 的文档创建/更新允许 markdown、lake、html 等格式；OpenKB MCP 写工具只能接受 OpenKB 支持的 Markdown。Lake 不作为 OpenKB 可编辑正文格式。HTML 必须先经过导入/转换链路变成可校验 Markdown，不能直接保存为正文。

## 7. Resources

资源 URI：

```text
kb://workspace/{workspace_id}
kb://knowledge-base/{kb_id}
kb://document/{document_id}
kb://document/{document_id}/markdown
kb://document/{document_id}/toc
```

不要全量列出大型知识库所有资源。分页或按最近访问/搜索结果暴露。

```text
kb://knowledge-base/{kb_id}/toc
```

该资源读取同样必须通过 Permission Service。

## 8. 审计

记录：

```text
user_id
client_id
tool_name
resource_uri
query
document_ids_returned
ip
user_agent
created_at
```

写工具还必须记录：

```text
action
object_type
object_id
base_version_id
new_version_id
```

审计 metadata 不允许记录 raw token。

## 9. 安全规则

- MCP 不能绕过 Permission Service。
- MCP 不能返回用户不可见的文档标题、片段、附件 URL。
- MCP token 被撤销后必须立即失效。
- MCP 返回 token 数量、document chars、top_k 和分页 limit 要有限制。
- MCP 写工具不能绕过 Markdown Feature Registry。
- MCP 写工具不能绕过文档版本冲突检查。
- MCP 不能创建管理员全库 PAT 或 app-wide user impersonation token。

## 10. 持久化表

MCP OAuth / PAT 的持久化表在 `docs/07-data-model.zh-CN.md` 中定义：

```text
mcp_oauth_clients
mcp_oauth_grants
mcp_oauth_authorization_codes
mcp_oauth_refresh_tokens
mcp_personal_access_tokens
```

实现要求：

- OAuth grant 必须绑定 user_id 和 tenant_id。
- PAT 必须绑定 user_id 和 tenant_id。
- 不允许创建不绑定真实用户的 MCP 管理员全库 token。
- access token 如果使用短期 JWT，可以不单独落库，但必须能从签名 token 解析到 user_id、tenant_id、scopes、client_id/grant_id。

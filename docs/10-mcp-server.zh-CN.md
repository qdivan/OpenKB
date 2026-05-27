# 10 - MCP Server

## 1. 原则

MCP 是 OpenKB 的用户级能力出口。MCP 返回的任何文档、分段、附件和搜索结果，都必须和当前用户在 Web 中可访问的范围一致。

OpenKB MCP 与 Web Search、Dify、附件读取、导出一样，复用同一套 Permission Service。Milvus 的 access metadata 只做候选预过滤；PostgreSQL 权限判断永远是最终真相。

## 2. 接入方式

主协议入口是 Streamable HTTP：

```text
POST /mcp
GET  /.well-known/oauth-protected-resource
GET  /.well-known/oauth-authorization-server
GET  /oauth/authorize
POST /oauth/authorize
POST /oauth/token
POST /oauth/revoke
```

本地客户端可通过 `openkb-mcp` stdio bridge 连接远程 `/mcp`：

```bash
openkb-mcp connect --server-url https://kb.example.com/mcp --pat-env OPENKB_MCP_PAT
```

`openkb-mcp` 是 bridge / installer CLI，不是 skill 本体。它只把 stdio JSON-RPC 转发到固定 OpenKB HTTP MCP endpoint，不执行 shell 命令，不根据模型输出动态连接未知目标。

## 3. 鉴权

### OAuth / Remote MCP

OAuth 使用 Authorization Code + PKCE：

```text
MCP client -> OAuth authorize -> access token -> /mcp
```

OAuth client 由 Admin 预创建。Refresh token 只保存 hash，access token 为短期签名 token。

### Personal Access Token

PAT 用于本地自动化和简单客户端接入：

```text
Authorization: Bearer <pat>
```

PAT 绑定真实 user 和 tenant。数据库只保存 token hash，不保存明文 token。PAT 不能变成管理员全库 token，也不能绕过对象权限。

## 4. Scopes

默认读能力：

```text
kb:read
kb:search
doc:read
```

写能力必须单独授权：

```text
profile:read
kb:write
doc:write
toc:write
```

写工具必须同时满足 MCP scope、用户对象权限、Markdown 校验、版本冲突保护和审计。

## 5. Tools

当前工具只使用 OpenKB `kb.*` 命名：

```text
kb.get_current_user
kb.search
kb.list_workspaces
kb.list_knowledge_bases
kb.get_knowledge_base
kb.create_knowledge_base
kb.update_knowledge_base
kb.list_documents
kb.get_document
kb.get_document_markdown
kb.get_toc
kb.get_knowledge_base_toc
kb.update_knowledge_base_toc
kb.create_document
kb.update_document
```

不提供 `yuque_*` alias。语雀兼容是能力和体验层面的参考，不追求工具名兼容。OpenKB 当前也不实现语雀“小记 / note / inbox”模型；不要把 note 偷映射成普通文档。

### `kb.search`

输入支持：

```json
{
  "query": "string",
  "knowledge_base_ids": ["optional"],
  "top_k": 5,
  "score_threshold": 0.2,
  "retrieval_model": {
    "search_method": "full_text_search",
    "top_k": 5,
    "score_threshold_enabled": true,
    "score_threshold": 0.2,
    "reranking_enable": false
  },
  "filters": {
    "tags": ["optional"],
    "metadata_condition": {
      "logical_operator": "and",
      "conditions": []
    }
  },
  "context_mode": "parent_child"
}
```

`top_k` 仍受 `MCP_MAX_TOP_K` 限制。`filters.tags` 和 `metadata_condition` 以 PostgreSQL 文档 metadata 为最终真相；返回结果仍逐条做最终权限检查。

### `kb.get_document_markdown`

返回完整 Markdown 前必须通过 `canReadDocument`。如果内容过长，会按 MCP 配置截断并标记 `truncated`。

### `kb.update_document`

更新 Markdown 必须携带：

```json
{
  "document_id": "...",
  "markdown": "...",
  "base_version_id": "...",
  "markdown_hash": "sha256-of-current-markdown"
}
```

如果当前版本已经变化，返回 `VERSION_CONFLICT`。客户端应重新读取文档，再应用最小编辑。

### `kb.update_knowledge_base_toc`

只接受结构化目录操作，例如 `move`、`rename`、`reorder`。新增目录节点或文档必须使用 `kb.create_document`。不接受 raw `toc_data`，不支持 delete/remove。

## 6. Resources

```text
kb://workspace/{workspace_id}
kb://knowledge-base/{knowledge_base_id}
kb://knowledge-base/{knowledge_base_id}/toc
kb://document/{document_id}
kb://document/{document_id}/markdown
kb://document/{document_id}/toc
```

资源读取同样必须经过 Permission Service。

## 7. `openkb-mcp` CLI

`openkb-mcp` 提供三个命令：

```bash
openkb-mcp probe --server-url https://kb.example.com/mcp --pat-env OPENKB_MCP_PAT
openkb-mcp connect --server-url https://kb.example.com/mcp --pat-env OPENKB_MCP_PAT
openkb-mcp install --client codex --server-url https://kb.example.com/mcp --pat-env OPENKB_MCP_PAT --output ./mcp.json
```

`install` 生成的是引用环境变量的配置模板，不写 raw PAT。

## 8. 跨客户端 Skill

portable skill 位于：

```text
integrations/skills/openkb-mcp/
```

该 skill 面向 Codex、OpenClaw、Claude Code 等 Agent，约束 Agent 使用 OpenKB MCP 时的安全流程：

- 先搜索，再按需读取完整 Markdown。
- 写文档前先读取当前版本，使用 `base_version_id` 和 `markdown_hash`。
- 只保存 OpenKB/Milkdown 支持的 Markdown。
- 权限失败时让用户修正授权或 PAT/OAuth scope，不绕过权限。

## 9. 审计与安全

- MCP 不能绕过 Permission Service。
- MCP 不能返回用户不可见的文档标题、正文、分段、附件 URL。
- MCP token 被撤销后必须立即失效。
- MCP 返回 token 数量、document chars、`top_k` 和分页 limit 必须有限制。
- MCP 写工具不能绕过 Markdown 校验和文档版本冲突检查。
- 审计 metadata 不记录 raw token。

## 10. 持久化表

MCP OAuth / PAT 表定义在 `docs/07-data-model.zh-CN.md`：

```text
mcp_oauth_clients
mcp_oauth_grants
mcp_oauth_authorization_codes
mcp_oauth_refresh_tokens
mcp_personal_access_tokens
```

OAuth grant 和 PAT 都必须绑定 `user_id`、`tenant_id` 和 scope。不允许创建不绑定真实用户的 MCP 管理员全库 token。

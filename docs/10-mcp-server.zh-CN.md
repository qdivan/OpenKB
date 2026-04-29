# 10 — MCP Server

## 1. 原则

```text
MCP 是用户级能力出口。
MCP 返回的任何文档范围必须和当前用户在 Web 中可访问范围一致。
MCP 不能使用管理员 key 读全库。
```

## 2. Transport

主推 Streamable HTTP：

```text
POST /mcp
GET  /.well-known/oauth-protected-resource
```

v0.x 不实现任意 stdio command spawn。即使提供本地开发 stdio 包装器，也只能连接远程 HTTP MCP，不允许根据用户输入执行 shell 命令。

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

PAT 绑定用户，不绑定管理员全库权限。

## 4. Scopes

默认只开放读：

```text
kb:read
kb:search
doc:read
```

写工具后续再做，且必须单独授权。

## 5. Tools

第一版 tools：

```text
kb.search
kb.get_document
kb.get_document_markdown
kb.get_toc
kb.list_workspaces
kb.list_knowledge_bases
kb.list_documents
```

### kb.search

输入：

```json
{
  "query": "string",
  "knowledge_base_ids": ["optional"],
  "top_k": 5,
  "filters": {}
}
```

输出只包含当前用户可读结果。

### kb.get_document_markdown

返回完整 Markdown 前必须调用 `canReadDocument`。

## 6. Resources

资源 URI：

```text
kb://workspace/{workspace_id}
kb://knowledge-base/{kb_id}
kb://document/{document_id}
kb://document/{document_id}/markdown
kb://document/{document_id}/toc
```

不要全量列出大型知识库所有资源。分页或按最近访问/搜索结果暴露。

## 7. 审计

记录：

```text
user_id
client_id
tool_name
query
document_ids_returned
ip
user_agent
created_at
```

## 8. 安全规则

- MCP 不能绕过 Permission Service。
- MCP 不能返回用户不可见的文档标题、片段、附件 URL。
- MCP token 被撤销后必须立即失效。
- MCP 返回 token 数量和 top_k 要有限制。

## 9. 持久化表

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

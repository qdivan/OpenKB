Implement MCP Server and Dify Adapter after permissions and retrieval are working.

MCP scope:
- Streamable HTTP endpoint.
- OAuth/PAT user-bound auth.
- Persistent tables from docs/07-data-model.zh-CN.md:
  - mcp_oauth_clients
  - mcp_oauth_grants
  - mcp_oauth_authorization_codes
  - mcp_oauth_refresh_tokens
  - mcp_personal_access_tokens
- Tools: kb.search, kb.get_document, kb.get_document_markdown, kb.get_toc, kb.list_workspaces, kb.list_knowledge_bases.
- Audit every tool call.
- Always call Permission Service.

Dify scope:
- POST /retrieval.
- Scoped API key.
- Persistent tables from docs/07-data-model.zh-CN.md:
  - dify_api_keys
  - dify_knowledge_mappings
- knowledge_id mapping.
- retrieval_setting.top_k and score_threshold.
- metadata_condition mapping.
- Return metadata as object, never null.

Rules:
- MCP is user-bound.
- Dify is app-key-bound.
- Neither can bypass document permissions/scopes.
- Dify API key is scoped by allowed_knowledge_base_ids.
- API keys and tokens are stored as hashes only.

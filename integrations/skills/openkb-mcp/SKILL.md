---
name: openkb-mcp
description: Use when an agent needs to search, read, or safely update OpenKB workspaces, knowledge bases, documents, or Markdown through the OpenKB MCP server from Codex, OpenClaw, Claude Code, or another MCP-capable client.
---

# OpenKB MCP

Use the configured OpenKB MCP server as a user-bound knowledge tool. The server exposes `kb.*` tools only; do not invent `yuque_*` aliases or note/inbox tools.

## Default Workflow

1. Start with `kb.get_current_user` when identity or scope is unclear.
2. Use `kb.search` before guessing document content. Pass `knowledge_base_ids`, `top_k`, `score_threshold`, `retrieval_model`, `filters`, or `context_mode` when the task asks for scoped retrieval.
3. Use `kb.get_document` for metadata and `kb.get_document_markdown` only when full Markdown is needed.
4. Use `kb.get_toc` or `kb.get_knowledge_base_toc` before reorganizing structure.
5. For updates, first read the current document metadata/Markdown. Then call `kb.update_document` with `base_version_id` and `markdown_hash`.
6. For tree edits, use `kb.update_knowledge_base_toc` only for structured move, rename, or reorder operations. Create new nodes with `kb.create_document`.

## Safety Rules

- OpenKB is Markdown-first. Save only Markdown supported by OpenKB/Milkdown. Do not save Lake, HTML, or arbitrary rich-text payloads.
- MCP is user-bound. If a tool returns `FORBIDDEN`, ask the user to grant workspace, knowledge base, or document permission, or to use a PAT/OAuth grant with the right scopes.
- Do not bypass final permissions by using IDs from search metadata.
- Do not request or store raw PATs in prompts, documents, or generated config. Prefer an environment variable such as `OPENKB_MCP_PAT`.
- Do not treat admin configuration access as content permission.

## Common Tool Map

- Search: `kb.search`
- Current user/scopes: `kb.get_current_user`
- Workspaces: `kb.list_workspaces`
- Knowledge bases: `kb.list_knowledge_bases`, `kb.get_knowledge_base`, `kb.create_knowledge_base`, `kb.update_knowledge_base`
- Documents: `kb.list_documents`, `kb.get_document`, `kb.get_document_markdown`, `kb.create_document`, `kb.update_document`
- Structure: `kb.get_toc`, `kb.get_knowledge_base_toc`, `kb.update_knowledge_base_toc`

For detailed mode-specific examples, read `references/tool-workflows.md`.

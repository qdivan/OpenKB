# OpenKB MCP Tool Workflows

## Search and Cite

1. Call `kb.search` with the user's query.
2. Prefer scoped search when the user named a workspace or knowledge base.
3. Report document title, knowledge base, and chunk context from the result metadata.
4. If the user asks for exact wording, call `kb.get_document_markdown` for the cited document.

## Safe Markdown Update

1. Call `kb.get_document` to capture `current_version.id` and the current Markdown hash if present.
2. Call `kb.get_document_markdown`.
3. Prepare the smallest Markdown edit.
4. Call `kb.update_document` with:
   - `document_id`
   - `markdown`
   - `base_version_id`
   - `markdown_hash`
5. If the server returns `VERSION_CONFLICT`, read the document again and reapply the edit.

## Knowledge Base Tree Update

Use `kb.update_knowledge_base_toc` only for structured operations:

- `move`
- `rename`
- `reorder`

Use `kb.create_document` for new page or folder nodes. Do not submit raw tree snapshots as `toc_data`.

## Unsupported Requests

OpenKB MCP does not expose Yuque note or inbox tools in this skill. For short-form notes, create a normal document only if the user explicitly wants that behavior.

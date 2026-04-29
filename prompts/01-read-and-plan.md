Read the repository documents first. Do not modify files yet.

Priority documents:
- AGENTS.md
- docs/00-index.zh-CN.md
- docs/18-decision-overrides-v0.3.zh-CN.md
- docs/21-v0.3.2-clarifications.zh-CN.md
- docs/22-v0.3.3-clarifications.zh-CN.md
- docs/04-editor-spec.zh-CN.md
- docs/05-permission-spec.zh-CN.md
- docs/09-search-rag-milvus-native.zh-CN.md
- docs/15-roadmap-and-codex-tasks.zh-CN.md
- docs/16-decisions-and-non-goals.zh-CN.md

After reading, produce:
1. A concise summary of the non-negotiable architecture rules.
2. The proposed monorepo structure.
3. The first 5 implementation milestones.
4. Any contradictions found in the spec.

Important:
- Do not implement anything in this turn.
- Do not introduce custom Markdown dialects.
- Do not introduce non-Yuque permission systems.
- Do not create per-knowledge-base model configuration.
- Use Milvus 2.6+ native Function support for embedding/rerank where compatible.
- Treat docs/18 as higher priority than docs/16 if there is any wording difference.
- Treat share links as read-only only in v0.x.
- Treat folders as documents with type=folder, not as a separate table.
- Treat workspace membership roles and content collaborator roles as separate systems.
- Use `id` as the Milvus primary key; `chunk_id` is a regular field.
- Do not implement embedding/rerank fallback keys in OpenKB DB.

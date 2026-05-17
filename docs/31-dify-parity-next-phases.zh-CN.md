# 31 — Dify parity 后续路线图

本文原本是 Phase 22.9 之后的后续路线入口；现在作为 Phase 23-25 的收口记录和后续验证入口。Phase 22.2-22.6 已完成 Dify-like 处理规则、显式 reprocess、retrieval model、segment 管理、QA/summary 和 Web 信息层级；Phase 22.8-22.9 已完成 Dify-compatible splitter 与 parity v2 主要收敛。

Phase 23-25 已按原顺序推进：先补低风险兼容与配置一致性，再补 QA parity，最后做图片与附件检索。Phase 25 稳定收口时已完成同模型 live retrieval parity 复跑和 image-capable smoke；后续重点转为发布后观察、排序差异归因和旧派生数据的手动重建 runbook。

## 当前剩余项

- **同模型 live retrieval parity**：已在 Phase 25 本机环境复跑完成。100 篇 corpus、240 条查询、qwen3-vl embedding/rerank、hybrid + rerank 同开关；证据路径见 `docs/30-dify-parity-v2-analysis.zh-CN.md`。
- **Image-capable smoke**：已在 Phase 25 本机环境完成。内部 `asset://` 图片生成 `document_asset_bindings` 与 `asset_image` chunk，index-worker 走 image vector，搜索结果可回填 source/original chunk 与 preview metadata。
- **旧派生数据不自动迁移**：旧 chunks、旧 QA、旧图片绑定不会因为计划更新自动改变；只有显式 reprocess 或后续专门 repair 工具才更新派生索引。
- **文档状态收口**：README、`docs/00`、`docs/15`、`docs/27`、`docs/28`、`docs/30` 以本文为后续路线来源；历史分析文档只用于追溯。

## Phase 23 — 低风险兼容补齐

目标：保证配置不会“看起来支持，实际不一致”。

- 状态：已完成。
- 已补齐 chunk 参数 UI/API round-trip：`separator`、`max_tokens`、`chunk_overlap`、parent/subchunk 参数、paragraph/full-doc parent mode、summary index setting。
- 已补齐默认 process snapshot：新文档、导入文档和显式 reprocess 都记录 Dify-shaped snapshot；UI 能显示 KB 默认值、文档快照值和当前是否过期。
- 已展示父块 overlap 与标准 overlap：明确 parent overlap、child overlap、automatic 默认 overlap 与 custom/hierarchical overlap 的来源和单位。
- 已校验 `text_model`、`hierarchical_model`、`qa_model` 切换后的行为：更新配置只标记 `needs_reprocess`，显式 reprocess 后才替换 PostgreSQL segments，不自动切 Milvus alias。

## Phase 24 — QA parity

目标：让 QA 知识库对检索结果的影响与 Dify 更接近，同时保留 OpenKB 显式消耗原则。

- 状态：已完成基础收口。
- QA 生成保持显式触发：CSV/manual/mock/LLM 都写入 `document_qa_pairs`；导入和 reprocess 不自动调用真实 LLM。
- `qa_model` 的 import/reprocess 只索引当前版本 active QA pairs；如果 QA pair 绑定 `source_chunk_id`，源 segment 必须属于当前版本、active 且 `index_role=content`。
- Dify Adapter 返回 Dify 风格 QA 内容和 metadata：`hit_type=qa`、`qa_question`、`qa_answer`、`qa_pair_id`、`source_chunk_id`、`qa_source`、`qa_generated_mode`；OpenKB Web/MCP 继续 answer-first，但保留同样解释字段。
- `overwrite=true` 只清理 `source in ("llm","mock")` 的 generated QA，不删除 manual/CSV。

## Phase 25 — 图片与附件检索

目标：按 Dify 1.14.1 的 multimodal/attachment 逻辑对齐图片和附件检索。

- 状态：已完成底座闭环。
- Markdown `asset://` 图片/附件会建立 `document_asset_bindings`；外部 http(s) 图片只做文本 metadata 索引，不抓取远程图片，避免 SSRF。
- Derived asset chunk 通过 `source_chunk_id` 回到源 segment，metadata 对齐 Dify 风格：`doc_type`、`segment_attachment_id`、`attachment_info`、`asset_preview_url/source_url`、`asset_match_text`、`image_vector_enabled/fallback_reason`。
- Index worker 在 embedding capability 包含 image 且 `OPENKB_IMAGE_VECTOR_MODE=auto` 时可使用 image vector；否则使用 alt/caption/filename/mime/source segment 文本降级，失败不拖垮整个 rebuild。
- Retrieval/Web/MCP/Dify 对 asset/image hit 回填原始 active segment、preview URL 和 attachment metadata；disabled/deleted/stale source segment 或越权 document 由 PostgreSQL final permission check 过滤。

## Dify 对齐基准

- Dify 知识库主线是 dataset/document/segment/child segment。
- Dify 图片作为 `UploadFile` 通过 `SegmentAttachmentBinding` 绑定到 segment；多模态索引只在 embedding model schema 支持 vision 时启用。
- OpenKB 对齐时保留 Markdown-first：正文仍是 `document_versions.markdown`，图片、QA、summary、segment 都是检索派生层。
- PostgreSQL + PermissionService 仍是最终权限真相；Milvus、image vector、Dify metadata 只提供候选和解释。

## 回归与证据

- 文档阶段：`pnpm docs:check`、`pnpm format:check`、`git diff --check`。
- Phase 23：chunk 参数 round-trip、snapshot 过期标记、三种 doc_form reprocess、Dify splitter parity。
- Phase 24：QA CSV/manual/mock/LLM、qa_model reprocess、QA source 终检、Dify/Web/MCP 返回语义。
- Phase 25：asset 绑定、OCR/alt/caption 文本路径、image vector 路径、回源预览 URL、权限终检。
- Live parity：Dify/OpenKB 同 corpus、同 embedding/rerank、同 top_k/threshold/rerank/hybrid 开关后复跑 top-k overlap、MRR/nDCG、score 差异和归因；Phase 25 证据见 `.codex-runtime/parity-runs/20260517T135537Z/retrieval/`。
- Image smoke：内部图片 asset 绑定、image vector、回源预览 URL 和权限终检；Phase 25 证据见 `.codex-runtime/phase25-smoke/image-smoke-summary.json`。

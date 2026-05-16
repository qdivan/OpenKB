# 31 — Dify parity 后续路线图

本文是 Phase 22.9 之后的唯一后续路线入口。Phase 22.2-22.6 已完成 Dify-like 处理规则、显式 reprocess、retrieval model、segment 管理、QA/summary 和 Web 信息层级；Phase 22.8-22.9 已完成 Dify-compatible splitter 与 parity v2 主要收敛。

后续工作按三段执行，顺序固定：先补低风险兼容与配置一致性，再补 QA parity，最后做图片与附件检索。

## 当前剩余项

- **同模型 live retrieval parity 复跑**：`docs/30-dify-parity-v2-analysis.zh-CN.md` 已记录 splitter 大样本一致；检索一致性仍需要在 Dify/OpenKB 使用同一 corpus、同一 embedding/rerank、同一 hybrid/rerank 开关后复跑。
- **旧派生数据不自动迁移**：旧 chunks、旧 QA、旧图片绑定不会因为计划更新自动改变；只有显式 reprocess 或后续专门 repair 工具才更新派生索引。
- **文档状态收口**：README、`docs/00`、`docs/15`、`docs/27`、`docs/28`、`docs/30` 以本文为后续路线来源；历史分析文档只用于追溯。

## Phase n+1 — 低风险兼容补齐

目标：保证配置不会“看起来支持，实际不一致”。

- 补齐 chunk 参数 UI/API round-trip：`separator`、`max_tokens`、`chunk_overlap`、parent/subchunk 参数、paragraph/full-doc parent mode、summary index setting。
- 补齐默认 process snapshot：新文档、导入文档和显式 reprocess 都记录同一份 Dify-shaped snapshot；UI 能清楚显示 KB 默认值、文档快照值和当前是否过期。
- 展示父块 overlap 与标准 overlap：明确 parent overlap、child overlap、automatic 默认 overlap 与 custom/hierarchical overlap 的来源和单位。
- 校验 `text_model`、`hierarchical_model`、`qa_model` 切换后的行为：更新配置只标记 `needs_reprocess`，显式 reprocess 后才替换 PostgreSQL segments，不自动切 Milvus alias。
- 验收：配置保存/读取一致；三种 doc_form 的 reprocess 结果与 Dify-compatible splitter 预期一致；旧 chunks 不自动迁移。

## Phase n+2 — QA parity

目标：让 QA 知识库对检索结果的影响与 Dify 更接近，同时保留 OpenKB 显式消耗原则。

- QA 生成保持显式触发：CSV/manual/mock/LLM 都写入 `document_qa_pairs`；导入和 reprocess 不自动调用真实 LLM。
- `qa_model` 的 import/reprocess 只索引当前版本 active QA pairs；问题进入索引，答案作为 PostgreSQL QA pair 真相和返回内容来源。
- Dify Adapter 返回 Dify 风格 QA 内容和 metadata：`hit_type=qa`、`qa_question`、`qa_answer`、`qa_pair_id`、`source_chunk_id`；OpenKB Web/MCP 可以继续 answer-first，但必须保留同样解释字段。
- QA source 必须回到当前版本 active content segment；源 segment disabled/deleted/stale 时过滤 QA 命中。
- 验收：QA CSV/manual/mock/LLM 都可检索；Dify/Web/MCP 返回语义分流稳定；所有 QA 命中仍通过 PostgreSQL final permission check。

## Phase n+3 — 图片与附件检索

目标：按 Dify 1.14.1 的 multimodal/attachment 逻辑对齐图片和附件检索。

- Markdown 图片解析为 asset：保存 `asset://` 引用，记录 alt、filename、mime、size、checksum、source document/version 和行号/字符范围。
- reprocess 建立 segment-asset 绑定：图片属于其所在 segment；父子模式下绑定到 parent segment，并可回填 child 命中上下文。
- 文本降级路径：无 image-capable embedding 时，先用 alt/caption/OCR/metadata 形成可检索文本，不生成 image vector。
- 多模态路径：当实例级 embedding capability 支持 image 时，按 Dify 逻辑把附件作为派生 image document/index row，metadata 标记 `doc_type=IMAGE`、asset id、source segment id；Milvus 仍通过 blue-green rebuild 更新。
- 检索回源：image 命中必须回填原始 segment、asset metadata、预览 URL 和权限终检结果；Dify Adapter metadata 需包含 attachment/image hit 解释。
- 验收：图片/附件命中不反写 Markdown 正文；无 image 模型时文本检索可用；有 image 模型时 image vector 可用；Dify-style attachment metadata 与 OpenKB asset metadata 可对应。

## Dify 对齐基准

- Dify 知识库主线是 dataset/document/segment/child segment。
- Dify 图片作为 `UploadFile` 通过 `SegmentAttachmentBinding` 绑定到 segment；多模态索引只在 embedding model schema 支持 vision 时启用。
- OpenKB 对齐时保留 Markdown-first：正文仍是 `document_versions.markdown`，图片、QA、summary、segment 都是检索派生层。
- PostgreSQL + PermissionService 仍是最终权限真相；Milvus、image vector、Dify metadata 只提供候选和解释。

## 回归与证据

- 文档阶段：`pnpm docs:check`、`pnpm format:check`、`git diff --check`。
- Phase n+1：chunk 参数 round-trip、snapshot 过期标记、三种 doc_form reprocess、Dify splitter parity。
- Phase n+2：QA CSV/manual/mock/LLM、qa_model reprocess、QA source 终检、Dify/Web/MCP 返回语义。
- Phase n+3：asset 绑定、OCR/alt/caption 文本路径、image vector 路径、回源预览 URL、权限终检。

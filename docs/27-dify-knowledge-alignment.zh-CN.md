# 27 Dify 1.14.1 知识库处理与检索逻辑对齐

> 当前规范：本文记录 OpenKB 对齐 Dify 1.14.1 知识库处理与检索逻辑的产品/技术计划。已验证的本地 Dify 1.14.1 升级记录见 `docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md`；分块与检索 parity 差异基线见 `docs/30-dify-parity-v2-analysis.zh-CN.md`；Phase 23-25 收口记录见 `docs/31-dify-parity-next-phases.zh-CN.md`。若本文中状态与 docs/30 冲突，以 docs/30 的工程基线为准。

本文件记录 OpenKB 对照 Dify `1.14.1` 源码后的知识库处理、分块、检索和 segment 管理映射。Dify 源码只作为公开实现参照，临时放在仓库外目录，不进入 OpenKB git。

> 状态收口：Phase 22.2-22.6 的基础能力、22.8 的 Dify-compatible splitter、22.9 的主要 parity 收敛、Phase 23 的配置一致性、Phase 24 的 QA parity 和 Phase 25 的图片/附件检索底座已经进入当前主线。后续验证入口统一写入 `docs/31-dify-parity-next-phases.zh-CN.md`。

## 对齐原则

- OpenKB 继续 Markdown-first，正文真相仍是 `document_versions.markdown`。
- 知识库保存默认处理规则，文档保存处理规则快照；文档内容或处理规则变更后需显式 reprocess。
- 同一个知识库统一 `doc_form`：`text_model`、`hierarchical_model`、`qa_model`。
- 父子知识库内每篇文档可在快照中选择 `paragraph` 或 `full-doc` parent mode。
- `economy` 映射到关键词/BM25；`high_quality` 映射到 embedding/hybrid/rerank，模型来自 system_admin 实例级 Models 配置。
- Segment override 只影响检索派生层和 Web/MCP/Dify 返回，不反写 Markdown 正文。
- PostgreSQL + PermissionService 仍是最终权限真相；Milvus、Dify metadata、summary hit 都不能扩大权限。

## Dify 字段矩阵

| Dify 1.14.1 字段 | Dify 语义 | OpenKB 映射 | 当前状态 |
| --- | --- | --- | --- |
| `doc_form=text_model` | 普通知识库，普通段落切片 | KB `knowledge_base_chunk_settings.doc_form`；生成 `general` chunks | 已实现基础 schema 和 chunking |
| `doc_form=hierarchical_model` | 父子分块知识库 | KB doc_form + 文档 `process_rule_snapshot.parent_mode` | 已实现 paragraph/full-doc 父子分块 |
| `doc_form=qa_model` | QA 知识库，问题入索引，答案返回 | `document_qa_pairs` + QA chunks metadata `qa_question/qa_answer` | Phase 24 已收口 manual/CSV/mock/LLM、active QA pair 索引和 Dify/Web/MCP 返回语义 |
| `indexing_technique=economy` | 低成本索引，关键词/全文检索 | retrieval mode 解析为 BM25 | 已实现策略映射 |
| `indexing_technique=high_quality` | 高质量索引，embedding/hybrid/rerank | retrieval mode 解析为 dense/hybrid/rerank | 已实现策略映射，依赖 Admin Models 与索引 profile |
| `process_rule.mode=automatic` | 自动分段 | `process_rule_mode` + Dify 1.14.1 recursive splitter 默认值 | Phase 22.8 已作为新 reprocess 默认；Phase 22.9 已补 parity fixture 输出 |
| `process_rule.mode=custom` | 自定义分段 | fixed separator + recursive fallback | Phase 22.8 已对齐 splitter 行为；Phase 22.9 已补 raw/Milkdown/indexed 对照 |
| `process_rule.mode=hierarchical` | 父子分段 | fixed parent/subchunk separator + recursive fallback | Phase 22.8 已对齐 splitter 行为；Phase 22.9 已补 parent/full-doc focused fixtures |
| `parent_mode=paragraph` | 段落作为父块 | `documents.process_rule_snapshot.process_rule.parent_mode=paragraph` | 已实现 |
| `parent_mode=full-doc` | 全文作为父块 | `...parent_mode=full-doc` | 已实现 |
| `retrieval_model.search_method=semantic_search` | 语义检索 | `dense` / `dense_rerank` | 已实现策略解析 |
| `retrieval_model.search_method=full_text_search` | 全文检索 | BM25 | 已实现策略解析 |
| `retrieval_model.search_method=hybrid_search` | 混合检索 | hybrid / hybrid_rerank | 已实现策略解析 |
| `retrieval_model.search_method=keyword_search` | 关键词检索 | BM25 | 已实现策略解析 |
| `retrieval_model.top_k` | 默认返回数量 | KB 默认策略；请求仍可覆盖 `top_k` | Phase 22.3 已注入 Web/API/MCP/Dify |
| `score_threshold` | 分数阈值 | KB 默认 + 请求覆盖；权限终检后、裁剪前统一过滤 | Phase 22.3 已实现 |
| `reranking_enable` | 是否 rerank | 映射到 `dense_rerank/hybrid_rerank` | 已实现策略解析 |
| `weights` | hybrid 权重 | Dify-like keyword/vector 权重映射到 Milvus WeightedRanker | Phase 22.3 已实现 |
| `metadata_filtering_conditions` | metadata 过滤 | tags 下推 Milvus；document metadata/Dify condition 走 retrieval post-filter | Phase 22.3 已统一解析 |
| `summary_index_setting` | 摘要索引设置 | `summary_index_setting` + `document_segment_summaries` | 已实现 document/segment summary 和显式生成；批量可靠性后续单独补 |
| segment enable/disable | Segment 是否参与检索 | `document_chunks.status` | 已实现 active/disabled/deleted |
| segment content override | Segment 检索文本覆盖 | `override_content_text/markdown` | 已实现，索引 worker 读取 override |
| segment reset | 取消覆盖 | 清空 override 字段 | 已实现 API/UI 基础 |

## 当前实现摘要

### 数据库

- `knowledge_base_chunk_settings` 增加 Dify-compatible 默认规则：`doc_form`、`indexing_technique`、`process_rule_mode`、`process_rule`、`retrieval_model`、`summary_index_setting`。
- `documents` 增加处理快照和状态：`doc_form`、`process_rule_snapshot`、`processing_status`、`processing_revision`、`need_summary`。
- `document_chunks` 增加 segment 管理字段：`status`、`override_content_text`、`override_content_markdown`、`overridden_by`、`overridden_at`、`disabled_at`。
- 新增 `document_qa_pairs` 与 `document_segment_summaries`。

### API 与 Worker

- KB chunk settings 支持 Dify fields。
- 文档处理 API 支持读取/更新快照、显式 reprocess、QA pair、summary、segment update。
- import worker 和 content service 均使用同一 chunking helper。
- index worker 只索引 active chunks，并优先使用 override content。
- retrieval service 在传入 KB scope 时读取 KB retrieval_model/indexing_technique 决定 BM25/dense/hybrid/rerank，并注入 `top_k`、`score_threshold`、hybrid weights 与 metadata filters。
- Dify Adapter metadata 增加 `doc_form`、`indexing_technique`、`retrieval_model`、`segment_status`、`summary_hit`、`original_chunk_id`、`qa_question`、`qa_answer`。

### UI

- KB Dashboard 顶层保留 Overview / Segments / Retrieval Lab / Settings；Settings 内按 Dify-like 信息层级拆为处理模式、分块规则、检索策略、metadata、摘要、重处理。
- KB Segment map 可按文档分组显示 segment 状态、override、summary hit，并提供跳转到文档侧栏管理的入口。
- 文档右侧面板已拆为大纲、处理快照、Segments、QA、Summary、Metadata、Versions；Segments 面板支持 segment enable/disable、override、reset override、soft delete/restore，并提示需要 Milvus index rebuild。

KB 设置页面保持 OpenKB 自己的紧凑工作台风格，但信息层级按 Dify 1.14.1 的处理模式、分块规则、检索策略、metadata、摘要和重处理组织。

![OpenKB KB Settings](assets/openkb-kb-settings.png)

文档编辑页右侧面板把处理快照、Segments、QA、Summary、Metadata 和 Versions 放在同一条文档上下文中，便于理解“正文版本”和“检索派生层”的区别。

![OpenKB Document Processing Panel](assets/openkb-workbench.png)

## 已完成分阶段实现

以下内容用于追溯 Phase 22 的实现路径。Phase 23-25 的收口记录和后续验证统一写入 `docs/31-dify-parity-next-phases.zh-CN.md`。

### Phase 22.2 / 22.8 分块与重处理

- 已完成文档变更后 `needs_reprocess` 与显式 reprocess。
- Phase 22.8 已将新建或显式 reprocess 的 chunking 默认切到 Dify 1.14.1-compatible splitter。
- 旧 chunks 不自动迁移；需要用户显式 reprocess 后才会使用新边界。

### Phase 22.3 检索策略

- 已将 KB `top_k`、`score_threshold`、hybrid weights 注入默认查询策略。
- 已支持 request override，且不污染 KB 默认。
- 已统一 Web Search、Retrieval Lab、MCP、Dify 的策略解析；多 KB 策略不一致时使用租户/实例默认并标记 `mixed_retrieval_model`。
- 若 KB 明确选择 semantic/hybrid 但 embedding 或 active dense index 不可用，返回 `SEARCH_INDEX_NOT_READY`，不静默降级 BM25。

### Phase 22.4 Segment 管理

- 文档右侧 Segments 面板支持 active/disabled/deleted 管理、override content、reset override、soft delete/restore。
- `GET /api/knowledge-bases/:id/chunks` 默认返回 active/disabled，`status=deleted|all` 可用于管理视图。
- `PUT /api/documents/:id/chunks/:chunkId` 返回 `needs_index_rebuild=true` 与可读 rebuild hint。
- KB Segment map 保持文档分组预览，不放复杂编辑表单；segment 管理在文档侧栏完成。
- Override 只影响检索派生层和 Web/MCP/Dify 外部返回，不反写 Markdown 正文。

### Phase 22.5 QA 与摘要索引

- 已支持手动/CSV/mock/LLM 显式生成 QA。
- 已支持 document/segment summary，summary hit 映射回原始 chunk。
- Dify Adapter 对 QA/summary 暴露 Dify 风格 metadata；Web Search 继续使用更直接的 answer-first 展示。

### Phase 22.8 / 22.9 Parity 基线

- `docs/30` 是当前 splitter/retrieval/metadata/QA/segment parity 工程基线；Phase 22.9 已把 QA 对外内容、tags 文档 metadata post-filter 和 focused fixture 证据纳入验收表。
- `scripts/parity` 生成的大型运行输出必须留在 `.codex-runtime`；提交内容只保留脚本、摘要和小型 golden fixtures。

### Phase 22.6 Web UI

- 已完成 KB Settings Dify-like tabs：处理模式、分块规则、检索策略、metadata、摘要、重处理。
- 已完成文档右侧处理快照、Segments、QA、Summary、Metadata、Versions 的信息层级重组。
- Phase 22.6 仅重组 Web UI，不新增 KB 级模型密钥、不新增后端 migration，也不把 segment override 反写 Markdown 正文。

## 不对齐项

- Dify 知识库级模型配置不照搬；OpenKB 只允许 system_admin 配置实例级 Models。
- OpenKB 不直接写 Dify 数据库。
- OpenKB 不把 chunk override 写回 Markdown 正文。
- OpenKB 不让 Dify key impersonate 用户；Dify 仍是 app-key-bound + allowed KB scope。

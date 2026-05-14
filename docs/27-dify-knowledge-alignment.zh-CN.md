# 27 Dify 1.14.1 知识库处理与检索逻辑对齐

> Phase 22 设计计划：本文记录 OpenKB 对齐 Dify 1.14.1 知识库处理与检索逻辑的产品/技术计划。已验证的本地 Dify 1.14.1 升级记录、真实运行结果和逐项差异审计见 `docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md`。若本文中“当前状态”与 docs/28 冲突，以 docs/28 为准。

本文件记录 OpenKB 对照 Dify `1.14.1` 源码后的知识库处理、分块、检索和 segment 管理映射。Dify 源码只作为公开实现参照，临时放在仓库外目录，不进入 OpenKB git。

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
| `doc_form=qa_model` | QA 知识库，问题入索引，答案返回 | `document_qa_pairs` + QA chunks metadata `qa_question/qa_answer` | 已实现手动 QA 数据结构和 chunking；LLM 生成后续增强 |
| `indexing_technique=economy` | 低成本索引，关键词/全文检索 | retrieval mode 解析为 BM25 | 已实现策略映射 |
| `indexing_technique=high_quality` | 高质量索引，embedding/hybrid/rerank | retrieval mode 解析为 dense/hybrid/rerank | 已实现策略映射，依赖 Admin Models 与索引 profile |
| `process_rule.mode=automatic` | 自动分段 | `process_rule_mode` + 默认 segmentation | 已保存；分段规则持续补强 |
| `process_rule.mode=custom` | 自定义分段 | `process_rule.segmentation/subchunk_segmentation` | 已保存并用于 max tokens / separator / overlap |
| `process_rule.mode=hierarchical` | 父子分段 | `process_rule_mode=hierarchical` + parent mode | 已保存并用于 parent-child chunking |
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
| `summary_index_setting` | 摘要索引设置 | `summary_index_setting` + `document_segment_summaries` | 已实现 schema 和手动 summary，LLM 批量后续 |
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

## 后续分阶段补强

### Phase 22.2 分块与重处理

- 完善 automatic/custom segmentation 的 Dify 参数覆盖率。
- 文档变更后显示 `needs_reprocess`，由用户显式触发 reprocess job。
- 支持 QA CSV 导入和 LLM mock 生成。

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

### Phase 22.5 摘要索引

- 使用实例级 LLM 生成文档/KB summary。
- summary hit 映射回原始 chunk。
- Dify metadata 暴露 summary hit 解释。

### Phase 22.6 Web UI

- 已完成 KB Settings Dify-like tabs：处理模式、分块规则、检索策略、metadata、摘要、重处理。
- 已完成文档右侧处理快照、Segments、QA、Summary、Metadata、Versions 的信息层级重组。
- Phase 22.6 仅重组 Web UI，不新增 KB 级模型密钥、不新增后端 migration，也不把 segment override 反写 Markdown 正文。

## 不对齐项

- Dify 知识库级模型配置不照搬；OpenKB 只允许 system_admin 配置实例级 Models。
- OpenKB 不直接写 Dify 数据库。
- OpenKB 不把 chunk override 写回 Markdown 正文。
- OpenKB 不让 Dify key impersonate 用户；Dify 仍是 app-key-bound + allowed KB scope。

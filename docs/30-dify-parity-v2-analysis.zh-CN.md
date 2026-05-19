# 30 — Dify Parity v2 深度分析基线

> 本文是工程兼容性测试材料，不是产品宣传口径。README 和当前用户入口统一使用“Dify 配合 / 兼容 / 接入”；本文保留 `parity` 作为脚本、数据集和历史测试报告名称。

本文是 `openkb-dify-parity-v2-20260515-000821` 报告、Dify 1.14.1 后端源码和 OpenKB 当前实现的三方对照基线。Phase 22.8 已把 Dify 兼容 splitter 接入显式 reprocess 默认路径；Phase 22.9 已收敛输入规范化、QA 返回语义、metadata/tags、segment 生命周期和复跑证据；Phase 23-25 已继续补齐配置一致性、QA 兼容语义、图片与附件检索底座。后续验证入口见 `docs/31-dify-parity-next-phases.zh-CN.md`。

大型 JSON、截图、raw response 和 live parity 结果仍保存在本机忽略目录，不进入 git：

```text
.codex-runtime/reports/openkb-dify-parity-v2-20260515-000821/openkb-dify-parity-v2-20260515-000821/
.codex-runtime/parity-runs/
```

## 当前结论

- 报告中的 Web 参数已经接近 Dify 默认值，例如 `automatic` 的 `separator="\n"`、`max_tokens=500`、`chunk_overlap=50`。结果仍明显不同，说明差异不只是默认字段值。
- Dify 1.14.1 的核心切分行为是 recursive splitter：automatic 使用 `EnhanceRecursiveCharacterTextSplitter`；custom/hierarchical 使用 `FixedRecursiveCharacterTextSplitter`，再按 `\n\n`、`。`、`. `、空格、字符递归回退。
- Phase 22.8 已将 Dify-shaped `process_rule` 的默认切分路径改为 Dify 1.14.1-compatible splitter。旧 chunks 不自动迁移，只有新建或显式 reprocess 后才使用新边界。
- Phase 22.9 已补齐 QA 对外语义、tags/document metadata post-filter、兼容性测试脚本的 raw/Milkdown/indexed/splitter 多阶段输出。
- 同模型检索基线已完成 Phase 25 稳定版复跑：Dify 和 OpenKB 使用同一 100 篇 corpus、同一 qwen3-vl embedding/rerank、同一 hybrid/rerank 开关后，240 条查询全部完成，不再是 `blocked_missing_live_inputs`。

## 2026-05-15 公开 Markdown 100 篇实测

本轮按公开 Markdown corpus 做了一次真实切片复跑，不提交全文样本。证据目录：

```text
.codex-runtime/parity-runs/20260515T112405Z/corpus/
.codex-runtime/parity-runs/20260515T125253Z/splitter/
.codex-runtime/parity-runs/20260515T133845Z/retrieval/
```

Corpus 共 100 篇，长度覆盖 200 到 10000 字，来源为公开文档仓库：

| 长度桶 | 文档数 |
| --- | ---: |
| 200-500 | 15 |
| 500-1000 | 26 |
| 1000-3000 | 22 |
| 3000-6000 | 18 |
| 6000-10000 | 19 |

| 来源仓库 | 用途 |
| --- | --- |
| `kubernetes/website` | 长篇技术说明、frontmatter、代码块、列表、表格候选 |
| `vitejs/vite` | 框架文档、短中篇配置说明 |
| `microsoft/TypeScript-Website` | 教程型 Markdown、代码块和列表 |
| `modelcontextprotocol/specification` | 规范型 Markdown、较稳定的标题层级 |

> 说明：GitHub REST tree API 当时触发匿名 rate limit，脚本自动 fallback 到 `.codex-runtime` 下 sparse clone。`github/docs` 和 `mdn/content` 在 Windows 长路径 sparse checkout 上被跳过，但 4 个公开仓库已满足 100 篇与长度桶覆盖。

### 切片结果摘要

| 模式 | 文档数 | Dify chunks | OpenKB chunks | Dify parent | OpenKB parent | Dify child | OpenKB child | 完全一致文档 | 平均 hash overlap | 平均 best similarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| standard_auto | 100 | 834 | 834 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| standard_custom_newline | 100 | 6618 | 6618 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| standard_custom_blankline | 100 | 2021 | 2021 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| standard_custom_cjk_period | 100 | 834 | 834 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| standard_custom_en_period | 100 | 977 | 977 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| standard_custom_space | 100 | 31349 | 31349 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |
| parent_paragraph | 100 | 9127 | 9127 | 2021 | 2021 | 7106 | 7106 | 100 | 1.0000 | 1.0000 |
| parent_full_doc | 100 | 7125 | 7125 | 100 | 100 | 7025 | 7025 | 100 | 1.0000 | 1.0000 |
| qa_model | 100 | 200 | 200 | 0 | 0 | 0 | 0 | 100 | 1.0000 | 1.0000 |

判断：

- `automatic`、custom newline/blankline/space、中文句号、英文句号、paragraph parent、full-doc parent 和 QA rows 在本轮复跑中都达到 100/100 文档完全一致。
- 这次收敛的关键修复是把 fixed splitter 的首层分隔和后续 recursive fallback 拆开：`custom ". "`、中文句号和 parent-child 的 child fallback 不再把空格剥掉。
- `standard_custom_space` 的长证书/base64 类无空格文本也已兼容字符级 fallback/overlap。
- QA 模式在生成的 question/answer rows 上完全一致；这验证的是 QA 索引行语义，不代表 LLM 生成质量。
- Markdown 保真检查 900 行失败数为 0。英文句号切分不再拆开 ordered list 标记，非 QA 模式也不剥离 heading、blockquote、code fence、list、link/image 等 Markdown 结构。

### Phase 25 同模型 live retrieval 兼容性测试

Phase 25 稳定收口时已经完成一轮真实同模型检索复跑。脚本生成 runtime-only import corpus，调用 Dify 1.14.1 console hit-testing 与 OpenKB `/api/search`，所有 raw response 和 normalized row 只保存在本机忽略目录。

证据目录：

```text
.codex-runtime/parity-runs/20260517T135454Z/retrieval/
.codex-runtime/parity-runs/20260517T135537Z/retrieval/
```

环境状态：

| 项目 | 状态 |
| --- | --- |
| OpenKB API | `http://localhost:4101/health` 可用，phase 为 `phase-25-stable-convergence` |
| OpenKB Web | `http://localhost:3100/` 可用 |
| OpenKB Dify Adapter | `http://localhost:4200/health` 可用 |
| Dify 1.14.1 | `http://localhost:18080/` 可用 |
| Corpus | 100 篇公开 Markdown，导入两边并完成 Dify indexing / OpenKB reprocess + Milvus rebuild |
| Embedding | `qwen3-vl-embedding`，768 维 |
| Rerank | `qwen3-vl-rerank` |
| Retrieval | `hybrid_search`，`top_k=5`，`score_threshold=0`，rerank 开启，keyword/vector 权重 0.5/0.5 |

检索指标：

| 指标 | 数值 |
| --- | ---: |
| 查询数 | 240 |
| 成功查询 | 240 |
| Top1 identity 一致 | 151 / 240 |
| Top1 identity 一致率 | 0.6292 |
| 平均 top3 identity overlap | 0.3764 |
| 平均 top5 identity overlap | 0.3023 |
| Dify MRR | 0.7896 |
| OpenKB MRR | 0.7883 |
| Dify nDCG | 0.7988 |
| OpenKB nDCG | 0.8178 |

按查询类型拆分：

| 类型 | 查询数 | Top1 一致率 | 平均 top3 overlap | 平均 top5 overlap | Dify MRR | OpenKB MRR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| exact_marker | 80 | 0.8250 | 0.3958 | 0.2698 | 0.9188 | 0.9479 |
| semantic | 80 | 0.4500 | 0.3354 | 0.2879 | 0.7208 | 0.6398 |
| ambiguous | 80 | 0.6125 | 0.3979 | 0.3492 | 0.7292 | 0.7771 |

归因摘要：

| 归因 | 查询数 |
| --- | ---: |
| same_top | 151 |
| ranking_difference | 70 |
| dify_missed_expected | 19 |

判断：

- live retrieval 不再被缺 dataset、cookie、CSRF、同 corpus/index 或模型不一致阻塞。
- splitter 边界已经进入兼容状态后，剩余差异主要来自 Dify console hit-testing 与 OpenKB `/api/search` 的排序/融合实现差异、Dify 内部命中 identity 映射差异，以及部分 exact marker 在 Dify 侧未命中期望文档。
- MRR 非常接近，说明同模型同 corpus 下两边总体相关性已经进入同一量级；Top-k overlap 仍是后续优化项，不应把 Phase 25 标成“完全一致”。

## 原始报告摘要

| 项目 | 数值 |
| --- | ---: |
| Run ID | `20260515-000821` |
| 长 Markdown 文档 | 30 |
| 检索查询 | 210 |
| Dify segment/child 总数 | 11179 |
| OpenKB chunk 总数 | 4266 |
| Dify top1 命中期望文档 | 89 |
| OpenKB top1 命中期望文档 | 202 |
| 两边 top1 marker 一致 | 90 |
| 平均 top3 marker overlap | 0.368 |

### 分块模式

| 模式 | 文档数 | Dify segment | Dify child | OpenKB chunks | OpenKB parent | OpenKB child | 平均边界相似度 | 完全一致文档 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| standard_auto | 30 | 1981 | 0 | 1757 | 0 | 0 | 0.5088 | 0 |
| standard_custom | 12 | 1272 | 0 | 510 | 0 | 0 | 0.1156 | 0 |
| parent_paragraph | 14 | 1323 | 3341 | 1124 | 252 | 872 | 0.0728 | 0 |
| parent_full_doc | 14 | 14 | 3248 | 875 | 14 | 861 | 0.0747 | 0 |

### 检索结果

| 模式 | 查询数 | top1 一致 | Dify 期望命中 | OpenKB 期望命中 | 平均 top3 overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| standard_auto | 90 | 48 | 47 | 87 | 0.4596 |
| standard_custom | 36 | 4 | 4 | 35 | 0.2199 |
| parent_paragraph | 42 | 13 | 13 | 40 | 0.2401 |
| parent_full_doc | 42 | 25 | 25 | 40 | 0.4266 |

semantic 查询经常一致，exact marker 和 ambiguous 查询差异更大。结论是：chunk 边界、metadata/关键词、rerank 输入、fallback 检索组合都会影响最终排序，不能只看模型本身。

## 后端代码对照

### Dify 1.14.1

Dify 源码只作为仓库外参照，当前本机路径为 `C:\tmp\codex-dify-1.14.1`，不得进入 OpenKB git。

| 模块 | 关键行为 |
| --- | --- |
| `api/models/dataset.py` | `DatasetProcessRule.AUTOMATIC_RULES`：`remove_extra_spaces=true`、`remove_urls_emails=false`、`delimiter="\n"`、`max_tokens=500`、`chunk_overlap=50` |
| `index_processor_base.py` | automatic 使用 `EnhanceRecursiveCharacterTextSplitter`；custom/hierarchical 使用 `FixedRecursiveCharacterTextSplitter` |
| `fixed_text_splitter.py` | custom 先按 fixed separator 切，再对超长块按 `\n\n`、`。`、`. `、空格、字符递归拆分 |
| `parent_child_index_processor.py` | paragraph parent 先切 parent 再切 child；full-doc parent 把整篇作为 parent 再切 children |
| `qa_index_processor.py` | question 作为索引文本，answer 存在 segment metadata / `DocumentSegment.answer`，对外常见内容形态是 `question:... answer:...` |
| metadata filters | 以 document metadata / tags 为业务过滤来源，chunk 技术字段不是用户配置的 metadata schema |

注意：Dify 字段名叫 `max_tokens`，但 1.14.1 splitter 的实际长度函数更接近字符长度，不是 OpenKB 旧 token estimator，也不是严格模型 tokenizer。

### OpenKB 当前实现

| 模块 | 当前状态 |
| --- | --- |
| `packages/markdown/src/index.ts` | `chunkMarkdownForIndex()` 是统一入口，支持 `text_model`、`hierarchical_model`、`qa_model` |
| Dify 兼容 splitter | Phase 22.8 起，automatic/custom/hierarchical 默认使用 Dify 1.14.1 兼容 splitter；长度使用 Unicode code point 语义，减少 CJK/emoji 与 JS UTF-16 `.length` 偏差 |
| `chunkMarkdownParentChild()` | paragraph/full-doc 都可表达，parent/subchunk 均走 Dify 兼容 splitter |
| QA chunks | QA 继续索引 question；PostgreSQL QA pair 保存 answer；Dify Adapter 对外返回 Dify 风格 `question:... answer:...`，Web/MCP 可继续 answer-first |
| metadata/tags | `metadata_condition` 与 `tags` 优先使用文档 metadata schema；chunk 技术字段保留在 `openkb_*` 或 retrieval explain metadata |
| `packages/retrieval/src/index.ts` | 候选来自 Milvus，最终以 PostgreSQL chunk/document/permission 终检为准；summary/QA/source chunk 不信任 Milvus metadata |

OpenKB 的优势仍是权限与派生命中解释更稳：summary、QA、source chunk 都会回到 PostgreSQL 终检。Dify 兼容性修复不能把 Milvus 或 Dify metadata 提升为权限真相。

## 根因判断

1. **splitter 算法差异是首要原因**
   旧 OpenKB 更像 delimiter/grouping；Dify 是 recursive splitter。即使参数一致，边界也会不同，custom 和 parent-child 尤其明显。

2. **输入规范化必须拆段记录**
   OpenKB 的 Markdown-first/Milkdown-normalized 输入会改变 frontmatter、列表、链接和空白形态。Parity 需要把差异拆成 raw -> Milkdown normalized -> indexed text -> splitter chunks，不能把输入差异误归因给 splitter。

3. **QA 返回语义有产品差异**
   Dify question 入索引、answer 放 metadata；OpenKB Web 为了可读性倾向 answer-first。Phase 22.9 的收口是：Dify Adapter 严格 Dify 风格，Web/MCP 保持可读但保留完整 metadata。

4. **metadata/tags 要以文档 metadata 为真相**
   Dify metadata 是知识库里配置的文档 metadata。OpenKB 不能长期依赖 `document_chunks.metadata.tags` 这类隐藏 chunk-only 能力；tags 已收口到文档 metadata post-filter。

5. **同模型检索环境仍需单独复跑**
   报告指出 Dify 环境没有完整启用 Milvus hybrid。必须在 Dify/OpenKB 使用同一 embedding/rerank/hybrid 开关后，才讨论 top-k、score、rerank 是否真正可比。

## Phase 22.9 收敛状态

| 优先级 | 项目 | 状态 | 证据/说明 |
| --- | --- | --- | --- |
| P0 | 保留报告与轻量复跑脚本 | 已实现 | `scripts/parity/run-dify-openkb-parity.mjs` 可读取报告目录/zip，也可生成 focused fixtures；大输出留在 `.codex-runtime` |
| P1 | Dify 兼容 splitter 默认行为 | 已验证 | 100 篇公开 Markdown、9 种模式复跑均为 100/100 文档完全一致；证据目录 `.codex-runtime/parity-runs/20260515T125253Z/` |
| P1 | 输入规范化对照 | 已实现 | `splitter-golden-fixtures.json` 输出 raw Markdown、Milkdown-normalized Markdown、indexed text、Dify splitter output、OpenKB splitter output |
| P1 | QA 兼容语义 | 已实现 | Dify Adapter QA 命中返回 `question:... answer:...` 内容，并带 `hit_type=qa`、`qa_question`、`qa_answer`、`qa_pair_id`、`source_chunk_id` |
| P2 | metadata/tags 产品模型收口 | 已实现 | `metadata_condition` 和 `tags` 使用文档 metadata post-filter；Admin Dify 可过滤字段显示 tags 来源为 `document_metadata` |
| P2 | 同模型 embedding/rerank/hybrid baseline | 脚本已实现，环境仍阻塞 | `--live-retrieval` 已能生成 import corpus、调用 Dify/OpenKB 检索入口并计算 overlap/MRR/nDCG；当前仍缺 Dify dataset/API token、OpenKB search session、同 corpus 导入/index 证据和已启动服务 |
| P3 | Segment lifecycle 兼容性 | 已验证基础矩阵 | active/disabled/deleted、override/reset、reprocess 后不迁移旧 override/segment summary；结果仍只返回 PostgreSQL 终检通过的 active chunks |

同模型 live retrieval 兼容性测试已有可复跑脚本入口；它作为 Phase 25 稳定收口的硬验收项保留，要求 Dify/OpenKB 使用同一 corpus、同一 embedding/rerank、同一 hybrid/rerank 开关后复跑。缺输入时必须保持 blocked，不得把环境不齐的结果记为通过。

## 复跑基线

脚本位置：

```text
scripts/parity/run-dify-openkb-parity.mjs
```

从已有报告生成摘要：

```powershell
node scripts/parity/run-dify-openkb-parity.mjs `
  --report-dir .codex-runtime/reports/openkb-dify-parity-v2-20260515-000821/openkb-dify-parity-v2-20260515-000821
```

生成 focused fixtures，默认至少 40 组：

```powershell
node scripts/parity/run-dify-openkb-parity.mjs --generate-fixtures --fixture-count 40
```

生成目录中应包含：

```text
fixtures/*.md
fixtures/qa-pairs.csv
splitter-golden-fixtures.json
parity-summary.json
parity-summary.zh-CN.md
```

`splitter-golden-fixtures.json` 是小型工程基线，覆盖中文标点、英文句号、长无分隔文本、表格、代码块、列表、frontmatter、Markdown link/image、emoji、中英混排、paragraph parent 和 full-doc parent。

## 模型连通性要求

模型连通性只能读取本机环境变量或本地 Admin UI 配置，不允许把 DashScope key、LLM key、Dify key、PAT 或 raw secret 写入命令、文档、`.env.example` 或 git diff。

OpenKB 侧建议临时变量名：

```text
OPENKB_EMBEDDING_REQUEST_FORMAT=dashscope
OPENKB_EMBEDDING_MODEL=qwen3-vl-embedding
OPENKB_EMBEDDING_DIM=768
OPENKB_RERANK_REQUEST_FORMAT=dashscope
OPENKB_RERANK_MODEL=qwen3-vl-rerank
OPENKB_LLM_REQUEST_FORMAT=openai_chat_completions
```

Dify 侧必须先确认 1.14.1 当前 Tongyi/DashScope provider 或 OpenAI-compatible provider 是否支持等价 endpoint。若 Dify 不能接入相同模型，记录为环境阻塞，不要把差异伪装成 parity 通过。

## 验收清单

- `docs/30` 能独立说明报告数据、源码差异、根因、收敛状态和剩余环境阻塞。
- 复跑脚本能从报告目录生成摘要，并能生成 40 组 focused Markdown fixtures。
- fixture 输出能拆出 raw、Milkdown normalized、indexed text、Dify output、OpenKB output。
- QA Dify Adapter 与 Web/MCP 展示语义分层明确。
- metadata/tags 不再依赖隐藏 chunk-only truth。
- 大 JSON、截图、临时运行输出仍在 `.codex-runtime`，不进入 git。
- 文档和脚本不包含任何 raw API key、SMTP password、OAuth secret、PAT 或本地私有 endpoint。

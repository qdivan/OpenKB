# 28 — Dify 1.14.1 知识库能力差异审计

本文是 Phase 22 的升级与审计记录。它合并两件事：

- 本地 Dify 从 `1.13.0` 原地升级到 `1.14.1` 的执行记录、验证结果和回滚边界。
- 以 Dify `1.14.1` 源码、升级后的本地 Dify UI/运行行为、OpenKB 当前实现为三方参照，逐项审计知识库处理、分块、检索和 segment 管理差异。

本文是当前 Dify 对齐工作的基线。`docs/27-dify-knowledge-alignment.zh-CN.md` 仍作为 Phase 22 设计计划保留；若两者冲突，以本文的“已验证状态”和“后续拆分计划”为准。

## 参照来源

| 来源 | 位置 | 用途 |
| --- | --- | --- |
| Dify 官方 Docker Compose 文档 | https://docs.dify.ai/getting-started/install-self-hosted/docker-compose | 升级前备份、compose/env/volumes 检查和启动路径 |
| Dify `1.14.1` Release | https://github.com/langgenius/dify/releases/tag/1.14.1 | 1.14.1 版本功能和修复点 |
| Dify `1.14.1` 源码 | 仓库外 `C:\tmp\codex-dify-1.14.1` | 字段、API、UI、迁移脚本对照；不进入 OpenKB git |
| 本地 Dify | `http://localhost:18080`，compose 目录位于仓库外的本机 Dify 测试目录 | 升级后真实运行验证 |
| OpenKB 当前代码 | 本仓库 | OpenKB Phase 21/22 实现状态核对 |

## 本地 Dify 升级记录

### 升级前状态

- 原版本：Dify `1.13.0`。
- compose 目录：仓库外本机 Dify 测试目录；不进入 OpenKB git。
- 本地 Dify 使用 OpenKB 的 Milvus 容器作为外部向量库：
  - `VECTOR_STORE=milvus`
  - `MILVUS_URI=http://openkb-milvus-standalone-1:19530`
  - override 文件：`docker-compose.openkb-milvus.override.yaml`
- 升级前 sandbox 镜像为 `langgenius/dify-sandbox:0.2.12`，升级到 `1.14.1` compose 后默认变为 `langgenius/dify-sandbox:0.2.15`。

### 备份

已在仓库外创建备份目录：

```text
<local-dify-backup-dir>/dify-1.13.0-to-1.14.1-<timestamp>
```

备份内容包括：

- `.env`
- `docker-compose.yaml`
- `docker-compose.openkb-milvus.override.yaml`
- 当前 `volumes/` 打包
- PostgreSQL `pg_dumpall` 压缩包
- 升级前容器状态、compose services 和关键日志

已验证 `postgres-pg_dumpall.sql.gz` 和 `volumes.tgz` 可读取。备份目录不属于 OpenKB git。

### 执行路径

1. 官方 git fetch 因网络超时未能直接拉取 tag；改用仓库外已下载的 Dify `1.14.1` 源码作为 compose 同步源。
2. 只同步 `docker/` 目录，保留本地 `.env`、`volumes/` 和 OpenKB Milvus override。
3. compose 镜像升级到：
   - `langgenius/dify-api:1.14.1`
   - `langgenius/dify-web:1.14.1`
   - `langgenius/dify-plugin-daemon:0.6.0-local`
   - `langgenius/dify-sandbox:0.2.15`
4. `docker compose pull` 受到 WSL Docker credential helper 影响失败，但目标镜像已存在于本机，因此使用 `--pull never` 启动。
5. Dify `1.14.1` compose 默认 `COMPOSE_PROFILES=${VECTOR_STORE},${DB_TYPE}` 会因为 `VECTOR_STORE=milvus` 误启本地内置 Milvus/etcd/minio。由于本环境使用 OpenKB 外部 Milvus，已在本地 `.env` 中改为只启用 DB profile：

   ```text
   COMPOSE_PROFILES=${DB_TYPE:-postgresql}
   ```

6. API entrypoint 自动执行 `flask upgrade-db`。日志显示迁移从 `fce013ca180e` 连续升级到 `a4f2d8c9b731`，并输出 `Database migration successful!`。

### 升级后验证

| 检查项 | 结果 |
| --- | --- |
| `docker compose ps` | API、Web、Worker、Plugin daemon、Sandbox 均运行；API/Sandbox health 通过 |
| Web 首页 | `http://localhost:18080/` 返回 307 到 `/apps` |
| Setup API | `GET /console/api/setup` 返回 `{"step":"finished"}`，响应头 `X-Version: 1.14.1` |
| DB migration | API 日志显示 `Database migration successful!` |
| Plugin daemon | 容器运行，端口 `5003` 暴露 |
| Sandbox health | 容器 health 通过 |
| Sandbox Python execution | 初次失败，修复后通过，真实执行输出 `12345` |

升级后同时用 OpenKB 真实页面复核 Dify External Knowledge 配置入口，确认 endpoint、External Knowledge ID、mapping 和可过滤 metadata 字段能在 Admin 控制台中被直接看到。

![OpenKB Dify Admin](assets/openkb-admin-dify.png)

### Sandbox 修复记录

升级后第一次真实 Python 执行失败：

```text
fork/exec /usr/local/bin/python3: no such file or directory
```

原因是旧 `volumes/sandbox/conf/config.yaml` 仍保留：

```yaml
python_path: /usr/local/bin/python3
```

但 `langgenius/dify-sandbox:0.2.15` 中 Python 路径是：

```text
/opt/python/bin/python3
```

已在本地 Dify 配置中改为：

```yaml
python_path: /opt/python/bin/python3
```

重启 sandbox/API/worker 后，从 Dify API 容器调用 `CodeExecutor.execute_code(CodeLanguage.PYTHON3, "", "print(12345)")` 成功返回 `12345`。

> 注意：以后 Dify 升级不能只看 Web/API/DB migration 或 sandbox health；必须把真实 Python execution 作为固定回归项。

### 已知升级提示

- API 日志中仍有一次 `Control server error: [Errno 13] Permission denied: '/home/dify'`，但 gunicorn 正常启动，API health 与真实 code execution 均通过。后续如果 Dify UI 或后台任务出现异常，再单独排查该权限日志。
- 本地 `.env` 中的 `COMPOSE_PROFILES` 修正是为了复用 OpenKB 外部 Milvus，属于本机 Dify 部署配置，不进入 OpenKB 仓库。

## Dify 1.14.1 字段与 OpenKB 映射矩阵

状态定义：

- 已实现：OpenKB 代码路径已经具备主要行为，并有相应 API/worker/UI 或测试。
- 部分实现：有 schema、API 或部分 UI，但行为未完全等价 Dify。
- 仅计划：只在文档或路线图中定义，尚未完整实现。
- 不对齐：OpenKB 明确不照搬，需保留产品边界。

| Dify 1.14.1 能力/字段 | Dify 语义 | OpenKB 当前映射 | 状态 | 差异与后续 |
| --- | --- | --- | --- | --- |
| Dataset / Knowledge | 知识库级对象，保存索引技术、检索模型、summary 设置、metadata schema 等 | `knowledge_bases` + `knowledge_base_chunk_settings` + metadata fields | 部分实现 | OpenKB 已有 KB dashboard/settings，但设置入口还不如 Dify 集中 |
| Document | 知识库内文档，可保存处理规则快照、启用状态和 summary 状态 | `documents` + `document_versions` + processing snapshot | 部分实现 | OpenKB 正文以 Markdown 版本为真相，处理快照是派生索引层 |
| Segment | 检索最小片段，可启用/禁用、编辑内容、删除 | `document_chunks` | 已实现基础闭环 | 文档右侧 Segments 面板管理 active/disabled/deleted、override/reset；KB Segment map 只做分组预览 |
| `doc_form=text_model` | 普通 RAG 文档，生成普通段落 chunks | `doc_form=text_model` / `general` chunks | 部分实现 | 基础已对齐，automatic/custom 参数覆盖率需继续补 |
| `doc_form=hierarchical_model` | 父子检索知识库 | `doc_form=hierarchical_model` + parent/child chunks | 部分实现 | 已有父子 chunk 思路，文档级 UI 与 reprocess 仍需补齐 |
| `doc_form=qa_model` | QA 知识库，索引问题、返回答案 | `document_qa_pairs` / QA metadata | 部分实现 | 手动/CSV 基础可做，LLM 生成 QA 未完整闭环 |
| `indexing_technique=economy` | 关键词/全文类低成本索引 | BM25 / keyword strategy | 部分实现 | 需要把 KB 默认策略更完整注入 Web/MCP/Dify/Search |
| `indexing_technique=high_quality` | embedding/hybrid/rerank 高质量索引 | Admin Models + dense/hybrid/rerank + Milvus profile | 部分实现 | OpenKB 不做 KB 级模型密钥，使用实例级模型配置 |
| `process_rule.mode=automatic` | Dify 默认切分规则 | OpenKB 默认 process rule | 部分实现 | 需按 Dify 1.14.1 参数补齐 separator/max tokens/overlap 默认值 |
| `process_rule.mode=custom` | 用户自定义切分规则 | KB chunk settings / process rule JSON | Phase 22.6 UI 已对齐 | KB Settings 已拆出分块规则 tab |
| `process_rule.mode=hierarchical` | 父子切分规则 | parent/child chunk settings | 部分实现 | 需把 paragraph/full-doc 选择清晰落到文档处理快照 |
| `parent_mode=paragraph` | 段落父块 | `parent_mode=paragraph` | 部分实现 | 需要端到端 reprocess job 验证 |
| `parent_mode=full-doc` | 全文父块 | `parent_mode=full-doc` | 部分实现 | 需要大文档 token/size 限制提示 |
| Subchunk segmentation | 父子模式中的子块规则 | `subchunk_segmentation` | 部分实现 | 需要 UI 和 worker 参数覆盖测试 |
| Document process snapshot | 文档导入/重处理时的规则快照 | `process_rule_snapshot` | Phase 22.6 UI 已对齐 | 文档右侧新增处理快照面板 |
| Reprocess | 文档按当前/指定规则重新处理 segment | document reprocess API | Phase 22.6 UI 已对齐 | KB Settings 重处理 tab 逐篇触发现有 document reprocess |
| `retrieval_model.search_method=semantic_search` | 语义检索 | dense / dense_rerank | Phase 22.3 已注入 | embedding/index 不可用时返回 `SEARCH_INDEX_NOT_READY` |
| `retrieval_model.search_method=full_text_search` | 全文检索 | BM25 | Phase 22.3 已注入 | metadata 标记 effective retrieval mode |
| `retrieval_model.search_method=hybrid_search` | 混合检索 | hybrid / hybrid_rerank | Phase 22.3 已注入 | 支持 keyword/vector weights |
| `retrieval_model.search_method=keyword_search` | 关键词检索 | BM25 / keyword | Phase 22.3 已注入 | economy 默认走 BM25 |
| `retrieval_model.top_k` | 默认返回数 | KB default + request override | Phase 22.3 已实现 | Web/MCP/Dify 请求可覆盖 |
| `score_threshold` | 分数阈值 | KB default + request override | Phase 22.3 已实现 | 权限终检后、裁剪前统一过滤 |
| Rerank enable/model | 开启重排并选择模型 | Admin instance-level rerank | 部分实现 | 不提供 KB 级 rerank provider/key |
| Hybrid weights | 语义/关键词权重 | `retrieval_model` JSON -> Milvus WeightedRanker | Phase 22.3 已实现 | SDK 支持 WeightedRanker 时使用权重 |
| Metadata schema | 知识库级 metadata 字段定义 | Phase 21.2 metadata fields | Phase 22.6 UI 已对齐 | KB Settings metadata tab 管理 schema，文档右侧 Metadata 管理 values |
| Metadata filters | workflow/retrieval 中按 metadata 过滤 | Dify `metadata_condition` + OpenKB metadata values | Phase 22.3 已统一解析 | tags 下推 Milvus；document metadata post-filter |
| Summary index | 文档/segment summary 参与索引 | `document_summaries` / `document_segment_summaries` / summary metadata | Phase 22.6 UI 已对齐 | 文档右侧 Summary 面板显式触发，KB Settings 只配置索引参与 |
| QA generation | 由 LLM 生成 QA pairs | 实例级 LLM 显式触发 | Phase 22.6 UI 已对齐 | 文档右侧 QA 面板支持手动、CSV、mock/LLM 触发 |
| Segment enable/disable | 控制 segment 是否参与检索 | `document_chunks.status` | Phase 22.4 已实现 | API/UI 均提示需要 Milvus index rebuild 后才影响搜索/MCP/Dify |
| Segment override | 手工覆盖 segment 内容 | override content fields | Phase 22.4 已实现 | 明确不反写 Markdown 正文，index worker 使用 override 内容 |
| Segment reset override | 恢复派生 chunk 内容 | reset override API/UI | Phase 22.4 已实现 | 清空 override 字段并写审计 |
| Hit-test explanation | 显示命中 segment 与上下文关系 | parent/child explanation metadata | 部分实现 | Web Search / Retrieval Lab / Dify metadata 需要统一 |
| External dataset / bound dataset tenant 校验 | 外部知识库和绑定知识库需要租户边界校验 | Dify app-key-bound allowed KB scope | 已实现/部分实现 | OpenKB 不写 Dify DB，只通过 External Knowledge API 对齐 |
| Knowledge-base-level model config | Dify 可为知识库选模型 | OpenKB 不提供 | 不对齐 | OpenKB 只允许 system_admin 配置实例级模型 |

## OpenKB 对齐结论

OpenKB 当前已经进入 Phase 22 的 schema/API 基础阶段：Dify 风格字段和部分 chunk/retrieval/metadata 扩展已经在代码中出现，但距离 Dify 1.14.1 的“原生知识库体验”仍有四个主要缺口：

1. **处理规则闭环不足**：需要把 KB 默认规则、文档快照、显式 reprocess、状态提示和 worker 行为统一起来。
2. **检索策略已完成基础注入**：Phase 22.3 已让 KB 级 `retrieval_model` 成为 Web Search、Retrieval Lab、MCP、Dify Adapter 的共同默认策略；Phase 22.6 已把策略配置放入 KB Settings 的“检索策略”tab。
3. **segment 管理基础已落地**：Phase 22.4 已实现启用/禁用、override/reset、soft delete/restore 和 index rebuild 提示；Phase 22.6 已把文案和入口统一为 Segments。
4. **summary/QA 生成闭环已进入 UI 可用阶段**：Phase 22.5 完成手动/CSV/mock/LLM 显式触发；Phase 22.6 已把 QA 与 Summary 放入文档右侧独立面板。后续重点是批量任务、失败重试和更细的命中解释可视化。

当前 UI 截图基于本地真实服务生成，覆盖 KB 处理配置、文档处理快照和搜索命中解释：

![OpenKB KB Settings](assets/openkb-kb-settings.png)

![OpenKB Search Result](assets/openkb-search.png)

## 后续分步开发计划

### Phase 22.2 — Dify 风格分块与显式 reprocess

- 完整落地 `automatic/custom/hierarchical` 参数。
- 文档保存处理规则快照，内容或规则变更后标记 `needs_reprocess`。
- 实现 reprocess job，重建 PostgreSQL chunks，但不自动切 Milvus alias。
- 父子模式支持 paragraph parent 与 full-doc parent 的端到端测试。

### Phase 22.3 — KB 级 retrieval_model 注入

- 已将 KB 默认 `retrieval_model` 注入 Web Search、Retrieval Lab、MCP、Dify Adapter。
- 已支持 `semantic_search`、`full_text_search`、`hybrid_search`、`keyword_search`。
- 已完成 `top_k`、`score_threshold`、hybrid weights、rerank 开关、metadata filters 的统一解析。
- 多 KB 策略不一致时使用租户/实例默认策略，并在响应 metadata 标记 `mixed_retrieval_model`。
- 所有结果继续通过 PostgreSQL final permission check。

### Phase 22.4 — Segment 管理与索引提示

- 已增加文档级 Chunks 管理侧栏。
- 已支持 enable/disable、override content、reset override、soft delete/restore。
- 影响检索派生层的变更会返回并展示 Milvus index rebuild 提示；不要求 chunk rebuild。
- Override 只影响检索和外部返回，不反写 Markdown 版本。

### Phase 22.5 — QA 与 summary 生成闭环

- 支持手动 QA、CSV QA 导入和 LLM mock 生成。
- 使用实例级 LLM 配置生成 document/segment summary。
- Summary/QA hit 映射回原始文档和 chunk，并在 Dify metadata 中说明命中类型。
- 所有 LLM 消耗必须手动或批量显式触发。

### Phase 22.6 — Web UI 对齐

- 已完成 KB Settings Dify-like tabs：处理模式、分块规则、检索策略、metadata、摘要、重处理。
- 已完成文档右侧大纲、处理快照、Segments、QA、Summary、Metadata、Versions 的面板层级。
- 页面风格保持 OpenKB 自己的产品设计，但知识库/文档处理信息层级与 Dify 1.14.1 对齐。

## 明确不对齐项

- 不做知识库级模型 endpoint/key 配置；模型仍由 system_admin 在实例级 Admin Models 管理。
- 不写 Dify 数据库，也不依赖 Dify 内部表结构。
- 不让 Dify key impersonate 用户；Dify 仍是 app-key-bound + allowed KB scope。
- 不把 segment override 反写 Markdown 正文。
- 不把 Milvus 或 Dify metadata 当作最终权限来源；PostgreSQL + PermissionService 仍是最终真相。

## 回滚与复核清单

### Dify 回滚

如需回滚本地 Dify：

1. 停止当前 Dify compose。
2. 使用备份目录中的 `.env`、compose 文件和 `volumes.tgz` 恢复。
3. 用备份中的 `postgres-pg_dumpall.sql.gz` 恢复数据库。
4. 恢复 sandbox `python_path` 与镜像版本。

### 后续每次 Dify 升级必须验证

- `docker compose ps`
- `GET /console/api/setup` 响应头 `X-Version`
- API migration 日志
- Web 登录与知识库页面
- External Knowledge API smoke
- Sandbox `/health`
- 从 API 容器真实执行 Python：`print(12345)`

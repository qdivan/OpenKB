# 26 — OpenKB 接入 Dify External Knowledge 配置指南

本文记录如何把 OpenKB 知识库作为 Dify External Knowledge 使用。示例使用一个小样本知识库 `三国演义`，用于验证 Dify 官方契约中的 `records.content`、`records.score`、`records.title` 和 `records.metadata` 是否完整兼容。

## 适用范围

- Dify 通过 External Knowledge API 调用 OpenKB 的 `apps/dify-adapter`。
- Dify API key 是 app-key-bound，只能访问 OpenKB 中显式授权的知识库。
- OpenKB 仍以 PostgreSQL + Permission/Scope check 为最终真相；Milvus 只是检索索引。
- Dify 不直接读取 OpenKB PostgreSQL，也不直接读取 OpenKB Milvus collection。

## OpenKB 端配置

1. 确认服务可用：

   ```bash
   curl http://localhost:4101/health
   curl http://localhost:4200/health
   ```

2. 创建或选择一个 OpenKB 知识库。本地兼容验证示例：

   - Workspace: `Default Workspace`
   - Knowledge Base: `三国演义`
   - Dify External Knowledge ID: `sanguo-openkb`

3. 创建若干 Markdown 文档并发布，例如：

   - `桃园结义`
   - `三顾茅庐`
   - `草船借箭`
   - `赤壁之战`
   - `官渡之战`
   - `空城计`
   - `人物索引`

4. 确认 chunks 和索引：

   - 发布文档会准备 PostgreSQL chunks。
   - 如需要 Dify 立即检索新内容，需要执行 Milvus index rebuild。
   - 如果使用 embedding/dense 检索，必须先在 Admin Models 中配置实例级 embedding model，然后执行 blue-green index rebuild。

5. 在 OpenKB Admin -> Dify 创建 API key：

   - Name: `Dify 三国演义`
   - External Knowledge ID: `sanguo-openkb`
   - Allowed KB: 只选择 `三国演义`
   - Top K Limit: `10`

   只在 Dify UI 配置时使用 raw key。不要把 raw key 写入文档、日志或代码仓库。

6. 打开 OpenKB Admin -> Dify 的“配置向导”：

   - 复制 `API Endpoint for Dify` 到 Dify UI。这个值是 base URL，不包含 `/retrieval`。
   - 复制 External Knowledge ID 到 Dify 外部知识库配置。
   - 用 `Copy test curl` 生成脱敏测试请求；把 `<DIFY_API_KEY>` 替换为刚创建时显示的一次性 raw key。
   - 查看“可过滤 metadata 字段”，确认业务字段来自 KB Metadata schema，而不是仅依赖 chunk 技术字段。

OpenKB Admin -> Dify 的配置向导会展示 endpoint、External Knowledge ID、mapping 和可过滤 metadata 字段；普通列表和截图都不会回显 raw key。

![OpenKB Dify Admin](assets/openkb-admin-dify.png)

## Dify 端配置

Dify UI 会自动在 API Endpoint 后拼接 `/retrieval`。因此 API Endpoint 填 base URL，不要填 `/retrieval`。

1. 打开 Dify Console，进入 Knowledge -> External Knowledge API。
2. 创建 External Knowledge API：

   - Name: `OpenKB 三国演义`
   - API Endpoint: `http://<dify-container-can-reach-openkb-adapter>:4200`
   - API Key: OpenKB Admin -> Dify 中创建的 raw key

3. 创建外部知识库：

   - Name: `三国演义 OpenKB`
   - External Knowledge API: `OpenKB 三国演义`
   - External Knowledge ID: `sanguo-openkb`
   - Retrieval: `top_k=5`, `score_threshold=0`

4. 在 Dify retrieval test 中查询：

   - `赤壁之战谁和谁对抗曹操`
   - `诸葛亮为什么要三顾茅庐`
   - `关羽和刘备是什么关系`

## Docker / WSL 本地网络

浏览器里的 `localhost:4200` 通常只对宿主机浏览器可用。Dify API 容器调用 OpenKB adapter 时，必须使用容器可达地址。

在当前 WSL2 Docker 开发环境里，可用 WSL nameserver 作为 Windows host 地址：

```bash
awk '/nameserver/{print $2; exit}' /etc/resolv.conf
```

然后在 Dify API Endpoint 填：

```text
http://<上一步输出的 IP>:4200
```

示例验证容器连通性：

```bash
docker exec docker-api-1 sh -lc 'curl -sS http://<上一步输出的 IP>:4200/health'
```

如果 OpenKB 和 Dify 都在同一个 Docker network 内，也可以使用服务名，例如：

```text
http://openkb-dify-adapter:4200
```

生产环境建议使用 HTTPS 域名，例如：

```text
https://openkb.example.com/dify
```

## 直接验证 OpenKB Adapter

用 Dify key 直接请求 OpenKB adapter：

```bash
curl -sS http://localhost:4200/retrieval \
  -H "Authorization: Bearer $OPENKB_DIFY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "knowledge_id": "sanguo-openkb",
    "query": "赤壁之战谁和谁对抗曹操",
    "retrieval_setting": {
      "top_k": 5,
      "score_threshold": 0
    },
    "metadata_condition": null
  }'
```

成功响应必须符合 Dify 契约：

```json
{
  "records": [
    {
      "content": "string",
      "score": 0.56,
      "title": "赤壁之战",
      "metadata": {}
    }
  ]
}
```

`metadata` 必须是 object，不能是 `null`。

如果带合法 Bearer 但请求体为空，OpenKB 会返回 Dify-compatible `400 / 4001`，并说明“OpenKB Dify adapter 已到达，但缺少 `knowledge_id/query/retrieval_setting`”。这用于帮助区分网络连通问题和 Dify 配置/请求体问题。

## Metadata 字段映射

OpenKB adapter 会保证每条 Dify record 至少包含以下 metadata：

| Dify / metadata 字段 | OpenKB 来源 | 含义 |
| --- | --- | --- |
| `records[].content` | 返回上下文 chunk/parent 文本 | Dify 展示和召回给 LLM 的正文片段 |
| `records[].score` | OpenKB normalized score | 归一化到 0..1 的分数 |
| `records[].title` | `documents.title` | Dify record 标题 |
| `records[].metadata` | OpenKB 组装 object | 永远是 object，不返回 `null` |
| `metadata.document_name` | Dify built-in -> `documents.title` | Dify 内部知识库同名 built-in 字段 |
| `metadata.dataset_name` | `knowledge_bases.title` | Dify 友好的知识库名称 |
| `metadata.segment_id` | `document_chunks.id` | Dify segment id 对齐；等于 `chunk_id` |
| `metadata.score` | `records[].score` | 方便 Dify metadata 面板直接查看分数 |
| `metadata.knowledge_base_title` | `knowledge_bases.title` | OpenKB 知识库标题 |
| `metadata.document_title` | `documents.title` | OpenKB 文档标题 |
| `metadata.document_slug` | `documents.slug` | OpenKB 文档 slug |
| `metadata.path_parts` | `result.path` | 路径数组 |
| `metadata.absolute_url` | `DIFY_RESULT_BASE_URL` / `APP_BASE_URL` | 可直接打开的 OpenKB 文档 URL；未配置 base URL 时为 `null` |
| `metadata.retrieval_mode` | OpenKB retrieval context | `chunk` / `parent_child` / `full_text` 等 |
| `metadata.score_source` | retrieval/rerank 状态 | `retrieval` 或 `rerank` |
| `metadata.retrieval_model` | KB 默认检索策略 + Dify request override | Dify-like `semantic_search/full_text_search/hybrid_search/keyword_search` 配置 |
| `metadata.mixed_retrieval_model` | Retrieval Service 策略解析 | 多 KB 策略不一致时为 `true`；Dify 单 KB mapping 通常为 `false` |
| `metadata.openkb_retrieval.hybrid_weights` | KB `retrieval_model.weights` | Hybrid keyword/vector 权重 |
| `metadata.openkb_retrieval.score_threshold_applied` | KB 或 Dify request 阈值 | 实际用于过滤的 score threshold |
| `metadata.document_id` | `documents.id` | OpenKB document id |
| `metadata.chunk_id` | `document_chunks.id` | OpenKB chunk id |
| `metadata.knowledge_base_id` | `knowledge_bases.id` | OpenKB knowledge base id |
| `metadata.workspace_id` | `workspaces.id` | OpenKB workspace id |
| `metadata.heading_path` | `document_chunks.heading_path` | 当前 chunk 的 Markdown 标题路径 |
| `metadata.context_mode` | OpenKB retrieval context | 当前返回上下文模式，例如 `parent_child` |
| `metadata.match_chunk_id` | 实际命中 chunk | 实际命中的 chunk id |
| `metadata.parent_chunk_id` | parent chunk | parent chunk id；无 parent 时为 `null` |
| `metadata.path` | `result.path` | OpenKB 逻辑路径，例如 `/三国演义/赤壁之战` |
| `metadata.url` | OpenKB Web URL | 文档 URL；可能是相对路径或绝对路径 |
| `metadata.updated_at` | `documents.updated_at` | 文档更新时间 |
| `metadata.raw_score` | Milvus 原始分数 | 召回原始分数 |
| `metadata.rerank_score` | rerank 分数 | 未启用时为 `null` |
| `metadata.rerank_failed` | rerank 状态 | rerank 是否失败 |

Dify 内部知识库的 metadata schema 与 OpenKB 对齐如下：

| Dify 内部 metadata | OpenKB Phase 21.2 映射 | 是否可用于 `metadata_condition` |
| --- | --- | --- |
| `document_name` | 内置，只读，来自 `documents.title` | 是 |
| `uploader` | 内置，只读，来自创建人显示名或邮箱 | 是 |
| `upload_date` | 内置，只读，来自 `documents.created_at` | 是 |
| `last_update_date` | 内置，只读，来自 `documents.updated_at` | 是 |
| `source` | 内置，只读，`online_document` 或 `file_upload` | 是 |
| 自定义 `string/number/time` 字段 | KB Settings -> Metadata 定义，文档右侧 Metadata 面板填写 | 是 |
| `openkb_retrieval.*` | 技术诊断字段，不建议作为业务 metadata | 可以，但应视为 OpenKB 技术字段 |

如果 chunk 自身有 metadata，还会透传安全字段，例如：

| 字段 | 含义 |
| --- | --- |
| `chunk_type` | `general` / `parent` / `child` |
| `token_count` | OpenKB 估算 token 数 |
| `start_line` / `end_line` | Markdown 行范围 |
| `start_char` / `end_char` | Markdown 字符范围 |
| `settings_revision` | chunk setting revision |
| `parent_ordinal` / `child_ordinal` | parent-child chunk 序号 |
| `tags` | chunk 原始 tags |

检索解释字段放在 `metadata.openkb_retrieval`：

```json
{
  "mode": "dense_rerank",
  "raw_score": 0.21,
  "rerank_score": 0.56,
  "retrieval_model": {
    "search_method": "hybrid_search",
    "top_k": 5
  },
  "score_threshold_applied": 0.2,
  "context_mode": "parent_child",
  "match_chunk_id": "...",
  "parent_chunk_id": "..."
}
```

## 本地验证结果

本地小样本验证使用：

- OpenKB KB: `三国演义`
- Dify External Knowledge ID: `sanguo-openkb`
- Dify external dataset: `三国演义 OpenKB`
- 检索模式：BM25 可用；中文查询建议配置 OpenAI-compatible embedding/rerank 后使用 dense/rerank。

已验证：

- OpenKB adapter `POST /retrieval` 返回 `records` 非空。
- `records[*].metadata` 是 object。
- Dify Console external-hit-testing 可拿到 OpenKB 返回的内容和 metadata。
- 错误 `knowledge_id` 返回 Dify-compatible `2001`。
- 授权范围只包含 `三国演义` KB，不会返回其它 KB 的文档。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `401 / 1001` | 未带 `Authorization: Bearer ...` | 检查 Dify External Knowledge API 的 API Key |
| `401 / 1002` | Dify key 错误、过期或 revoked | 在 OpenKB Admin -> Dify 重新创建或 rotate key |
| `404 / 2001` | `knowledge_id` 没有 active mapping | 确认 Dify External Knowledge ID 与 OpenKB mapping 一致 |
| `403` | key 未授权目标 KB | 检查 allowed KB scope |
| `503 / 3001` | Milvus active alias 未就绪 | 执行 Admin Indexing rebuild |
| Dify 容器连接失败 | Dify 容器不能访问浏览器 `localhost` | 使用 WSL nameserver、Docker service name 或 HTTPS 域名 |
| Dify pipeline 报 metadata 错误 | external API 返回 `metadata: null` | OpenKB adapter 必须返回 object；升级或检查自定义 adapter |
| 中文查询命中差 | BM25 text-only 缺少中文分词/语义 | 配置 OpenAI-compatible embedding/rerank，并重建 Milvus index |

## 安全注意

- 不要把 Dify raw key、OpenKB model key、SMTP password、PAT 或 OAuth secret 写入文档或仓库。
- Dify key 只授权必要 KB。
- Dify app-key-bound，不能模拟任意用户。
- OpenKB 返回前仍执行 PostgreSQL final scope check。

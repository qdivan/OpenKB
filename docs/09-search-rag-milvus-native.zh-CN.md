# 09 — Milvus 原生检索、Function 和索引重建

## 1. 最高原则

```text
Milvus 是检索索引，不是业务数据库，也不是最终权限系统。
PostgreSQL 是文档、chunk 和权限真相。
Embedding / BM25 / rerank 长期优先使用 Milvus Server 2.6+ 原生 Function 能力。
OpenKB v0.x 不保存 embedding/rerank provider API key。
```

当前 v0.3.x 已按部署决策实现 OpenKB 直连 HTTP 模型服务：endpoint/model 只来自环境变量，检索模式只由 Admin 设置保存到 `retrieval_settings`，不保存 provider key，不提供知识库级模型配置。Milvus TEXTEMBEDDING/RERANK Function 仍保留为后续演进方向。

## 2. OpenKB 管理什么

OpenKB 只管理：

```text
Milvus URI/token/database
active alias
collection/index status
rebuild job
alias switch
health check
retrieval mode
```

OpenKB 不管理：

```text
embedding provider API key
rerank provider API key
知识库级模型配置
知识库级向量维度配置
模型 endpoint/key 的数据库配置
```

## 3. Embedding

当前链路：

```text
index-worker reads PostgreSQL chunks
  -> OpenKB calls OPENKB_EMBEDDING_ENDPOINT
  -> OpenKB writes raw text + metadata + dense_vector to Milvus
```

查询链路：

```text
OpenKB calls OPENKB_EMBEDDING_ENDPOINT for query vector
  -> Milvus dense or hybrid search
  -> PostgreSQL final permission check
```

已验证的兼容配置示例：

```text
OPENKB_EMBEDDING_ENDPOINT=http://192.168.6.220:18081/v1/embeddings
OPENKB_EMBEDDING_MODEL=qwen3-vl-embedding-2b
OPENKB_EMBEDDING_DIM=2048
```

Milvus Function 版本的目标仍是后续可选演进：由 Milvus TEXTEMBEDDING Function 调用 provider service，OpenKB 只写 raw text。

## 4. BM25 / Sparse Search

知识库检索必须支持关键词能力。Milvus collection 中应包含：

```text
content_text: VARCHAR
sparse_vector: SPARSE_FLOAT_VECTOR 或 Milvus BM25 Function 输出字段
```

未配置 embedding endpoint 时，OpenKB 固定回退到 BM25。配置 embedding 并完成索引重建后，可以使用：

```text
bm25
dense
hybrid
```

## 5. Rerank

当前链路：

```text
Milvus returns candidates
  -> PostgreSQL final permission check
  -> OpenKB calls OPENKB_RERANK_ENDPOINT with authorized chunk text only
  -> OpenKB sorts by relevance_score
```

已验证的兼容配置示例：

```text
OPENKB_RERANK_ENDPOINT=http://192.168.6.220:18082/v1/rerank
OPENKB_RERANK_MODEL=qwen3-vl-reranker-2b
```

限制：

- rerank 使用的字段必须是文本字段。
- rerank 失败时降级为未 rerank 结果，并在结果 metadata 标记 `rerank_failed`。
- rerank 必须发生在最终权限检查之后。
- OpenKB 不保存 rerank API key。
- Milvus RERANK / Model Ranker Function 是后续可选演进。

## 6. Collection schema

默认 collection 按 embedding 维度和版本创建：

```text
openkb_chunks_qwen3_1024_v1
openkb_chunks_qwen3_1024_v2
openkb_chunks_qwen3_2560_v1
openkb_chunks_custom_768_v1
```

检索使用 alias：

```text
openkb_chunks_active
```

### 6.1 主键定稿

Milvus collection 使用：

```text
id: VARCHAR primary key
chunk_id: VARCHAR regular field
```

v0.x 中：

```text
id = string(document_chunks.id)
chunk_id = string(document_chunks.id)
```

也就是说，`id` 是 Milvus 主键字段，`chunk_id` 是为了 API 返回、过滤和可读性保留的普通字段。不要在 prompt 或代码里把 `chunk_id` 声明成 primary key。Dify/MCP/Web 返回里的 `chunk_id` 使用 `document_chunks.id`。

### 6.2 推荐字段

```text
id: VARCHAR primary key
chunk_id: VARCHAR
tenant_id: VARCHAR
workspace_id: VARCHAR
knowledge_base_id: VARCHAR
document_id: VARCHAR
version_id: VARCHAR
is_current: BOOL
doc_status: VARCHAR
title: VARCHAR
heading_path: ARRAY<VARCHAR>
content_text: VARCHAR
content_markdown: VARCHAR
metadata: JSON
access_principals: ARRAY<VARCHAR>
dense_vector: FLOAT_VECTOR(dim = current embedding dim) optional
sparse_vector: SPARSE_FLOAT_VECTOR optional
created_at: INT64 timestamp
updated_at: INT64 timestamp
```

## 7. 权限预过滤

Milvus filter 示例：

```text
tenant_id == "t1"
and is_current == true
and doc_status == "published"
and ARRAY_CONTAINS_ANY(access_principals, [
  "user:u123",
  "group:g1",
  "workspace:w1:member",
  "kb:kb1:viewer"
])
```

这只是预过滤。最终必须回 PostgreSQL 调 Permission Service。

## 8. Rebuild 和 alias switch

Embedding 模型更换流程：

```text
1. 管理员在部署环境更新 `OPENKB_EMBEDDING_*` / `OPENKB_RERANK_*`。
2. 管理员在 OpenKB 后台创建 rebuild job。
3. OpenKB 创建新 Milvus collection。
4. collection schema 定义 BM25 Function；如启用 embedding，则包含普通 `dense_vector` 字段。
5. OpenKB 从 PostgreSQL 读取当前有效 chunks。
6. index-worker 调用 embedding endpoint 生成 dense vector。
7. OpenKB 写入 raw text、metadata、access_principals、dense_vector。
8. OpenKB load collection 并执行 sample search。
9. OpenKB 切换 alias openkb_chunks_active -> new collection。
10. 旧 collection 保留 rollback window。
11. 稳定后 admin 可清理旧 collection。
```

禁止：

- 在同一 active collection 混合新旧 embedding 模型向量。
- 让知识库 owner 单独切换模型。
- 让 OpenKB 保存 embedding/rerank provider API key。
- 为了兼容某模型在 OpenKB DB 中临时保存 embedding/rerank key。

## 9. Retrieval Service

输入：

```ts
type RetrievalInput = {
  query: string;
  authContext: AuthContext;
  knowledgeBaseIds?: string[];
  topK: number;
  filters?: Record<string, unknown>;
};
```

输出：

```ts
type RetrievalResult = {
  documentId: string;
  chunkId: string;
  title: string;
  path: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};
```

流程：

```text
resolve caller identity
  -> resolve readable principals
  -> resolve retrieval mode
  -> embed query if dense/hybrid is active
  -> Milvus search active alias with filters
  -> PostgreSQL final permission check
  -> rerank authorized candidates if rerank mode is active
  -> trim/top_k
  -> return
```

## 10. Admin UI

后台页面：

```text
/app/admin/retrieval
  - 当前检索模式
  - embedding/rerank 是否配置
  - 模型名和 vector dim
  - active alias / active collection
  - dense index 是否需要重建
  - 模型 probe
  - 创建 rebuild job
```

不提供知识库级模型配置页面。

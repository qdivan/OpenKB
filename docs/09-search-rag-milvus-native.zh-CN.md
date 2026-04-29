# 09 — Milvus 原生检索、Function 和索引重建

## 1. 最高原则

```text
Milvus 是检索索引，不是业务数据库，也不是最终权限系统。
PostgreSQL 是文档、chunk 和权限真相。
Embedding / BM25 / rerank 优先使用 Milvus Server 2.6+ 原生 Function 能力。
OpenKB v0.x 不保存 embedding/rerank provider API key。
```

如果当前 Milvus/provider 暂时不兼容某个模型，v0.x 不在 OpenKB 内实现“旁路模型配置中心”来保存 embedding/rerank key。应在部署层更换为 Milvus 支持的 provider、TEI endpoint、vLLM ranker endpoint，或等待新的项目决策文档显式改变该规则。

## 2. OpenKB 管理什么

OpenKB 只管理：

```text
Milvus URI/token/database
active alias
collection/index status
rebuild job
alias switch
health check
```

OpenKB 不管理：

```text
embedding provider API key
rerank provider API key
知识库级模型配置
知识库级向量维度配置
```

## 3. Embedding Function

目标链路：

```text
OpenKB writes raw chunk text + metadata to Milvus
  -> Milvus TEXTEMBEDDING Function calls provider service
  -> Milvus stores dense_vector
```

查询链路：

```text
OpenKB sends query text
  -> Milvus uses same TEXTEMBEDDING Function to embed query
  -> vector search
```

适配 Qwen3 Embedding 的推荐部署：

```text
Qwen3-Embedding service via TEI / compatible provider
Milvus TEXTEMBEDDING Function references that provider/endpoint
OpenKB only calls Milvus
```

## 4. BM25 / Sparse Search

知识库检索必须支持关键词能力。Milvus collection 中应包含：

```text
content_text: VARCHAR
sparse_vector: SPARSE_FLOAT_VECTOR 或 Milvus BM25 Function 输出字段
```

检索时优先使用：

```text
dense search + BM25/sparse search + hybrid fusion/ranker
```

## 5. Rerank Function

Rerank 优先放在 Milvus search-time Function 中。

推荐方式：

```text
Qwen3-Reranker service via vLLM/TEI-compatible ranker
Milvus RERANK / Model Ranker Function references endpoint
OpenKB receives reranked results from Milvus
```

限制：

- rerank 使用的字段必须是文本字段。
- rerank 失败时可以降级为未 rerank 的 hybrid 结果，但必须记录日志。
- rerank 不能绕过最终权限检查。
- OpenKB 不保存 rerank API key。

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
dense_vector: FLOAT_VECTOR(dim = current embedding dim)
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
1. 管理员在 Milvus/模型服务部署层更新 provider、endpoint、credential。
2. 管理员在 OpenKB 后台创建 rebuild job。
3. OpenKB 创建新 Milvus collection。
4. collection schema 定义新的 TEXTEMBEDDING/BM25/RERANK functions。
5. OpenKB 从 PostgreSQL 读取当前有效 chunks。
6. OpenKB 写入 raw text、metadata、access_principals。
7. Milvus 生成 embedding 并建立索引。
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
  -> Milvus search active alias with filters
  -> PostgreSQL final permission check
  -> trim/top_k
  -> return
```

## 10. Admin UI

后台页面：

```text
系统设置 / Milvus 与索引
  - Milvus 连接状态
  - active alias
  - 当前 collection
  - vector dim
  - embedding function 名称
  - BM25 function 状态
  - rerank function 状态
  - 索引文档数/chunk 数
  - 触发全量重建
  - rebuild job 日志
  - alias 切换记录
```

不提供知识库级模型配置页面。

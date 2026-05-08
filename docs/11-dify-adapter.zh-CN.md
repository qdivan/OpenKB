# 11 - Dify External Knowledge Adapter

## 1. 原则

Dify 是应用级检索出口，使用 scoped API key；MCP 是用户级出口，使用真实用户权限。两者不能混用，Dify key 不能伪装成管理员或任意用户。

硬规则：

- API key 只存 SHA-256 hash，不保存明文。
- API key 必须绑定 `tenant_id` 和 `allowed_knowledge_base_ids`。
- `knowledge_id` 必须通过 `dify_knowledge_mappings` 映射到内部 `knowledge_base_id`。
- 映射成功后，还必须确认内部 KB 在当前 key 的 allow list 中。
- PostgreSQL final scope check 是最终真相；Milvus 只做候选检索。
- 不新增知识库级模型配置，不保存明文 embedding/rerank provider key；如需模型 secret，只能复用 system-admin 实例级加密配置。

## 2. Endpoint

```http
POST /retrieval
Authorization: Bearer <api_key>
Content-Type: application/json
```

请求：

```json
{
  "knowledge_id": "openkb-demo",
  "query": "怎么配置 MCP？",
  "retrieval_setting": {
    "top_k": 5,
    "score_threshold": 0.5
  },
  "metadata_condition": {
    "logical_operator": "and",
    "conditions": []
  }
}
```

响应：

```json
{
  "records": [
    {
      "content": "...",
      "score": 0.87,
      "title": "MCP 接入说明",
      "metadata": {
        "document_id": "doc_1",
        "chunk_id": "chunk_1",
        "knowledge_base_id": "kb_1",
        "context_mode": "parent_child",
        "match_chunk_id": "chunk_1",
        "parent_chunk_id": "parent_chunk_1",
        "path": "/OpenKB Demo/Getting Started/MCP 接入说明",
        "url": "https://kb.example.com/app/kb/kb_1/docs/doc_1",
        "raw_score": 1.42,
        "rerank_score": 0.87,
        "rerank_failed": false
      }
    }
  ]
}
```

`metadata` 必须是 object，不能是 `null`。`score` 返回给 Dify 前 clamp 到 `[0, 1]`，原始分数放入 `metadata.raw_score`。启用父子或全文上下文时，`content` 返回父块/全文安全截断内容，`metadata.match_chunk_id` 保留实际命中的 child/general chunk。

## 3. API Key 范围

`dify_api_keys` 字段语义：

```text
tenant_id
allowed_knowledge_base_ids
allowed_metadata_filters
retrieval_top_k_limit
status
expires_at
last_used_at
```

`top_k` 使用以下上限：

```text
min(request.retrieval_setting.top_k, key.retrieval_top_k_limit, DIFY_MAX_TOP_K)
```

默认 `DIFY_MAX_TOP_K=20`。Dify key 可以显式授权 private KB；未授权 KB 不得返回任何候选。

## 4. Retrieval 流程

```text
validate bearer api key
  -> resolve active knowledge_id mapping
  -> check key allowed_knowledge_base_ids
  -> RetrievalService bm25/dense/hybrid search
  -> PostgreSQL final scope check
  -> rerank authorized candidates if active
  -> parent/full-text context expansion inside scoped KB
  -> metadata_condition post-filter
  -> return Dify records
```

Milvus 预过滤只包含 tenant、current、published、allowed KB 和 metadata filter。Dify app-scoped 检索不使用用户 `access_principals`，也不能扩大到全租户。

## 5. metadata_condition

支持 Dify 官方 operators：

```text
contains
not contains
start with
end with
is
is not
in
not in
empty
not empty
=
≠
>
<
≥
≤
before
after
```

当前实现采用 adapter 侧 post-filter；字段从 chunk metadata 中读取，支持 dotted path。未知 operator 或非法结构返回 Dify 兼容错误。

## 6. 错误格式

错误响应使用非 200 HTTP 状态和 Dify 兼容 body：

```json
{
  "error_code": 1002,
  "error_msg": "Dify API key is invalid or expired."
}
```

稳定错误码：

```text
1001 missing bearer token
1002 invalid / expired / revoked API key
2001 knowledge_id mapping missing or inactive
2002 mapped KB is outside current key scope
3001 search index not ready
4001 invalid request
5001 internal error
```

错误和审计日志都不能包含 raw API key。

## 7. Key 创建

本地/测试可用 CLI 创建一次性显示的 Dify API key：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:DIFY_KEY_CREATED_BY_EMAIL="admin@openkb.local"
$env:DIFY_API_KEY_NAME="Local Dify Key"
$env:DIFY_KNOWLEDGE_ID="openkb-demo"
$env:DIFY_KNOWLEDGE_BASE_ID="<internal knowledge_base_id>"
pnpm dify:key:create
```

相关 env：

```text
DIFY_API_KEY_PREFIX=dify_
DIFY_API_KEY_NAME
DIFY_KEY_CREATED_BY_EMAIL
DIFY_KNOWLEDGE_ID
DIFY_KNOWLEDGE_BASE_ID
DIFY_TOP_K_LIMIT
DIFY_KEY_EXPIRES_DAYS
DIFY_MAX_TOP_K
DIFY_RESULT_BASE_URL
```

## 8. 审计

每次 `/retrieval` 写入 `audit_logs`：

```text
actor_type = api_key
action = dify.retrieval
object_type = knowledge_base
object_id = mapped internal knowledge_base_id
```

`metadata` 记录 `api_key_type=dify`、key id、Dify knowledge id、top_k、score_threshold、metadata_condition、返回的 document/chunk id，不记录 raw API key。这里使用 `api_key` 是为了遵守 `audit_logs.actor_type` 的既有 CHECK 约束，不为 Phase 10 新增 migration。

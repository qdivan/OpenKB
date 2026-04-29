# 11 — Dify External Knowledge Adapter

## 1. 原则

```text
Dify 是应用级检索出口。
Dify 使用 scoped API key。
Dify 不等于用户级权限。
```

MCP 绑定用户权限，Dify 绑定 API key 范围。这两者不能混淆。

## 2. Endpoint

```http
POST /retrieval
Authorization: Bearer <api_key>
Content-Type: application/json
```

请求：

```json
{
  "knowledge_id": "kb_xxx",
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
        "path": "/AI/MCP",
        "url": "https://kb.example.com/docs/doc_1"
      }
    }
  ]
}
```

`metadata` 必须是 object，不能是 null。

## 3. API key 范围

Dify API key 绑定：

```text
tenant_id
allowed_knowledge_base_ids
allowed_metadata_filters
retrieval_top_k_limit
status
expires_at
```

Dify 不通过用户个人权限，而是通过 API key scope 限定知识库范围。

## 4. 权限

Dify 检索流程：

```text
validate api key
  -> check knowledge_id allowed
  -> build app auth context
  -> Retrieval Service
  -> final scope check
  -> return records
```

不能因为 API key 存在就访问全租户知识库。

## 5. 持久化表

Dify scoped API key 和 knowledge_id 映射表在 `docs/07-data-model.zh-CN.md` 中定义：

```text
dify_api_keys
dify_knowledge_mappings
```

实现要求：

- API key 只保存 hash，不保存明文。
- `knowledge_id` 必须通过 `dify_knowledge_mappings` 映射到内部 knowledge_base_id。
- 映射成功后，还必须检查当前 API key 的 `allowed_knowledge_base_ids`。
- API key 不能访问全租户知识库，除非其 scope 明确列出对应知识库。

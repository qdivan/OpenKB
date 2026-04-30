# 03 — 系统架构

## 架构原则

```text
PostgreSQL：内容、版本、目录、用户、权限、审计的真相。
Milvus：chunk 检索索引，不是业务数据库，不是最终权限系统。
Milkdown：Markdown 编辑器能力边界。
MCP：用户级权限出口。
Dify：应用级 scoped API key 出口。
```

## 总体架构

```text
Browser / Web App
  -> API Server
       -> PostgreSQL
       -> Redis
       -> MinIO/S3
       -> Permission Service
       -> Retrieval Service
            -> Milvus active alias

Workers
  -> Import Worker: 文件转 Markdown
  -> Index Worker: chunk + metadata + access principals 写入 Milvus

Integrations
  -> MCP Server: user-bound tools/resources
  -> Dify Adapter: app-key-bound /retrieval
```

## 推荐服务

```text
apps/web           Next.js + Milkdown
apps/api           NestJS/Fastify API
apps/mcp-server    MCP Streamable HTTP server
apps/dify-adapter  Dify External Knowledge endpoint
workers/import-worker
workers/index-worker
packages/permissions
packages/editor
packages/milvus
packages/retrieval
packages/db
```

## 关键链路

### 文档保存

```text
Milkdown editor
  -> Markdown serialize
  -> API version conflict check
  -> document_versions insert
  -> documents.current_version_id update
  -> enqueue indexing job
```

### 检索

```text
caller identity
  -> permission principals
  -> resolve bm25/dense/hybrid mode
  -> Milvus search with metadata/access_principals pre-filter
  -> PostgreSQL final permission check
  -> rerank authorized candidates if enabled
  -> return authorized chunks/documents
```

### Embedding 模型更换

```text
admin updates OPENKB_EMBEDDING_* deployment env
  -> create new Milvus collection with matching schema
  -> rebuild chunks into new collection
  -> health check
  -> switch alias
  -> retain old collection for rollback
```

## 部署模式

- 单机开发：Docker Compose。
- 私有化生产：Docker Compose 或 K8s standalone Milvus。
- 企业规模：K8s + Milvus cluster + external PostgreSQL/S3/Redis。

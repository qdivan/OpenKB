# 13 — 部署

## 1. Docker Compose

服务：

```text
web
api
mcp-server
dify-adapter
import-worker
index-worker
postgres
redis
minio-assets
milvus-standalone
milvus-etcd
milvus-minio
qwen-embedding-tei optional
qwen-reranker-vllm optional
mineru-worker optional
```

注意：OpenKB 自己的 MinIO 和 Milvus 内部对象存储可以分开，生产建议分开。

本地开发默认是 CPU-only。没有 NVIDIA GPU / `nvidia-smi` 的机器不要启用 TEXTEMBEDDING、RERANK、MinerU GPU worker、Qwen Embedding TEI 或 Qwen Reranker vLLM。OpenKB 的默认测试脚本只启动 Postgres、MinIO、Milvus BM25/text-only 等基础依赖，不默认启动高显存模型服务。

## 2. Milvus 配置

Milvus/provider 凭证放在：

```text
milvus.yaml
Docker Compose env
K8s Secret + Helm values
provider service env
```

OpenKB 数据库不保存 embedding/rerank API key。

## 3. Helm

Helm values 需要支持：

```yaml
postgres:
  external: false
redis:
  external: false
s3:
  external: false
milvus:
  mode: standalone # standalone | cluster | external
  external:
    uri: ""
    tokenSecret: ""
mcp:
  enabled: true
difyAdapter:
  enabled: true
```

## 4. 环境变量

OpenKB：

```text
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY
S3_SECRET_KEY
MILVUS_URI
MILVUS_TOKEN
MILVUS_DATABASE
MILVUS_ACTIVE_ALIAS=openkb_chunks_active
SMTP_HOST
SMTP_USER
SMTP_PASSWORD
APP_BASE_URL
```

Milvus/provider：由 Milvus 部署文档决定，不写入 OpenKB DB。

## 5. 本地测试资源边界

轻量内容测试：

```text
pnpm content:test
```

只启动 PostgreSQL，不应连接 Milvus 或任何 GPU/模型服务。

检索/MCP 测试：

```text
pnpm retrieval:test
pnpm mcp:test
```

会启动 PostgreSQL + Milvus standalone，默认仍是 BM25/text-only。Qwen Embedding、Reranker、MinerU 属可选外部服务，必须由部署层显式启用，并配置显存预算、并发限制和回退策略。OpenKB 不保存 embedding/rerank provider API key。

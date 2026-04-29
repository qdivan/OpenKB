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

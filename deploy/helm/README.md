# Helm

Phase 11 adds the minimal OpenKB chart at:

```text
deploy/helm/openkb
```

The chart deploys:

```text
web
api
mcp-server
dify-adapter
import-worker
index-worker
```

It can also deploy built-in development/self-hosted dependencies:

```text
postgres
redis
minio-assets
milvus-standalone
milvus-etcd
milvus-minio
```

## Static Checks

```bash
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values deploy/helm/openkb/values.yaml
```

## External Dependencies

For production clusters, prefer managed/external dependencies where appropriate:

```yaml
postgres:
  external: true
  host: postgres.example.internal
  port: 5432
  database: openkb
  username: openkb
redis:
  external: true
  host: redis.example.internal
  port: 6379
s3:
  external: true
  endpoint: https://s3.example.com
  bucket: openkb-assets
milvus:
  mode: external
  uri: milvus.example.internal:19530
models:
  embedding:
    requestFormat: openai_compatible
    endpoint: http://embedding.internal/v1/embeddings
    model: qwen3-vl-embedding-2b
  rerank:
    requestFormat: openai_compatible
    endpoint: http://rerank.internal/v1/rerank
    model: qwen3-vl-reranker-2b
```

Set `secrets.existingSecret` when an operator wants to manage secrets outside this chart. The Secret must include the application keys used by OpenKB:

```text
DATABASE_URL
ADMIN_PASSWORD
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
POSTGRES_PASSWORD
MILVUS_TOKEN
MILVUS_MINIO_ACCESS_KEY_ID
MILVUS_MINIO_SECRET_ACCESS_KEY
```

If `secrets.existingSecret` is empty, the chart creates a basic Secret from `values.yaml`.

## CPU-only Defaults

Default values keep OpenKB CPU-only:

```yaml
milvus:
  enableBm25: "true"
  enableTextEmbedding: "false"
  enableRerank: "false"
optionalModels:
  qwenEmbeddingTei:
    enabled: false
  qwenRerankerVllm:
    enabled: false
  mineruGpuWorker:
    enabled: false
```

Optional model services are placeholders for explicit operator overlays. The chart must not contain embedding/rerank provider API keys, and OpenKB must not save those credentials in its database.

When `models.embedding.endpoint` and `models.embedding.model` are empty, OpenKB uses BM25 even if `retrieval.defaultMode` is `hybrid`. Native providers such as DashScope must set the matching `models.embedding.requestFormat` and `models.rerank.requestFormat`; endpoint and model alone are not enough when the payload shape is not OpenAI-compatible. After enabling model endpoints, rebuild the Milvus index and switch mode in `/app/admin/retrieval`.

## Migrations

Run migrations explicitly using the OpenKB image and the chart Secret/ConfigMap. The chart does not run migrations implicitly in long-running Deployments.

Example pattern:

```bash
kubectl run openkb-migrate --rm -it --restart=Never \
  --image=openkb:phase-29 \
  --env-from=configmap/openkb-config \
  --env-from=secret/openkb-secret \
  -- pnpm db:migrate
```

Use the actual release fullname if it differs from `openkb`.

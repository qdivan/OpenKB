# 13 — 部署

Phase 11 已完成最小可部署闭环：生产/自托管 Docker Compose、Helm 最小 chart、环境变量整理、健康检查和公网测试安全基线。Phase 12 已在代码中接入真实 embedding、rerank 和 hybrid retrieval。Phase 13 已加入知识库 Dashboard、父子切片、全文上下文、检索测试台和发布闭环。

部署层只负责配置、启动、健康检查和依赖编排；不新增知识库级模型配置，不在 OpenKB DB 中保存 embedding/rerank provider API key。

## 1. Docker Compose

生产/自托管 compose 文件：

```text
deploy/docker-compose/compose.yml
```

覆盖服务：

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
```

默认端口：

```text
web: 3000
api: 4000
mcp-server: 4100
dify-adapter: 4200
postgres: 5432
redis: 6379
minio-assets: 9000 / 9001
milvus-standalone: 19530 / 9091
```

启动顺序：

```bash
docker compose -f deploy/docker-compose/compose.yml build
docker compose -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
```

迁移和 seed 是显式一次性命令，不由长期运行服务隐式执行。`seed-dev` 创建开发账号：

```text
admin@openkb.local / OpenKB-dev-123456
```

健康检查：

```bash
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4200/health
```

Redis 是 Phase 11 部署基线依赖，但当前 import/index workers 仍使用 PostgreSQL 轮询 `import_jobs` 和 `index_rebuild_jobs`；BullMQ 队列接入不属于 Phase 11。

## 2. CPU-only 默认与模型开关

本地和自托管默认是 CPU-only，且不配置模型 endpoint 时自动使用 BM25：

```text
MILVUS_ENABLE_BM25=true
MILVUS_ENABLE_TEXT_EMBEDDING=false
MILVUS_ENABLE_RERANK=false
OPENKB_RETRIEVAL_DEFAULT_MODE=hybrid
OPENKB_EMBEDDING_ENDPOINT=
OPENKB_RERANK_ENDPOINT=
```

`OPENKB_RETRIEVAL_DEFAULT_MODE=hybrid` 只有在 embedding endpoint 配置且 active index 已重建后才会生效；否则自动回退到 `bm25`。

如果启用直连模型服务，至少配置：

```text
OPENKB_EMBEDDING_ENDPOINT
OPENKB_EMBEDDING_MODEL
OPENKB_EMBEDDING_DIM=2048
OPENKB_RERANK_ENDPOINT
OPENKB_RERANK_MODEL
```

没有 NVIDIA GPU / `nvidia-smi` 的机器不要在同机启动 MinerU GPU worker、Qwen Embedding TEI 或 Qwen Reranker vLLM。模型服务可以部署在独立机器或内网模型平台上。

可选模型服务只能通过显式 compose profile、Helm values overlay 或外部部署启用。默认部署不启动高显存模型服务。

## 3. Milvus 配置

Milvus/token 和模型服务凭证放在部署层：

```text
Docker Compose env
K8s Secret + Helm values
provider service env
```

OpenKB 数据库不保存 embedding/rerank API key。

OpenKB 只从环境变量读取 endpoint/model；`retrieval_settings` 只保存当前模式：

```text
bm25
dense
dense_rerank
hybrid
hybrid_rerank
```

默认 compose 使用 Milvus standalone + etcd + 独立 `milvus-minio`，与 OpenKB 附件用的 `minio-assets` 分开。

Embedding 模型更换仍遵循：

```text
新 collection -> rebuild PostgreSQL chunks -> health check -> alias switch -> rollback window
```

禁止在 active collection 混写不同 embedding 模型或维度的向量。

## 4. Helm

最小 chart：

```text
deploy/helm/openkb
```

静态检查：

```bash
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values deploy/helm/openkb/values.yaml
```

核心 values：

```yaml
image:
  repository: openkb
  tag: phase-11
web:
  enabled: true
api:
  enabled: true
mcp:
  enabled: true
difyAdapter:
  enabled: true
workers:
  import:
    enabled: true
  index:
    enabled: true
postgres:
  enabled: true
  external: false
redis:
  enabled: true
  external: false
s3:
  external: false
milvus:
  mode: standalone # standalone | external
secrets:
  existingSecret: ""
```

如果使用 external dependencies：

- `postgres.external=true` 时设置 `postgres.host`、`postgres.port`、`postgres.database`、`postgres.username`，或直接设置 `postgres.databaseUrl`。
- `redis.external=true` 时设置 `redis.host` 和 `redis.port`。
- `s3.external=true` 时设置 `s3.endpoint`、`s3.bucket`、`s3.region`。
- `milvus.mode=external` 时设置 `milvus.uri`、`milvus.database`，token 通过 Secret 提供。

敏感配置通过 Secret 提供：

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

如果设置 `secrets.existingSecret`，该 Secret 必须包含上述应用实际需要的 key。

## 5. 环境变量

OpenKB 应用读取：

```text
DATABASE_URL
REDIS_URL
APP_BASE_URL
WEB_BASE_URL
NEXT_PUBLIC_API_BASE_URL
CORS_ORIGINS
OPENKB_ALLOW_LOCAL_CORS
AUTH_COOKIE_SECURE
TRUST_PROXY_HEADERS
API_RATE_LIMIT_MAX
API_RATE_LIMIT_WINDOW_SECONDS
AUTH_RATE_LIMIT_MAX
AUTH_RATE_LIMIT_WINDOW_SECONDS
UPLOAD_MAX_BYTES
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
MILVUS_URI
MILVUS_TOKEN
MILVUS_DATABASE
MILVUS_ACTIVE_ALIAS
MILVUS_COLLECTION_PREFIX
MILVUS_ENABLE_BM25
MILVUS_ENABLE_TEXT_EMBEDDING
MILVUS_ENABLE_RERANK
MILVUS_VECTOR_DIM
OPENKB_RETRIEVAL_DEFAULT_MODE
OPENKB_EMBEDDING_ENDPOINT
OPENKB_EMBEDDING_MODEL
OPENKB_EMBEDDING_DIM
OPENKB_EMBEDDING_BATCH_SIZE
OPENKB_EMBEDDING_TIMEOUT_MS
OPENKB_RERANK_ENDPOINT
OPENKB_RERANK_MODEL
OPENKB_RERANK_TIMEOUT_MS
MCP_SERVER_BASE_URL
DIFY_REQUEST_MAX_BYTES
DIFY_RESULT_BASE_URL
```

Compose 构建还支持 `OPENKB_NODE_IMAGE` 覆盖 Node.js base image，例如在镜像源受限环境使用内部 registry mirror。

`AUTH_COOKIE_SECURE` 默认为 `auto`：当 `WEB_BASE_URL`/`APP_BASE_URL` 是
HTTPS 时自动写入 `Secure` cookie，本地 `http://localhost` compose 不写入
`Secure`，避免登录后浏览器不回传 session cookie。

公网测试平台还必须使用 `OPENKB_ALLOW_LOCAL_CORS=false`、精确 HTTPS
`CORS_ORIGINS`、`AUTH_COOKIE_SECURE=true` 和反向代理/Ingress TLS；完整清单见
`docs/24-public-test-platform-deployment.zh-CN.md`。

注意：当前 Web 使用 Next.js production build，`NEXT_PUBLIC_API_BASE_URL` 是构建期公开变量。Docker Compose build 已把该值作为 build arg 传入；如果生产 API public URL 不同，应使用目标 URL 重新构建 Web 镜像。

## 6. 验证范围

部署闭环验证：

```bash
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
docker compose -f deploy/docker-compose/compose.yml build
docker compose -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values deploy/helm/openkb/values.yaml
```

功能链路验证：

```text
登录
知识库 Dashboard Overview/Chunks/Retrieval Lab/Settings
上传/导入
import worker 转 Markdown
发布文档
可选：修改 chunk settings 并触发 chunk rebuild
触发 index rebuild
搜索
MCP PAT + kb.search
Dify scoped key + /retrieval
```

启用真实模型后，还需要验证：

```text
/app/admin/retrieval probe embedding/rerank
创建 rebuild job
index-worker 写入 dense_vector
bm25
dense
dense_rerank
hybrid
hybrid_rerank
rerank 服务停止时搜索降级返回，并在 metadata 标记 rerank_failed
```

公网测试平台部署前，部署人员必须向项目负责人确认域名、TLS、管理员账号、数据库、S3、Milvus、模型 endpoint/model、Dify/MCP 是否开放公网、上传策略、备份和日志保留。完整清单见 `docs/24-public-test-platform-deployment.zh-CN.md`。

## 7. Phase 11 之后

以下不属于 Phase 11：

- 生产 SMTP 发送、重试和模板管理。
- MCP 完整 OAuth 授权码、同意页、refresh/revoke。
- MCP PAT 和 Dify API key Web 管理页。
- Office/PDF/OCR/MinerU 全量复杂转换。
- 实时协同。
- 生产级完整 Admin UI。
- 监控、日志聚合、备份恢复、升级/回滚演练。
- 当前文档切片侧栏、全局搜索更完整的命中解释和发布后索引引导。

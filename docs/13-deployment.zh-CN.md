# 13 — 部署

本文是当前 OpenKB `v0.3.x / Phase 25` 的部署说明。它覆盖 Docker Compose、Helm、环境变量、健康检查和升级验收。历史阶段说明请看 `docs/15-roadmap-and-codex-tasks.zh-CN.md`，不要再把 Phase 11 的最小部署闭环当作当前状态。

## 1. 组件

默认部署包含：

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

本地源码开发推荐端口仍是 Web `3100`、API `4101`，见 `docs/25-local-quickstart.zh-CN.md`。

## 2. Docker Compose

Compose 文件：

```text
deploy/docker-compose/compose.yml
```

启动顺序：

```bash
docker compose --env-file .env -f deploy/docker-compose/compose.yml build
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm migrate
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d
```

`migrate` 和 `seed-dev` 是显式一次性命令，不由长期运行服务隐式执行。`seed-dev` 只用于本地开发：

```text
admin@openkb.local / OpenKB-dev-123456
```

健康检查：

```bash
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4200/health
```

`/health.phase` 只是展示当前构建标识，不能作为升级验收的唯一依据。

## 3. Phase 25 升级验收

部署验收应同时确认镜像 tag/commit、数据库迁移、表结构和关键接口：

- `_prisma_migrations` 已完成 `0014_account_setup_admin_visibility`、`0015_dify_knowledge_alignment`、`0016_qa_summary_generation`、`0017_dashscope_model_provider`、`0018_asset_bindings`、`0019_qa_mock_source`。
- 表结构包含 `document_qa_pairs`、`document_segment_summaries`、`document_summaries`、`document_asset_bindings`，以及 `document_chunks.index_role`、`document_chunks.source_chunk_id` 和 asset-derived chunk roles。
- 关键接口可用：KB chunk settings、document processing、document reprocess、segment management、QA、summaries、search、Dify `/retrieval`、asset/image hit metadata。
- Docker Compose/Helm 已透传 Phase 20-25 的 SMTP、CSRF、MCP OAuth、模型、导入工具、metrics、backup、embedding/rerank request format 和 image-vector 环境变量。
- Dify parity 修复以 `docs/30-dify-parity-v2-analysis.zh-CN.md` 为基线；旧 chunks 不自动迁移，显式 reprocess 后才使用 Dify 1.14.1-compatible splitter；QA、metadata/tags、segment 生命周期和图片/附件回源也按该基线验收。
- 升级旧数据后，管理员需要显式 reprocess 目标文档，再执行 Milvus blue-green index rebuild；迁移不会自动重写派生 chunks、QA、summary 或 asset binding。

## 4. 模型与检索配置

默认部署是 CPU-only BM25。dense、hybrid、rerank 只有在配置模型并完成 Milvus blue-green index rebuild 后才启用。

核心变量：

```text
MILVUS_ENABLE_BM25=true
MILVUS_ENABLE_TEXT_EMBEDDING=false
MILVUS_ENABLE_RERANK=false
OPENKB_RETRIEVAL_DEFAULT_MODE=hybrid
OPENKB_EMBEDDING_REQUEST_FORMAT=openai_compatible | dashscope
OPENKB_EMBEDDING_ENDPOINT
OPENKB_EMBEDDING_MODEL
OPENKB_EMBEDDING_DIM
OPENKB_EMBEDDING_API_KEY
OPENKB_RERANK_REQUEST_FORMAT=openai_compatible | dashscope
OPENKB_RERANK_ENDPOINT
OPENKB_RERANK_MODEL
OPENKB_RERANK_API_KEY
OPENKB_LLM_REQUEST_FORMAT
OPENKB_LLM_ENDPOINT
OPENKB_LLM_MODEL
OPENKB_LLM_API_KEY
OPENKB_CONFIG_ENCRYPTION_KEY
```

模型 secret 只能由 `system_admin` 以实例级加密配置保存，或通过环境变量提供。禁止知识库级模型配置，禁止明文写入仓库、日志或 audit。

Embedding 模型或维度变更必须走 Milvus blue-green rebuild：

```text
new collection -> rebuild from PostgreSQL chunks -> health check -> alias switch -> rollback window
```

不要在同一个 active collection 混写不同 embedding 模型或不同维度的向量。

## 5. Helm

Chart：

```text
deploy/helm/openkb
```

检查：

```bash
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values deploy/helm/openkb/values.yaml
```

敏感配置通过 Kubernetes Secret 提供。推荐使用 `secrets.existingSecret`，不要把真实密码、PAT、Dify key、SMTP password、模型 key 或 OAuth signing secret 写进 values 文件。

## 6. 生产安全基线

公网或准生产环境必须满足：

- HTTPS、HSTS、反向代理或 Ingress TLS。
- `AUTH_COOKIE_SECURE=true`。
- `OPENKB_ALLOW_LOCAL_CORS=false`。
- 精确配置 `CORS_ORIGINS`。
- Cookie-auth mutation 使用 CSRF double-submit；Bearer 型 Dify/MCP 接入走独立鉴权。
- PostgreSQL、Redis、MinIO Console、Milvus、etcd 不暴露公网。
- SMTP、模型、导入工具、OAuth 等 secret 只来自 `.env`、Secret 或实例级加密 DB 配置。
- 日志脱敏 `Authorization`、`Cookie`、`Set-Cookie`、password、token、api key。

## 7. 功能链路验证

基础验证：

```bash
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
docker compose --env-file .env -f deploy/docker-compose/compose.yml config
```

应用链路：

```text
登录
创建/查看 workspace 与 knowledge base
创建文档、编辑、发布
显式 document reprocess
KB Settings：处理模式、分块规则、检索策略、metadata、摘要、重处理
Admin Indexing：创建 Milvus index rebuild job
Web Search / Retrieval Lab
MCP OAuth 或 PAT + kb.search
Dify scoped key + /retrieval
导入工具路由和 import worker
SMTP test send 与 outbox retry
```

注意：发布文档、reprocess PostgreSQL segments、Milvus index rebuild 是三件不同的事。发布不自动触发 Milvus 增量 upsert；搜索索引更新仍通过显式 rebuild 完成。

## 8. 参考文档

- 本地快速开始：`docs/25-local-quickstart.zh-CN.md`
- 公网测试平台：`docs/24-public-test-platform-deployment.zh-CN.md`
- Dify External Knowledge：`docs/26-dify-external-knowledge-setup.zh-CN.md`
- Dify 兼容性基线：`docs/27-dify-knowledge-alignment.zh-CN.md`
- Dify parity v2：`docs/30-dify-parity-v2-analysis.zh-CN.md`

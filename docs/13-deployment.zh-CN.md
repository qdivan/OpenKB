# 13 - 部署说明

本文是当前 OpenKB `v0.3.x / Phase 29` 的部署说明，覆盖 Docker Compose、Helm、环境变量、健康检查和升级验收。

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

源码开发推荐端口仍是 Web `3100`、API `4101`，见 `docs/25-local-quickstart.zh-CN.md`。

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

`migrate` 和 `seed-dev` 是显式一次性命令，不由长期服务隐式执行。`seed-dev` 只用于本地开发：

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

## 3. Phase 31 升级验收

部署验收应同时确认镜像 tag/commit、数据库迁移、表结构和关键接口：

- `_prisma_migrations` 已完成 `0014_account_setup_admin_visibility` 到 `0023_workspace_compatibility`。
- 表结构包含 `workspaces.kind`、`workspaces.personal_owner_user_id`、`workspaces.avatar_color`、`workspaces.avatar_initials`、`document_user_activities`、`dify_hub_connections`、`document_asset_bindings`、`document_chunks.index_role` 和 `document_chunks.source_chunk_id`。
- 关键接口和脚本可用：workspace dashboard、workspace create/update、KB visibility/collaborators、document permission/share links、`workspace:migration-report`、KB chunk settings、document processing、document reprocess、segment management、QA、summaries、search、Dify `/retrieval`、Dify Hub metadata sync。
- Docker Compose/Helm 透传 SMTP、CSRF、MCP OAuth、模型、导入工具、metrics、backup、embedding/rerank request format 和 image-vector 环境变量。
- 升级旧数据后，管理员需要查看空间迁移报告；`Default Workspace / OpenKB Demo` 默认作为团队空间。文档派生数据仍需显式 reprocess，再执行 Milvus blue-green index rebuild；迁移不会自动重写私有权限、派生 chunks、QA、summary 或 asset binding。

## 4. 模型与检索配置

默认部署是 CPU-only BM25。Dense、hybrid、rerank 只有在配置模型并完成 Milvus blue-green index rebuild 后才启用。

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
```

真实 secret 只能写本机 `.env`、平台 secret 或 Admin UI，加密保存需要 `OPENKB_CONFIG_ENCRYPTION_KEY`。

## 5. Helm

默认 values：

```text
deploy/helm/openkb/values.yaml
```

示例：

```bash
helm upgrade --install openkb deploy/helm/openkb \
  --set image.repository=openkb \
  --set image.tag=phase-29
```

生产环境应覆盖数据库、Redis、S3、Milvus、OAuth、SMTP 和模型 secret，不使用本地开发默认值。

# Docker Compose

This directory contains two groups of compose files:

- `compose.yml`: Phase 11 production/self-hosted deployment template.
- `*.test.yml`: lightweight integration-test dependencies used by the legacy PowerShell + WSL scripts.

The production compose path targets native Docker first. The test compose files remain intentionally small and are still used by root scripts such as `pnpm db:test:up`, `pnpm object-storage:test:up`, and `pnpm milvus:test:up`.

## Production Template

Services in `compose.yml`:

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

Default host ports:

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

Start from a native Docker environment:

```bash
docker compose -f deploy/docker-compose/compose.yml build
docker compose -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
```

Health checks:

```bash
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4200/health
```

Login:

```text
admin@openkb.local / OpenKB-dev-123456
```

## Configuration

`compose.yml` reads `.env` or shell variables. Useful overrides:

```text
POSTGRES_PASSWORD
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
APP_BASE_URL
NEXT_PUBLIC_API_BASE_URL
CORS_ORIGINS
OPENKB_ALLOW_LOCAL_CORS
AUTH_COOKIE_SECURE
TRUST_PROXY_HEADERS
API_RATE_LIMIT_MAX
AUTH_RATE_LIMIT_MAX
MCP_SERVER_BASE_URL
DIFY_RESULT_BASE_URL
DIFY_REQUEST_MAX_BYTES
MILVUS_ENABLE_TEXT_EMBEDDING
MILVUS_ENABLE_RERANK
```

`AUTH_COOKIE_SECURE=auto` follows the configured Web base URL: local `http://localhost`
does not mark the session cookie as `Secure`; HTTPS deployments do.

For a public test platform, use `AUTH_COOKIE_SECURE=true`,
`OPENKB_ALLOW_LOCAL_CORS=false`, exact HTTPS `CORS_ORIGINS`, and bind published
ports to `127.0.0.1` behind a TLS reverse proxy. See
`docs/24-public-test-platform-deployment.zh-CN.md`.

The app containers use service-internal URLs for dependencies:

```text
postgres:5432
redis:6379
minio-assets:9000
milvus-standalone:19530
```

Migrations and seed are explicit one-off services under the `init` profile (`migrate` and `seed-dev`). Long-running app services do not run migrations automatically.

## CPU-only Defaults

The default deployment is CPU-only:

```text
MILVUS_ENABLE_BM25=true
MILVUS_ENABLE_TEXT_EMBEDDING=false
MILVUS_ENABLE_RERANK=false
```

Do not enable TEXTEMBEDDING, RERANK, MinerU GPU workers, Qwen Embedding TEI, or Qwen Reranker vLLM on machines without NVIDIA GPU support. Optional model services must be deployed explicitly and are not started by OpenKB compose by default.

OpenKB does not store embedding/rerank provider API keys in its database.

## Redis Note

Redis is included as a Phase 11 deployment baseline service. Current import/index workers still poll PostgreSQL-backed job tables and do not use BullMQ yet.

## Legacy Test Compose

The test compose files keep their previous WSL-oriented behavior:

- `postgres.test.yml` for PostgreSQL.
- `minio.test.yml` for S3-compatible object storage.
- `milvus.test.yml` for Milvus standalone plus its etcd/MinIO dependencies.

OpenKB test scripts only manage OpenKB test compose projects in this directory. They must not stop or prune unrelated Docker containers such as local Dify or SkillHub stacks.

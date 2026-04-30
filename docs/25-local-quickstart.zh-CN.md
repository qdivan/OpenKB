# 25 — 本地快速部署

这份文档只解决一件事：在本机用 Docker Compose 把 OpenKB 跑起来，方便开发、演示和冒烟测试。公网测试平台请看 `docs/24-public-test-platform-deployment.zh-CN.md`，不要把本地默认账号、默认密码和开发 seed 带到公网。

## 1. 准备

需要：

- Docker Desktop 或原生 Docker Engine。
- Docker Compose v2。
- Git。
- 可访问镜像源。国内环境如拉取 Milvus、MinIO 较慢，可以按部署机实际情况配置 Docker registry mirror。

当前默认链路是 CPU-only：Milvus 使用 BM25/text-only，不启动 MinerU GPU 或 Qwen 模型服务。配置外部 embedding endpoint 并重建索引后，可在 Admin 页面切换 dense/hybrid/rerank。

## 2. 启动

在仓库根目录执行：

```bash
docker compose -f deploy/docker-compose/compose.yml build

docker compose -f deploy/docker-compose/compose.yml up -d \
  postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone

docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
```

启动后访问：

```text
Web:  http://localhost:3000
API:  http://localhost:4000/health
MCP:  http://localhost:4100/health
Dify: http://localhost:4200/health
```

本地开发账号：

```text
Email:    admin@openkb.local
Password: OpenKB-dev-123456
```

## 3. 检查服务

```bash
docker compose -f deploy/docker-compose/compose.yml ps
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4200/health
```

Web、API、MCP、Dify、PostgreSQL、Redis、MinIO、Milvus 都应处于 running 或 healthy 状态。

## 4. 常用端口

| 服务 | 默认端口 |
|---|---|
| Web | `3000` |
| API | `4000` |
| MCP Server | `4100` |
| Dify Adapter | `4200` |
| PostgreSQL | `5432` |
| Redis | `6379` |
| MinIO assets | `9000 / 9001` |
| Milvus | `19530 / 9091` |

如果端口被占用，可以在 shell 或 `.env` 中覆盖 `WEB_PORT`、`API_PORT`、`POSTGRES_PORT`、`REDIS_PORT`、`MINIO_PORT`、`MINIO_CONSOLE_PORT`、`MILVUS_PORT`、`MILVUS_HEALTH_PORT`。

示例：

```bash
WEB_PORT=3001 \
API_PORT=4001 \
POSTGRES_PORT=15432 \
docker compose -f deploy/docker-compose/compose.yml up -d
```

## 5. 本地验证路径

推荐按下面顺序走一遍：

1. 登录 `http://localhost:3000`。
2. 打开默认知识库和默认文档，切换 Read / Edit / Source。
3. 导入一个 Markdown 或文本文件。
4. 等 import worker 把任务处理成 succeeded。
5. 触发或等待索引重建，进入搜索页检索导入内容。
6. 如需测试 MCP，创建 PAT 后调用 `http://localhost:4100/mcp`。
7. 如需测试 Dify，创建 scoped key 后调用 `http://localhost:4200/retrieval`。

如需测试真实 embedding/rerank，可在 `.env` 中加入：

```bash
OPENKB_RETRIEVAL_DEFAULT_MODE=hybrid
OPENKB_EMBEDDING_ENDPOINT=http://192.168.6.220:18081/v1/embeddings
OPENKB_EMBEDDING_MODEL=qwen3-vl-embedding-2b
OPENKB_EMBEDDING_DIM=2048
OPENKB_RERANK_ENDPOINT=http://192.168.6.220:18082/v1/rerank
OPENKB_RERANK_MODEL=qwen3-vl-reranker-2b
```

然后重启应用和 index-worker，登录 `/app/admin/retrieval`，执行 probe、创建 rebuild job，等重建完成后再切换 `dense`、`hybrid` 或 rerank 模式。

创建 MCP PAT：

```bash
DATABASE_URL="postgresql://openkb:openkb@localhost:5432/openkb?schema=public" \
MCP_PAT_USER_EMAIL="admin@openkb.local" \
MCP_PAT_NAME="Local MCP PAT" \
pnpm mcp:pat:create
```

创建 Dify key：

```bash
DATABASE_URL="postgresql://openkb:openkb@localhost:5432/openkb?schema=public" \
DIFY_KEY_CREATED_BY_EMAIL="admin@openkb.local" \
DIFY_API_KEY_NAME="Local Dify Key" \
DIFY_KNOWLEDGE_ID="openkb-demo" \
DIFY_KNOWLEDGE_BASE_ID="<internal knowledge_base_id>" \
pnpm dify:key:create
```

## 6. 停止与清理

停止服务：

```bash
docker compose -f deploy/docker-compose/compose.yml down
```

清理数据卷会删除本地数据库、对象存储和 Milvus 数据，只能在确认不需要本地数据后执行：

```bash
docker compose -f deploy/docker-compose/compose.yml down -v
```

## 7. 注意事项

- `seed-dev` 只用于本地；公网测试和生产必须用 `db:seed:first-admin`。
- Redis 已作为部署基线服务提供，但当前 workers 仍通过 PostgreSQL 轮询任务表。
- OpenKB 不保存 embedding/rerank provider key；模型 endpoint/model 只读环境变量，凭据应留在模型服务或部署平台 Secret 中。
- 如果 Web 登录后回到登录页，先检查 `APP_BASE_URL`、`AUTH_COOKIE_SECURE` 和浏览器访问协议是否一致。

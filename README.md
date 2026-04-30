# OpenKB

OpenKB 是一个 Markdown-first、语雀式权限与编辑体验、面向私有化部署的开源知识库系统。它把团队知识库、用户级权限、文件导入、Milvus 检索索引、MCP Server 和 Dify External Knowledge Adapter 放在一套可自托管架构里。

当前仓库处于 v0.3.x / Phase 11：最小部署闭环已经完成，适合本地开发、公网测试平台、私有化试跑和后续产品迭代；还不是完整生产 GA 版本。

## 快速入口

| 入口                                                                                                 | 说明                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| [docs/00-index.zh-CN.md](docs/00-index.zh-CN.md)                                                     | 需求与设计文档索引             |
| [docs/13-deployment.zh-CN.md](docs/13-deployment.zh-CN.md)                                           | Docker Compose / Helm 部署说明 |
| [docs/23-docs-code-gap-analysis.zh-CN.md](docs/23-docs-code-gap-analysis.zh-CN.md)                   | 当前代码与 docs 的差异核对     |
| [docs/24-public-test-platform-deployment.zh-CN.md](docs/24-public-test-platform-deployment.zh-CN.md) | 公网测试平台安全部署文档       |
| [deploy/docker-compose/README.md](deploy/docker-compose/README.md)                                   | 原生 Docker Compose 启动路径   |
| [deploy/helm/README.md](deploy/helm/README.md)                                                       | Helm chart 使用说明            |

## 核心能力

- 语雀式 workspace / knowledge base / folder / document 数据模型。
- 邮箱注册、邮箱验证、登录、登出、密码重置、管理员激活/禁用用户。
- PostgreSQL 权限真相：workspace role 与 content collaborator role 分离，admin 不默认读取私有内容。
- Yuque-like Web 工作台：左侧文档树、中心文档编辑器、右侧 outline。
- Milkdown Markdown 编辑：Read / Edit / Source 模式、自动保存、版本冲突提示、feature registry。
- MinIO/S3 文件上传与导入：当前支持 Markdown / Text / HTML / CSV，复杂 Office/PDF/OCR adapter 留给后续阶段。
- Milvus BM25/text-only 检索索引、blue/green rebuild、alias switch、PostgreSQL final permission check。
- Streamable HTTP MCP Server：user-bound PAT、`kb.*` tools/resources、审计日志。
- Dify External Knowledge Adapter：app-scoped API key、`knowledge_id` mapping、`metadata_condition`、审计日志。
- Phase 11 部署资产：Dockerfile、生产 Compose、Helm 最小 chart、健康检查、CPU-only 默认配置。

## 架构概览

```text
apps/
  web/            Next.js Web 工作台
  api/            NestJS + Fastify API
  mcp-server/     MCP Streamable HTTP Server
  dify-adapter/   Dify External Knowledge Adapter
workers/
  import-worker/  PostgreSQL-backed import polling worker
  index-worker/   Milvus index/rebuild worker
packages/
  auth/ db/ editor/ markdown/ milvus/ permissions/ retrieval/ shared/
deploy/
  docker-compose/ helm/
docs/
```

```text
Browser -> web -> api -> PostgreSQL
                    -> S3/MinIO assets
                    -> import/index job tables

index-worker -> PostgreSQL chunks -> Milvus active alias

MCP client -> mcp-server -> PostgreSQL PermissionService -> retrieval
Dify       -> dify-adapter -> scoped key + KB mapping -> retrieval
```

PostgreSQL 是内容、权限、版本和审计真相；Milvus 只做检索索引。Web、MCP、Dify、附件和搜索结果返回前都必须走 PostgreSQL 最终权限检查。

## Docker 快速启动

本地或测试机需要 Docker / Docker Compose。首次启动：

```bash
docker compose -f deploy/docker-compose/compose.yml build
docker compose -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
```

健康检查：

```bash
curl http://localhost:4000/health
curl http://localhost:4100/health
curl http://localhost:4200/health
```

本地开发账号：

```text
Email:    admin@openkb.local
Password: OpenKB-dev-123456
```

这个账号和 `seed-dev` 只允许本地开发使用。公网测试或生产环境必须使用 `pnpm db:seed:first-admin` 创建负责人确认的一次性强密码管理员，不得提交或复用默认密码。

默认本地端口：

```text
Web:  http://localhost:3000
API:  http://localhost:4000
MCP:  http://localhost:4100/mcp
Dify: http://localhost:4200/retrieval
```

## 公网测试部署

部署到公网前先阅读 [docs/24-public-test-platform-deployment.zh-CN.md](docs/24-public-test-platform-deployment.zh-CN.md)。部署人员需要向项目负责人确认域名、HTTPS/TLS、管理员邮箱和强密码、数据库、Redis、S3/MinIO、Milvus、模型服务地址、Dify 出口 IP、MCP PAT 策略、上传策略、备份与日志保留策略。

公网安全基线：

- 必须使用 HTTPS，`AUTH_COOKIE_SECURE=true`，`OPENKB_ALLOW_LOCAL_CORS=false`，`CORS_ORIGINS` 写精确公网域名。
- Web/API/MCP/Dify 放在反向代理或 Ingress 后；PostgreSQL、Redis、MinIO Console、Milvus、etcd 不得暴露公网。
- 禁止运行 `dev:seed` 或提交默认账号；管理员密码至少 20 位随机，首次登录后更换。
- Dify key 是 app-scoped；MCP PAT 是 user-bound；不要给公网集成发管理员全库 token。
- OpenKB 不保存 embedding/rerank provider key；相关凭据放在 Milvus、模型服务或部署平台 Secret。
- 当前没有生产 SMTP、完整 MCP OAuth、2FA、病毒扫描和 Admin UI，公网测试应限制账号、上传和集成入口。

## Helm

最小 chart 位于 [deploy/helm/openkb](deploy/helm/openkb)：

```bash
helm lint deploy/helm/openkb
helm template openkb deploy/helm/openkb --values deploy/helm/openkb/values.yaml
```

chart 支持内置或外部 PostgreSQL、Redis、S3/MinIO、Milvus。生产或公网测试环境应使用私有 values overlay 与 `secrets.existingSecret`，不要把真实 Secret 提交到 Git。

## 本地开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

需要依赖服务时可使用旧 PowerShell + WSL 测试脚本：

```powershell
pnpm db:test:up
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
pnpm db:migrate
pnpm dev:seed

pnpm content:test
pnpm import:test
pnpm index:test
pnpm retrieval:test
pnpm mcp:test
pnpm dify:test
```

开发服务：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:MILVUS_URI="localhost:59530"
pnpm --filter @openkb/api dev

$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
pnpm --filter @openkb/web exec next dev --port 3001
```

## MCP 与 Dify

创建 MCP PAT：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:MCP_PAT_USER_EMAIL="admin@openkb.local"
$env:MCP_PAT_NAME="Local MCP PAT"
pnpm mcp:pat:create
```

创建 Dify External Knowledge API key：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:DIFY_KEY_CREATED_BY_EMAIL="admin@openkb.local"
$env:DIFY_API_KEY_NAME="Local Dify Key"
$env:DIFY_KNOWLEDGE_ID="openkb-demo"
$env:DIFY_KNOWLEDGE_BASE_ID="<internal knowledge_base_id>"
pnpm dify:key:create
```

## 边界与路线

当前 v0.3.x 已完成 Phase 1-11 的主干资产，但以下能力仍是后续增强：

- 生产 SMTP、公开注册完整邮件闭环、Admin UI。
- Share/Collaborator 面板、邀请审批、分享密码、分享页。
- 完整 MCP OAuth、MCP/Dify key 管理 UI。
- PDF/DOCX/PPTX/XLSX/图片 OCR adapter、MinerU/GPU worker。
- dense/hybrid/rerank 生产链路、模型服务运维面板。
- 实时协同、监控告警、备份恢复、升级回滚流程。

更完整的规则与非目标见 [AGENTS.md](AGENTS.md)、[docs/18-decision-overrides-v0.3.zh-CN.md](docs/18-decision-overrides-v0.3.zh-CN.md) 和 [docs/22-v0.3.3-clarifications.zh-CN.md](docs/22-v0.3.3-clarifications.zh-CN.md)。

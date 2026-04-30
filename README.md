# OpenKB

OpenKB 是一个 Markdown-first、语雀式权限与编辑体验、面向私有化部署的开源知识库系统。项目目标是把团队知识库、用户级权限、文件导入、Milvus 检索索引、MCP Server 和 Dify 第三方知识库适配统一在一套可自托管架构里。

当前代码已推进到 Phase 10：Dify External Knowledge Adapter。仓库仍处于早期开发阶段，适合本地开发、架构验证和后续功能迭代。

## 已实现

- pnpm + Turborepo + TypeScript monorepo
- PostgreSQL 数据模型、Prisma Client、SQL migrations、first admin seed、dev seed
- 邮箱注册、邮箱验证、登录、登出、`me`、密码重置、管理员激活/禁用用户
- 语雀式 workspace / knowledge base / document 权限服务
- Workspace、Knowledge Base、Document、Collaborator、Invitation、Share Link 基础 API
- Next.js Web 登录/注册页面和 `/app` 工作台
- 文档树、Read/Edit/Source 模式、真实 Milkdown 编辑器、自动保存、版本冲突提示
- `@openkb/editor` Feature Registry、Markdown outline/hash/source validation helper
- MinIO/S3 文件上传、Markdown/Text/HTML/CSV 导入、import worker、PostgreSQL chunks
- Milvus schema builder、BM25/text-only collection、blue/green rebuild job、alias switch、index worker
- `@openkb/retrieval`、`POST /api/search`、`/app/search` 站内搜索，返回前执行 PostgreSQL 最终权限检查
- Streamable HTTP MCP Server、user-bound PAT、`kb.*` read/write tools/resources、MCP audit logs
- Dify External Knowledge `/retrieval`、scoped API key、`knowledge_id` mapping、metadata_condition、Dify audit logs

## 目录结构

```text
apps/
  web/            Next.js Web 工作台
  api/            NestJS + Fastify API
  mcp-server/     MCP Server 占位
  dify-adapter/   Dify External Knowledge Adapter
workers/
  import-worker/
  index-worker/
packages/
  auth/
  db/
  editor/
  markdown/
  milvus/
  permissions/
  retrieval/
  shared/
deploy/
  docker-compose/
  helm/
docs/
prompts/
```

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm docs:check
```

宿主机不要求安装 Docker；需要数据库、对象存储或 Milvus 测试时使用 WSL2 Ubuntu 中的 Docker。

```powershell
pnpm db:test:up
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
pnpm db:migrate
pnpm dev:seed
```

集成测试：

```powershell
pnpm content:test
pnpm import:test
pnpm index:test
pnpm retrieval:test
pnpm mcp:test
pnpm dify:test
```

`content:test` 是轻量内容 API 回归，只启动 PostgreSQL，不依赖 Milvus。`retrieval:test` 和 `mcp:test` 会启动 PostgreSQL + Milvus，用于验证 BM25/text-only 检索和 MCP 链路。

开发测试账号：

```text
Email:    admin@openkb.local
Password: OpenKB-dev-123456
```

开发服务：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:MILVUS_URI="localhost:59530"
pnpm --filter @openkb/api dev

$env:NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
pnpm --filter @openkb/web exec next dev --port 3001
```

默认本地地址：

```text
Web: http://localhost:3001/login
API: http://localhost:4000/health
Search: http://localhost:3001/app/search
MCP: http://localhost:4100/mcp
MCP protected resource: http://localhost:4100/.well-known/oauth-protected-resource
Dify: http://localhost:4200/retrieval
```

MCP PAT 创建：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:MCP_PAT_USER_EMAIL="admin@openkb.local"
$env:MCP_PAT_NAME="Local MCP PAT"
pnpm mcp:pat:create
```

Dify External Knowledge API key 创建：

```powershell
$env:DATABASE_URL="postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
$env:DIFY_KEY_CREATED_BY_EMAIL="admin@openkb.local"
$env:DIFY_API_KEY_NAME="Local Dify Key"
$env:DIFY_KNOWLEDGE_ID="openkb-demo"
$env:DIFY_KNOWLEDGE_BASE_ID="<internal knowledge_base_id>"
pnpm dify:key:create
```

### CPU-only 本地环境

默认本地链路是 CPU-only：Milvus 使用 BM25/text-only，`.env.example` 中 `MILVUS_ENABLE_TEXT_EMBEDDING=false`、`MILVUS_ENABLE_RERANK=false`。没有 NVIDIA GPU / `nvidia-smi` 的机器不要启用 TEXTEMBEDDING、RERANK、MinerU GPU worker、Qwen Embedding TEI 或 Qwen Reranker vLLM 服务。

Qwen Embedding、Reranker、MinerU 属于可选外部服务；OpenKB 默认测试脚本不会启动它们，也不会保存 embedding/rerank provider API key。宿主机已有的 Dify、SkillHub 或其他 Docker 容器不属于 OpenKB 测试 compose，OpenKB 脚本只管理自己的 test compose 服务。

## 核心约束

- Markdown 是内容持久化真相，富文本编辑边界固定为 Milkdown。
- PostgreSQL 是内容、权限、版本和分享真相；Milvus 只做检索索引。
- 每个检索结果返回前都必须通过 PostgreSQL `PermissionService` 最终权限检查。
- 目录不建 `folders` 表，folder 使用 `documents.type = 'folder'`。
- 权限模型严格区分 workspace role 与 content collaborator role。
- 不保存 embedding/rerank API key，不添加知识库级模型配置。
- MCP 是用户级权限出口；Dify 是应用级 scoped API key 出口。

更多规则见 `AGENTS.md`、`docs/18-decision-overrides-v0.3.zh-CN.md` 和 `docs/22-v0.3.3-clarifications.zh-CN.md`。

## 后续路线

```text
Phase 11 Docker Compose / Helm
```

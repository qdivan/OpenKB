# 24 — Phase 10 新机器 / 新 Agent 交接

本文面向没有历史上下文的新 agent。请先读完再开始 Phase 11。

## 1. 当前仓库状态

- 分支：`main`
- Phase 10 完成提交：`d1d2931 Implement Phase 10 Dify adapter`
- 已有 tag：`phase-10`
- 当前阶段：Phase 10 已完成；Phase 11 Docker Compose / Helm 待在有原生 Docker 的新机器上继续。
- 开发测试账号：`admin@openkb.local` / `OpenKB-dev-123456`

已实现能力：

- pnpm + Turborepo + TypeScript monorepo。
- PostgreSQL 数据模型、Prisma、SQL migrations、first admin seed、dev seed。
- Auth 注册/验证/登录/登出/me/密码重置/admin 激活禁用。
- Yuque-style workspace / KB / document 权限服务和内容 API。
- Next.js Web 工作台、文档树、Milkdown 编辑器、Read/Edit/Source、自动保存、版本冲突。
- S3/MinIO 上传、Markdown/Text/HTML/CSV 导入、import worker、PostgreSQL chunks。
- Milvus BM25/text-only schema、blue/green rebuild、alias switch、index worker。
- Retrieval Service、`POST /api/search`、`/app/search`，并执行 PostgreSQL final permission check。
- Streamable HTTP MCP Server、user-bound PAT、`kb.*` 读写 tools/resources、MCP audit logs。
- Dify External Knowledge `/retrieval`、scoped API key、`knowledge_id` mapping、metadata_condition、Dify audit logs。

## 2. 新 agent 阅读顺序

必须先读：

1. `AGENTS.md`
2. `docs/00-index.zh-CN.md`
3. `docs/18-decision-overrides-v0.3.zh-CN.md`
4. `docs/22-v0.3.3-clarifications.zh-CN.md`
5. `docs/13-deployment.zh-CN.md`
6. `docs/15-roadmap-and-codex-tasks.zh-CN.md`
7. `docs/23-unfinished-work.zh-CN.md`

Phase 11 开发时再重点读：

- `docs/03-system-architecture.zh-CN.md`
- `docs/07-data-model.zh-CN.md`
- `docs/09-search-rag-milvus-native.zh-CN.md`
- `docs/10-mcp-server.zh-CN.md`
- `docs/11-dify-adapter.zh-CN.md`
- `docs/12-import-conversion.zh-CN.md`

## 3. 本地基础验证

先安装依赖：

```bash
pnpm install
```

不需要 Docker 的基础检查：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
pnpm docs:check
```

有原生 Docker 的新机器上，Phase 11 开始前建议完整跑：

```bash
pnpm content:test
pnpm import:test
pnpm index:test
pnpm retrieval:test
pnpm mcp:test
pnpm dify:test
```

当前旧机器的测试脚本按历史约束使用 WSL Docker。新机器如果是原生 Docker 环境，Phase 11 可以优先把部署脚本和 compose 验证改造成原生 Docker 友好的路径，但不要破坏旧的 WSL 说明，除非明确替换策略。

## 4. Phase 11 建议起点

1. 先补生产 Docker Compose：不要只复用 test compose；需要覆盖应用服务、workers、Postgres、Redis、MinIO、Milvus。
2. 再补 Helm chart：先做最小可安装 chart，支持 external dependencies，再逐步加 values。
3. 更新部署文档：README、`docs/13`、`deploy/docker-compose/README.md`、`deploy/helm/README.md` 必须同步。
4. 验证完整闭环：compose 启动、迁移、dev seed、登录、导入、索引、搜索、MCP、Dify。
5. 完成后提交、推送 main，并打 `phase-11` tag。

## 5. Phase 11 不要做的事

- 不实现新业务功能。
- 不新增知识库级模型配置。
- 不把 embedding/rerank provider API key 写入 OpenKB DB。
- 不让 admin 默认绕过 private 内容权限。
- 不把 Dify key 当用户 token 使用。
- 不把 MCP 变成任意 stdio command execution。
- 不默认启用 GPU/大模型服务；可选服务必须显式 profile/values 开启。

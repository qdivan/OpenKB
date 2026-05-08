# 23 — 本机开发移交档案

本文记录本机开发结束时的 OpenKB 状态，用于转移回其他开发电脑后继续工作。旧的 Phase 10/11 交接内容已经清空；`docs/24-public-test-platform-deployment.zh-CN.md` 继续作为公网测试平台部署文档，不作为移交档案。

## 当前状态

截至 2026-05-08，本机代码已经推进到 `v0.3.x / Phase 15.1` 稳定化收口。Phase 15.1 之前的主线提交为 `889fd09 feat: add admin models and workbench polish`。

已完成的主线：

- Phase 11 部署闭环：生产 Dockerfile、Docker Compose、Helm 最小 chart、环境变量、健康检查、显式 migrate/seed 和部署文档。
- Phase 12/15 真实检索与模型配置：OpenKB 可通过环境变量或 system-admin 实例级加密 DB 配置直连 embedding/rerank/LLM 模型服务，支持 BM25、dense、hybrid、rerank，不保存明文 provider key，不做知识库级模型配置。
- Phase 13 知识库体验：KB Dashboard、Chunks、Retrieval Lab、KB 级切片设置、父子切片、全文上下文、chunk rebuild job、发布/取消发布闭环。
- Phase 14 Admin 用户管理：创建账号、密码重置链接、激活/停用/软删除、租户角色、会话撤销和审计入口。
- Phase 15 Admin Models 配置中心：`system_admin` 可管理实例级 embedding、rerank、language model endpoint/model 和加密 secret；不做知识库级模型配置。
- Phase 15.1 稳定化：本地源码开发端口固定为 Web `3100` / API `4101`，并补充文档状态、i18n/Models/工作台回归和浏览器冷/热启动验证。
- Web、API、MCP Server、Dify Adapter、import worker、index worker 均已接入 Phase 15 最小闭环。

Phase 16-20 建议后续优先补：

- Phase 16：Workspace/KB/document 分享协作面板、邀请审批、密码分享、member-only、关闭/重置链接 UI 和 `/share/:token` 只读页。
- Phase 17：Dify key Web 管理、MCP PAT/OAuth UI、Milvus/rebuild jobs 管理、完整 audit logs 和 auth settings 页面。
- Phase 18：当前文档切片侧栏、文档版本列表/恢复、全局搜索 parent/child 命中解释、发布后 index rebuild 引导。
- Phase 19：PDF/DOCX/PPTX/XLSX/图片 OCR/MinerU/MarkItDown/Pandoc adapter。
- Phase 20：生产 SMTP、CSRF 防护、备份/恢复、监控、TLS/Ingress、完整 MCP OAuth 和密钥轮换策略。

## 工作树状态

Phase 15.1 已在 Phase 15 Models 基础上做稳定化收口；后续接手时需要同时关注账号权限、协作权限、模型配置和检索链路四条线。

关键新增内容：

- Phase 14 Admin：`/app/admin`、`/app/admin/users`、`/password-reset`，以及账号创建、状态、角色、会话和审计 API。
- Phase 15 Admin Models：`/app/admin/models`、模型配置 API、`model_settings`、`@openkb/model-client`、实例级加密 secret。
- Phase 15.1 稳定化：`pnpm dev:local:web`、`pnpm dev:local:api`，Web `3100` / API `4101` 本地源码开发约定。
- Prisma migration：`0005_phase13_chunk_experience`、`0006_phase13_legacy_chunk_settings`。
- API：知识库 overview/chunk settings/chunk preview/chunks/chunk rebuild jobs，文档 publish/unpublish。
- Web：`/app/kb/:kbId` 知识库 Dashboard，包含 Overview、Chunks、Retrieval Lab、Settings。
- Markdown：hierarchical chunker，支持 `general`、`parent`、`child`、段落父块、全文父块、child overlap、范围和 ordinal。
- Retrieval：新增 `context_mode`，支持 `chunk`、`parent_child`、`paragraph_parent_child`、`full_text`。
- MCP/Dify：搜索入口复用统一 RetrievalService，并返回扩展 metadata。
- Workers：import worker 处理 chunk rebuild；index worker 只索引 `general` 和 `child`，并只索引 published 当前版本文档。
- 部署：Compose 支持 `OPENKB_NODE_IMAGE`，本机建议命令统一带 `--env-file .env`。

重点文件组：

- 数据模型：`packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/`、`packages/db/src/index.ts`。
- 切片和检索：`packages/markdown/src/index.ts`、`packages/retrieval/src/index.ts`。
- API 和 UI：`apps/api/src/content/`、`apps/web/src/components/workbench/`、`apps/web/src/lib/openkb-api.ts`。
- Worker 和集成：`workers/import-worker/src/processor.ts`、`workers/index-worker/src/processor.ts`、`apps/mcp-server/src/`、`apps/dify-adapter/src/`。
- 文档：`README.md`、`docs/00`、`docs/07`、`docs/08`、`docs/09`、`docs/10`、`docs/11`、`docs/12`、`docs/13`、`docs/14`、`docs/15`、`docs/17`、`docs/18`、`docs/23`、`docs/24`、`docs/25`、`docs/99`。

## 本机验证

已经通过的验证：

```bash
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

本地源码开发健康检查：

- API: `http://localhost:4101/health`
- MCP Server: `http://localhost:4100/health`
- Dify Adapter: `http://localhost:4200/health`

本机测试入口：

- Web: `http://localhost:3100`
- 账号：`admin@openkb.local`
- 密码：`OpenKB-dev-123456`

本机端口注意事项：

- PostgreSQL 使用 `localhost:15432`，不是默认 `5432`。
- Redis 使用 `localhost:16379`，不是默认 `6379`。
- MinIO assets 使用 `localhost:19000/19001`。
- Milvus 使用 `localhost:29530/29091`。

如果要直接连接本机 PostgreSQL 跑迁移：

```bash
DATABASE_URL="postgresql://openkb:openkb@localhost:15432/openkb?schema=public" pnpm db:migrate
```

## 转移回其他电脑后的顺序

建议按下面顺序恢复环境：

1. 确认代码和未提交改动已经完整同步到目标电脑。
2. 执行 `corepack enable` 和 `pnpm install --frozen-lockfile`。
3. 执行 `pnpm db:generate`，再对目标数据库执行 `pnpm db:migrate`。
4. 准备 `.env`：从 `.env.example` 复制，按目标机器端口、模型 endpoint、S3、Milvus、JWT/Session secret 调整。
5. 启动依赖和应用：

```bash
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm migrate
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d
```

国内环境如果 Docker Hub 慢，可以设置：

```bash
OPENKB_NODE_IMAGE="m.daocloud.io/docker.io/library/node:20-bookworm-slim"
```

6. 打开 `http://localhost:3000` 登录，进入 `/app/kb/:kbId` 检查 Dashboard、Chunks、Retrieval Lab。
7. 对已有知识库按需执行 chunk rebuild，再到 Admin Retrieval 页面重建 Milvus index。
8. 冒烟验证：新建文档、发布文档、重建索引、搜索、MCP `kb.search`、Dify `/retrieval`。

## 重要边界

- 不要把模型 endpoint/model 写到知识库级配置；实例级 `model_settings` 只允许 system_admin 管理，secret 必须加密。
- 不要给知识库 owner/manager 增加模型配置入口；KB 级设置只允许切片策略。
- Web search、MCP、Dify 返回内容前必须继续走 PostgreSQL 最终权限检查。
- Milvus 只做检索索引，不能成为最终授权来源。
- 手动文档默认 draft；要进入检索链路，需要 publish 后再重建 index。

<p align="center">
  <img src="docs/assets/openkb-logo.png" width="88" alt="OpenKB logo" />
</p>

<h1 align="center">OpenKB</h1>

<p align="center">
  <strong>像语雀一样写文档，把团队知识库留在自己的基础设施里。</strong>
</p>

<p align="center">
  Markdown-first · Self-hosted · Permission-safe retrieval · MCP · Dify External Knowledge
</p>

<p align="center">
  <a href="docs/25-local-quickstart.zh-CN.md">本地快速开始</a>
  ·
  <a href="docs/13-deployment.zh-CN.md">部署</a>
  ·
  <a href="docs/00-index.zh-CN.md">文档</a>
  ·
  <a href="docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md">Dify 1.14.1 对齐审计</a>
  ·
  <a href="docs/31-dify-parity-next-phases.zh-CN.md">后续路线</a>
</p>

<p align="center">
  <img alt="Phase 25" src="https://img.shields.io/badge/phase-25-10B981" />
  <img alt="Docker Compose" src="https://img.shields.io/badge/deploy-Docker%20Compose-2563EB" />
  <img alt="Helm" src="https://img.shields.io/badge/k8s-Helm-0F766E" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-user--bound-7C3AED" />
  <img alt="Dify" src="https://img.shields.io/badge/Dify-external%20knowledge-111827" />
</p>

<p align="center">
  <img src="docs/assets/openkb-cover.png" alt="OpenKB knowledge base settings" />
</p>

OpenKB 是一个开源、自托管的团队知识库。它把文档正文、版本、协作者和权限放在 PostgreSQL 里，把 Milvus 当作可重建的检索索引。Web、MCP 和 Dify 返回结果前都会回到 PostgreSQL 做最终权限检查。

当前主线处于 `v0.3.x / Phase 25`：Phase 22 已完成 Dify-like 处理规则、retrieval model、segment、QA/summary 和 Web 信息层级；Phase 23 补齐 chunk 参数与处理快照一致性；Phase 24 收口 QA parity；Phase 25 接入 Dify 风格的图片与附件检索底座。它适合本地开发、公网测试平台和私有化试跑，还不是生产 GA 版本。

## Highlights

- 语雀式知识库结构：工作区、知识库、目录、文档、协作者、邀请和只读分享。
- Markdown-first 编辑：Milkdown 富文本体验，Markdown 版本仍是正文真相。
- Dify-like 知识库处理：普通 RAG、父子检索、QA 知识库、显式 reprocess、segment override、summary index、图片/附件命中回源。
- Dify-compatible parity：新建或显式 reprocess 后按 Dify 1.14.1 recursive splitter 行为生成 PostgreSQL segments；Dify Adapter 对 QA、summary、metadata 和 tags 使用更接近 Dify 内部知识库的语义。
- Phase 25 已跑真实验收：同一 corpus、同一 qwen3-vl embedding/rerank、同一 hybrid/rerank 开关完成 240 条 live retrieval parity；内部 `asset://` 图片完成 image vector smoke。
- 检索策略可解释：BM25、semantic、hybrid、rerank、parent-child 回填、metadata filters 和命中解释。
- 安全接入：MCP 绑定真实用户；Dify 绑定 app key 和 allowed KB scope。
- 运维控制台：用户、模型、导入工具、Dify、MCP、索引、SMTP、审计和安全运维入口。

## Preview

| Workbench                                             | Search                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| ![OpenKB workbench](docs/assets/openkb-workbench.png) | ![OpenKB search](docs/assets/openkb-search.png) |

| Dify setup                                              | KB processing settings                                    |
| ------------------------------------------------------- | --------------------------------------------------------- |
| ![OpenKB Dify admin](docs/assets/openkb-admin-dify.png) | ![OpenKB KB settings](docs/assets/openkb-kb-settings.png) |

## Quick Start

需要 Docker 和 Docker Compose。

```bash
cp .env.example .env
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm migrate
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d
```

打开 `http://localhost:3000`，使用开发账号登录：

```text
admin@openkb.local
OpenKB-dev-123456
```

源码开发建议固定本地端口：

```powershell
pnpm dev:local:api
pnpm dev:local:web
```

此模式下 Web 是 `http://localhost:3100`，API 是 `http://localhost:4101`。运行 `next dev` 时不要同时执行 Web `next build`，两者会争用同一个 `.next` 目录。

## Upgrade Acceptance

`/health` is a liveness and display endpoint. Do not use `phase` alone as the
upgrade gate. For a Phase 25 deployment, verify the release image or commit,
then check the database, schema, and interfaces:

- Prisma migrations include `0014_account_setup_admin_visibility`,
  `0015_dify_knowledge_alignment`, `0016_qa_summary_generation`,
  `0017_dashscope_model_provider`, `0018_asset_bindings`, and
  `0019_qa_mock_source`.
- Phase 25 tables and columns exist, especially `document_qa_pairs`,
  `document_segment_summaries`, `document_summaries`,
  `document_asset_bindings`, `document_chunks.index_role`,
  `document_chunks.source_chunk_id`, and the asset-derived chunk roles.
- Key APIs respond after authentication: KB chunk settings, document processing,
  document reprocess, segment management, QA, summaries, search, Dify
  `/retrieval`, and asset/image hit metadata.
- Docker Compose deployments pass through the Phase 20-25 SMTP, CSRF, MCP OAuth,
  model, import-tool, metrics, backup, embedding/rerank request format, and
  image-vector environment variables.
- Existing derived data is not migrated automatically. Reprocess documents and
  rebuild the Milvus index explicitly when upgrading older data.

Local Phase 25 evidence is kept out of git:

- Live retrieval parity: `.codex-runtime/parity-runs/20260517T135537Z/retrieval/`
- Image-capable smoke: `.codex-runtime/phase25-smoke/image-smoke-summary.json`

## Releases

- [`phase-21`](https://github.com/qdivan/OpenKB/releases/tag/phase-21): Dify External Knowledge 原生体验补强，包含配置向导、Dify 友好 metadata、KB metadata schema 和文档 metadata values。
- [`phase-22`](https://github.com/qdivan/OpenKB/releases/tag/phase-22): Dify 1.14.1 知识库处理与检索逻辑对齐，包含分块/reprocess、retrieval model、segment 管理、QA/summary 和 Web 信息层级。
- [`phase-25`](https://github.com/qdivan/OpenKB/releases/tag/phase-25): Phase 23-25 稳定收口，包含 chunk 参数一致性、QA parity、图片与附件检索、同模型 live retrieval parity 和 image-capable smoke 验收。

## Documentation

- [文档索引](docs/00-index.zh-CN.md)
- [权限模型](docs/05-permission-spec.zh-CN.md)
- [检索与 Milvus](docs/09-search-rag-milvus-native.zh-CN.md)
- [Dify Adapter](docs/11-dify-adapter.zh-CN.md)
- [Dify External Knowledge 配置指南](docs/26-dify-external-knowledge-setup.zh-CN.md)
- [Dify 1.14.1 对齐计划](docs/27-dify-knowledge-alignment.zh-CN.md)
- [Dify 1.14.1 差异审计](docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md)
- [Dify parity v2 工程基线](docs/30-dify-parity-v2-analysis.zh-CN.md)
- [Dify parity 后续路线](docs/31-dify-parity-next-phases.zh-CN.md)
- [本地快速开始](docs/25-local-quickstart.zh-CN.md)
- [部署说明](docs/13-deployment.zh-CN.md)

## Development Checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

需要完整链路时再运行：

```bash
pnpm content:test
pnpm retrieval:test
pnpm dify:test
pnpm mcp:test
```

`content:test` 只依赖 PostgreSQL；`retrieval:test`、`dify:test` 和 `mcp:test` 会用到 Milvus。默认本地链路是 CPU-only BM25，dense/hybrid/rerank 只有在配置模型并重建索引后才启用。

## Boundaries

- PostgreSQL + PermissionService 是内容和权限的最终真相。
- 管理员可以管理对象元数据，但不会默认读取所有私有正文；紧急接管必须审计。
- Dify key 只能访问显式授权的 KB，不能模拟任意用户。
- 模型、SMTP、导入工具等 secret 只允许实例级加密保存，不做知识库级密钥配置。
- Segment、QA 和 summary 是检索派生层，不反写 Markdown 正文版本。

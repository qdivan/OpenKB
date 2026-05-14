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
</p>

<p align="center">
  <img alt="Phase 22" src="https://img.shields.io/badge/phase-22-10B981" />
  <img alt="Docker Compose" src="https://img.shields.io/badge/deploy-Docker%20Compose-2563EB" />
  <img alt="Helm" src="https://img.shields.io/badge/k8s-Helm-0F766E" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-user--bound-7C3AED" />
  <img alt="Dify" src="https://img.shields.io/badge/Dify-external%20knowledge-111827" />
</p>

<p align="center">
  <img src="docs/assets/openkb-cover.png" alt="OpenKB knowledge base settings" />
</p>

OpenKB 是一个开源、自托管的团队知识库。它把文档正文、版本、协作者和权限放在 PostgreSQL 里，把 Milvus 当作可重建的检索索引。Web、MCP 和 Dify 返回结果前都会回到 PostgreSQL 做最终权限检查。

当前主线处于 `v0.3.x / Phase 22`：正在对齐 Dify 1.14.1 的知识库处理、分块、检索策略、QA、summary 和 segment 管理。它适合本地开发、公网测试平台和私有化试跑，还不是生产 GA 版本。

## Highlights

- 语雀式知识库结构：工作区、知识库、目录、文档、协作者、邀请和只读分享。
- Markdown-first 编辑：Milkdown 富文本体验，Markdown 版本仍是正文真相。
- Dify-like 知识库处理：普通 RAG、父子检索、QA 知识库、显式 reprocess、segment override、summary index。
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

## Releases

- [`phase-21`](https://github.com/qdivan/OpenKB/releases/tag/phase-21): Dify External Knowledge 原生体验补强，包含配置向导、Dify 友好 metadata、KB metadata schema 和文档 metadata values。
- [`phase-22`](https://github.com/qdivan/OpenKB/releases/tag/phase-22): Dify 1.14.1 知识库处理与检索逻辑对齐，包含分块/reprocess、retrieval model、segment 管理、QA/summary 和 Web 信息层级。

## Documentation

- [文档索引](docs/00-index.zh-CN.md)
- [权限模型](docs/05-permission-spec.zh-CN.md)
- [检索与 Milvus](docs/09-search-rag-milvus-native.zh-CN.md)
- [Dify Adapter](docs/11-dify-adapter.zh-CN.md)
- [Dify External Knowledge 配置指南](docs/26-dify-external-knowledge-setup.zh-CN.md)
- [Dify 1.14.1 对齐计划](docs/27-dify-knowledge-alignment.zh-CN.md)
- [Dify 1.14.1 差异审计](docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md)
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

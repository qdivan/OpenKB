# OpenKB

OpenKB 是一个 Markdown-first、可自托管的知识库系统。它把正文、版本、协作者和权限留在 PostgreSQL；Milvus 只作为可重建的检索索引。Web、MCP 和 Dify External Knowledge 返回结果前，都会回到 PostgreSQL 做最终权限检查。

当前主线：`v0.3.x / Phase 31`。Phase 31 在语雀式空间、知识库归属和权限入口之上，补齐旧 workspace 的兼容迁移报告与 runbook：`Default Workspace / OpenKB Demo` 默认作为团队空间处理，迁移报告只做只读审计，不自动搬迁私有内容或重写权限。项目适合本地开发、公网测试平台和私有化试跑，还不是生产 GA。

## Highlights

- 空间与知识库：个人空间、团队空间、归属空间、知识库、目录、文档、公开性、协作者和只读分享。
- 语雀式工作台：左侧空间与知识库入口，中间编辑/分段/源码，右侧大纲、元数据和版本。
- Markdown-first：Milkdown 富文本编辑，Markdown 版本仍是正文真相。
- Dify 配合：OpenKB 可作为 Dify External Knowledge API 使用，并可通过 Dify Hub 管理 external dataset 和 metadata 字段。
- 检索派生层：显式 reprocess、segment override、QA、summary、图片/附件回源，不反写 Markdown 正文。
- 权限边界：MCP 绑定真实用户；Dify 绑定 app key 和 allowed KB scope；所有检索结果做 PostgreSQL final permission check。

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

源码模式下 Web 是 `http://localhost:3100`，API 是 `http://localhost:4101`。运行 `next dev` 时不要同时执行 Web `next build`，两者会争用同一个 `.next` 目录。

## Upgrade Acceptance

`/health.phase` 只是展示字段，不作为升级验收标准。Phase 31 部署应按以下内容验收：

- Prisma migrations 至少包含 `0014_account_setup_admin_visibility` 到 `0023_workspace_compatibility`。
- 关键表/字段存在：`workspaces.kind`、`workspaces.personal_owner_user_id`、`workspaces.avatar_color`、`workspaces.avatar_initials`、`document_user_activities`、`dify_hub_connections`、`document_asset_bindings`、`document_chunks.index_role`、`document_chunks.source_chunk_id`。
- 关键接口和脚本认证后可用：workspace dashboard、workspace create/update、KB visibility/collaborators、document permission/share links、workspace migration report、KB chunk settings、document processing、document reprocess、segment management、QA、summaries、search、Dify `/retrieval`、Dify Hub metadata sync。
- 旧派生数据不会自动迁移。升级旧数据后，管理员需要显式 reprocess 文档，再重建 Milvus 索引。

## Releases

- [`phase-21`](https://github.com/qdivan/OpenKB/releases/tag/phase-21): Dify External Knowledge 接入体验补强。
- [`phase-22`](https://github.com/qdivan/OpenKB/releases/tag/phase-22): Dify 风格知识库处理与检索配置。
- [`phase-25`](https://github.com/qdivan/OpenKB/releases/tag/phase-25): chunk 参数一致性、QA 兼容语义、图片与附件检索底座和同模型检索验证。
- [`phase-25.1`](https://github.com/qdivan/OpenKB/releases/tag/phase-25.1): Workbench 与 Dify 设置稳定修复。
- [`phase-26`](https://github.com/qdivan/OpenKB/releases/tag/phase-26): Dify Hub Service API、metadata sync 和语雀式空间路线图。

## Documentation

- [文档索引](docs/00-index.zh-CN.md)
- [产品愿景](docs/01-product-vision.zh-CN.md)
- [权限模型](docs/05-permission-spec.zh-CN.md)
- [注册与账号](docs/06-auth-registration.zh-CN.md)
- [数据模型](docs/07-data-model.zh-CN.md)
- [检索与 Milvus](docs/09-search-rag-milvus-native.zh-CN.md)
- [Dify External Knowledge 配置](docs/26-dify-external-knowledge-setup.zh-CN.md)
- [语雀式空间与知识库模型](docs/32-yuque-space-kb-model.zh-CN.md)
- [空间迁移与兼容 Runbook](docs/33-workspace-migration-compatibility.zh-CN.md)
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
- Segment、QA、summary 和图片/附件索引是检索派生层，不反写 Markdown 正文版本。

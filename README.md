<p align="center">
  <img src="docs/assets/openkb-logo.png" width="96" alt="OpenKB logo" />
</p>

<h1 align="center">OpenKB</h1>

<p align="center">
  <strong>像语雀一样写文档，把知识库握在自己手里。</strong>
</p>

<p align="center">
  Markdown 优先 · 私有化部署 · 权限清晰 · MCP 与 Dify
</p>

<p align="center">
  <a href="docs/25-local-quickstart.zh-CN.md">本地快速开始</a>
  ·
  <a href="docs/24-public-test-platform-deployment.zh-CN.md">公网测试部署</a>
  ·
  <a href="docs/00-index.zh-CN.md">完整文档</a>
  ·
  <a href="docs/23-docs-code-gap-analysis.zh-CN.md">当前移交档案</a>
</p>

<p align="center">
  <img alt="Phase" src="https://img.shields.io/badge/phase-v0.3.x-10B981" />
  <img alt="Docker Compose" src="https://img.shields.io/badge/deploy-Docker%20Compose-2563EB" />
  <img alt="Helm" src="https://img.shields.io/badge/k8s-Helm-0F766E" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-user--bound-7C3AED" />
  <img alt="Dify" src="https://img.shields.io/badge/Dify-external%20knowledge-111827" />
</p>

<p align="center">
  <img src="docs/assets/openkb-cover.png" alt="OpenKB cover" />
</p>

OpenKB 是一个开源、自托管的团队知识库。它关注写作体验、权限边界和可信检索：内容与权限以 PostgreSQL 为准，Milvus 只做检索索引，Web、MCP、Dify 返回结果前都会再次校验权限。

当前版本处于 `v0.3.x / Phase 19` 复杂导入适配器，适合本地开发、公网测试平台和私有化试跑；还不是生产 GA 版本。

## 特性

- Markdown 优先，编辑边界跟随 Milkdown。
- 语雀式结构：工作区、知识库、目录、文档、协作者和分享链接。
- 权限清晰：管理员不默认读取所有私有内容，检索结果返回前做最终权限检查。
- 真实检索：默认 BM25；配置模型后支持向量检索、混合检索和重排。
- 父子切片：支持段落父块、全文父块、子块召回、父块上下文回填和检索测试台。
- 外部接入：MCP 是用户绑定出口，Dify 是应用密钥绑定出口。
- 私有化部署：提供 Docker Compose、Helm、MinIO、Milvus 和公网测试部署清单。

## 预览

![OpenKB workbench](docs/assets/openkb-workbench.png)

![OpenKB search](docs/assets/openkb-search.png)

## 本地快速开始

需要 Docker 和 Docker Compose。

```bash
cp .env.example .env
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm migrate
docker compose --env-file .env -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose --env-file .env -f deploy/docker-compose/compose.yml up -d
```

打开 `http://localhost:3000`，使用本地开发账号登录：

```text
admin@openkb.local
OpenKB-dev-123456
```

更完整的端口覆盖、健康检查、真实模型配置和 MCP/Dify 冒烟测试见 [本地快速部署](docs/25-local-quickstart.zh-CN.md)。

如果只做源码开发，推荐用两个终端固定本地端口：

```powershell
pnpm dev:local:api
pnpm dev:local:web
```

此模式下 Web 使用 `http://localhost:3100`，API 使用 `http://localhost:4101`。不要在 `next dev` 运行时同时执行 Web `next build`，两者会争用同一个 `.next` 目录；构建前先停掉 Web dev server。

## 部署

- Docker Compose: [deploy/docker-compose/README.md](deploy/docker-compose/README.md)
- Helm: [deploy/helm/README.md](deploy/helm/README.md)
- 公网测试平台: [docs/24-public-test-platform-deployment.zh-CN.md](docs/24-public-test-platform-deployment.zh-CN.md)

公网环境不要使用 `seed-dev`、默认账号或默认密码。请启用 HTTPS，收紧 CORS，使用强密钥，并确保 PostgreSQL、Redis、MinIO、Milvus、etcd 不直接暴露到公网。

## 当前状态

已进入代码的主线能力：

- Phase 11：部署闭环。
- Phase 12：真实 embedding/rerank/hybrid 检索。
- Phase 13：知识库 Dashboard、父子切片、全文上下文、检索测试台、发布闭环。
- Phase 14：Admin 用户管理、账号状态、租户角色、密码重置链接、会话撤销和审计入口。
- Phase 15：Admin Models 配置中心，支持 system_admin 管理实例级 embedding、rerank、language model endpoint/model 和加密 secret。
- Phase 15.1：稳定化收口，补本地启动脚本、文档状态、i18n/Models/工作台回归和浏览器冷/热启动验证。
- Phase 16：协作与分享 UI，支持 Workspace/KB/document 成员与协作者面板、邮箱邀请、审批、只读分享链接、密码访问、member-only、关闭/重置链接、`/invite/:token` 和 `/share/:token`。
- Phase 17：Admin 运维管理 UI，补齐 Auth Settings、Audit Logs、Indexing、Dify key/mapping 和 MCP PAT/OAuth client/grant 管理入口。
- Phase 18：文档版本列表/预览/restore、当前文档 chunk 侧栏、搜索 parent/child 命中解释和发布后 index rebuild 引导。
- Phase 19：复杂导入 adapter 与系统级导入工具配置，支持 MarkItDown、MinerU、Pandoc、Tesseract OCR 的格式路由、fallback、warnings 和密文 secret。

下一批路线是 Phase 20：生产增强。当前本机开发移交见 [docs/23-docs-code-gap-analysis.zh-CN.md](docs/23-docs-code-gap-analysis.zh-CN.md)。

## 开发验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

## 文档入口

- [文档索引](docs/00-index.zh-CN.md)
- [产品目标](docs/01-product-vision.zh-CN.md)
- [权限模型](docs/05-permission-spec.zh-CN.md)
- [检索与 Milvus](docs/09-search-rag-milvus-native.zh-CN.md)
- [MCP Server](docs/10-mcp-server.zh-CN.md)
- [Dify Adapter](docs/11-dify-adapter.zh-CN.md)
- [部署说明](docs/13-deployment.zh-CN.md)

更严格的项目规则见 [AGENTS.md](AGENTS.md)、[docs/18-decision-overrides-v0.3.zh-CN.md](docs/18-decision-overrides-v0.3.zh-CN.md) 和 [docs/22-v0.3.3-clarifications.zh-CN.md](docs/22-v0.3.3-clarifications.zh-CN.md)。

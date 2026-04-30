<p align="center">
  <img src="docs/assets/openkb-logo.png" width="96" alt="OpenKB logo" />
</p>

<h1 align="center">OpenKB</h1>

<p align="center">
  <strong>像语雀一样写文档，把知识库握在自己手里。</strong>
</p>

<p align="center">
  Markdown 优先 · 私有化部署 · 权限清晰 · 接入 MCP 与 Dify
</p>

<p align="center">
  <a href="docs/25-local-quickstart.zh-CN.md">本地快速开始</a>
  ·
  <a href="docs/24-public-test-platform-deployment.zh-CN.md">公网测试部署</a>
  ·
  <a href="docs/00-index.zh-CN.md">完整文档</a>
  ·
  <a href="docs/23-docs-code-gap-analysis.zh-CN.md">实现进度</a>
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

OpenKB 是一个开源、自托管的团队知识库。它关注三件事：写作体验接近语雀，权限模型足够清楚，检索和外部集成不绕过权限。

项目当前处于 `v0.3.x / Phase 11`，已经打通 Web、API、导入、Milvus 检索、MCP、Dify、Docker Compose 和 Helm 的最小闭环，适合本地开发、公网测试平台和私有化试跑；还不是完整生产 GA 版本。

## ✨ 特性

- 📝 **Markdown 优先**：编辑边界跟随 Milkdown，不发明新的 Markdown 方言。
- 🗂️ **语雀式结构**：工作区、知识库、目录、文档、协作者和分享链接。
- 🔐 **权限清晰**：PostgreSQL 是内容与权限真相，管理员不默认读取所有私有文档。
- 🔎 **可检索**：Milvus 负责检索索引，结果返回前再次经过 PostgreSQL 权限检查。
- 📥 **可导入**：当前支持 Markdown、Text、HTML、CSV；复杂 Office/PDF/OCR 留给后续 adapter。
- 🤖 **可接入 AI 工具**：MCP 是用户绑定的出口，Dify 是应用密钥绑定的出口。
- 🚢 **可部署**：提供 Dockerfile、生产 Compose、Helm 最小 chart 和公网测试部署清单。

## 🖼️ 预览

### 文档工作台

![OpenKB workbench](docs/assets/openkb-workbench.png)

### 知识库检索

![OpenKB search](docs/assets/openkb-search.png)

## 🚀 本地跑起来

需要 Docker / Docker Compose。首次启动：

```bash
docker compose -f deploy/docker-compose/compose.yml build
docker compose -f deploy/docker-compose/compose.yml up -d postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
docker compose -f deploy/docker-compose/compose.yml run --rm migrate
docker compose -f deploy/docker-compose/compose.yml run --rm seed-dev
docker compose -f deploy/docker-compose/compose.yml up -d
```

打开 `http://localhost:3000`，使用本地开发账号登录：

```text
admin@openkb.local
OpenKB-dev-123456
```

更完整的本地部署、端口覆盖、健康检查和 MCP/Dify 验证见 [本地快速部署](docs/25-local-quickstart.zh-CN.md)。

## 📦 部署

- Docker Compose: [deploy/docker-compose/README.md](deploy/docker-compose/README.md)
- Helm: [deploy/helm/README.md](deploy/helm/README.md)
- 公网测试平台: [docs/24-public-test-platform-deployment.zh-CN.md](docs/24-public-test-platform-deployment.zh-CN.md)

公网环境不要使用 `seed-dev`、默认账号或默认密码。请启用 HTTPS，收紧 CORS，使用强密钥，并确保 PostgreSQL、Redis、MinIO、Milvus、etcd 不直接暴露到公网。

## 🧭 项目状态

已完成的主线：

- 登录注册、邮箱验证、密码重置、管理员激活/禁用用户。
- 工作区、知识库、文档树、读写模式、源码模式和自动保存。
- 文件上传、导入任务、chunk 生成和索引重建。
- BM25/text-only 检索、MCP Server、Dify External Knowledge Adapter。
- Phase 11 部署闭环：Docker Compose、Helm、环境变量、健康检查、安全基线文档。

仍在路上的能力：

- 生产 SMTP、Admin UI、分享/协作者面板。
- 完整 MCP OAuth、MCP/Dify key 管理 UI。
- PDF/DOCX/PPTX/XLSX/图片 OCR adapter。
- dense/hybrid/rerank 生产链路、监控备份和升级回滚。

代码与需求文档的逐项差异见 [docs/23-docs-code-gap-analysis.zh-CN.md](docs/23-docs-code-gap-analysis.zh-CN.md)。

## 🛠️ 开发验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
```

## 📚 文档

| 文档                                                                                   | 用途          |
| -------------------------------------------------------------------------------------- | ------------- |
| [docs/00-index.zh-CN.md](docs/00-index.zh-CN.md)                                       | 文档索引      |
| [docs/01-product-vision.zh-CN.md](docs/01-product-vision.zh-CN.md)                     | 产品目标      |
| [docs/04-editor-spec.zh-CN.md](docs/04-editor-spec.zh-CN.md)                           | 编辑器边界    |
| [docs/05-permission-spec.zh-CN.md](docs/05-permission-spec.zh-CN.md)                   | 权限模型      |
| [docs/09-search-rag-milvus-native.zh-CN.md](docs/09-search-rag-milvus-native.zh-CN.md) | 检索与 Milvus |
| [docs/10-mcp-server.zh-CN.md](docs/10-mcp-server.zh-CN.md)                             | MCP Server    |
| [docs/11-dify-adapter.zh-CN.md](docs/11-dify-adapter.zh-CN.md)                         | Dify Adapter  |
| [docs/13-deployment.zh-CN.md](docs/13-deployment.zh-CN.md)                             | 部署说明      |

更严格的项目规则见 [AGENTS.md](AGENTS.md)、[docs/18-decision-overrides-v0.3.zh-CN.md](docs/18-decision-overrides-v0.3.zh-CN.md) 和 [docs/22-v0.3.3-clarifications.zh-CN.md](docs/22-v0.3.3-clarifications.zh-CN.md)。

# 23 — 本机开发移交与缺口记录

> 历史快照：本文最初用于 Phase 17/19 期间的本机开发移交。它保留阶段推进脉络，但不再作为当前实现规范。当前规范请优先阅读 README、`docs/15-roadmap-and-codex-tasks.zh-CN.md`、`docs/27-dify-knowledge-alignment.zh-CN.md`、`docs/28-dify-1.14.1-knowledge-gap-audit.zh-CN.md` 和 `docs/30-dify-parity-v2-analysis.zh-CN.md`。

## 当前主线状态

截至 2026-05-17，主线处于 `v0.3.x / Phase 25`：

- Phase 20 生产增强已进入主线：SMTP、CSRF、MCP OAuth、ops health、metrics、backup/restore、security 页面和部署 env 透传。
- Phase 21 Dify External Knowledge 原生体验已进入主线：配置向导、Dify 友好 metadata、KB metadata schema、文档 metadata values。
- Phase 22.2-22.6 已完成基础闭环：Dify 风格 process rule、显式 reprocess、retrieval_model 注入、segment 管理、QA/summary、Web 信息层级。
- Phase 22.8-22.9 聚焦 Dify parity v2：Dify 1.14.1-compatible splitter、新建/显式 reprocess 后的边界收敛、QA 对外语义、metadata/tags、segment lifecycle 和同模型检索基线。
- Phase 23-25 已继续收口：chunk 参数一致性、QA parity、图片与附件检索底座进入主线；稳定版验收以 README、`docs/13`、`docs/30`、`docs/31` 为准。

## 仍需优先关注的方向

1. **Dify splitter parity 复跑**
   使用 `scripts/parity/` 和 `docs/30` 的基线，重新比较 Dify 1.14.1 与 OpenKB 的 chunk count、边界、parent/child 数量、QA 返回语义和 metadata filter。

2. **同模型环境下的检索 parity**
   在 OpenKB 和 Dify 使用同等 embedding/rerank 配置后，复跑 semantic、hybrid、rerank、metadata filters 和 QA/summary hit。

3. **生产部署实战演练**
   `/health.phase` 只作展示；升级验收应看 migration、表结构和关键接口。Compose/Helm 必须透传 Phase 20-25 env，但真实 secret 只能来自 `.env`、Secret 或实例级加密 DB 配置。

4. **真实导入工具 smoke**
   Phase 19 的 adapter 路由已完成，仍建议在实际安装 MarkItDown/Pandoc/Tesseract 或配置 MinerU endpoint 后做真实文件 smoke。

## 本地开发约定

- Web：`http://localhost:3100`
- API：`http://localhost:4101/health`
- MCP Server：`http://localhost:4100/health`
- Dify Adapter：`http://localhost:4200/health`

开发账号：

```text
admin@openkb.local
OpenKB-dev-123456
```

常用检查：

```bash
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm content:test
pnpm retrieval:test
pnpm dify:test
```

## 重要边界

- PostgreSQL + PermissionService 是内容和权限最终真相。
- Milvus 只是可重建索引；stale candidates 必须被 PostgreSQL final check 拦截。
- Dify key 是 app-key-bound，只能访问 allowed KB；MCP 是 user-bound。
- 管理员可以管理元数据，但不默认读取所有私有正文；紧急接管必须审计。
- 模型、SMTP、导入工具等 secret 只能实例级加密保存，不做知识库级密钥配置。
- Segment、QA、summary 是检索派生层，不反写 Markdown 正文版本。

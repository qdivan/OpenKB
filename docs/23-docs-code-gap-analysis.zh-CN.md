# 23 本机开发移交与缺口记录

本文记录当前 OpenKB 本机开发状态，便于在不同机器或不同 agent 之间继续接手。

## 当前状态

截至 2026-05-09，本机代码已经推进到 `v0.3.x / Phase 17` Admin 运维管理 UI。

已完成的主线：

- Phase 11 部署闭环：生产 Dockerfile、Docker Compose、Helm 最小 chart、环境变量、健康检查、显式 migrate/seed 和部署文档。
- Phase 12/15 真实检索与模型配置：OpenKB 可通过环境变量或 system-admin 实例级加密 DB 配置连接 embedding、rerank、LLM 服务；不做知识库级模型配置。
- Phase 13 知识库体验：KB Dashboard、Chunks、Retrieval Lab、KB 级切片设置、父子切片、全文上下文、chunk rebuild job、发布/取消发布闭环。
- Phase 14 Admin 用户管理：创建账号、密码重置链接、激活、停用、软删除、租户角色、会话撤销和审计入口。
- Phase 15 Admin Models 配置中心：`system_admin` 可管理实例级 embedding、rerank、language model endpoint/model 和加密 secret。
- Phase 15.1 稳定化：本地源码开发端口固定为 Web `3100` / API `4101`，并补充文档状态、i18n/Models/工作台回归和浏览器冷/热启动验证。
- Phase 16 协作与分享 UI：工作台 AccessPanel / SharePanel、Workspace/KB/document 成员与协作者管理、邮箱邀请、待审批邀请、只读分享链接、密码访问、member-only、关闭/重置链接、`/invite/:token` 和 `/share/:token`。
- Phase 17 Admin 运维管理 UI：Auth Settings、Audit Logs、Indexing、Dify key/mapping、MCP PAT/OAuth client/grant 管理入口和对应 Admin API。
- Phase 18 文档版本与检索解释：文档版本列表/预览/恢复、当前文档 chunk 侧栏、搜索 parent/child 命中解释和发布后 index rebuild 引导。
- Phase 19 复杂导入适配器：`@openkb/import-tools`、`/app/admin/import-tools`、实例级 MarkItDown/MinerU/Pandoc/Tesseract OCR 配置、格式路由和 worker fallback 转 Markdown。

后续建议优先级：

- Phase 19：已完成最小复杂导入 adapter 闭环；后续可继续增强真实工具 smoke、批量导入管理后台和更细的转换质量报告。
- Phase 20：生产 SMTP、CSRF 防护、备份/恢复、监控、TLS/Ingress、完整 MCP OAuth 授权码流程和密钥轮换策略。

## 工作树关键内容

关键新增内容：

- Phase 14 Admin：`/app/admin`、`/app/admin/users`、`/password-reset`，以及账号创建、状态、角色、会话和审计 API。
- Phase 15 Admin Models：`/app/admin/models`、模型配置 API、`model_settings`、`@openkb/model-client`、实例级加密 secret。
- Phase 16 协作分享：`apps/api/src/content/collaboration.controller.ts`、`apps/api/src/content/share.controller.ts`、`apps/web/src/components/workbench/access-panel.tsx`、`apps/web/src/components/workbench/share-panel.tsx`、`apps/web/src/app/invite/[token]/`、`apps/web/src/app/share/[token]/`。
- Phase 17 Admin Ops：`apps/api/src/admin-ops/`、`apps/web/src/app/app/admin/auth-settings/`、`audit/`、`indexing/`、`dify/`、`mcp/`，以及 `0009_phase17_admin_ops` migration。

重点文件组：

- 数据模型：`packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/`、`packages/db/src/index.ts`。
- 切片和检索：`packages/markdown/src/index.ts`、`packages/retrieval/src/index.ts`。
- API 和 UI：`apps/api/src/content/`、`apps/api/src/admin-ops/`、`apps/web/src/components/workbench/`、`apps/web/src/lib/openkb-api.ts`。
- Worker 和集成：`workers/import-worker/src/processor.ts`、`workers/index-worker/src/processor.ts`、`apps/mcp-server/src/`、`apps/dify-adapter/src/`。

## 本机验证

本阶段已通过：

```bash
pnpm docs:check
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

本地源码开发健康检查：

- Web: `http://localhost:3100`
- API: `http://localhost:4101/health`
- MCP Server: `http://localhost:4100/health`
- Dify Adapter: `http://localhost:4200/health`

本地测试账号：

- 账号：`admin@openkb.local`
- 密码：`OpenKB-dev-123456`

## 重要边界

- 不要把模型 endpoint/model 写到知识库级配置；实例级 `model_settings` 只允许 system_admin 管理，secret 必须加密。
- 不要给知识库 owner/manager 增加模型配置入口；KB 级设置只允许切片策略。
- Web search、MCP、Dify 返回内容前必须继续走 PostgreSQL 最终权限检查。
- Milvus 只做检索索引，不能成为最终授权来源。
- 手动文档默认 draft；要进入检索链路，需要 publish 后再重建 index。

# 23 — 文档与当前代码差异核对

本文件记录 2026-04-30 对 `docs/` 与当前代码实现的逐项核对结果。它替代旧的 Phase 10/11 交接文档；旧 `docs/23-unfinished-work.zh-CN.md` 和 `docs/24-agent-handoff-phase-10.zh-CN.md` 已删除。

## 核对结论

当前代码已经完成 v0.3.x 的 Phase 11 最小部署闭环：Web、API、MCP、Dify、import/index workers、PostgreSQL、Redis、MinIO、Milvus、Docker Compose 和 Helm 最小 chart 都已有实现。主要差异集中在三类：

- 产品规格中列为完整体验的能力，当前代码只完成了最小可用子集。
- 文档中规划的后续能力尚未进入 v0.3.x，例如生产 SMTP、完整 MCP OAuth、复杂 OCR/MinerU、实时协同、完整 Admin UI。
- 少量接口文档比代码更超前，需要后续实现或在文档中继续标注为未实现。

## 逐项差异

| 文档 | 当前代码对齐情况 | 主要差异 |
|---|---|---|
| `00-index.zh-CN.md` | 已更新为当前阅读入口。 | 已移除旧 23/24 交接引用，改为指向本差异核对文档。 |
| `01-product-vision.zh-CN.md` | 项目定位、Markdown-first、MCP、Dify、私有化部署方向已对齐。 | 愿景中的 PDF/DOCX/PPTX/XLSX/图片导入、完整分享/审批体验仍是后续增强；当前导入只启用 Markdown/Text/HTML/CSV，检索默认 BM25，配置模型后支持 dense/hybrid/rerank。 |
| `02-yuque-reference-model.zh-CN.md` | Tenant/Workspace/KB/Folder/Document 模型和 Yuque-style 角色基本对齐。 | Web 顶部已有协作/分享图标，但协作者面板、分享面板、邀请审批、密码访问、关闭/重置链接等 UI 尚未实现。 |
| `03-system-architecture.zh-CN.md` | Monorepo 服务划分、Permission Service、Retrieval Service、MCP、Dify、Milvus alias 思路已对齐。 | Redis 已作为部署依赖交付，但 import/index workers 当前仍轮询 PostgreSQL job 表，尚未接 BullMQ。Import worker 当前是 TypeScript worker，不是 MinerU/Python 转换 worker。 |
| `04-editor-spec.zh-CN.md` | Feature Registry、Milkdown CommonMark/GFM、Read/Edit/Source、自动保存、版本冲突、右侧 outline、asset 占位回写已实现。 | 工具栏/slash menu 未实现；内部链接只在工作台点击时处理，没有完整 URL rewrite/renderer；源码保存的 Milkdown parse/serialize 仍是轻量规则校验，不是完整 Milkdown round-trip；权限隐藏目录树已有服务层保障但缺专门 UI 测试覆盖。 |
| `05-permission-spec.zh-CN.md` | Workspace role 与 content collaborator role 分离，Permission Service、final check、只读分享、admin 不默认读私有内容等核心规则已实现。 | owner 转让未实现；邀请审批、邀请链接重置、邮箱域限制、分享密码校验、分享 verify-password 接口未实现；workspace 成员管理 UI/API 还很有限；`canCreateShareLink` 当前只允许 owner/manager。 |
| `06-auth-registration.zh-CN.md` | 邮箱注册、验证 token/outbox、登录、登出、me、密码重置、admin 激活/禁用、auth_settings 已实现。 | 生产 SMTP 发送未实现；邀请注册流程未完整接入注册页；管理员拒绝/删除 pending 用户、重发验证邮件未实现；Admin UI 页面未实现。 |
| `07-data-model.zh-CN.md` | Prisma schema 与 SQL migrations 覆盖核心表、auth_settings、MCP PAT/OAuth 表、Dify key/mapping 表、share link view-only 约束。 | 文档示例中的 `document_assets` 和 `import_jobs` 是简化版；实际 schema 已扩展 filename/checksum/storage_bucket/metadata、parent/title/output/warnings/finished 等字段。文档可后续补齐实际字段。 |
| `08-api-contract.zh-CN.md` | Auth、Admin users/settings、Workspace、KB、Document、Collaborator、Invitation accept/revoke、Share create/get/revoke、Search、Upload/Import、Milvus admin 主要 API 已实现。 | 未实现或缺失：OpenAPI 生成、`GET /api/admin/audit-logs`、document versions/restore API、`GET /api/invitations/:token`、`POST /api/invitations/:id/approve`、`POST /api/share/:token/verify-password`。实际多了 `GET /api/import-jobs?knowledge_base_id=` 和 `GET /api/assets/:id/url`。 |
| `09-search-rag-milvus-native.zh-CN.md` | Milvus schema builder、`id` primary key + `chunk_id` regular field、BM25 Function、OpenKB 直连 embedding/rerank、dense/hybrid/rerank 模式、alias rebuild/switch、PostgreSQL final check 已实现。 | Milvus TEXTEMBEDDING/RERANK Function 改为后续可选演进；手动新建文档默认 `draft`，而 Milvus/search filter 只返回 `doc_status = "published"`，目前缺显式发布 API。 |
| `10-mcp-server.zh-CN.md` | Streamable HTTP、PAT、scope 校验、`kb.*` 读写工具、resources、审计、Yuque MCP 能力对照已实现。 | 完整 OAuth authorize/token/refresh/revoke 流程未实现；`.well-known/oauth-protected-resource` 只是 metadata；安全 stdio bridge 未实现。 |
| `11-dify-adapter.zh-CN.md` | `/retrieval`、Bearer scoped API key、knowledge mapping、metadata_condition post-filter、Dify 错误格式、审计、top_k 限制已实现。 | Dify key 管理只有 CLI/helper，没有 Web 管理页；检索复用统一 RetrievalService，可随 Admin 模式切换 bm25/dense/hybrid/rerank。 |
| `12-import-conversion.zh-CN.md` | 上传、object storage、import_jobs、worker、Markdown/Text/HTML/CSV 转 Markdown、chunk 生成已实现。 | 文档宣称 v0.x 支持 PDF/DOCX/PPTX/XLSX/图片，当前代码只把这些扩展名识别为“需要 MinerU/MarkItDown/Pandoc/OCR adapter”，实际会返回 converter unavailable。复杂内容 asset 化/OCR 未实现。 |
| `13-deployment.zh-CN.md` | Phase 11 Compose、Helm、环境变量、CPU-only 默认、显式 migrate/seed、健康检查已实现。 | Helm 需要安装 `helm` 后做 lint/template；可选模型服务只有 disabled placeholder；生产 TLS/Ingress/backup/monitoring 未进入当前 chart。 |
| `14-ui-routes.zh-CN.md` | `/login`、`/register`、`/verify-email`、`/app`、workspace/KB/doc/search、`/app/admin/retrieval` 路由已实现。 | `/share/:token` 和完整 `/admin/*` 页面未实现；Share/Collaborator panel 未实现；知识库设置页未实现；Admin Milvus UI 只有 retrieval/index 最小页面。 |
| `15-roadmap-and-codex-tasks.zh-CN.md` | Phase 1-11 的主要代码资产已经落地。 | Phase 11 描述已从“将在新机器继续”更新为“已完成最小部署闭环”。后续增强仍不应混入 v0.3.x 部署闭环。 |
| `16-decisions-and-non-goals.zh-CN.md` | 核心决策仍与代码一致。 | 允许后续扩展项均未实现，符合非目标边界。 |
| `17-glossary.zh-CN.md` | 术语与代码命名基本一致。 | 无明显实现冲突。 |
| `18-decision-overrides-v0.3.zh-CN.md` | 最高优先级硬规则基本被代码遵守。 | “权限完整向语雀对齐”在产品体验上仍是进行中；当前代码实现核心数据与服务规则，UI/审批/密码分享仍缺。 |
| `19-codex-start-guide.zh-CN.md` | 作为历史启动指南仍可读。 | 文档仍偏项目早期 bootstrap 语境，不反映 Phase 11 已完成；如继续维护，可改成“新 agent 入场指南”。 |
| `20-codex-prompts.zh-CN.md` | 作为 prompts 索引可保留。 | 无运行时代码差异；属于开发过程资料。 |
| `21-v0.3.2-clarifications.zh-CN.md` | share link view-only、folder 使用 `documents.type = folder` 等澄清已落实。 | 无明显实现冲突。 |
| `22-v0.3.3-clarifications.zh-CN.md` | workspace/content role 分离、Milvus primary key、auth_settings、MCP/Dify 表、禁存 provider key 已落实。 | 无明显实现冲突。 |
| `99-references.md` | 参考资料性质。 | 不直接约束当前代码实现。 |

## 建议优先修正

1. 更新 `docs/12-import-conversion.zh-CN.md`，把 PDF/Office/图片从“v0.x 支持”改成“后续 adapter 支持”，避免测试时误判。
2. 更新 `docs/08-api-contract.zh-CN.md`，标注未实现 API，补上当前实际存在的 asset/import list 接口。
3. 更新 `docs/14-ui-routes.zh-CN.md`，把 `/share/:token`、`/admin/*`、权限面板标为未实现。
4. 决定手动文档默认 `draft` 是否需要发布 API；否则 search/filter 只返回 `published` 会让新建文档不可检索。
5. 后续如果要进入产品增强阶段，应优先补分享/协作者 UI、完整 Admin UI、复杂导入 adapter、MCP OAuth 和 Key 管理 UI。

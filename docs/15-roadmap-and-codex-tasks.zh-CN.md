# 15 — 开发路线和 Codex 任务

## Phase 0 — 读文档和确认约束

目标：Codex 总结规则，不写代码。

输出：

- 不可违反规则。
- 架构摘要。
- 首批里程碑。
- 发现的矛盾。

## Phase 1 — Monorepo 脚手架

输出：

- pnpm workspaces。
- Turborepo。
- apps/web Next.js。
- apps/api NestJS/Fastify。
- packages/shared/db/permissions/editor/milvus。
- 基础 README 和 smoke tests。

## Phase 2 — 数据库模型

输出：

- Prisma schema。
- SQL migrations。
- users/tenants/workspaces/kbs/documents/versions/collaborators/invitations/share_links/audit_logs。
- seed first admin。

## Phase 3 — Auth 和注册

输出：

- 邮箱注册。
- 邮箱验证。
- 登录。
- admin 激活。
- 注册设置。

## Phase 4 — 语雀式权限服务

输出：

- Permission Service。
- canRead/canEdit/canManage。
- 协作者、公开性、分享链接、邀请审批。
- 单元测试。

## Phase 5 — Milkdown 编辑器

输出：

- 文档树。
- Milkdown 编辑器。
- 阅读/编辑/源码模式。
- 版本保存和冲突。
- Feature Registry。

## Phase 6 — 文件导入

输出：

- 上传。
- import_jobs。
- converter adapters。
- Milkdown dialect validation。

## Phase 7 — Milvus 原生 Function 索引

输出：

- packages/milvus。
- 创建 collection schema。
- TEXTEMBEDDING/BM25/RERANK Function 配置代码。
- rebuild job。
- alias switch。
- health check。

## Phase 8 — Retrieval Service

输出：

- Milvus active alias 检索。
- access_principals 预过滤。
- PostgreSQL final permission check。
- Web search API。

## Phase 9 — MCP Server

输出：

- Streamable HTTP MCP。
- OAuth/PAT。
- kb.search / kb.get_document / kb.get_toc。
- 用户权限绑定。
- 审计。

## Phase 9.1 — MCP 对齐语雀公开 MCP 的文档核对

输出：

- 对照 `yuque/yuque-mcp-server` 公开工具清单。
- 明确 OpenKB 只使用 `kb.*` 工具命名，不提供 `yuque_*` 别名。
- 明确安全 stdio bridge 只能转发固定 HTTP MCP，不允许任意 command spawn。
- 明确语雀 TOC 是知识库目录树；OpenKB 保留文档 outline，并规划知识库 TOC 工具。
- 明确 notes 小记不进入 v0.x 对齐范围。

## Phase 9.2 — MCP 写工具与语雀能力补齐

输出：

- `kb.get_current_user`。
- `kb.get_knowledge_base`。
- `kb.create_knowledge_base` / `kb.update_knowledge_base`。
- `kb.create_document` / `kb.update_document`。
- `kb.get_knowledge_base_toc` / `kb.update_knowledge_base_toc`。
- 新增 `profile:read`、`kb:write`、`doc:write`、`toc:write` scopes。
- 写工具只做 create/update，不做 delete。
- 写入 Markdown 必须通过 Feature Registry 校验、版本冲突检查、Permission Service 和审计。
- TOC 更新使用结构化操作，不接收任意 raw `toc_data` 字符串。

## Phase 10 — Dify Adapter

输出：

- /retrieval。
- scoped API key。
- knowledge_id mapping。
- metadata_condition。
- Dify 兼容错误格式 `{ error_code, error_msg }`。
- app-scoped retrieval，不模拟用户、不模拟管理员。
- `knowledge_id` 必须映射到内部 KB，并被当前 API key allow list 显式授权。
- 返回前执行 PostgreSQL final scope check；Milvus 只做候选索引。
- 审计 `dify.retrieval`，`actor_type=api_key` 且 metadata 标记 `api_key_type=dify`，不记录 raw API key。
- 不新增数据库 migration，不保存 embedding/rerank provider key。

## Phase 11 — 部署

输出：

- Docker Compose。
- Helm chart。
- Milvus standalone/external。
- MinIO/Postgres/Redis。

Phase 11 将在有原生 Docker 的新机器上继续，目标是把 Phase 1-10 已实现能力做成可部署闭环；不要在 Phase 11 中扩散到生产 SMTP、完整 MCP OAuth、复杂 OCR、dense/hybrid/rerank、实时协同或 admin UI 等后续产品增强。

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

## Phase 10 — Dify Adapter

输出：

- /retrieval。
- scoped API key。
- knowledge_id mapping。
- metadata_condition。

## Phase 11 — 部署

输出：

- Docker Compose。
- Helm chart。
- Milvus standalone/external。
- MinIO/Postgres/Redis。

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
- BM25 Function 配置代码。
- 当前 v0.3.x 使用 OpenKB 通过环境变量直连 embedding/rerank HTTP endpoint，写入普通 `dense_vector` 字段；Milvus TEXTEMBEDDING/RERANK Function 或 Model Ranker 是后续可选演进。
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
- 不新增 Dify 数据库 migration，不保存明文 embedding/rerank provider key。

## Phase 11 — 部署

输出：

- Docker Compose。
- Helm chart。
- Milvus standalone/external。
- MinIO/Postgres/Redis。

Phase 11 已完成最小部署闭环，包含生产/自托管 Docker Compose、Helm 最小 chart、环境变量整理、健康检查和部署文档。后续不要把生产 SMTP、完整 MCP OAuth、复杂 OCR、实时协同或完整 admin UI 等产品增强混入部署闭环。

## Phase 12 — 真实模型检索

输出：

- OpenAI-compatible embedding client。
- rerank client。
- `bm25`、`dense`、`dense_rerank`、`hybrid`、`hybrid_rerank` 模式。
- Admin retrieval settings 页面。
- index-worker 批量生成 dense vector。
- rerank 在最终权限过滤后执行，失败时降级。

当前代码已完成 Phase 12 的最小闭环。

## Phase 13 — 知识库体验和父子检索

输出：

- 知识库 Dashboard：文档数、chunk 数、索引状态、最近导入和重建。
- KB 级切片设置：`general` / `parent_child`、段落父块 / 全文父块、分隔符、max chars、overlap。
- 切片可视化：按文档展示 `general` / `parent` / `child` chunk。
- 检索测试台：支持临时 `context_mode`、top_k，展示命中子块、父块上下文、raw score、rerank score。
- 段落父子检索和全文父块：子块入 Milvus，父块回 PostgreSQL 回填上下文。
- 发布/取消发布闭环：新建文档默认 draft，发布后经 Milvus index rebuild 进入检索。
- Web/MCP/Dify 结果 metadata 附加 parent/child 信息。

当前代码已完成 Phase 13 的最小闭环。后续仍需补强知识库设置页的信息架构、当前文档切片侧栏、检索结果解释 UI、分享/协作面板和复杂导入 adapter。

## Phase 15 - Admin Models 配置中心

输出：
- `/app/admin/models`，与 Users、Retrieval、Permission Boundary 并列。
- `GET /api/admin/models`、`PUT /api/admin/models/:kind`、`POST /api/admin/models/:kind/probe`、`DELETE /api/admin/models/:kind/secret`。
- `model_settings` 实例级配置表，`kind = embedding | rerank | language`，不提供知识库级模型配置。
- `system_admin` 可保存 endpoint/model 和加密 API key；`tenant_admin` 只能查看检索状态，不能保存 Models。
- `OPENKB_CONFIG_ENCRYPTION_KEY` 作为 AES-256-GCM secret 解密密钥；缺失时不能保存或读取 DB secret。
- 模型配置优先级：DB enabled 配置 > 环境变量 > 未配置。
- Language model 第一版只做连通性检测，不实现 LLM 问答生成；请求格式支持 OpenAI Responses、OpenAI Chat Completions 和 Anthropic Messages。

硬规则：
- 数据库只保存密文、last4、更新时间和配置元数据。
- 审计日志、DTO、日志 payload 都不能出现 raw API key。
- embedding model 或 dim 变更后不自动重建 Milvus；Admin UI 显示 index rebuild required，并继续通过现有 rebuild job 执行 blue/green alias switch。

## Phase 15.1 - 稳定化收口

输出：
- README、路线图、交接文档和本地快速部署文档同步到 Phase 15.1 现状。
- 固定推荐本地源码开发端口：Web `3100`、API `4101`。
- 补 `pnpm dev:local:web` 和 `pnpm dev:local:api`，并说明 `next dev` 与 `next build` 不要同时争用同一个 `.next`。
- 回归 `/`、`/login`、`/app`、知识库 Dashboard、文档页、Admin Users、Admin Retrieval、Admin Models 的中文文案、loading skeleton、错误态和无 overlay 状态。
- 巩固 Models 保存前校验、检测错误展示、secret 不回显、DB/env source 说明，以及 transient probe 不保存配置或 raw key。
- 真实浏览器记录 dev 冷编译和热导航耗时；冷启动只记录，热导航要求主路径有即时反馈。

边界：
- 不新增数据库 migration。
- 不修改模型权限规则。
- 不新增协作、分享、版本、复杂导入或运维管理功能。

## Phase 16 - 协作与分享 UI

输出：
- Workspace / KB / document 协作者面板（Phase 16 已实现）。
- 邀请链接创建、撤销、接受和审批入口（Phase 16 已实现）。
- 分享链接 UI：密码访问、member-only、关闭分享、重置链接（Phase 16 已实现）。
- `/invite/:token` 邀请接受页和 `/share/:token` 最小只读页（Phase 16 已实现）。
- 分享链接 v0.x 继续只读，不加入编辑权限。

边界：
- 不做 owner transfer，不做匿名编辑分享链接，不做宽泛用户搜索。
- 外部 SMTP 仍未实现；邀请邮件继续写入开发 outbox。
- PostgreSQL + `PermissionService` 仍是最终权限真相，管理员身份不默认读取私有内容。

## Phase 17 - Admin 运维管理 UI

输出（Phase 17 已实现最小闭环）：
- `/app/admin/auth-settings`：租户感知注册、邮箱验证、邀请必需、默认激活状态和域名白名单配置。
- `/app/admin/audit`：完整审计列表和 action/object/actor/date 过滤。
- `/app/admin/indexing`：Milvus health、active alias/profile、profiles、rebuild jobs、rebuild job 创建和 alias switch。
- `/app/admin/dify`：Dify API key 创建、reveal、rotate、revoke，以及 knowledge_id mapping 管理。
- `/app/admin/mcp`：MCP PAT 创建/撤销、OAuth client 创建/禁用、OAuth grant 查看/撤销。
- Admin API 补齐对应 Dify、MCP、Milvus、Audit、Auth Settings 运维接口；Dify key 新增加密存储字段，旧 hash-only key 只能 rotate 后 reveal。

边界：
- 不实现完整 MCP OAuth authorize/token/refresh 流程，保留到 Phase 20。
- 不改变 MCP user-bound / Dify app-key-bound / PostgreSQL final permission check 规则。
- 普通 list/detail DTO、audit 和日志不返回 raw secret；Dify raw key 只通过显式 reveal，PAT raw token 只在创建时显示一次。

## Phase 18 - 文档版本与检索解释

输出（Phase 18 已实现最小闭环）：
- 文档版本 API：`GET /api/documents/:id/versions`、`GET /api/documents/:id/versions/:versionId`、`POST /api/documents/:id/restore/:versionId`。
- 文档页右侧 `Outline / Chunks / Versions` 面板：当前文档 chunk 侧栏、版本列表、Markdown 预览、差异摘要和 restore。
- restore 不回退旧指针，而是复制目标版本 Markdown 创建新的当前版本，并审计 `restored_from_version_id` / `new_version_id`。
- 搜索页和 KB Retrieval Lab 展示 parent / child 命中解释；发布、取消发布和 restore 后提示需要重建搜索索引。

边界：
- 不新增数据库表；继续复用 `document_versions` 和 `document_chunks`。
- 不做复杂可视化 diff 编辑器；第一版只做 Markdown 预览与行级差异摘要。
- PostgreSQL + `PermissionService` 仍是最终权限真相，Milvus 命中解释不参与授权。

## Phase 19 - 复杂导入适配器

输出：
- PDF / DOCX / PPTX / XLSX / image 导入适配器。
- MarkItDown / Pandoc / MinerU / OCR adapter 边界。
- 工具不可用时返回明确 warnings，不静默失败。

## Phase 20 - 生产增强

输出：
- 生产 SMTP。
- CSRF 防护。
- 备份 / 恢复。
- 监控、TLS、Ingress。
- 完整 MCP OAuth 授权码流程。
- 密钥轮换策略和安全运维文档。

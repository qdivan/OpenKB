# 07 - 数据模型

本文记录 OpenKB v0.x 的数据模型边界。实际字段以 `packages/db/prisma/schema.prisma` 和 SQL migration 为准；本文用于解释产品语义和权限边界。

## 1. 租户、用户和角色

`tenant` 是后台、部署、多租户和系统管理边界，不作为普通用户的一层空间入口。

核心表：

```text
users
tenants
tenant_memberships
auth_settings
auth_tokens
auth_sessions
auth_email_outbox
audit_logs
```

租户角色：

```text
system_admin | tenant_admin | member
```

管理员角色只管理后台配置和对象元数据；私有正文读取仍必须通过内容权限或显式审计接管。

`auth_settings` 保存实例默认或租户覆盖的注册策略。`tenant_id = null` 表示实例默认配置；租户级记录优先于实例默认配置。`registration_enabled` 控制后端是否允许自助注册，`login_registration_enabled` 只控制登录页和 `/register` 页面是否展示公开注册入口，邮箱白名单仍由 `allowed_email_domains` 在服务端强制校验。

## 2. 空间、知识库和文档

Phase 31 起，`workspaces` 同时承载个人空间和团队空间，不新增独立 Team 表；旧 workspace 通过兼容迁移和只读报告纳入空间模型。

```text
workspaces (
  id uuid primary key,
  tenant_id uuid not null,
  name text not null,
  slug text not null,
  kind text not null default 'team',
  personal_owner_user_id uuid null,
  avatar_color text null,
  avatar_initials text null,
  created_by uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, slug)
)
```

语义：

- `kind = personal` 表示个人空间，由系统在用户 active 后创建。
- `kind = team` 表示团队空间，由用户创建或由旧 workspace 迁移而来。
- 同一 tenant 下，同一 user 只能有一个 personal workspace。
- `avatar_color` / `avatar_initials` 是 Phase 28 的颜色 + 首字头像字段；本阶段不支持图片头像上传。
- 客户端不能创建个人空间，也不能写入 `personal_owner_user_id`。
- `0023_workspace_compatibility` 会把 `default-workspace` 固定为团队空间，并补齐旧空间头像兜底字段；它不会移动知识库或重写私有权限。
- `pnpm --filter @openkb/db workspace:migration-report` 可生成只读迁移报告，用于判断旧空间更像个人空间、团队空间还是需要人工复核。

空间成员：

```text
workspace_members (
  tenant_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'member', 'guest')),
  unique (workspace_id, user_id)
)
```

知识库：

```text
knowledge_bases (
  tenant_id uuid not null,
  workspace_id uuid not null,
  title text not null,
  slug text not null,
  visibility text not null check (visibility in ('private', 'workspace', 'public')),
  status text not null,
  created_by uuid not null,
  unique (workspace_id, slug)
)
```

文档和目录都使用 `documents`：

```text
documents.type = page | folder
```

正文版本使用 `document_versions`，Markdown 正文永远以版本表为真相。

## 3. 个人空间活动

Phase 27 增加轻量活动表：

```text
document_user_activities (
  tenant_id uuid not null,
  user_id uuid not null,
  workspace_id uuid not null,
  knowledge_base_id uuid not null,
  document_id uuid not null,
  activity_type text not null check (activity_type in ('view')),
  last_activity_at timestamptz not null,
  activity_count integer not null,
  unique (tenant_id, user_id, document_id, activity_type)
)
```

写入规则：

- 只有认证用户通过 Web/API 打开 page 文档且权限检查通过后，才记录 view。
- share link、Dify、MCP 不写个人浏览记录。
- 无权限读取失败时不写活动。

最近编辑从 `document_versions.created_by` 推导；最近浏览从 `document_user_activities` 推导。收藏和评论目前只保留入口，不建完整数据模型。

## 4. 协作者和分享

内容协作者只用于知识库和文档：

```text
collaborators.object_type = knowledge_base | document
collaborators.role = owner | manager | editor | viewer
```

Workspace 成员关系只存在于 `workspace_members`，不要写入 `collaborators`。

邀请：

- Workspace invitation: `admin | member | guest`
- Knowledge base / document invitation: `manager | editor | viewer`

Share link 在 v0.x 只读，不实现 link edit。

## 5. 检索派生层

检索派生数据包括：

```text
document_chunks
document_qa_pairs
document_summaries
document_segment_summaries
document_asset_bindings
document_assets
knowledge_base_metadata_fields
document_metadata_values
```

规则：

- Segment、QA、summary、图片与附件索引都不反写 Markdown 正文。
- Milvus 只保存可重建索引和候选 metadata。
- 返回 Web/MCP/Dify 前必须回 PostgreSQL 做 final permission check。

## 6. Dify / MCP / Admin 配置

Dify app-key-bound：

```text
dify_api_keys
dify_knowledge_mappings
dify_hub_connections
```

Dify Hub 只使用 Dify Dataset Service API，不使用 Console cookie，不写 Dify 数据库。Dify Service API token 必须加密保存。

MCP user-bound：

```text
mcp_oauth_clients
mcp_oauth_grants
mcp_oauth_authorization_codes
mcp_oauth_refresh_tokens
mcp_personal_access_tokens
```

实例级 admin 配置：

```text
model_settings
smtp_settings
import_tool_settings
import_format_routes
```

模型、SMTP、导入工具等 secret 只能实例级加密保存，不能做知识库级密钥配置。

# 05 — 权限规格说明

## 1. 最高原则

```text
权限完整向语雀产品逻辑对齐。
v0.x 不引入其它权限方案作为设计目标。
PostgreSQL 中的语雀式对象权限是最终权限真相。
```

不做：

```text
LDAP / SCIM / 复杂组织架构同步
OpenFGA / Casbin / OPA
自定义 ABAC 策略语言
管理员默认可读全库内容
知识库级模型配置权限
链接编辑权限
```

## 2. 对象层级

```text
Tenant / 实例或租户
  └── Workspace / 空间
        └── Knowledge Base / 知识库
              └── Folder / 目录
                    └── Document / 文档
```

权限主要发生在 workspace、knowledge_base、document。folder 默认参与继承、目录结构和排序，不做单独权限体系。实现时 folder 不单独建表，而是 `documents.type = folder` 的目录节点；page 是 `documents.type = page` 的正文文档。

## 3. 角色命名和映射

### 3.1 Workspace / 空间成员角色

空间成员关系只存在 `workspace_members` 表，不进入 `collaborators` 表。

| UI 文案 | 内部 role | 含义 |
|---|---|---|
| 空间所有者 | `owner` | 拥有空间，可转让、删除、管理空间成员和设置。通常由创建、转让或系统初始化产生，不通过普通邀请链接授予。 |
| 空间管理员 | `admin` | 可管理空间成员、空间设置和空间内知识库管理入口，但不等于内容对象 owner。 |
| 空间成员 | `member` | 普通成员。可以阅读 `visibility = workspace` 的知识库/文档。 |
| 空间访客 | `guest` | 受限成员。默认只看到明确邀请或分享给自己的内容。 |

Workspace 邀请只能授予：

```text
admin / member / guest
```

不允许通过普通邀请链接直接授予 workspace `owner`。workspace `owner` 只能通过创建空间、转让所有权或系统级初始化产生。

### 3.2 内容对象协作者角色

内容对象包括 knowledge_base 和 document。`documents.type = folder` 的目录节点也按 document 对象处理。

内容对象协作者关系存在 `collaborators` 表。

| UI 文案 | 内部 role | 含义 |
|---|---|---|
| 所有者 | `owner` | 拥有对象，可转让、删除、管理协作者。通常由创建或转让产生。 |
| 可管理 | `manager` | 可管理设置、目录、协作者和内容。 |
| 可编辑 | `editor` | 可阅读和编辑内容。 |
| 可阅读 | `viewer` | 只读访问。 |

Knowledge base / document / folder 邀请只能授予：

```text
manager / editor / viewer
```

不允许通过普通邀请链接直接授予内容对象 `owner`。内容对象 `owner` 只能通过创建或转让产生。

### 3.3 系统管理角色

| 角色 | 来源 | 含义 |
|---|---|---|
| `system_admin` | `tenant_memberships.role` 或系统级成员关系 | 系统级后台管理员。 |
| `tenant_admin` | `tenant_memberships.role` | 租户级后台管理员。 |
| `member` | `tenant_memberships.role` | 租户普通用户。 |

内容对象 `manager` 不等于后台 admin。workspace `admin` 也不等于 `tenant_admin`。

## 4. Admin 边界

system_admin / tenant_admin 可以：

- 进入后台。
- 管理用户、激活用户、禁用用户。
- 配置 SMTP。
- 配置 Milvus 连接、索引任务、collection alias。
- 查看模型/embedding/rerank Function 状态。
- 触发全局重建索引。
- 查看审计日志。

但 admin 不因此自动拥有所有私有文档的阅读权限。搜索、MCP、Dify、附件、导出都不能因为 admin 身份绕过内容权限。

## 5. Workspace / 空间权限

空间是成员协作和安全策略边界。

默认规则：

```text
空间 member 可以阅读 visibility = workspace 的知识库/文档。
空间 member 不能阅读 private 知识库，除非是协作者。
空间 member 不能编辑知识库，除非有 editor/manager/owner 内容对象协作者权限。
空间 guest 只看到明确邀请或分享给自己的内容。
空间 admin 可以管理空间设置和成员，但不自动获得 private 知识库内容阅读权。
```

## 6. Knowledge Base / 知识库权限

知识库有两组关键设置：

```text
visibility
collaborators
```

### 6.1 公开性

| UI 文案 | 内部值 | 含义 |
|---|---|---|
| 仅协作者可访问 | `private` | 只有知识库协作者和被授权文档协作者可访问。 |
| 空间成员可访问 | `workspace` | 当前空间 member/admin/owner 可阅读。guest 默认不可读，除非被明确授权。 |
| 互联网可访问 | `public` | 匿名用户可阅读已发布内容。 |

公开性只决定阅读。编辑/管理仍然依赖协作者角色。

### 6.2 协作者

知识库协作者可以是：

- 用户。
- 用户组。
- 邮箱邀请接受后的用户。

角色：owner、manager、editor、viewer。

知识库 owner 不能配置知识库自己的模型。

## 7. Document / 文档权限

文档默认继承知识库权限。

```text
document.permission_mode = inherit | custom
```

### inherit

文档继承知识库 visibility 和 collaborators。

### custom

文档可以设置独立协作者和分享状态。custom 可以让某篇文档比知识库更严格或更开放，但必须通过明确 UI 展示。

文档协作者角色：owner、manager、editor、viewer。

## 8. 内容对象能力矩阵

| 能力 | owner | manager | editor | viewer |
|---|---:|---:|---:|---:|
| 阅读 | ✅ | ✅ | ✅ | ✅ |
| 编辑正文 | ✅ | ✅ | ✅ | ❌ |
| 新建子文档 | ✅ | ✅ | ✅ | ❌ |
| 移动/重命名 | ✅ | ✅ | ✅ | ❌ |
| 删除 | ✅ | ✅ | 可配置，默认 ❌ | ❌ |
| 管理协作者 | ✅ | ✅ | ❌ | ❌ |
| 创建分享链接 | ✅ | ✅ | 可配置，默认 ❌ | ❌ |
| 转让 owner | ✅ | ❌ | ❌ | ❌ |

## 9. 邀请机制

### 9.1 Workspace 邀请

Workspace 邀请的结果是写入 `workspace_members`，不是写入 `collaborators`。

邀请对象：

- 已注册用户。
- 邮箱。

邀请角色：

```text
admin / member / guest
```

普通 workspace 邀请不支持 `owner`。owner 转让走单独接口和审计。

### 9.2 内容对象直接邀请

邀请对象：

- 已注册用户。
- 邮箱。
- 用户组。

邀请范围：knowledge_base、document。folder 使用 document 对象语义。

邀请角色：

```text
manager / editor / viewer
```

普通内容对象邀请不支持 `owner`。owner 转让走单独接口和审计。

### 9.3 邀请链接

邀请链接设置：

- 角色：根据 object_type 使用不同角色集合：
  - workspace：admin/member/guest。
  - knowledge_base/document：manager/editor/viewer。
- 是否需要审批。
- 是否限制邮箱域名。
- 过期时间。
- 使用次数。
- 可重置链接。
- 可关闭链接。

## 10. 分享链接

分享链接和协作者邀请分开。

分享链接默认只读，支持：

- 密码访问。
- 过期时间。
- 仅空间成员可访问。
- 关闭分享。
- 访问审计。

v0.x 不支持链接编辑权限。`share_links.permission` 必须固定为 `view`。

## 11. 权限服务函数

必须实现统一 Permission Service：

```ts
canReadDocument(user, documentId): Promise<boolean>
canEditDocument(user, documentId): Promise<boolean>
canManageDocument(user, documentId): Promise<boolean>
canManageWorkspace(user, workspaceId): Promise<boolean>
canManageKnowledgeBase(user, kbId): Promise<boolean>
canInviteCollaborator(user, object): Promise<boolean>
canCreateShareLink(user, object): Promise<boolean>
resolveEffectiveRole(user, object): Promise<Role | null>
resolveWorkspaceRole(user, workspaceId): Promise<'owner' | 'admin' | 'member' | 'guest' | null>
resolveReadablePrincipalsForMilvus(user): Promise<string[]>
```

所有 API、MCP、Dify、附件和导出必须调用 Permission Service 或同等底层逻辑。

## 12. Milvus access principals

写入 Milvus 的每个 chunk 带 `access_principals` 作为预过滤字段：

```json
[
  "tenant:t1:member",
  "workspace:w1:member",
  "kb:kb1:viewer",
  "group:g1",
  "user:u123"
]
```

用户检索时先计算用户 principals，再做 Milvus 预过滤，最后回 PostgreSQL 做最终 canReadDocument。

## 13. 审计

需要记录：

- 权限变更。
- 邀请创建/接受/拒绝/撤销。
- 分享链接创建/关闭。
- 管理员激活/禁用用户。
- MCP 查询返回的 document IDs。
- Dify scoped key 调用。
- 管理员触发重建索引和 alias 切换。
- owner 转让。

## 14. 测试要求

必须覆盖：

- private 知识库只有协作者可读。
- workspace-visible 知识库对 workspace member 可读，对 guest 默认不可读。
- workspace admin 不自动获得 private 知识库阅读权限。
- workspace 邀请写入 `workspace_members`，角色只能是 admin/member/guest。
- knowledge_base/document 邀请写入 `collaborators`，角色只能是 manager/editor/viewer。
- 分享链接固定只读。
- removed collaborator 失去访问。
- MCP principals 只包含当前用户允许范围。

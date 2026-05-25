# 14 - UI 路由与页面

本文记录 OpenKB Web 的主要路由和当前页面层级。Phase 31 已在空间主页、知识库归属和语雀式权限入口的基础上，补齐旧 workspace 迁移兼容：旧 `Default Workspace / OpenKB Demo` 默认作为团队空间进入空间切换器，迁移报告和 runbook 用于人工复核，不自动改私有内容权限。

## 1. 公共路由

```text
/
/login
/register
/verify-email
/password-reset
```

语言切换只更新 locale、localStorage 和 document language，不改变当前 URL，不重新选择默认空间、知识库或文档。

登录页注册入口由公开注册配置控制：

- `registration_enabled`：后端是否接受自助注册请求。
- `login_registration_enabled`：登录页和 `/register` 是否展示公开注册入口。
- `invite_required`：启用后不展示公开注册表单，用户应通过邀请链接加入。
- `allowed_email_domains`：启用白名单后，登录页和注册页会展示允许的邮箱域名范围，后端仍做最终校验。

## 2. 工作台路由

```text
/app
/app/workspaces/:workspaceId
/app/kb/:kbId
/app/kb/:kbId/docs/:docId
/app/search
```

行为：

- `/app` 无显式目标时，默认打开当前用户个人空间 dashboard。
- `/app/workspaces/:workspaceId` 打开指定空间 dashboard。
- `/app/kb/:kbId` 打开知识库首页。
- `/app/kb/:kbId/docs/:docId` 打开指定文档。
- 直接访问 KB/doc URL 时，不会被个人空间默认入口覆盖。

## 3. 空间入口

左侧顶部是空间切换器：

- “个人”分组显示当前用户个人空间。
- “空间”分组显示已加入或可管理的团队空间。
- “创建空间”会创建团队空间，并要求填写空间名称、slug、头像首字和头像颜色。
- 选择空间后进入 `/app/workspaces/:workspaceId`，不自动打开第一个知识库。

空间 dashboard 显示：

- 空间名称、颜色首字头像和空间类型：个人空间 / 团队空间。
- 快捷入口：新建知识库、新建文档、导入文件。
- 知识库卡片列表，包含知识库类型、可见性、状态、页面数、目录数和需重处理数量。
- 最近内容，分组展示最近编辑和最近浏览。
- 收藏入口和空状态。
- 评论入口和空状态。
- 团队空间会显示“成员”入口，复用现有空间成员管理面板。

收藏和评论只保留入口，不实现完整数据模型。

导入文件后，左侧文档树区域会保留导入任务面板。用户可以看到任务状态、源文件名、转换器、错误、警告和卡住诊断；成功后刷新文档树。

## 4. Workbench 布局

当前工作台采用三栏：

```text
左侧：空间切换器 + 当前空间下的知识库列表
中间：空间 dashboard / 知识库 dashboard / 文档编辑器
右侧：空间上下文 / 文档辅助信息
```

内部对象名仍是 `workspace`，用户可见文案优先使用“空间”。

当打开知识库首页但未打开文档时，右侧栏显示当前空间头像、名称、类型、角色、知识库数量、成员入口和空间设置入口；文档大纲、元数据和版本只在打开具体文档后显示。

## 5. 文档页

文档页顶部保留：

```text
编辑 / 分段 / 源码
```

- 编辑：Milkdown 富文本编辑，只有可编辑用户可用。
- 分段：文档级处理工作区，展示 segments、QA、summary、分段设置和 reprocess 入口。
- 源码：Markdown 源码编辑，只有可编辑用户可用。

右侧文档栏只放辅助信息，不重复承载主流程。当前核心入口是：

- 大纲。
- 元数据。
- 版本。

文档权限和分享不放在右侧辅助栏中；它们靠近文档标题和工具栏：

- 权限：继承知识库权限 / 自定义权限、文档协作者。
- 分享：只读分享链接、密码、登录要求、空间成员限制、过期时间、重置和撤销。

## 6. 权限入口

知识库首页提供“权限”入口，打开后按语雀式层级展示：

- 公开性：仅协作者、空间成员、公开。
- 协作者：owner / manager / editor / viewer。

空间成员入口仍属于空间上下文，角色为 owner / admin / member / guest。空间成员、知识库协作者、文档协作者是三层不同权限，不混用。

## 7. 迁移与兼容入口

Phase 31 不新增 Web 页面。管理员通过 CLI 生成旧空间迁移报告：

```bash
pnpm --filter @openkb/db workspace:migration-report
```

报告只读；如需处理旧 `Default Workspace / OpenKB Demo`，按 `docs/33-workspace-migration-compatibility.zh-CN.md` 的 runbook 进行人工归属判断。

## 8. Admin 路由

```text
/app/admin
/app/admin/users
/app/admin/auth
/app/admin/email
/app/admin/search
/app/admin/models
/app/admin/import-tools
/app/admin/indexing
/app/admin/dify
/app/admin/mcp
/app/admin/audit
/app/admin/security
/app/admin/permission-boundaries
```

管理员页面只管理配置和元数据；管理员身份不默认授予私有正文读取权限。

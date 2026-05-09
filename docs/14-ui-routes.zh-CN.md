# 14 — UI 路由和页面

本文档区分当前已实现页面和后续计划页面，避免把完整产品体验误认为 v0.3.x 已完成能力。

## 1. 已实现页面

```text
/login
/register
/verify-email
/app
/app/workspaces
/app/workspaces/:workspaceId
/app/kb/:kbId
/app/kb/:kbId/docs/:docId
/app/search
/app/admin
/app/admin/users
/app/admin/auth-settings
/app/admin/retrieval
/app/admin/models
/app/admin/indexing
/app/admin/dify
/app/admin/mcp
/app/admin/audit
/password-reset
/invite/:token
/share/:token
```

Phase 13 起，未选中文档时 `/app/kb/:kbId` 展示知识库 Dashboard；选中文档后进入 Yuque-like 文档编辑器：左侧文档树、中心文档编辑器、右侧 outline，并支持 Read/Edit/Source、自动保存、上传导入、搜索入口和发布状态切换。

## 2. 当前未实现页面

```text
/admin/audit-logs
```

当前已实现 `/app/admin`、`/app/admin/users`、`/app/admin/auth-settings`、`/app/admin/retrieval`、`/app/admin/models`、`/app/admin/indexing`、`/app/admin/dify`、`/app/admin/mcp` 和 `/app/admin/audit` 页面。用户管理页支持账号创建、激活/停用/软删除、租户角色、密码重置链接、会话撤销和账号审计入口。Models 页面是实例级 `system_admin` 配置中心，Admin 页面不显示“给某个知识库单独配置模型”的入口。Phase 17 起，Admin 运维页提供 Auth Settings、Audit Logs、Indexing、Dify key/mapping 和 MCP PAT/OAuth client/grant 管理入口。

## 3. 文档页面布局

```text
/app/kb/:kbId/docs/:docId
  - TopBar
  - LeftDocumentTree
  - DocumentTitle
  - Draft/Published state
  - Publish/Unpublish action
  - MilkdownEditorOrReader
  - RightOutline
```

规划但未实现：

- 文档版本列表和 restore UI。
- 当前文档切片侧栏。
- 当前文档检索命中解释。

## 4. 权限面板

位置：文档/知识库顶部“分享”或“协作”按钮。

Phase 16 已实现：

- 工作台顶部“协作”按钮打开 AccessPanel，默认目标为当前文档；未选中文档时为知识库；面板内可切换 Workspace / KB / Document。
- Workspace 使用 `workspace_members`，展示成员并允许管理 `admin/member/guest`；owner 锁定，不做 owner transfer。
- KB/document 使用 `collaborators`，展示协作者并允许管理 `manager/editor/viewer`；owner 锁定。
- 邀请优先按邮箱创建，支持 `require_approval`、过期时间和最大使用次数；`/invite/:token` 用于登录用户接受邀请，待审批邀请需管理员批准后才授权。
- 顶部“分享”按钮打开 SharePanel，支持只读分享链接、密码访问、登录要求、仅工作区成员、关闭分享和重置链接。
- `/share/:token` 是最小只读页；文档分享展示只读 Markdown，知识库分享展示文档树和只读文档内容入口，workspace 分享展示共享知识库列表。
- 前端交互禁止使用浏览器原生 `window.prompt` / `window.confirm` / `window.alert`；创建、重命名、删除、移除、未保存离开等应用内交互必须使用 OpenKB Web 弹窗。唯一例外是浏览器刷新/关闭标签页时的 `beforeunload` 未保存保护。

仍未实现：分享链接编辑权限、owner 转让、宽泛用户搜索、完整分享访问日志 UI。

## 5. 知识库 Dashboard

`/app/kb/:kbId` 在未选中文档时呈现知识库首页，而不是直接打开第一篇文档：

```text
/app/kb/:kbId
  - Overview metrics
  - Document coverage
  - Import jobs
  - Index status
  - Chunk map
  - Retrieval lab
  - Chunk settings
```

当前 Dashboard 已展示：

- 文档数、已发布文档数、chunk 数。
- 切片是否 stale、Milvus index 是否需要重建。
- 最近导入任务和最近 index rebuild job。
- 切片地图：按文档、标题、段落展示 parent/child chunk。
- 检索测试台：输入 query，选择 context mode，展示命中子块、父块上下文、raw score、rerank score。
- Settings：管理 KB 级切片模式、段落/全文父块、父/子分隔符、max chars、overlap，并触发 chunk rebuild。

## 6. 知识库设置页

知识库 owner/manager 可以管理：

- 标题。
- 描述。
- 公开性。
- 协作者。
- 邀请/分享。
- 目录。
- 只读查看索引状态和切片状态。

不能管理：

- Embedding 模型。
- Rerank 模型。
- LLM 模型。
- Milvus collection。

模型 secret、endpoint 和 model 配置只属于 `system_admin`；`tenant_admin` 可以查看检索状态但不能保存 Models 配置。Milvus 和检索模式仍是 admin 控制面能力。

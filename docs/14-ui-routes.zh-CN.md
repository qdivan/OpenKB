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
/app/admin/retrieval
```

Phase 13 起，未选中文档时 `/app/kb/:kbId` 展示知识库 Dashboard；选中文档后进入 Yuque-like 文档编辑器：左侧文档树、中心文档编辑器、右侧 outline，并支持 Read/Edit/Source、自动保存、上传导入、搜索入口和发布状态切换。

## 2. 当前未实现页面

```text
/share/:token
/admin
/admin/users
/admin/auth-settings
/admin/milvus
/admin/milvus/rebuild-jobs
/admin/audit-logs
```

当前已实现 `/app/admin/retrieval` 最小页面，用于检索模式、模型 probe 和索引重建。Admin 页面不显示“给某个知识库单独配置模型”的入口。

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

- ShareAndCollaboratorPanel。
- 文档版本列表和 restore UI。
- 当前文档切片侧栏。
- 当前文档检索命中解释。

## 4. 权限面板

位置：文档/知识库顶部“分享”或“协作”按钮。

规划包含：

- 当前公开性。
- 协作者列表。
- 添加协作者。
- 邀请链接。
- 分享链接。
- 密码访问。
- 仅空间成员访问。
- 关闭分享。

当前 Web 顶部已有分享/协作图标入口感知，但完整面板、密码分享、邀请审批和关闭/重置链接 UI 尚未实现。

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

模型、Milvus 和检索模式配置只属于 `system_admin` / `tenant_admin`。

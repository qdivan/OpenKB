# 14 — UI 路由和页面

## 1. 公共页面

```text
/login
/register
/verify-email
/share/:token
```

## 2. 应用页面

```text
/app
/app/workspaces
/app/workspaces/:workspaceId
/app/kb/:kbId
/app/kb/:kbId/docs/:docId
/app/search
/app/admin/retrieval
```

## 3. 文档页面布局

```text
/app/kb/:kbId/docs/:docId
  - TopBar
  - LeftDocumentTree
  - DocumentTitle
  - MilkdownEditorOrReader
  - RightOutline
  - ShareAndCollaboratorPanel
```

## 4. 权限面板

位置：文档/知识库顶部“分享”或“协作”按钮。

包含：

- 当前公开性。
- 协作者列表。
- 添加协作者。
- 邀请链接。
- 分享链接。
- 密码访问。
- 仅空间成员访问。
- 关闭分享。

## 5. Admin 页面

```text
/admin
/admin/users
/admin/auth-settings
/admin/milvus
/admin/milvus/rebuild-jobs
/app/admin/retrieval
/admin/audit-logs
```

当前已实现 `/app/admin/retrieval` 最小页面，用于检索模式、模型 probe 和索引重建。Admin 页面不显示“给某个知识库单独配置模型”的入口。

## 6. 知识库设置页

知识库 owner/manager 可以管理：

- 标题。
- 描述。
- 公开性。
- 协作者。
- 邀请/分享。
- 目录。

不能管理：

- Embedding 模型。
- Rerank 模型。
- LLM 模型。
- Milvus collection。

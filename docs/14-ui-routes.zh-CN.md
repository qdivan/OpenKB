# 14 — UI 路由和页面

本文记录当前 OpenKB Web 页面结构。OpenKB 的视觉风格保持自己的紧凑工作台设计；知识库处理、分块、检索、QA、summary 和 metadata 的信息层级参考 Dify External Knowledge 使用习惯，以便更自然地配合 Dify。

## 1. 已实现路由

```text
/
/login
/register
/verify-email
/password-reset
/invite/:token
/share/:token
/app
/app/workspaces
/app/workspaces/:workspaceId
/app/kb/:kbId
/app/kb/:kbId/docs/:docId
/app/search
/app/admin
/app/admin/users
/app/admin/auth-settings
/app/admin/email
/app/admin/retrieval
/app/admin/models
/app/admin/import-tools
/app/admin/indexing
/app/admin/dify
/app/admin/mcp
/app/admin/audit
/app/admin/security
```

`/app/kb/:kbId` 是知识库首页；选中文档后进入 `/app/kb/:kbId/docs/:docId`。工作台切换 workspace、KB、document 时使用软导航，不应再依赖整页刷新。

## 2. 工作台布局

主工作台：

```text
Left sidebar: space / knowledge base
Document tree: folder + page
Center: KB dashboard or document editor
Right panel: outline / metadata / versions
Top actions: search, settings, collaborators, share, logout
```

Phase 27-29 的语雀式空间入口会把左侧工作区列表逐步改为左上角空间切换器：

- “个人”分组显示当前用户个人空间。
- “空间”分组显示已加入的团队空间，并提供创建空间入口。
- `workspace` 仍是内部对象名；用户可见文案优先使用“空间”。

文档编辑页支持：

- 阅读、编辑、源码模式。
- Milkdown 富文本编辑，Markdown 版本仍是正文真相。
- 自动保存、显式保存、版本冲突提示。
- 发布/取消发布。
- 中心 `分段` 页管理分段设置、QA、summary 和检索派生层；右侧只保留文档辅助信息。

## 3. 知识库 Dashboard

顶层 tabs：

- `Overview`：文档数、发布数、segments、索引状态、最近导入和 rebuild 状态。
- `Segments`：按文档分组展示 PostgreSQL segments，显示 active/disabled/deleted、override、summary/QA 命中类型，并提供跳转到文档侧栏管理的入口。
- `Retrieval Lab`：使用当前 KB 默认 `retrieval_model`，允许临时覆盖 top_k、score_threshold 和 context mode；不会修改 KB 默认配置。
- `Settings`：Dify 风格设置入口。

Settings 子 tabs：

- `处理模式`：`doc_form`、`indexing_technique`、`process_rule_mode`、`parent_mode`、settings revision。
- `分块规则`：automatic/custom/hierarchical 参数、parent/subchunk separator、max tokens/chars、overlap、规则预览。
- `检索策略`：semantic/full_text/hybrid/keyword、top_k、score threshold、rerank 开关、hybrid weights。
- `Metadata`：KB metadata schema。
- `摘要`：summary index 配置和提示；配置本身不自动消耗 LLM。
- `重处理`：列出 page 文档 processing 状态，逐个调用 document reprocess；Milvus index rebuild 仍需手动执行。

## 4. 文档主区分段页

文档页顶部保留 `编辑 / 分段 / 源码`。`分段` 页是文档级处理工作区：

- `分段设置`：预处理规则、分隔符、长度、overlap、段落父子/全文父子、子分段长度等；保存后只标记 `needs_reprocess`。
- `Segments`：普通分段列表，或父分段 + 可折叠子分段；enable/disable、override、soft delete/restore 只影响检索派生层，不反写 Markdown 正文。
- `QA`：QA 知识库在主区显示手动 QA、CSV 导入、mock/LLM 生成。QA 索引 question，Dify Adapter metadata 返回 `qa_question` / `qa_answer`，Web 可继续 answer-first 展示。
- `Summary`：文档级和 segment 级 summary，支持 manual/mock/LLM 显式生成。Summary hit 映射回原始 active chunk。

没有当前版本 active content segments 时，QA/summary/segment 操作应提示先 reprocess 文档。

## 5. 文档右侧面板

文档右侧 tabs：

- `大纲`：标题大纲。
- `Metadata`：文档级 metadata values。
- `Versions`：版本列表、Markdown 预览、差异摘要、restore。

知识库首页右侧使用 KB 侧栏，不渲染文档专属空面板。右侧栏内容区独立滚动，窄屏隐藏以避免挤压主编辑区。

## 6. 协作与分享

顶部协作按钮打开 AccessPanel：

- Space / Workspace 使用 `workspace_members`，角色为 `owner/admin/member/guest`。
- KB/document 使用 `collaborators`，角色为 `owner/manager/editor/viewer`。
- 邮箱邀请支持过期时间、最大使用次数和审批。
- `/invite/:token` 用于登录用户接受邀请。

顶部分享按钮打开 SharePanel：

- 只读分享链接。
- 密码访问。
- 登录要求。
- 仅 workspace member。
- 关闭分享和重置链接。
- `/share/:token` 是最小只读页面；v0.x 不提供分享链接编辑权限。

前端禁止使用浏览器原生 `window.prompt`、`window.confirm`、`window.alert`。应用内交互必须使用 OpenKB Web dialog；唯一例外是浏览器刷新/关闭标签页时的 `beforeunload` 未保存保护。

## 7. Admin 控制台

Admin 页面包括：

- Users：账号创建、欢迎设置密码邮件、激活/停用/软删除、租户角色、会话撤销和审计。
- Auth Settings：注册、邮箱验证、邀请必需、默认状态、域名白名单。
- Email：SMTP 配置、测试发送、outbox 状态和重试。
- Retrieval：检索状态和探测。
- Models：实例级 embedding/rerank/LLM 配置；仅 `system_admin` 可保存 secret。
- Import Tools：实例级 MarkItDown/MinerU/Pandoc/Tesseract OCR 路由；仅 `system_admin` 可保存 secret。
- Indexing：Milvus health、profiles、rebuild jobs、alias switch。
- Dify：Dify API key、mapping、allowed KB、配置向导和可过滤 metadata 字段。
- MCP：PAT、OAuth clients、grants。
- Audit：完整审计列表和过滤。
- Security：secrets 状态、轮换提示和运维安全入口。

Admin 配置不是内容权限。管理员能管理元数据，但不能默认读取所有私有正文；紧急内容接管必须显式确认并写 audit。

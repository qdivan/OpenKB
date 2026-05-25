# 15 - Roadmap 与 Codex 任务

本文是当前开发路线的收口入口。历史 phase 的详细审计材料保留在对应专题文档里；本文件只记录仍影响当前开发判断的状态和下一步。

## 当前主线

当前主线为 `v0.3.x / Phase 31`：

- Phase 21-22：Dify External Knowledge 配合、知识库处理配置、检索策略、segment、QA、summary 和 Web 信息层级已完成基础闭环。
- Phase 23-25：chunk 参数一致性、QA parity、图片与附件检索底座、同模型检索验证和稳定收口已完成。
- Phase 26：Dify Hub 使用 Dify Dataset Service API 管理 external dataset 和 metadata schema，不使用 Console cookie，不写 Dify 数据库。
- Phase 27：注册与个人空间已落地。active 用户拥有个人空间，`/app` 默认进入个人空间 dashboard，存量 active 用户登录时懒创建个人空间。
- Phase 28：团队空间创建与空间切换器已落地。左上角空间切换器按“个人 / 空间”分组，用户可创建团队空间，创建者自动成为空间 owner。
- Phase 29：空间主页与知识库归属已落地。空间主页展示知识库卡片、快捷入口和最近内容；创建知识库时必须确认归属空间；KB Dashboard 右侧显示空间上下文。
- Phase 30：语雀式权限细化已落地。知识库权限页按“公开性 + 协作者”组织；文档权限和分享入口靠近文档标题；空间成员、知识库协作者、文档协作者三层角色说明统一。
- Phase 31：迁移与兼容已落地。旧 `Default Workspace / OpenKB Demo` 默认作为团队空间处理，提供只读迁移报告和手动 runbook，不自动搬迁私有内容或重写权限。
- 最新体验修复：语言切换保持当前 URL 和工作台选择；导入任务面板展示 pending/running/succeeded/failed、错误、警告和 MinerU/worker 卡住诊断；认证设置新增“登录首页显示注册入口”，与后端注册开关、邀请制和邮箱白名单分开管理。

## 当前边界

- 个人空间和团队空间都由 `workspaces` 承载，不新增独立 Team 表。
- `tenant` 继续是后台、部署、多租户和系统管理边界，不作为普通用户的一层空间入口。
- 空间成员角色为 `owner/admin/member/guest`，知识库/文档协作者角色仍为 `owner/manager/editor/viewer`。
- 管理员可以管理元数据和后台配置，但不会默认读取私有正文；紧急接管必须审计。
- Dify Hub 只能安全管理 Dify external dataset，不删除 OpenKB 内容，不写 Dify 数据库。
- 旧 workspace 迁移报告只读；空间类型建议需要管理员人工复核。
- 旧派生数据不自动迁移；升级后由管理员显式 reprocess，再执行 Milvus blue-green index rebuild。
- 登录首页是否展示注册入口只是 UI 入口开关；`registration_enabled` 仍是后端是否接受自助注册的安全真相。
- MinerU、MarkItDown、Pandoc 和 OCR 工具仍是实例级导入基础设施，只能由 `system_admin` 配置。

## 后续路线

### Phase 29 已实现：空间主页与知识库归属

- 空间主页展示知识库卡片、最近内容、快捷入口和成员入口。
- 创建知识库时必须选择归属空间；从当前空间进入时默认归属当前空间。
- 知识库列表区分个人空间知识库和团队空间知识库。
- KB Dashboard 右侧信息改成空间上下文，不混用文档专属空面板。

### Phase 30 已实现：语雀式权限细化

- 知识库权限页按“公开性 + 协作者”重组。
- 文档分享和权限入口靠近语雀式页面布局。
- 空间成员、知识库协作者、文档协作者三层权限说明统一。
- 管理员紧急接管继续显式审计，不作为默认读取权限。

### Phase 31 已实现：迁移与兼容

- `0023_workspace_compatibility` 为旧 workspace 补空间类型和头像兜底，`default-workspace` 固定为团队空间。
- `pnpm --filter @openkb/db workspace:migration-report` 生成只读迁移报告，标注 team / personal / needs review 候选。
- `docs/33-workspace-migration-compatibility.zh-CN.md` 提供 OpenKB Demo / Default Workspace 归属 runbook。
- 不自动重写私有内容权限，不自动移动知识库，不自动改 collaborators。

## 重点验证清单

- `pnpm test`
- `pnpm auth:test`
- `pnpm content:test`
- `pnpm retrieval:test`
- `pnpm dify:test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

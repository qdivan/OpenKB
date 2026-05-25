# 32 - 语雀式空间与知识库模型

本文是 Phase 26 起的产品基线文档，用于把 OpenKB 的空间、注册、知识库和权限体验继续向语雀式产品逻辑收口。Phase 27 已落地个人空间；Phase 28 已落地团队空间创建和左上角空间切换器；Phase 29 已落地空间主页知识库卡片、归属空间选择和知识库首页空间上下文；Phase 30 已落地语雀式权限入口和三层角色说明；Phase 31 已落地旧 workspace 兼容迁移报告和 runbook。最新主线还补齐了登录页注册入口独立配置、邮箱白名单展示、导入任务进度可见和工作台语言切换不跳转。

参考来源：

- 用户提供的语雀登录态截图：左上角空间切换器分为“个人”和“空间”，空间下可创建团队空间。
- 语雀空间官网说明：个人版用于个人笔记、日记和知识管理；语雀空间用于团队协作、企业知识沉淀和知识库门户。
- 语雀知识库权限说明：知识库权限由“公开性 + 协作者”两部分组成，公开性包含仅协作者、空间成员和互联网公开。

## 1. 产品模型

OpenKB 采用“空间 - 知识库 - 文档”模型：

```text
Tenant / 实例或租户边界
└── Space / Workspace / 空间
    ├── 个人空间
    └── 团队空间
        └── Knowledge Base / 知识库
            └── Folder / Document / 目录与文档
```

决策：

- 不新增独立 Team 表。
- 个人空间和团队空间都由 `workspaces` 承载。
- `tenant` 继续是后台、部署、多租户和系统管理边界，不作为普通用户的一层空间入口。
- 团队协作能力由团队空间表达；空间成员和知识库协作者是两层不同权限。

## 2. Phase 27 已实现：注册与个人空间

- `workspaces.kind = personal | team`。
- `workspaces.personal_owner_user_id` 指向个人空间 owner。
- 同一 tenant 下，每个用户只能有一个个人空间。
- 注册无需邮箱验证且最终为 active 时创建个人空间。
- 邮箱验证后变为 active 时创建个人空间。
- 管理员创建 active 用户、管理员激活用户或把用户状态改为 active 时创建个人空间。
- active 存量用户登录时懒创建个人空间，用作修复路径。
- `/app` 无显式 KB/doc 参数时默认进入当前用户个人空间 dashboard。
- 个人 dashboard 展示我的知识库、最近编辑、最近浏览；收藏和评论先保留入口和空状态。
- 个人空间 owner 只是 `workspace_members.role = owner`，不等于 `system_admin`。

不会创建个人空间的状态：

- `pending_email_verification`
- `pending_activation`
- `suspended`
- `deleted`

## 3. Phase 28 已实现：团队空间与空间切换器

- `workspaces.avatar_color` 和 `workspaces.avatar_initials` 用于颜色 + 首字头像。
- 用户可以创建团队空间，创建者自动成为 `workspace_members.role = owner`。
- 客户端不能创建 `kind=personal` 空间，也不能写入 `personal_owner_user_id`。
- 左上角空间切换器按“个人 / 空间”分组。
- “个人”显示当前用户个人空间。
- “空间”显示已加入或可管理的团队空间，并提供创建空间入口。
- 选择空间后进入空间主页，不自动打开第一个知识库。
- 团队空间主页显示成员入口，复用现有空间成员管理面板。
- 团队空间设置支持名称、slug、头像颜色和头像首字。
- 个人空间设置本阶段仍由系统生成，不开放用户侧修改。

## 4. 语雀页面逻辑总结

语雀登录后的默认入口更接近“个人工作台”：

- 左上角是空间切换器。
- 切换器分为“个人”和“空间”两组。
- “个人”下是当前用户自己的空间。
- “空间”下是已加入的团队空间，并提供创建空间入口。
- 首页提供新建文档、新建知识库、模板中心等快捷入口。
- 最近内容列表会显示文档所属个人空间或团队空间、知识库和创建者等上下文。
- 空间主页用于聚合知识库、最近内容、成员协作和快捷入口。

OpenKB 当前已经覆盖个人空间、团队空间创建、空间切换器、空间 dashboard、成员入口、知识库归属空间选择、知识库卡片、最近内容、知识库公开性 + 协作者入口、文档权限/分享入口，以及旧 workspace 迁移报告；模板中心、团队邀请和批量迁移工具留在后续阶段。

## 5. 权限模型映射

语雀式知识库权限分两层：

| 语雀语义 | OpenKB 映射 |
| --- | --- |
| 空间成员 | `workspace_members`，角色为 `owner/admin/member/guest` |
| 知识库公开性：仅协作者 | `knowledge_bases.visibility = private` |
| 知识库公开性：空间成员 | `knowledge_bases.visibility = workspace` |
| 知识库公开性：互联网公开 | `knowledge_bases.visibility = public` |
| 知识库协作者 | `collaborators.object_type = knowledge_base` |
| 文档协作者 | `collaborators.object_type = document` |

管理员边界不变：

- `system_admin` / `tenant_admin` 可以管理元数据和后台配置。
- 管理员不会默认读取私有正文。
- 紧急接管必须写 audit，并授予普通协作者角色后再读取。

## 6. 差异与后续目标

| 项目 | 当前状态 | 后续目标 |
| --- | --- | --- |
| 注册后默认入口 | active 用户有个人空间，`/app` 默认进入个人 dashboard | 增加更完整的新手引导 |
| 空间切换器 | 已按“个人 / 空间”分组 | 增加搜索、排序和更多空间设置 |
| 个人空间 | 已有 `kind=personal`、唯一 owner 和 dashboard | 增加个人头像/空间偏好、收藏/评论完整数据 |
| 团队空间 | 支持创建、头像、slug、空间主页和成员入口 | 增加邀请、成员 onboarding、空间设置页 |
| 知识库归属 | 创建知识库时必须确认归属空间，默认当前空间；空间主页按个人/团队空间展示知识库卡片 | 后续补更多空间筛选 |
| 旧空间兼容 | `default-workspace` 默认保留为团队空间；提供只读迁移报告和 runbook | 后续如需要再做带审计的一键迁移工具 |
| 团队层 | 无独立 Team | 继续不拆 Team；团队由团队空间表达 |

## 7. 后续路线图

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

- 为已有 default workspace 标记团队空间类型，并补头像兜底元数据。
- 提供 `workspace:migration-report` 只读迁移报告，标出 personal/team/needs review 候选。
- 提供 `docs/33-workspace-migration-compatibility.zh-CN.md` runbook，说明 OpenKB Demo / Default Workspace 默认归属团队空间。
- 不自动重写私有内容权限；不自动移动 KB；不自动改 collaborators。

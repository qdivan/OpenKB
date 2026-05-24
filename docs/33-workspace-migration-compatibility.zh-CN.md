# 33 - 空间迁移与兼容 Runbook

本文用于 Phase 31：把旧版本中的 workspace 纳入“个人空间 / 团队空间”模型，同时避免误改私有内容权限。

## 原则

- 旧 `Default Workspace` / `OpenKB Demo` 默认作为团队空间处理。
- 迁移只处理空间元数据和 UI 入口，不自动移动知识库，不自动改 collaborators，不自动公开私有正文。
- PostgreSQL 仍是权限真相；管理员未显式审计接管前不能读取私有正文。
- 迁移报告是只读审计工具，不会写数据库。

## 升级后自动校正

`0023_workspace_compatibility` 会幂等补齐旧空间元数据：

- `default-workspace` 固定为 `kind = team`。
- `default-workspace.personal_owner_user_id = null`。
- 缺少头像信息的旧空间会补 `avatar_color` 和 `avatar_initials` 兜底值。

它不会：

- 把任何旧空间自动改成个人空间。
- 移动知识库到另一个空间。
- 重写 KB / 文档公开性或协作者。
- 修改分享链接、邀请、审计日志或管理员接管记录。

## 生成迁移报告

默认输出 Markdown：

```bash
pnpm --filter @openkb/db workspace:migration-report
```

输出 JSON：

```bash
pnpm --filter @openkb/db workspace:migration-report --format json
```

写入文件：

```bash
pnpm --filter @openkb/db workspace:migration-report --format markdown --output .codex-runtime/workspace-migration-report.md
```

报告包含：

- workspace 基本信息：id、tenant、名称、slug、当前 `kind`。
- 建议类型：`team_candidate`、`personal_candidate`、`needs_review`。
- 置信度和原因。
- 成员数量、owner 数、KB 数、文档数。
- 是否为 `default-workspace`。
- 唯一 owner 是否已经有其它个人空间。

报告不会输出文档正文、token、cookie、模型 key、SMTP 密码、OAuth secret 或加密 secret。

## 判定规则

`team_candidate`：

- 成员数大于 1。
- 存在 `workspace` 或 `public` 可见知识库。
- slug/name 命中 `default-workspace`、`OpenKB Demo`、`team`、`demo`、`default`。

`personal_candidate`：

- 只有一个 owner，且没有 admin/member/guest。
- 知识库全部为 private。
- `created_by` 与唯一 owner 一致。

`needs_review`：

- 没有成员。
- 多个 owner。
- 创建者用户已不存在。
- 唯一 owner 已经有其它个人空间。
- 团队信号和个人信号混合，且不是明确的 default/demo 团队空间。

## Default Workspace / OpenKB Demo 处理建议

默认建议：保留为团队空间。

适用场景：

- 它是 seed-dev 或早期版本创建的示例空间。
- 空间内包含 `OpenKB Demo`。
- 知识库可见性是 `workspace` 或面向团队协作。
- 多个用户已经通过 workspace 成员或 KB 协作者访问内容。

操作：

1. 执行迁移后确认 `Default Workspace.kind = team`。
2. 打开空间主页，确认 OpenKB Demo 出现在“空间知识库”。
3. 保留现有 KB visibility、collaborators、share links。
4. 如需更新展示名称，可通过团队空间设置修改 name、slug、头像颜色和首字。

## 将旧空间转为个人空间的手动流程

只有在报告显示 `personal_candidate` 且管理员确认这是某个用户的个人内容时，才考虑手动迁移。

建议流程：

1. 确认目标用户已是 active，并已拥有系统创建的个人空间。
2. 备份数据库或至少导出迁移报告。
3. 将目标知识库移动到该用户个人空间，或保留原空间并只调整 UI 入口。
4. 不自动改 KB/document visibility。
5. 不自动删除原 workspace 成员或 collaborators。
6. 让目标用户登录检查个人空间 dashboard、知识库卡片和最近内容。
7. 管理员只做元数据核对；如需读私有正文，必须走显式审计接管。

Phase 31 不提供一键迁移。需要批量移动知识库或合并空间时，应在后续 Phase 32 单独实现带 dry-run、确认和 audit 的迁移工具。

## 验收清单

- `pnpm --filter @openkb/db workspace:migration-report` 可输出报告。
- `default-workspace` 被报告为团队空间候选。
- 个人空间唯一约束仍生效。
- 旧私有 KB、文档协作者和分享链接行为不变。
- `/app` 默认进入个人空间；旧 Default Workspace 可通过空间切换器进入。
- Web Search、MCP、Dify 和附件读取继续走最终权限检查。

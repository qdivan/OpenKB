# 06 — 注册、激活与个人空间

本文描述 OpenKB v0.x 的账号注册、邮箱验证、管理员创建账号、密码设置和 Phase 27 个人空间语义。

## 1. 用户状态

`users.status` 允许值：

- `pending_email_verification`
- `pending_activation`
- `active`
- `suspended`
- `deleted`

只有 `active` 用户可以登录。`suspended` 和 `deleted` 用户不能登录。

## 2. 注册策略

注册策略由 `auth_settings` 控制：

```text
registration_enabled
login_registration_enabled
email_verification_required
default_signup_status = active | pending_activation
invited_user_auto_active
allowed_email_domains
invite_required
first_user_becomes_admin
```

`registration_enabled` 是后端是否接受自助注册请求的安全开关；关闭后，直接调用注册 API 也会被拒绝。`login_registration_enabled` 只控制登录页和 `/register` 页面是否展示公开注册入口；它不会替代后端校验。

`allowed_email_domains` 为空时表示不限制邮箱域名；有值时，只有邮箱域名命中的用户可以自行注册。Admin -> 认证设置中通过“只允许白名单邮箱域名注册”开关启用限制，再用“编辑白名单”弹窗维护域名。管理员可以输入 `sailuntire.com`、`@qq.com` 或 `user@sailuntire.com` 这类形式，系统会统一保存为域名（例如 `sailuntire.com`、`qq.com`）。管理员手动创建账号不受该自助注册白名单影响。

登录页和注册页使用公开只读配置接口读取注册展示策略。该接口只返回是否允许注册、登录页是否展示注册、是否邀请制、是否启用邮箱域名白名单和允许的域名列表；不返回任何管理侧敏感配置。

优先读取租户级设置；如果租户级设置不存在，则读取 `tenant_id = null` 的实例默认设置。

## 3. 注册流程

```text
用户提交邮箱和密码
  -> 创建 user
  -> 写入 tenant_memberships(role=member)
  -> 如果需要邮箱验证：pending_email_verification
  -> 否则按 default_signup_status 进入 active 或 pending_activation
```

如果最终状态为 `active`，系统必须在同一事务内确认个人空间存在。

## 4. 邮箱验证与激活

邮箱验证 token 使用 `auth_tokens.purpose = email_verification`。用户点击验证链接后：

```text
验证 token
  -> 根据 default_signup_status 更新 user.status
  -> 消费 token
  -> 若 user.status = active，创建或确认个人空间
```

如果用户进入 `pending_activation`，不会创建个人空间；管理员激活后再创建。

## 5. 管理员创建账号

管理员创建账号时：

- 用户状态为 `active`。
- 系统生成 `account_setup` 一次性 token。
- 邮件文案是欢迎设置密码，不是普通重置密码。
- 如果 SMTP 可用，系统立即尝试投递；失败时保留 outbox 记录供重试。
- 创建 active 用户时必须创建或确认个人空间。

`account_setup` 和 `password_reset` 链接都只能使用一次。再次生成新链接会让旧的未使用链接失效。

## 6. 第一个用户成为管理员

如果系统中不存在任何 `system_admin`，且 `first_user_becomes_admin = true`，第一位完成注册/验证并进入 active 的用户会获得：

```text
tenant_memberships.role = system_admin
```

这只影响租户/后台角色，不影响个人空间语义。个人空间 owner 不等于 `system_admin`。

## 7. Phase 27 个人空间

Phase 27 起，active 用户必须拥有一个个人空间：

```text
active user
  -> workspaces.kind = personal
  -> workspaces.personal_owner_user_id = users.id
  -> workspace_members.role = owner
```

创建触发点：

- 注册无需邮箱验证且最终状态为 `active`。
- 邮箱验证后状态变为 `active`。
- 管理员创建 active 用户。
- 管理员激活用户，或把用户状态改为 `active`。
- active 存量用户登录时懒创建，作为修复路径。

不会创建个人空间的状态：

- `pending_email_verification`
- `pending_activation`
- `suspended`
- `deleted`

默认名称：`{displayName 或邮箱前缀} 的个人空间`。

默认 slug：`u-{userId 前缀}`，避免暴露邮箱。

同一 tenant 下，同一个 user 只能有一个个人空间。

## 8. 登录后的默认入口

`/app` 无显式 workspace/kb/doc 参数时，默认进入当前用户的个人空间 dashboard。

直接访问以下路径时，不会被个人空间默认逻辑覆盖：

```text
/app/workspaces/:workspaceId
/app/kb/:kbId
/app/kb/:kbId/docs/:docId
```

个人 dashboard 当前展示：

- 我的知识库。
- 最近编辑。
- 最近浏览。
- 收藏入口和空状态。
- 评论入口和空状态。

收藏和评论数据模型留到后续阶段。

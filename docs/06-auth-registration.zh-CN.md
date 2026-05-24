# 06 — 用户注册、登录和激活

## 1. 注册方式

v0.x 支持邮箱注册和邮箱密码登录。

不做：

- LDAP。
- SCIM。
- 企业组织架构同步。
- 第三方 OAuth 登录，后续可加。

## 2. 用户状态

```text
pending_email_verification
pending_activation
active
suspended
deleted
```

## 3. 管理员设置

后台注册设置：

```text
允许邮箱注册：开/关
必须验证邮箱：开/关
注册后默认状态：active / pending_activation
被邀请用户验证邮箱后是否自动激活：开/关
允许邮箱域名白名单：可选
仅允许邀请注册：开/关
第一位用户自动成为 system_admin：开/关，默认开
```

## 3.1 auth_settings 表结构

`auth_settings` 必须在 `docs/07-data-model.zh-CN.md` 中实现。核心字段包括：

```text
registration_enabled
email_verification_required
default_signup_status = active | pending_activation
invited_user_auto_active
allowed_email_domains
invite_required
first_user_becomes_admin
```

实现时优先读取租户级设置；如果不存在租户级设置，则读取 `tenant_id = null` 的实例默认设置。

## 4. 注册流程

```text
用户提交邮箱和密码
  -> 创建 user
  -> 如果需要邮箱验证：pending_email_verification
  -> 用户点击验证链接
  -> 如果默认需要管理员激活：pending_activation
  -> 否则 active
```

## 5. 激活流程

管理员后台可查看 pending_activation 用户，并执行：

- 激活。
- 拒绝/删除。
- 禁用 active 用户。
- 重发验证邮件。

所有操作写入 audit_logs。

管理员创建账号时不生成临时明文密码，也不使用普通“重置密码”文案。系统创建 `account_setup` 一次性 token，并写入“欢迎设置密码”邮件。若生产 SMTP 已配置，系统会立即尝试投递；未配置或投递失败时，记录保留在 `auth_email_outbox`，管理员可以在邮件队列中重试。

`account_setup` 和 `password_reset` 链接都只能使用一次。同一用户再次生成设置/重置链接时，旧的未使用设置/重置链接必须失效。设置或重置成功后，用户应回到登录页；当前链接再次提交必须返回 `INVALID_OR_EXPIRED_TOKEN`。

## 6. 邀请注册

用户通过邀请链接注册时：

```text
打开邀请链接
  -> 注册/登录
  -> 邮箱验证
  -> 如果链接需要审批：进入待审批
  -> 否则根据 object_type 授权：
      workspace -> 写入 workspace_members
      knowledge_base/document -> 写入 collaborators
```

被邀请用户是否自动 active 由后台设置决定。

## 7. 第一位用户

如果系统中不存在任何 system_admin，且 `first_user_becomes_admin = true`，第一位完成注册/验证流程的用户必须被授予：

```text
tenant_memberships.role = system_admin
```

如果系统采用多租户初始化流程，该用户也应成为默认 tenant 的 tenant_admin。

## 8. 个人空间路线图

Phase 27 起，新用户完成注册、验证和激活后，应自动拥有一个个人空间：

```text
用户完成注册/激活
  -> 创建或确认 personal workspace
  -> 写入 workspace_members(owner)
  -> 首次登录进入个人空间 dashboard
```

个人空间 owner 不等于 `system_admin`。租户继续是后台和部署边界，不显示为普通用户的空间入口。团队协作通过用户显式创建团队空间实现。

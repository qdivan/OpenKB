import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import {
  encryptSmtpPassword,
  getSmtpConfig,
  sendEmail,
  type StoredSmtpSetting
} from "@openkb/email";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";

export type UpdateSmtpSettingsInput = {
  enabled?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  username?: string | null;
  password?: string | null;
  clear_password?: boolean;
  from_email?: string | null;
  reply_to?: string | null;
};

export type TestEmailInput = {
  to?: string;
  subject?: string;
  text?: string;
};

@Injectable()
export class ProductionAdminService {
  private readonly prisma: PrismaClient;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async getEmailSettings(sessionToken: string | null) {
    await this.requireSystemAdmin(sessionToken);
    const setting = await this.getSmtpSetting();
    return this.toSmtpSettingsDto(setting);
  }

  async updateEmailSettings(sessionToken: string | null, input: UpdateSmtpSettingsInput) {
    const me = await this.requireSystemAdmin(sessionToken);
    const current = await this.getSmtpSetting();
    const passwordUpdate =
      input.password !== undefined
        ? encryptSmtpPassword(input.password)
        : input.clear_password
          ? { encrypted: null, last4: null }
          : null;
    const now = new Date();

    const saved = await this.prisma.smtpSetting.upsert({
      where: { scope: "instance" },
      create: {
        scope: "instance",
        enabled: Boolean(input.enabled),
        host: normalizeNullableText(input.host),
        port: normalizeNullablePort(input.port),
        secure: input.secure ?? true,
        username: normalizeNullableText(input.username),
        encrypted_password: passwordUpdate?.encrypted ?? null,
        password_last4: passwordUpdate?.last4 ?? null,
        from_email: normalizeNullableText(input.from_email),
        reply_to: normalizeNullableText(input.reply_to),
        updated_by: me.user.id,
        created_at: now,
        updated_at: now
      },
      update: {
        enabled: input.enabled ?? current?.enabled ?? false,
        host: input.host !== undefined ? normalizeNullableText(input.host) : current?.host,
        port: input.port !== undefined ? normalizeNullablePort(input.port) : current?.port,
        secure: input.secure ?? current?.secure ?? true,
        username:
          input.username !== undefined ? normalizeNullableText(input.username) : current?.username,
        ...(passwordUpdate
          ? {
              encrypted_password: passwordUpdate.encrypted,
              password_last4: passwordUpdate.last4
            }
          : {}),
        from_email:
          input.from_email !== undefined
            ? normalizeNullableText(input.from_email)
            : current?.from_email,
        reply_to:
          input.reply_to !== undefined ? normalizeNullableText(input.reply_to) : current?.reply_to,
        updated_by: me.user.id,
        updated_at: now
      }
    });

    await this.writeAudit(me, "admin.email.settings.update", "smtp_settings", saved.id, {
      fields: Object.keys(input).filter((field) => field !== "password")
    });
    return this.toSmtpSettingsDto(saved);
  }

  async probeEmail(sessionToken: string | null, input: UpdateSmtpSettingsInput = {}) {
    await this.requireSystemAdmin(sessionToken);
    const current = await this.getSmtpSetting();
    const transient = {
      enabled: input.enabled ?? current?.enabled ?? false,
      host: input.host !== undefined ? normalizeNullableText(input.host) : (current?.host ?? null),
      port: input.port !== undefined ? normalizeNullablePort(input.port) : (current?.port ?? null),
      secure: input.secure ?? current?.secure ?? true,
      username:
        input.username !== undefined
          ? normalizeNullableText(input.username)
          : (current?.username ?? null),
      from_email:
        input.from_email !== undefined
          ? normalizeNullableText(input.from_email)
          : (current?.from_email ?? null),
      reply_to:
        input.reply_to !== undefined
          ? normalizeNullableText(input.reply_to)
          : (current?.reply_to ?? null),
      encrypted_password:
        input.password !== undefined
          ? encryptSmtpPassword(input.password).encrypted
          : (current?.encrypted_password ?? null),
      password_last4:
        input.password !== undefined
          ? encryptSmtpPassword(input.password).last4
          : (current?.password_last4 ?? null)
    } satisfies StoredSmtpSetting;
    const config = getSmtpConfig(process.env, transient);
    return {
      ok: config.enabled && !config.secretError && Boolean(config.host && config.fromEmail),
      source: config.source,
      message:
        config.secretError ??
        (config.enabled ? "SMTP configuration is usable." : "SMTP is not configured."),
      host: config.host ?? null,
      from_email: config.fromEmail ?? null
    };
  }

  async sendTestEmail(sessionToken: string | null, input: TestEmailInput) {
    const me = await this.requireSystemAdmin(sessionToken);
    const setting = await this.getSmtpSetting();
    const config = getSmtpConfig(process.env, setting);
    const to = normalizeNullableText(input.to) ?? me.user.email;
    const result = await sendEmail(config, {
      to,
      subject: input.subject?.trim() || "OpenKB SMTP test",
      text: input.text?.trim() || "This is an OpenKB SMTP test message."
    });
    await this.writeAudit(me, "admin.email.test_send", "smtp_settings", setting?.id ?? null, {
      ok: result.ok,
      source: result.source,
      to
    });
    return result;
  }

  async listOutbox(sessionToken: string | null, input: { limit?: number; offset?: number } = {}) {
    await this.requireSystemAdmin(sessionToken);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.authEmailOutbox.findMany({
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.authEmailOutbox.count()
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        tenant_id: item.tenant_id,
        to_email: item.to_email,
        template: item.template,
        subject: item.subject,
        status: item.status,
        error: item.error,
        attempts: item.attempts,
        last_attempt_at: item.last_attempt_at?.toISOString() ?? null,
        sent_at: item.sent_at?.toISOString() ?? null,
        created_at: item.created_at.toISOString()
      })),
      limit,
      offset,
      total
    };
  }

  async retryOutbox(sessionToken: string | null, id: string) {
    const me = await this.requireSystemAdmin(sessionToken);
    const item = await this.prisma.authEmailOutbox.findUnique({ where: { id } });
    if (!item) {
      throw new AuthError("OBJECT_NOT_FOUND", "Outbox item was not found.", 404);
    }
    const setting = await this.getSmtpSetting();
    const result = await sendEmail(getSmtpConfig(process.env, setting), {
      to: item.to_email,
      subject: item.subject,
      text: String(
        (item.payload as { link_url?: string })?.link_url ?? item.link_url ?? item.subject
      )
    });
    await this.prisma.authEmailOutbox.update({
      where: { id },
      data: {
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date() : item.sent_at,
        error: result.ok ? null : (result.error ?? "Email delivery failed."),
        attempts: { increment: 1 },
        last_attempt_at: new Date()
      }
    });
    await this.writeAudit(me, "admin.email.outbox.retry", "auth_email_outbox", id, {
      ok: result.ok
    });
    return result;
  }

  async getOpsHealth(sessionToken: string | null) {
    const me = await this.requireAdmin(sessionToken);
    const smtp = getSmtpConfig(process.env, await this.getSmtpSetting());
    const [db, emailOutbox] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => "ok").catch(() => "error"),
      this.prisma.authEmailOutbox.groupBy({
        by: ["status"],
        _count: { _all: true }
      })
    ]);
    return {
      tenant_id: me.tenantId,
      database: db,
      redis: process.env.REDIS_URL ? "configured" : "not_configured",
      s3: process.env.S3_ENDPOINT ? "configured" : "not_configured",
      milvus: process.env.MILVUS_URI ? "configured" : "not_configured",
      smtp: {
        source: smtp.source,
        enabled: smtp.enabled,
        ok: smtp.enabled && !smtp.secretError,
        error: smtp.secretError ?? null
      },
      mcp_oauth: {
        issuer: process.env.MCP_OAUTH_ISSUER || process.env.MCP_SERVER_BASE_URL || null,
        access_token_ttl_seconds: parsePositiveInt(
          process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
          900
        ),
        refresh_token_ttl_days: parsePositiveInt(process.env.MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS, 30)
      },
      email_outbox: Object.fromEntries(emailOutbox.map((row) => [row.status, row._count._all])),
      checked_at: new Date().toISOString()
    };
  }

  async listSecrets(sessionToken: string | null) {
    await this.requireSystemAdmin(sessionToken);
    const smtp = await this.getSmtpSetting();
    const counts = await Promise.all([
      this.prisma.difyApiKey.count({ where: { encrypted_key: { not: null } } }),
      this.prisma.modelSetting.count({ where: { encrypted_api_key: { not: null } } }),
      this.prisma.importToolSetting.count({ where: { encrypted_api_key: { not: null } } }),
      this.prisma.mcpOauthRefreshToken.count({ where: { revoked_at: null } })
    ]);
    return {
      config_encryption_key_set: Boolean(process.env.OPENKB_CONFIG_ENCRYPTION_KEY),
      items: [
        {
          kind: "smtp_password",
          encrypted_count: smtp?.encrypted_password ? 1 : 0,
          last4: smtp?.password_last4 ?? null,
          updated_at: smtp?.updated_at?.toISOString() ?? null
        },
        { kind: "dify_api_keys", encrypted_count: counts[0] },
        { kind: "model_api_keys", encrypted_count: counts[1] },
        { kind: "import_tool_keys", encrypted_count: counts[2] },
        { kind: "mcp_oauth_refresh_tokens", active_count: counts[3] }
      ]
    };
  }

  async rotateSecret(sessionToken: string | null, kind: string) {
    const me = await this.requireSystemAdmin(sessionToken);
    if (kind !== "mcp_oauth_refresh_tokens") {
      throw new AuthError(
        "SECRET_NOT_AVAILABLE",
        "This secret kind must be rotated from its dedicated admin page or the offline re-encryption script.",
        400
      );
    }
    const result = await this.prisma.mcpOauthRefreshToken.updateMany({
      where: { revoked_at: null },
      data: { revoked_at: new Date() }
    });
    await this.writeAudit(me, "admin.security.rotate", null, null, {
      kind,
      revoked_count: result.count
    });
    return { ok: true, kind, revoked_count: result.count };
  }

  private async getSmtpSetting() {
    return this.prisma.smtpSetting.findUnique({ where: { scope: "instance" } });
  }

  private toSmtpSettingsDto(setting: (StoredSmtpSetting & { id?: string }) | null) {
    const config = getSmtpConfig(process.env, setting);
    return {
      id: setting?.id ?? null,
      enabled: setting?.enabled ?? false,
      host: setting?.host ?? null,
      port: setting?.port ?? null,
      secure: setting?.secure ?? true,
      username: setting?.username ?? null,
      from_email: setting?.from_email ?? null,
      reply_to: setting?.reply_to ?? null,
      has_password: Boolean(setting?.encrypted_password || process.env.OPENKB_SMTP_PASSWORD),
      password_last4: setting?.password_last4 ?? config.passwordLast4 ?? null,
      source: config.source,
      env_configured: config.source === "env",
      updated_by: setting?.updated_by ?? null,
      updated_at: setting?.updated_at?.toISOString() ?? null
    };
  }

  private async requireAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private async requireSystemAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "System admin role is required.", 403);
    }
    return me;
  }

  private async writeAudit(
    me: AuthenticatedUser,
    action: string,
    objectType: string | null,
    objectId: string | null,
    metadata: Prisma.InputJsonObject
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: me.tenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata
      }
    });
  }
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeNullablePort(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new AuthError("INVALID_INPUT", "Port must be between 1 and 65535.", 400);
  }
  return value;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value && value > 0 ? Math.min(value, 100) : fallback;
}

function normalizeOffset(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 0;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";

export const AUTH_COOKIE_NAME = "openkb_session";

export type AuthErrorCode =
  | "ADMIN_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "EMAIL_ALREADY_REGISTERED"
  | "EMAIL_DOMAIN_NOT_ALLOWED"
  | "INVALID_CREDENTIALS"
  | "INVALID_INPUT"
  | "INVALID_OR_EXPIRED_TOKEN"
  | "INVITE_REQUIRED"
  | "REGISTRATION_DISABLED"
  | "USER_NOT_ACTIVE"
  | "USER_NOT_FOUND";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerifiedAt: string | null;
};

export type AuthenticatedUser = {
  user: PublicUser;
  tenantId: string;
  roles: string[];
};

export type RegisterInput = {
  email: string;
  password: string;
  displayName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type UpdateAuthSettingsInput = {
  registration_enabled?: boolean;
  email_verification_required?: boolean;
  default_signup_status?: "active" | "pending_activation";
  invited_user_auto_active?: boolean;
  allowed_email_domains?: string[];
  invite_required?: boolean;
  first_user_becomes_admin?: boolean;
};

export type AuthServiceOptions = {
  prisma?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

type AuthSettingsRecord = {
  id: string;
  tenant_id: string | null;
  registration_enabled: boolean;
  email_verification_required: boolean;
  default_signup_status: string;
  invited_user_auto_active: boolean;
  allowed_email_domains: string[];
  invite_required: boolean;
  first_user_becomes_admin: boolean;
};

type TokenPurpose = "email_verification" | "password_reset";

export class AuthService {
  private readonly prisma: PrismaClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(options: AuthServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async register(input: RegisterInput) {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);
    const now = this.now();
    const tenant = await this.ensureDefaultTenant();
    const settings = await this.getEffectiveAuthSettings(tenant.id);

    if (!settings.registration_enabled) {
      throw new AuthError("REGISTRATION_DISABLED", "Registration is disabled.", 403);
    }
    if (settings.invite_required) {
      throw new AuthError("INVITE_REQUIRED", "Registration requires an invitation.", 403);
    }
    assertEmailDomainAllowed(email, settings.allowed_email_domains);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.status !== "deleted") {
      throw new AuthError("EMAIL_ALREADY_REGISTERED", "Email is already registered.", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const status = settings.email_verification_required
      ? "pending_email_verification"
      : settings.default_signup_status;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              password_hash: passwordHash,
              display_name: displayName,
              status,
              email_verified_at: settings.email_verification_required ? null : now,
              updated_at: now
            }
          })
        : await tx.user.create({
            data: {
              email,
              password_hash: passwordHash,
              display_name: displayName,
              status,
              email_verified_at: settings.email_verification_required ? null : now,
              created_at: now,
              updated_at: now
            }
          });

      await tx.tenantMembership.upsert({
        where: {
          tenant_id_user_id: {
            tenant_id: tenant.id,
            user_id: user.id
          }
        },
        create: {
          tenant_id: tenant.id,
          user_id: user.id,
          role: "member",
          created_at: now
        },
        update: {}
      });

      let verificationLink: string | null = null;
      if (settings.email_verification_required) {
        verificationLink = await this.createAuthTokenAndOutbox(tx, {
          tenantId: tenant.id,
          userId: user.id,
          email: user.email,
          purpose: "email_verification",
          ttlHours: this.emailVerificationTtlHours()
        });
      } else {
        await this.promoteFirstAdminIfNeeded(tx, tenant.id, user.id, settings);
      }

      return {
        user,
        verificationLink
      };
    });

    return {
      user: toPublicUser(result.user),
      status: result.user.status,
      requiresEmailVerification: settings.email_verification_required,
      verificationOutboxLink: result.verificationLink
    };
  }

  async verifyEmail(token: string) {
    const now = this.now();
    const tokenHash = hashToken(token);

    return this.prisma.$transaction(async (tx) => {
      const authToken = await tx.authToken.findUnique({ where: { token_hash: tokenHash } });
      if (
        !authToken ||
        authToken.purpose !== "email_verification" ||
        authToken.consumed_at ||
        authToken.expires_at <= now
      ) {
        throw new AuthError(
          "INVALID_OR_EXPIRED_TOKEN",
          "Email verification token is invalid.",
          400
        );
      }

      const settings = await this.getEffectiveAuthSettings(authToken.tenant_id, tx);
      const user = await tx.user.update({
        where: { id: authToken.user_id },
        data: {
          status: settings.default_signup_status,
          email_verified_at: now,
          updated_at: now
        }
      });

      await tx.authToken.update({
        where: { id: authToken.id },
        data: { consumed_at: now }
      });
      await this.promoteFirstAdminIfNeeded(tx, authToken.tenant_id, user.id, settings);

      return {
        user: toPublicUser(user),
        status: user.status
      };
    });
  }

  async login(input: LoginInput) {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    }
    if (user.status !== "active") {
      throw new AuthError("USER_NOT_ACTIVE", "User is not active.", 403);
    }

    const tenant = await this.ensureDefaultTenant();
    await this.prisma.tenantMembership.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: tenant.id,
          user_id: user.id
        }
      },
      create: {
        tenant_id: tenant.id,
        user_id: user.id,
        role: "member",
        created_at: this.now()
      },
      update: {}
    });

    const rawSessionToken = createRawToken();
    const now = this.now();
    const expiresAt = addDays(now, this.sessionTtlDays());

    await this.prisma.authSession.create({
      data: {
        tenant_id: tenant.id,
        user_id: user.id,
        token_hash: hashToken(rawSessionToken),
        expires_at: expiresAt,
        last_seen_at: now,
        created_at: now
      }
    });

    return {
      sessionToken: rawSessionToken,
      expiresAt,
      me: await this.getAuthenticatedUserByUserId(user.id, tenant.id)
    };
  }

  async logout(sessionToken: string | null | undefined): Promise<void> {
    if (!sessionToken) {
      return;
    }

    await this.prisma.authSession.updateMany({
      where: {
        token_hash: hashToken(sessionToken),
        revoked_at: null
      },
      data: {
        revoked_at: this.now()
      }
    });
  }

  async getMe(sessionToken: string | null | undefined): Promise<AuthenticatedUser> {
    if (!sessionToken) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
    }

    const now = this.now();
    const session = await this.prisma.authSession.findUnique({
      where: { token_hash: hashToken(sessionToken) }
    });

    if (!session || session.revoked_at || session.expires_at <= now) {
      throw new AuthError("AUTHENTICATION_REQUIRED", "Session is invalid or expired.", 401);
    }

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { last_seen_at: now }
    });

    return this.getAuthenticatedUserByUserId(session.user_id, session.tenant_id);
  }

  async requestPasswordReset(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.status === "deleted") {
      return { ok: true };
    }

    const tenantId = await this.resolveUserTenantId(user.id);

    await this.prisma.$transaction(async (tx) => {
      await this.createAuthTokenAndOutbox(tx, {
        tenantId,
        userId: user.id,
        email: user.email,
        purpose: "password_reset",
        ttlHours: this.passwordResetTtlHours()
      });
    });

    return { ok: true };
  }

  async confirmPasswordReset(input: { token: string; password: string }) {
    const password = validatePassword(input.password);
    const tokenHash = hashToken(input.token);
    const now = this.now();

    await this.prisma.$transaction(async (tx) => {
      const authToken = await tx.authToken.findUnique({ where: { token_hash: tokenHash } });
      if (
        !authToken ||
        authToken.purpose !== "password_reset" ||
        authToken.consumed_at ||
        authToken.expires_at <= now
      ) {
        throw new AuthError("INVALID_OR_EXPIRED_TOKEN", "Password reset token is invalid.", 400);
      }

      await tx.user.update({
        where: { id: authToken.user_id },
        data: {
          password_hash: await bcrypt.hash(password, 12),
          updated_at: now
        }
      });
      await tx.authToken.update({
        where: { id: authToken.id },
        data: { consumed_at: now }
      });
      await tx.authSession.updateMany({
        where: {
          user_id: authToken.user_id,
          revoked_at: null
        },
        data: {
          revoked_at: now
        }
      });
    });

    return { ok: true };
  }

  async listUsers(adminSessionToken: string, status?: string) {
    await this.requireAdmin(adminSessionToken);

    const users = await this.prisma.user.findMany({
      where: status ? { status } : undefined,
      orderBy: { created_at: "desc" },
      take: 100
    });

    return users.map(toPublicUser);
  }

  async activateUser(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const now = this.now();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: "active",
        updated_at: now
      }
    });
    await this.writeAuditLog(admin, "admin.user.activate", "user", user.id);
    return toPublicUser(user);
  }

  async suspendUser(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const now = this.now();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: "suspended",
        updated_at: now
      }
    });
    await this.prisma.authSession.updateMany({
      where: {
        user_id: userId,
        revoked_at: null
      },
      data: { revoked_at: now }
    });
    await this.writeAuditLog(admin, "admin.user.suspend", "user", user.id);
    return toPublicUser(user);
  }

  async getAuthSettings(adminSessionToken: string) {
    await this.requireAdmin(adminSessionToken);
    const settings = await this.ensureInstanceAuthSettings();
    return toAuthSettingsDto(settings);
  }

  async updateAuthSettings(adminSessionToken: string, input: UpdateAuthSettingsInput) {
    const admin = await this.requireAdmin(adminSessionToken);
    const current = await this.ensureInstanceAuthSettings();
    const data = normalizeAuthSettingsInput(input);
    const updated = await this.prisma.authSetting.update({
      where: { id: current.id },
      data: {
        ...data,
        updated_at: this.now()
      }
    });
    await this.writeAuditLog(admin, "admin.auth_settings.update", "auth_settings", updated.id);
    return toAuthSettingsDto(updated);
  }

  createCookie(sessionToken: string, expiresAt: Date): string {
    const parts = [
      `${this.cookieName()}=${encodeURIComponent(sessionToken)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Expires=${expiresAt.toUTCString()}`
    ];

    if (this.env.NODE_ENV === "production") {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  clearCookie(): string {
    return `${this.cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  cookieName(): string {
    return this.env.AUTH_COOKIE_NAME || AUTH_COOKIE_NAME;
  }

  private async requireAdmin(sessionToken: string): Promise<AuthenticatedUser> {
    const me = await this.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private async ensureDefaultTenant() {
    const slug = this.env.DEFAULT_TENANT_SLUG || "default";
    const name = this.env.DEFAULT_TENANT_NAME || "Default Tenant";

    return this.prisma.tenant.upsert({
      where: { slug },
      create: {
        slug,
        name,
        created_at: this.now()
      },
      update: {
        name
      }
    });
  }

  private async ensureInstanceAuthSettings(
    tx: Prisma.TransactionClient | PrismaClient = this.prisma
  ) {
    const existing = await tx.authSetting.findFirst({ where: { tenant_id: null } });
    if (existing) {
      return existing;
    }

    const now = this.now();
    return tx.authSetting.create({
      data: {
        tenant_id: null,
        registration_enabled: true,
        email_verification_required: true,
        default_signup_status: "active",
        invited_user_auto_active: true,
        allowed_email_domains: [],
        invite_required: false,
        first_user_becomes_admin: true,
        created_at: now,
        updated_at: now
      }
    });
  }

  private async getEffectiveAuthSettings(
    tenantId: string,
    tx: Prisma.TransactionClient | PrismaClient = this.prisma
  ): Promise<AuthSettingsRecord> {
    const tenantSettings = await tx.authSetting.findFirst({ where: { tenant_id: tenantId } });
    return tenantSettings ?? (await this.ensureInstanceAuthSettings(tx));
  }

  private async promoteFirstAdminIfNeeded(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    settings: Pick<AuthSettingsRecord, "first_user_becomes_admin">
  ) {
    if (!settings.first_user_becomes_admin) {
      return;
    }

    const existingAdmin = await tx.tenantMembership.findFirst({
      where: {
        role: "system_admin"
      }
    });

    if (existingAdmin) {
      return;
    }

    await tx.tenantMembership.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: tenantId,
          user_id: userId
        }
      },
      create: {
        tenant_id: tenantId,
        user_id: userId,
        role: "system_admin",
        created_at: this.now()
      },
      update: {
        role: "system_admin"
      }
    });
  }

  private async createAuthTokenAndOutbox(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      userId: string;
      email: string;
      purpose: TokenPurpose;
      ttlHours: number;
    }
  ): Promise<string> {
    const rawToken = createRawToken();
    const now = this.now();
    const expiresAt = addHours(now, input.ttlHours);
    const linkUrl = this.createLink(input.purpose, rawToken);
    const subject =
      input.purpose === "email_verification"
        ? "Verify your OpenKB email"
        : "Reset your OpenKB password";

    await tx.authToken.create({
      data: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        purpose: input.purpose,
        token_hash: hashToken(rawToken),
        expires_at: expiresAt,
        created_at: now
      }
    });
    await tx.authEmailOutbox.create({
      data: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        to_email: input.email,
        template: input.purpose,
        subject,
        link_url: linkUrl,
        payload: {
          link_url: linkUrl
        },
        status: "pending",
        created_at: now
      }
    });

    return linkUrl;
  }

  private createLink(purpose: TokenPurpose, token: string): string {
    const baseUrl = (this.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const path = purpose === "email_verification" ? "/verify-email" : "/password-reset";
    return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  private async getAuthenticatedUserByUserId(
    userId: string,
    tenantId: string
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
    }

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: userId
      }
    });

    return {
      user: toPublicUser(user),
      tenantId,
      roles: memberships.map((membership) => membership.role)
    };
  }

  private async resolveUserTenantId(userId: string): Promise<string> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: "asc" }
    });

    if (membership) {
      return membership.tenant_id;
    }

    const tenant = await this.ensureDefaultTenant();
    await this.prisma.tenantMembership.create({
      data: {
        tenant_id: tenant.id,
        user_id: userId,
        role: "member",
        created_at: this.now()
      }
    });
    return tenant.id;
  }

  private async writeAuditLog(
    admin: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: admin.tenantId,
        actor_user_id: admin.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata: {},
        created_at: this.now()
      }
    });
  }

  private sessionTtlDays(): number {
    return parsePositiveInt(this.env.SESSION_TTL_DAYS, 30);
  }

  private emailVerificationTtlHours(): number {
    return parsePositiveInt(this.env.EMAIL_VERIFICATION_TTL_HOURS, 24);
  }

  private passwordResetTtlHours(): number {
    return parsePositiveInt(this.env.PASSWORD_RESET_TTL_HOURS, 2);
  }
}

export function getCookieValue(
  cookieHeader: string | undefined,
  name = AUTH_COOKIE_NAME
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

export function toPublicUser(user: {
  id: string;
  email: string;
  display_name: string;
  status: string;
  email_verified_at: Date | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    emailVerifiedAt: user.email_verified_at ? user.email_verified_at.toISOString() : null
  };
}

function toAuthSettingsDto(settings: AuthSettingsRecord) {
  return {
    registration_enabled: settings.registration_enabled,
    email_verification_required: settings.email_verification_required,
    default_signup_status: settings.default_signup_status,
    invited_user_auto_active: settings.invited_user_auto_active,
    allowed_email_domains: settings.allowed_email_domains,
    invite_required: settings.invite_required,
    first_user_becomes_admin: settings.first_user_becomes_admin
  };
}

function normalizeAuthSettingsInput(input: UpdateAuthSettingsInput) {
  const data: UpdateAuthSettingsInput = {};

  if (input.registration_enabled !== undefined) {
    data.registration_enabled = Boolean(input.registration_enabled);
  }
  if (input.email_verification_required !== undefined) {
    data.email_verification_required = Boolean(input.email_verification_required);
  }
  if (input.default_signup_status !== undefined) {
    if (!["active", "pending_activation"].includes(input.default_signup_status)) {
      throw new AuthError("INVALID_INPUT", "default_signup_status is invalid.", 400);
    }
    data.default_signup_status = input.default_signup_status;
  }
  if (input.invited_user_auto_active !== undefined) {
    data.invited_user_auto_active = Boolean(input.invited_user_auto_active);
  }
  if (input.allowed_email_domains !== undefined) {
    data.allowed_email_domains = input.allowed_email_domains
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
  }
  if (input.invite_required !== undefined) {
    data.invite_required = Boolean(input.invite_required);
  }
  if (input.first_user_becomes_admin !== undefined) {
    data.first_user_becomes_admin = Boolean(input.first_user_becomes_admin);
  }

  return data;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthError("INVALID_INPUT", "Email is invalid.", 400);
  }
  return normalized;
}

function validatePassword(password: string): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new AuthError("INVALID_INPUT", "Password must be at least 8 characters.", 400);
  }
  return password;
}

function normalizeDisplayName(displayName: string | undefined, email: string): string {
  const normalized = displayName?.trim();
  if (normalized) {
    return normalized;
  }
  return email.split("@")[0] || email;
}

function assertEmailDomainAllowed(email: string, domains: string[]) {
  if (domains.length === 0) {
    return;
  }

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !domains.map((item) => item.toLowerCase()).includes(domain)) {
    throw new AuthError("EMAIL_DOMAIN_NOT_ALLOWED", "Email domain is not allowed.", 403);
  }
}

function createRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

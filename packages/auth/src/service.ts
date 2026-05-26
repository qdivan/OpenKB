import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import { getSmtpConfig, sendEmail, type SmtpConfig, type SmtpTransport } from "@openkb/email";

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
  | "OBJECT_NOT_FOUND"
  | "REGISTRATION_DISABLED"
  | "SECRET_NOT_AVAILABLE"
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

export type AdminUserStatus =
  | "pending_email_verification"
  | "pending_activation"
  | "active"
  | "suspended"
  | "deleted";

export type TenantRole = "system_admin" | "tenant_admin" | "member";

export type AdminUser = PublicUser & {
  tenantRole: TenantRole | null;
  activeSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminSetupEmailDelivery = {
  outboxId: string;
  toEmail: string;
  status: string;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  lastAttemptAt: string | null;
  smtpConfigured: boolean;
  smtpSource: "db" | "env" | "dev";
};

export type AuditLogEntry = {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorType: string;
  action: string;
  objectType: string | null;
  objectId: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
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
  scope?: "instance" | "tenant";
  tenant_id?: string | null;
  registration_enabled?: boolean;
  login_registration_enabled?: boolean;
  email_verification_required?: boolean;
  default_signup_status?: "active" | "pending_activation";
  invited_user_auto_active?: boolean;
  allowed_email_domains?: string[];
  invite_required?: boolean;
  first_user_becomes_admin?: boolean;
};

export type CreateAdminUserInput = {
  email?: string;
  display_name?: string;
  tenant_role?: TenantRole;
};

export type UpdateAdminUserInput = {
  display_name?: string;
  status?: Exclude<AdminUserStatus, "deleted">;
};

export type ListAdminUsersInput = {
  status?: string;
  role?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type ListAuditLogsInput = {
  action?: string;
  object_type?: string;
  object_id?: string;
  actor_user_id?: string;
  actor_type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

export type AuthServiceOptions = {
  prisma?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  emailTransport?: SmtpTransport;
};

type AuthSettingsRecord = {
  id: string;
  tenant_id: string | null;
  registration_enabled: boolean;
  login_registration_enabled: boolean;
  email_verification_required: boolean;
  default_signup_status: string;
  invited_user_auto_active: boolean;
  allowed_email_domains: string[];
  invite_required: boolean;
  first_user_becomes_admin: boolean;
};

type TokenPurpose = "email_verification" | "password_reset" | "account_setup";

export class AuthService {
  private readonly prisma: PrismaClient;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly emailTransport?: SmtpTransport;

  constructor(options: AuthServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.emailTransport = options.emailTransport;
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
      let verificationOutboxId: string | null = null;
      if (settings.email_verification_required) {
        const outbox = await this.createAuthTokenAndOutbox(tx, {
          tenantId: tenant.id,
          userId: user.id,
          email: user.email,
          purpose: "email_verification",
          ttlHours: this.emailVerificationTtlHours()
        });
        verificationLink = outbox.linkUrl;
        verificationOutboxId = outbox.outboxId;
      } else {
        await this.promoteFirstAdminIfNeeded(tx, tenant.id, user.id, settings);
      }
      if (user.status === "active") {
        await this.ensurePersonalWorkspaceForUser(tx, tenant.id, user);
      }

      return {
        user,
        verificationLink,
        verificationOutboxId
      };
    });

    if (result.verificationOutboxId) {
      await this.deliverOutboxIfSmtpConfigured(result.verificationOutboxId);
    }

    return {
      user: toPublicUser(result.user),
      status: result.user.status,
      requiresEmailVerification: settings.email_verification_required,
      verificationOutboxLink: result.verificationLink
    };
  }

  async getPublicRegistrationSettings() {
    const tenant = await this.ensureDefaultTenant();
    const settings = await this.getEffectiveAuthSettings(tenant.id);
    return {
      registration_enabled: settings.registration_enabled,
      login_registration_enabled: settings.login_registration_enabled,
      invite_required: settings.invite_required,
      allowed_email_domains_enabled: settings.allowed_email_domains.length > 0,
      allowed_email_domains: settings.allowed_email_domains,
      registration_available:
        settings.registration_enabled &&
        settings.login_registration_enabled &&
        !settings.invite_required
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
      if (user.status === "active") {
        await this.ensurePersonalWorkspaceForUser(tx, authToken.tenant_id, user);
      }

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
    const rawSessionToken = createRawToken();
    const now = this.now();
    const expiresAt = addDays(now, this.sessionTtlDays());

    await this.prisma.$transaction(async (tx) => {
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
      await this.ensurePersonalWorkspaceForUser(tx, tenant.id, user);
      await tx.authSession.create({
        data: {
          tenant_id: tenant.id,
          user_id: user.id,
          token_hash: hashToken(rawSessionToken),
          expires_at: expiresAt,
          last_seen_at: now,
          created_at: now
        }
      });
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

    const outbox = await this.prisma.$transaction(async (tx) =>
      this.createAuthTokenAndOutbox(tx, {
        tenantId,
        userId: user.id,
        email: user.email,
        purpose: "password_reset",
        ttlHours: this.passwordResetTtlHours()
      })
    );

    await this.deliverOutboxIfSmtpConfigured(outbox.outboxId);

    return { ok: true };
  }

  async confirmPasswordReset(input: { token: string; password: string }) {
    const password = validatePassword(input.password);
    const tokenHash = hashToken(input.token);
    const now = this.now();

    await this.prisma.$transaction(async (tx) => {
      const authToken = await tx.authToken.findUnique({ where: { token_hash: tokenHash } });
      if (!authToken || !isPasswordTokenPurpose(authToken.purpose) || authToken.expires_at <= now) {
        throw new AuthError("INVALID_OR_EXPIRED_TOKEN", "Password reset token is invalid.", 400);
      }
      const consumed = await tx.authToken.updateMany({
        where: { id: authToken.id, consumed_at: null },
        data: { consumed_at: now }
      });
      if (consumed.count !== 1) {
        throw new AuthError("INVALID_OR_EXPIRED_TOKEN", "Password reset token is invalid.", 400);
      }

      await tx.user.update({
        where: { id: authToken.user_id },
        data: {
          password_hash: await bcrypt.hash(password, 12),
          updated_at: now
        }
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

  async listUsers(adminSessionToken: string, input: string | ListAdminUsersInput = {}) {
    const admin = await this.requireAdmin(adminSessionToken);
    const filters = typeof input === "string" ? { status: input } : input;
    const limit = normalizeLimit(filters.limit, 100);
    const offset = normalizeOffset(filters.offset);
    const where: Prisma.UserWhereInput = {};

    if (filters.status) {
      where.status = normalizeAdminUserStatus(filters.status, true);
    }
    if (filters.query?.trim()) {
      const query = filters.query.trim();
      where.OR = [
        { email: { contains: query, mode: "insensitive" } },
        { display_name: { contains: query, mode: "insensitive" } }
      ];
    }
    if (filters.role) {
      const role = normalizeTenantRole(filters.role);
      const memberships = await this.prisma.tenantMembership.findMany({
        where: {
          tenant_id: admin.tenantId,
          role
        },
        select: { user_id: true }
      });
      where.id = { in: memberships.map((membership) => membership.user_id) };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      items: await this.toAdminUsers(admin.tenantId, users),
      limit,
      offset,
      total
    };
  }

  async createAdminUser(adminSessionToken: string, input: CreateAdminUserInput) {
    const admin = await this.requireAdmin(adminSessionToken);
    const email = normalizeEmail(input.email ?? "");
    const displayName = normalizeDisplayName(input.display_name, email);
    const role = normalizeTenantRole(input.tenant_role ?? "member");
    this.assertCanGrantRole(admin, role);
    const now = this.now();

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing && existing.status !== "deleted") {
        throw new AuthError("EMAIL_ALREADY_REGISTERED", "Email is already registered.", 409);
      }

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              password_hash: null,
              display_name: displayName,
              status: "active",
              email_verified_at: now,
              updated_at: now
            }
          })
        : await tx.user.create({
            data: {
              email,
              password_hash: null,
              display_name: displayName,
              status: "active",
              email_verified_at: now,
              created_at: now,
              updated_at: now
            }
          });

      await tx.tenantMembership.upsert({
        where: {
          tenant_id_user_id: {
            tenant_id: admin.tenantId,
            user_id: user.id
          }
        },
        create: {
          tenant_id: admin.tenantId,
          user_id: user.id,
          role,
          created_at: now
        },
        update: { role }
      });
      await this.ensurePersonalWorkspaceForUser(tx, admin.tenantId, user);

      const setupOutbox = await this.createAuthTokenAndOutbox(tx, {
        tenantId: admin.tenantId,
        userId: user.id,
        email: user.email,
        purpose: "account_setup",
        ttlHours: this.passwordResetTtlHours()
      });
      await this.writeAuditLog(tx, admin, "admin.user.create", "user", user.id, {
        tenant_role: role,
        restored: Boolean(existing)
      });

      return { user, setupOutbox };
    });

    const setupEmail = await this.deliverOutboxIfSmtpConfigured(result.setupOutbox.outboxId);

    return {
      user: await this.toAdminUser(admin.tenantId, result.user),
      setup_link: result.setupOutbox.linkUrl,
      reset_link: result.setupOutbox.linkUrl,
      setup_email: setupEmail
    };
  }

  async updateAdminUser(adminSessionToken: string, userId: string, input: UpdateAdminUserInput) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);

    const data: Prisma.UserUpdateInput = {};
    const displayName = input.display_name?.trim();
    if (displayName) {
      data.display_name = displayName;
    }
    if (input.status !== undefined) {
      const status = normalizeAdminUserStatus(input.status, false);
      if (status === "deleted") {
        throw new AuthError("INVALID_INPUT", "Use the delete endpoint to soft-delete users.", 400);
      }
      if (target.id === admin.user.id && status === "suspended") {
        throw new AuthError("INVALID_INPUT", "Admins cannot suspend themselves.", 400);
      }
      if (status === "suspended") {
        await this.assertNotLastActiveSystemAdmin(admin.tenantId, target.id);
      }
      data.status = status;
      if (status === "active" && !target.email_verified_at) {
        data.email_verified_at = this.now();
      }
    }

    if (Object.keys(data).length === 0) {
      return this.toAdminUser(admin.tenantId, target);
    }

    const now = this.now();
    data.updated_at = now;
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data });
      if (data.status === "suspended") {
        await tx.authSession.updateMany({
          where: { user_id: userId, revoked_at: null },
          data: { revoked_at: now }
        });
      }
      if (updated.status === "active") {
        await this.ensurePersonalWorkspaceForUser(tx, admin.tenantId, updated);
      }
      await this.writeAuditLog(tx, admin, "admin.user.update", "user", userId, {
        fields: Object.keys(data).filter((field) => field !== "updated_at")
      });
      return updated;
    });

    return this.toAdminUser(admin.tenantId, user);
  }

  async activateUser(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);
    const now = this.now();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: "active",
          email_verified_at: target.email_verified_at ?? now,
          updated_at: now
        }
      });
      await this.ensurePersonalWorkspaceForUser(tx, admin.tenantId, updated);
      await this.writeAuditLog(tx, admin, "admin.user.activate", "user", updated.id);
      return updated;
    });
    return this.toAdminUser(admin.tenantId, user);
  }

  async suspendUser(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);
    if (target.id === admin.user.id) {
      throw new AuthError("INVALID_INPUT", "Admins cannot suspend themselves.", 400);
    }
    await this.assertNotLastActiveSystemAdmin(admin.tenantId, target.id);
    const now = this.now();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: "suspended",
          updated_at: now
        }
      });
      await tx.authSession.updateMany({
        where: {
          user_id: userId,
          revoked_at: null
        },
        data: { revoked_at: now }
      });
      await this.writeAuditLog(tx, admin, "admin.user.suspend", "user", updated.id);
      return updated;
    });
    return this.toAdminUser(admin.tenantId, user);
  }

  async softDeleteUser(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);
    if (!admin.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Only system admins can soft-delete users.", 403);
    }
    if (target.id === admin.user.id) {
      throw new AuthError("INVALID_INPUT", "Admins cannot delete themselves.", 400);
    }
    await this.assertNotLastActiveSystemAdmin(admin.tenantId, target.id);
    const now = this.now();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: "deleted",
          updated_at: now
        }
      });
      await tx.authSession.updateMany({
        where: { user_id: userId, revoked_at: null },
        data: { revoked_at: now }
      });
      const [workspaceMemberships, collaborators, tenantMemberships] = await Promise.all([
        tx.workspaceMember.deleteMany({ where: { user_id: userId } }),
        tx.collaborator.deleteMany({
          where: {
            subject_type: "user",
            subject_id: userId
          }
        }),
        tx.tenantMembership.deleteMany({ where: { user_id: userId } })
      ]);
      await this.writeAuditLog(tx, admin, "admin.user.delete", "user", updated.id, {
        removed_workspace_memberships: workspaceMemberships.count,
        removed_collaborators: collaborators.count,
        removed_tenant_memberships: tenantMemberships.count
      });
      return updated;
    });
    return this.toAdminUser(admin.tenantId, user);
  }

  async createAdminPasswordReset(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);

    const resetOutbox = await this.prisma.$transaction(async (tx) => {
      const outbox = await this.createAuthTokenAndOutbox(tx, {
        tenantId: admin.tenantId,
        userId: target.id,
        email: target.email,
        purpose: "password_reset",
        ttlHours: this.passwordResetTtlHours()
      });
      await this.writeAuditLog(tx, admin, "admin.user.password_reset", "user", target.id);
      return outbox;
    });

    await this.deliverOutboxIfSmtpConfigured(resetOutbox.outboxId);

    return { ok: true, reset_link: resetOutbox.linkUrl };
  }

  async setTenantRole(adminSessionToken: string, userId: string, roleInput: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const role = normalizeTenantRole(roleInput);
    this.assertCanGrantRole(admin, role);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const currentRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, currentRole);
    if (target.id === admin.user.id) {
      throw new AuthError("INVALID_INPUT", "Admins cannot change their own role.", 400);
    }
    if (currentRole === "system_admin" && role !== "system_admin") {
      await this.assertNotLastActiveSystemAdmin(admin.tenantId, target.id);
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.upsert({
        where: {
          tenant_id_user_id: {
            tenant_id: admin.tenantId,
            user_id: target.id
          }
        },
        create: {
          tenant_id: admin.tenantId,
          user_id: target.id,
          role,
          created_at: this.now()
        },
        update: { role }
      });
      await this.writeAuditLog(tx, admin, "admin.user.role.update", "user", target.id, {
        previous_role: currentRole,
        tenant_role: role
      });
      return updated;
    });

    return {
      user: await this.toAdminUser(admin.tenantId, target),
      tenant_role: membership.role
    };
  }

  async revokeUserSessions(adminSessionToken: string, userId: string) {
    const admin = await this.requireAdmin(adminSessionToken);
    const target = await this.getTargetUserForAdmin(admin, userId);
    const targetRole = await this.getTenantRole(admin.tenantId, userId);
    this.assertCanManageTarget(admin, target.id, targetRole);
    const now = this.now();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.authSession.updateMany({
        where: {
          user_id: userId,
          revoked_at: null
        },
        data: { revoked_at: now }
      });
      await this.writeAuditLog(tx, admin, "admin.user.sessions.revoke", "user", userId, {
        revoked_count: updated.count
      });
      return updated;
    });

    return { ok: true, revoked_count: result.count };
  }

  async listAuditLogs(adminSessionToken: string, input: ListAuditLogsInput = {}) {
    const admin = await this.requireAdmin(adminSessionToken);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const where: Prisma.AuditLogWhereInput = {};

    if (!admin.roles.includes("system_admin")) {
      where.tenant_id = admin.tenantId;
    }
    if (input.action?.trim()) {
      where.action = { contains: input.action.trim(), mode: "insensitive" };
    }
    if (input.object_type?.trim()) {
      where.object_type = input.object_type.trim();
    }
    if (input.object_id?.trim()) {
      where.object_id = input.object_id.trim();
    }
    if (input.actor_user_id?.trim()) {
      where.actor_user_id = input.actor_user_id.trim();
    }
    if (input.actor_type?.trim()) {
      where.actor_type = input.actor_type.trim();
    }
    const dateFrom = parseOptionalDate(input.date_from);
    const dateTo = parseOptionalDate(input.date_to);
    if (dateFrom || dateTo) {
      where.created_at = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {})
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.auditLog.count({ where })
    ]);

    return {
      items: items.map(toAuditLogEntry),
      limit,
      offset,
      total
    };
  }

  async getAuthSettings(adminSessionToken: string, input: UpdateAuthSettingsInput = {}) {
    const admin = await this.requireAdmin(adminSessionToken);
    const tenantId = await this.resolveAuthSettingsTenantId(admin, input);
    const settings = await this.ensureAuthSettingsForTenant(tenantId);
    return toAuthSettingsDto(settings);
  }

  async updateAuthSettings(adminSessionToken: string, input: UpdateAuthSettingsInput) {
    const admin = await this.requireAdmin(adminSessionToken);
    const tenantId = await this.resolveAuthSettingsTenantId(admin, input);
    const current = await this.ensureAuthSettingsForTenant(tenantId);
    const data = normalizeAuthSettingsInput(input);
    const updated = await this.prisma.authSetting.update({
      where: { id: current.id },
      data: {
        ...data,
        updated_at: this.now()
      }
    });
    await this.writeAuditLog(
      this.prisma,
      admin,
      "admin.auth_settings.update",
      "auth_settings",
      updated.id,
      { scope: updated.tenant_id ? "tenant" : "instance", tenant_id: updated.tenant_id }
    );
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

    if (this.shouldUseSecureCookie()) {
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

  private shouldUseSecureCookie(): boolean {
    const explicit = parseOptionalBoolean(this.env.AUTH_COOKIE_SECURE);
    if (explicit !== null) {
      return explicit;
    }

    const baseUrl = this.env.WEB_BASE_URL || this.env.APP_BASE_URL;
    if (baseUrl) {
      return isHttpsUrl(baseUrl);
    }

    return this.env.NODE_ENV === "production";
  }

  private async requireAdmin(sessionToken: string): Promise<AuthenticatedUser> {
    const me = await this.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private async toAdminUsers(
    tenantId: string,
    users: Array<{
      id: string;
      email: string;
      display_name: string;
      status: string;
      email_verified_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>
  ): Promise<AdminUser[]> {
    if (users.length === 0) {
      return [];
    }

    const userIds = users.map((user) => user.id);
    const [memberships, sessions] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where: {
          tenant_id: tenantId,
          user_id: { in: userIds }
        }
      }),
      this.prisma.authSession.groupBy({
        by: ["user_id"],
        where: {
          user_id: { in: userIds },
          revoked_at: null,
          expires_at: { gt: this.now() }
        },
        _count: { _all: true }
      })
    ]);
    const roleByUser = new Map(
      memberships.map((membership) => [membership.user_id, membership.role as TenantRole])
    );
    const sessionsByUser = new Map(
      sessions.map((session) => [session.user_id, session._count._all])
    );

    return users.map((user) => ({
      ...toPublicUser(user),
      tenantRole: roleByUser.get(user.id) ?? null,
      activeSessionCount: sessionsByUser.get(user.id) ?? 0,
      createdAt: user.created_at.toISOString(),
      updatedAt: user.updated_at.toISOString()
    }));
  }

  private async toAdminUser(
    tenantId: string,
    user: {
      id: string;
      email: string;
      display_name: string;
      status: string;
      email_verified_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }
  ): Promise<AdminUser> {
    const [adminUser] = await this.toAdminUsers(tenantId, [user]);
    if (!adminUser) {
      throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
    }
    return adminUser;
  }

  private async getTargetUserForAdmin(admin: AuthenticatedUser, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === "deleted") {
      throw new AuthError("USER_NOT_FOUND", "User was not found.", 404);
    }
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenant_id: admin.tenantId,
        user_id: userId
      }
    });
    if (!membership) {
      throw new AuthError("USER_NOT_FOUND", "User was not found in this tenant.", 404);
    }
    return user;
  }

  private async getTenantRole(tenantId: string, userId: string): Promise<TenantRole | null> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: userId
      }
    });
    return isTenantRole(membership?.role) ? membership.role : null;
  }

  private assertCanManageTarget(
    admin: AuthenticatedUser,
    targetUserId: string,
    targetRole: TenantRole | null
  ) {
    if (targetRole === "system_admin" && !admin.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Only system admins can manage system admins.", 403);
    }
    if (targetUserId === admin.user.id && targetRole === "system_admin") {
      return;
    }
  }

  private assertCanGrantRole(admin: AuthenticatedUser, role: TenantRole) {
    if (role === "system_admin" && !admin.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Only system admins can grant system admin.", 403);
    }
  }

  private async assertNotLastActiveSystemAdmin(tenantId: string, targetUserId: string) {
    const targetRole = await this.getTenantRole(tenantId, targetUserId);
    if (targetRole !== "system_admin") {
      return;
    }

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenant_id: tenantId,
        role: "system_admin"
      },
      select: { user_id: true }
    });
    const activeSystemAdmins = await this.prisma.user.count({
      where: {
        id: { in: memberships.map((membership) => membership.user_id) },
        status: "active"
      }
    });

    if (activeSystemAdmins <= 1) {
      throw new AuthError("INVALID_INPUT", "At least one active system admin is required.", 400);
    }
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
        login_registration_enabled: true,
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

  private async ensureAuthSettingsForTenant(
    tenantId: string | null,
    tx: Prisma.TransactionClient | PrismaClient = this.prisma
  ) {
    if (tenantId === null) {
      return this.ensureInstanceAuthSettings(tx);
    }

    const existing = await tx.authSetting.findFirst({ where: { tenant_id: tenantId } });
    if (existing) {
      return existing;
    }

    const defaults = await this.ensureInstanceAuthSettings(tx);
    const now = this.now();
    return tx.authSetting.create({
      data: {
        tenant_id: tenantId,
        registration_enabled: defaults.registration_enabled,
        login_registration_enabled: defaults.login_registration_enabled,
        email_verification_required: defaults.email_verification_required,
        default_signup_status: defaults.default_signup_status,
        invited_user_auto_active: defaults.invited_user_auto_active,
        allowed_email_domains: defaults.allowed_email_domains,
        invite_required: defaults.invite_required,
        first_user_becomes_admin: defaults.first_user_becomes_admin,
        created_at: now,
        updated_at: now
      }
    });
  }

  private async resolveAuthSettingsTenantId(
    admin: AuthenticatedUser,
    input: Pick<UpdateAuthSettingsInput, "scope" | "tenant_id"> = {}
  ): Promise<string | null> {
    if (!admin.roles.includes("system_admin")) {
      return admin.tenantId;
    }

    if (input.scope === "tenant" || input.tenant_id) {
      const tenantId = input.tenant_id?.trim() || admin.tenantId;
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        throw new AuthError("OBJECT_NOT_FOUND", "Tenant was not found.", 404);
      }
      return tenant.id;
    }

    return null;
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

  private async ensurePersonalWorkspaceForUser(
    tx: Prisma.TransactionClient,
    tenantId: string,
    user: {
      id: string;
      email: string;
      display_name: string | null;
      status: string;
    }
  ) {
    if (user.status !== "active") {
      return null;
    }

    const existing = await tx.workspace.findFirst({
      where: {
        tenant_id: tenantId,
        kind: "personal",
        personal_owner_user_id: user.id
      }
    });
    if (existing) {
      await tx.workspaceMember.upsert({
        where: {
          workspace_id_user_id: {
            workspace_id: existing.id,
            user_id: user.id
          }
        },
        create: {
          tenant_id: tenantId,
          workspace_id: existing.id,
          user_id: user.id,
          role: "owner",
          created_at: this.now()
        },
        update: {
          role: "owner"
        }
      });
      return existing;
    }

    const now = this.now();
    const displayName = user.display_name?.trim() || user.email.split("@")[0] || user.email;
    const name = `${displayName} 的个人空间`;
    const avatarInitials =
      Array.from(displayName.trim())
        .filter((char) => /\S/u.test(char))
        .slice(0, 2)
        .join("") || "我";
    const baseSlug = `u-${user.id.replaceAll("-", "").slice(0, 24)}`;
    let slug = baseSlug;
    for (let suffix = 2; suffix <= 20; suffix += 1) {
      const conflict = await tx.workspace.findUnique({
        where: {
          tenant_id_slug: {
            tenant_id: tenantId,
            slug
          }
        }
      });
      if (!conflict) {
        break;
      }
      slug = `${baseSlug}-${suffix}`;
    }

    const created = await tx.workspace.create({
      data: {
        tenant_id: tenantId,
        name,
        slug,
        kind: "personal",
        personal_owner_user_id: user.id,
        avatar_color: "#059669",
        avatar_initials: avatarInitials.toUpperCase(),
        created_by: user.id,
        created_at: now,
        updated_at: now
      }
    });
    await tx.workspaceMember.create({
      data: {
        tenant_id: tenantId,
        workspace_id: created.id,
        user_id: user.id,
        role: "owner",
        created_at: now
      }
    });
    return created;
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
  ): Promise<{ linkUrl: string; outboxId: string }> {
    const rawToken = createRawToken();
    const now = this.now();
    const expiresAt = addHours(now, input.ttlHours);
    const linkUrl = this.createLink(input.purpose, rawToken);
    const subject = authEmailSubject(input.purpose);

    if (isPasswordTokenPurpose(input.purpose)) {
      await tx.authToken.updateMany({
        where: {
          tenant_id: input.tenantId,
          user_id: input.userId,
          purpose: { in: ["password_reset", "account_setup"] },
          consumed_at: null
        },
        data: { consumed_at: now }
      });
    }

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
    const outbox = await tx.authEmailOutbox.create({
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

    return { linkUrl, outboxId: outbox.id };
  }

  private createLink(purpose: TokenPurpose, token: string): string {
    const baseUrl = (this.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const path = purpose === "email_verification" ? "/verify-email" : "/password-reset";
    return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  private async deliverOutboxIfSmtpConfigured(
    outboxId: string
  ): Promise<AdminSetupEmailDelivery | null> {
    const item = await this.prisma.authEmailOutbox.findUnique({ where: { id: outboxId } });
    if (!item || item.status !== "pending") {
      return item ? toSetupEmailDelivery(item, { enabled: false, source: "dev" }) : null;
    }
    const setting = await this.prisma.smtpSetting.findUnique({ where: { scope: "instance" } });
    const config = getSmtpConfig(this.env, setting);
    if (!config.enabled) {
      return toSetupEmailDelivery(item, config);
    }

    const result = await sendEmail(
      config,
      {
        to: item.to_email,
        subject: item.subject,
        text: authEmailText(item.subject, item.link_url)
      },
      this.emailTransport ? { transport: this.emailTransport } : {}
    );
    const updated = await this.prisma.authEmailOutbox.update({
      where: { id: item.id },
      data: {
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? this.now() : item.sent_at,
        error: result.ok ? null : (result.error ?? "Email delivery failed."),
        attempts: { increment: 1 },
        last_attempt_at: this.now()
      }
    });
    return toSetupEmailDelivery(updated, config);
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
    tx: Prisma.TransactionClient | PrismaClient,
    admin: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string,
    metadata: Prisma.InputJsonValue = {}
  ) {
    await tx.auditLog.create({
      data: {
        tenant_id: admin.tenantId,
        actor_user_id: admin.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata,
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

function toSetupEmailDelivery(
  item: {
    id: string;
    to_email: string;
    status: string;
    attempts: number;
    error: string | null;
    sent_at: Date | null;
    last_attempt_at: Date | null;
  },
  config: Pick<SmtpConfig, "enabled" | "source">
): AdminSetupEmailDelivery {
  return {
    outboxId: item.id,
    toEmail: item.to_email,
    status: item.status,
    attempts: item.attempts,
    error: item.error,
    sentAt: item.sent_at?.toISOString() ?? null,
    lastAttemptAt: item.last_attempt_at?.toISOString() ?? null,
    smtpConfigured: config.enabled,
    smtpSource: config.source
  };
}

function toAuthSettingsDto(settings: AuthSettingsRecord) {
  return {
    tenant_id: settings.tenant_id,
    scope: settings.tenant_id ? "tenant" : "instance",
    registration_enabled: settings.registration_enabled,
    login_registration_enabled: settings.login_registration_enabled,
    email_verification_required: settings.email_verification_required,
    default_signup_status: settings.default_signup_status,
    invited_user_auto_active: settings.invited_user_auto_active,
    allowed_email_domains: settings.allowed_email_domains,
    invite_required: settings.invite_required,
    first_user_becomes_admin: settings.first_user_becomes_admin
  };
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value?.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuthError("INVALID_INPUT", "Date value is invalid.", 400);
  }
  return date;
}

function toAuditLogEntry(entry: {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  metadata: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}): AuditLogEntry {
  return {
    id: entry.id,
    tenantId: entry.tenant_id,
    actorUserId: entry.actor_user_id,
    actorType: entry.actor_type,
    action: entry.action,
    objectType: entry.object_type,
    objectId: entry.object_id,
    metadata: entry.metadata,
    ip: entry.ip,
    userAgent: entry.user_agent,
    createdAt: entry.created_at.toISOString()
  };
}

function normalizeAuthSettingsInput(input: UpdateAuthSettingsInput) {
  const data: UpdateAuthSettingsInput = {};

  if (input.registration_enabled !== undefined) {
    data.registration_enabled = Boolean(input.registration_enabled);
  }
  if (input.login_registration_enabled !== undefined) {
    data.login_registration_enabled = Boolean(input.login_registration_enabled);
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
    data.allowed_email_domains = normalizeAllowedEmailDomains(input.allowed_email_domains);
  }
  if (input.invite_required !== undefined) {
    data.invite_required = Boolean(input.invite_required);
  }
  if (input.first_user_becomes_admin !== undefined) {
    data.first_user_becomes_admin = Boolean(input.first_user_becomes_admin);
  }

  return data;
}

function normalizeAdminUserStatus(value: string, allowDeleted: boolean): AdminUserStatus {
  const statuses: AdminUserStatus[] = [
    "pending_email_verification",
    "pending_activation",
    "active",
    "suspended",
    "deleted"
  ];
  if (statuses.includes(value as AdminUserStatus) && (allowDeleted || value !== "deleted")) {
    return value as AdminUserStatus;
  }
  throw new AuthError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeTenantRole(value: string): TenantRole {
  if (isTenantRole(value)) {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "tenant role is invalid.", 400);
}

function isTenantRole(value: string | undefined | null): value is TenantRole {
  return value === "system_admin" || value === "tenant_admin" || value === "member";
}

function isPasswordTokenPurpose(
  value: string
): value is Extract<TokenPurpose, "password_reset" | "account_setup"> {
  return value === "password_reset" || value === "account_setup";
}

function authEmailSubject(purpose: TokenPurpose): string {
  if (purpose === "email_verification") {
    return "Verify your OpenKB email";
  }
  if (purpose === "account_setup") {
    return "Welcome to OpenKB - set your password";
  }
  return "Reset your OpenKB password";
}

function authEmailText(subject: string, linkUrl: string | null): string {
  return linkUrl ? `${subject}\n\n${linkUrl}` : subject;
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

function normalizeAllowedEmailDomains(values: string[]): string[] {
  const normalized = values
    .map(normalizeAllowedEmailDomain)
    .filter((domain): domain is string => Boolean(domain));
  return Array.from(new Set(normalized));
}

function normalizeAllowedEmailDomain(value: string): string | null {
  let domain = value.trim().toLowerCase();
  if (!domain) {
    return null;
  }
  if (domain.includes("@")) {
    domain = domain.split("@").pop() ?? "";
  }
  domain = domain.replace(/^\*\./, "").replace(/^@/, "");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain
    )
  ) {
    throw new AuthError("INVALID_INPUT", "allowed_email_domains contains an invalid domain.", 400);
  }
  return domain;
}

function parseOptionalBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
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

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new AuthError("INVALID_INPUT", "limit is invalid.", 400);
  }
  return Math.min(Math.trunc(parsed), 200);
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AuthError("INVALID_INPUT", "offset is invalid.", 400);
  }
  return Math.trunc(parsed);
}

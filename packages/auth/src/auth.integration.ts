import bcrypt from "bcryptjs";
import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AuthError, AuthService } from "./service";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for auth integration tests.");
}

const allTables = [
  "audit_logs",
  "auth_email_outbox",
  "auth_tokens",
  "auth_sessions",
  "dify_knowledge_mappings",
  "dify_api_keys",
  "mcp_personal_access_tokens",
  "mcp_oauth_refresh_tokens",
  "mcp_oauth_authorization_codes",
  "mcp_oauth_grants",
  "mcp_oauth_clients",
  "index_rebuild_jobs",
  "milvus_index_profiles",
  "document_chunks",
  "import_jobs",
  "share_links",
  "invitations",
  "collaborators",
  "document_versions",
  "document_assets",
  "documents",
  "knowledge_bases",
  "workspace_members",
  "workspaces",
  "group_members",
  "groups",
  "auth_settings",
  "tenant_memberships",
  "tenants",
  "users"
] as const;

let prisma: PrismaClient;

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_BASE_URL: "http://localhost:3000",
    DEFAULT_TENANT_SLUG: "default",
    DEFAULT_TENANT_NAME: "Default Tenant",
    SESSION_TTL_DAYS: "30",
    EMAIL_VERIFICATION_TTL_HOURS: "24",
    PASSWORD_RESET_TTL_HOURS: "2",
    ...overrides
  };
}

function service(overrides: NodeJS.ProcessEnv = {}) {
  return new AuthService({
    prisma,
    env: env(overrides)
  });
}

function tokenFromLink(link: string): string {
  const url = new URL(link);
  const token = url.searchParams.get("token");
  if (!token) {
    throw new Error(`Missing token in ${link}`);
  }
  return token;
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`);
}

async function createDefaultSettings(
  data: Partial<Parameters<typeof prisma.authSetting.create>[0]["data"]> = {}
) {
  return prisma.authSetting.create({
    data: {
      tenant_id: null,
      registration_enabled: true,
      email_verification_required: true,
      default_signup_status: "active",
      invited_user_auto_active: true,
      allowed_email_domains: [],
      invite_required: false,
      first_user_becomes_admin: true,
      ...data
    }
  });
}

describe("AuthService integration", () => {
  beforeAll(async () => {
    prisma = createDatabaseClient();
    const result = await prisma.$queryRaw<Array<{ auth_sessions: string | null }>>`
      SELECT to_regclass('public.auth_sessions')::text AS auth_sessions
    `;
    expect(result[0]?.auth_sessions).toBe("auth_sessions");
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a user and writes verification token plus outbox row", async () => {
    const auth = service();

    const result = await auth.register({
      email: "User@Example.com",
      password: "password-123",
      displayName: "User"
    });

    const tokens = await prisma.authToken.findMany();
    const outbox = await prisma.authEmailOutbox.findMany();

    expect(result.requiresEmailVerification).toBe(true);
    expect(result.user.email).toBe("user@example.com");
    expect(result.user.status).toBe("pending_email_verification");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ purpose: "email_verification", consumed_at: null });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.link_url).toContain("/verify-email?token=");
  });

  it("verifies email, activates by settings, and promotes the first verified user", async () => {
    const auth = service();
    await auth.register({ email: "admin@example.com", password: "password-123" });
    const outbox = await prisma.authEmailOutbox.findFirstOrThrow();

    const verified = await auth.verifyEmail(tokenFromLink(outbox.link_url ?? ""));
    const membership = await prisma.tenantMembership.findFirstOrThrow();

    expect(verified.status).toBe("active");
    expect(membership.role).toBe("system_admin");
  });

  it("honors pending_activation after email verification", async () => {
    await createDefaultSettings({ default_signup_status: "pending_activation" });
    const auth = service();
    await auth.register({ email: "pending@example.com", password: "password-123" });
    const outbox = await prisma.authEmailOutbox.findFirstOrThrow();

    const verified = await auth.verifyEmail(tokenFromLink(outbox.link_url ?? ""));

    expect(verified.status).toBe("pending_activation");
  });

  it("logs in active users and revokes sessions on logout", async () => {
    await createDefaultSettings({ email_verification_required: false });
    const auth = service();
    await auth.register({ email: "active@example.com", password: "password-123" });

    const login = await auth.login({ email: "active@example.com", password: "password-123" });
    const me = await auth.getMe(login.sessionToken);
    await auth.logout(login.sessionToken);

    expect(me.user.email).toBe("active@example.com");
    expect(await prisma.authSession.count()).toBe(1);
    await expect(auth.getMe(login.sessionToken)).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED"
    });
  });

  it("rejects inactive, suspended, and deleted users during login", async () => {
    await createDefaultSettings({
      email_verification_required: false,
      default_signup_status: "pending_activation"
    });
    const auth = service();
    await auth.register({ email: "pending@example.com", password: "password-123" });

    await expect(
      auth.login({ email: "pending@example.com", password: "password-123" })
    ).rejects.toMatchObject({
      code: "USER_NOT_ACTIVE"
    });

    await prisma.user.update({
      where: { email: "pending@example.com" },
      data: { status: "suspended" }
    });
    await expect(
      auth.login({ email: "pending@example.com", password: "password-123" })
    ).rejects.toMatchObject({
      code: "USER_NOT_ACTIVE"
    });

    await prisma.user.update({
      where: { email: "pending@example.com" },
      data: { status: "deleted" }
    });
    await expect(
      auth.login({ email: "pending@example.com", password: "password-123" })
    ).rejects.toMatchObject({
      code: "USER_NOT_ACTIVE"
    });
  });

  it("handles password reset without email enumeration", async () => {
    await createDefaultSettings({ email_verification_required: false });
    const auth = service();
    await auth.register({ email: "reset@example.com", password: "old-password" });

    await expect(auth.requestPasswordReset("missing@example.com")).resolves.toEqual({ ok: true });
    expect(await prisma.authEmailOutbox.count()).toBe(0);

    await auth.requestPasswordReset("reset@example.com");
    const outbox = await prisma.authEmailOutbox.findFirstOrThrow({
      where: { template: "password_reset" }
    });
    await auth.confirmPasswordReset({
      token: tokenFromLink(outbox.link_url ?? ""),
      password: "new-password"
    });

    await expect(
      auth.login({ email: "reset@example.com", password: "old-password" })
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS"
    });
    await expect(
      auth.login({ email: "reset@example.com", password: "new-password" })
    ).resolves.toMatchObject({
      me: { user: { email: "reset@example.com" } }
    });
    expect(await prisma.authToken.count({ where: { consumed_at: { not: null } } })).toBe(1);
  });

  it("lets admins activate and suspend users while blocking non-admins", async () => {
    await createDefaultSettings({ email_verification_required: false });
    const auth = service();
    await auth.register({ email: "admin@example.com", password: "password-123" });
    await auth.register({ email: "member@example.com", password: "password-123" });
    const adminLogin = await auth.login({ email: "admin@example.com", password: "password-123" });
    const memberLogin = await auth.login({ email: "member@example.com", password: "password-123" });

    const pending = await prisma.user.create({
      data: {
        email: "pending@example.com",
        password_hash: await bcrypt.hash("password-123", 12),
        display_name: "Pending",
        status: "pending_activation"
      }
    });

    await expect(auth.listUsers(memberLogin.sessionToken)).rejects.toMatchObject({
      code: "ADMIN_REQUIRED"
    });
    await expect(auth.activateUser(adminLogin.sessionToken, pending.id)).resolves.toMatchObject({
      email: "pending@example.com",
      status: "active"
    });
    await expect(auth.suspendUser(adminLogin.sessionToken, pending.id)).resolves.toMatchObject({
      status: "suspended"
    });
    expect(await prisma.auditLog.count()).toBe(2);
  });

  it("updates auth settings and applies them to later registrations", async () => {
    await createDefaultSettings({ email_verification_required: false });
    const auth = service();
    await auth.register({ email: "admin@example.com", password: "password-123" });
    const adminLogin = await auth.login({ email: "admin@example.com", password: "password-123" });

    await auth.updateAuthSettings(adminLogin.sessionToken, {
      allowed_email_domains: ["example.org"],
      invite_required: true
    });

    await expect(
      auth.register({ email: "user@example.com", password: "password-123" })
    ).rejects.toMatchObject({
      code: "INVITE_REQUIRED"
    });

    await auth.updateAuthSettings(adminLogin.sessionToken, {
      invite_required: false
    });
    await expect(
      auth.register({ email: "user@example.com", password: "password-123" })
    ).rejects.toMatchObject({
      code: "EMAIL_DOMAIN_NOT_ALLOWED"
    });
    await expect(
      auth.register({ email: "user@example.org", password: "password-123" })
    ).resolves.toMatchObject({
      user: { email: "user@example.org" }
    });
  });

  it("validates bad auth settings input", async () => {
    await createDefaultSettings({ email_verification_required: false });
    const auth = service();
    await auth.register({ email: "admin@example.com", password: "password-123" });
    const adminLogin = await auth.login({ email: "admin@example.com", password: "password-123" });

    await expect(
      auth.updateAuthSettings(adminLogin.sessionToken, {
        default_signup_status: "nope" as never
      })
    ).rejects.toBeInstanceOf(AuthError);
  });
});

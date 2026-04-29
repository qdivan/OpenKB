export { Prisma, PrismaClient } from "@prisma/client";

import { PrismaClient } from "@prisma/client";

export const DB_PACKAGE_NAME = "@openkb/db";
export const DATABASE_RUNTIME = "postgresql";

export const USER_STATUSES = [
  "pending_email_verification",
  "pending_activation",
  "active",
  "suspended",
  "deleted"
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUTH_TOKEN_PURPOSES = ["email_verification", "password_reset"] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const AUTH_EMAIL_OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type AuthEmailOutboxStatus = (typeof AUTH_EMAIL_OUTBOX_STATUSES)[number];

export const TENANT_ROLES = ["system_admin", "tenant_admin", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const WORKSPACE_ROLES = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const CONTENT_ROLES = ["owner", "manager", "editor", "viewer"] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

export const CONTENT_INVITATION_ROLES = ["manager", "editor", "viewer"] as const;
export type ContentInvitationRole = (typeof CONTENT_INVITATION_ROLES)[number];

export const WORKSPACE_INVITATION_ROLES = ["admin", "member", "guest"] as const;
export type WorkspaceInvitationRole = (typeof WORKSPACE_INVITATION_ROLES)[number];

export const SHARE_LINK_PERMISSION = "view" as const;

export type DatabaseStatus = {
  packageName: typeof DB_PACKAGE_NAME;
  runtime: typeof DATABASE_RUNTIME;
  migrationsImplemented: true;
};

export const databaseStatus: DatabaseStatus = {
  packageName: DB_PACKAGE_NAME,
  runtime: DATABASE_RUNTIME,
  migrationsImplemented: true
};

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return databaseUrl;
}

export function createDatabaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl()
      }
    }
  });
}

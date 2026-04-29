import bcrypt from "bcryptjs";

import { createDatabaseClient, type PrismaClient } from "./index";

export type SeedFirstAdminOptions = {
  env?: NodeJS.ProcessEnv;
  prisma?: PrismaClient;
};

export type SeedFirstAdminResult = {
  tenantId: string;
  userId: string;
  email: string;
};

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value : fallback;
}

export async function seedFirstAdmin(
  options: SeedFirstAdminOptions = {}
): Promise<SeedFirstAdminResult> {
  const env = options.env ?? process.env;
  const prisma = options.prisma ?? createDatabaseClient();
  const shouldDisconnect = !options.prisma;

  const email = requiredEnv(env, "ADMIN_EMAIL").trim().toLowerCase();
  const password = requiredEnv(env, "ADMIN_PASSWORD");
  const displayName = optionalEnv(env, "ADMIN_DISPLAY_NAME", "OpenKB Admin");
  const tenantName = optionalEnv(env, "DEFAULT_TENANT_NAME", "Default Tenant");
  const tenantSlug = optionalEnv(env, "DEFAULT_TENANT_SLUG", "default");
  const now = new Date();

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.upsert({
        where: { slug: tenantSlug },
        create: {
          name: tenantName,
          slug: tenantSlug,
          created_at: now
        },
        update: {
          name: tenantName
        }
      });

      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          password_hash: passwordHash,
          display_name: displayName,
          status: "active",
          email_verified_at: now,
          created_at: now,
          updated_at: now
        },
        update: {
          password_hash: passwordHash,
          display_name: displayName,
          status: "active",
          email_verified_at: now,
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
          role: "system_admin",
          created_at: now
        },
        update: {
          role: "system_admin"
        }
      });

      const instanceAuthSetting = await tx.authSetting.findFirst({
        where: { tenant_id: null }
      });

      if (instanceAuthSetting) {
        await tx.authSetting.update({
          where: { id: instanceAuthSetting.id },
          data: { updated_at: now }
        });
      } else {
        await tx.authSetting.create({
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

      return {
        tenantId: tenant.id,
        userId: user.id,
        email: user.email
      };
    });

    return result;
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

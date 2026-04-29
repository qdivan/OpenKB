import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";

import { createDatabaseClient, type Prisma, type PrismaClient } from "./index";

export const DEV_ADMIN_EMAIL = "admin@openkb.local";
export const DEV_ADMIN_PASSWORD = "OpenKB-dev-123456";

export type SeedDevOptions = {
  env?: NodeJS.ProcessEnv;
  prisma?: PrismaClient;
};

export type SeedDevResult = {
  tenantId: string;
  userId: string;
  email: string;
  workspaceId: string;
  knowledgeBaseId: string;
  folderId: string;
  documentId: string;
};

export async function seedDev(options: SeedDevOptions = {}): Promise<SeedDevResult> {
  const env = options.env ?? process.env;
  const prisma = options.prisma ?? createDatabaseClient();
  const shouldDisconnect = !options.prisma;
  const now = new Date();

  const tenantName = optionalEnv(env, "DEFAULT_TENANT_NAME", "Default Tenant");
  const tenantSlug = optionalEnv(env, "DEFAULT_TENANT_SLUG", "default");

  try {
    const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 12);

    return await prisma.$transaction(async (tx) => {
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
        where: { email: DEV_ADMIN_EMAIL },
        create: {
          email: DEV_ADMIN_EMAIL,
          password_hash: passwordHash,
          display_name: "OpenKB Dev Admin",
          status: "active",
          email_verified_at: now,
          created_at: now,
          updated_at: now
        },
        update: {
          password_hash: passwordHash,
          display_name: "OpenKB Dev Admin",
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

      await ensureInstanceAuthSettings(tx, now);

      const workspace = await upsertWorkspace(tx, {
        tenantId: tenant.id,
        userId: user.id,
        now
      });
      await tx.workspaceMember.upsert({
        where: {
          workspace_id_user_id: {
            workspace_id: workspace.id,
            user_id: user.id
          }
        },
        create: {
          tenant_id: tenant.id,
          workspace_id: workspace.id,
          user_id: user.id,
          role: "owner",
          created_at: now
        },
        update: {
          role: "owner"
        }
      });

      const knowledgeBase = await upsertKnowledgeBase(tx, {
        tenantId: tenant.id,
        workspaceId: workspace.id,
        userId: user.id,
        now
      });
      await upsertOwnerCollaborator(tx, {
        tenantId: tenant.id,
        objectType: "knowledge_base",
        objectId: knowledgeBase.id,
        userId: user.id,
        now
      });

      const folder = await upsertDocument(tx, {
        tenantId: tenant.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        userId: user.id,
        parentId: null,
        type: "folder",
        title: "Getting Started",
        slug: "getting-started",
        markdown: "",
        now
      });
      const document = await upsertDocument(tx, {
        tenantId: tenant.id,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        userId: user.id,
        parentId: folder.id,
        type: "page",
        title: "Welcome to OpenKB",
        slug: "welcome-to-openkb",
        markdown: "# Welcome to OpenKB\n\nThis is the local development seed document.",
        now
      });

      await upsertOwnerCollaborator(tx, {
        tenantId: tenant.id,
        objectType: "document",
        objectId: folder.id,
        userId: user.id,
        now
      });
      await upsertOwnerCollaborator(tx, {
        tenantId: tenant.id,
        objectType: "document",
        objectId: document.id,
        userId: user.id,
        now
      });

      return {
        tenantId: tenant.id,
        userId: user.id,
        email: user.email,
        workspaceId: workspace.id,
        knowledgeBaseId: knowledgeBase.id,
        folderId: folder.id,
        documentId: document.id
      };
    });
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

async function ensureInstanceAuthSettings(tx: Prisma.TransactionClient, now: Date) {
  const existing = await tx.authSetting.findFirst({ where: { tenant_id: null } });
  if (existing) {
    await tx.authSetting.update({
      where: { id: existing.id },
      data: {
        registration_enabled: true,
        email_verification_required: true,
        default_signup_status: "active",
        invited_user_auto_active: true,
        allowed_email_domains: [],
        invite_required: false,
        first_user_becomes_admin: true,
        updated_at: now
      }
    });
    return;
  }

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

async function upsertWorkspace(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; userId: string; now: Date }
) {
  const existing = await tx.workspace.findUnique({
    where: {
      tenant_id_slug: {
        tenant_id: input.tenantId,
        slug: "default-workspace"
      }
    }
  });

  if (existing) {
    return tx.workspace.update({
      where: { id: existing.id },
      data: {
        name: "Default Workspace",
        updated_at: input.now
      }
    });
  }

  return tx.workspace.create({
    data: {
      tenant_id: input.tenantId,
      name: "Default Workspace",
      slug: "default-workspace",
      created_by: input.userId,
      created_at: input.now,
      updated_at: input.now
    }
  });
}

async function upsertKnowledgeBase(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; workspaceId: string; userId: string; now: Date }
) {
  const existing = await tx.knowledgeBase.findUnique({
    where: {
      workspace_id_slug: {
        workspace_id: input.workspaceId,
        slug: "openkb-demo"
      }
    }
  });

  if (existing) {
    return tx.knowledgeBase.update({
      where: { id: existing.id },
      data: {
        title: "OpenKB Demo",
        visibility: "workspace",
        status: "active",
        updated_at: input.now
      }
    });
  }

  return tx.knowledgeBase.create({
    data: {
      tenant_id: input.tenantId,
      workspace_id: input.workspaceId,
      title: "OpenKB Demo",
      slug: "openkb-demo",
      visibility: "workspace",
      status: "active",
      created_by: input.userId,
      created_at: input.now,
      updated_at: input.now
    }
  });
}

async function upsertDocument(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    userId: string;
    parentId: string | null;
    type: "folder" | "page";
    title: string;
    slug: string;
    markdown: string;
    now: Date;
  }
) {
  const existing = await tx.document.findFirst({
    where: {
      knowledge_base_id: input.knowledgeBaseId,
      parent_id: input.parentId,
      slug: input.slug,
      status: { not: "deleted" }
    }
  });

  const document = existing
    ? await tx.document.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          type: input.type,
          updated_by: input.userId,
          updated_at: input.now
        }
      })
    : await tx.document.create({
        data: {
          tenant_id: input.tenantId,
          workspace_id: input.workspaceId,
          knowledge_base_id: input.knowledgeBaseId,
          parent_id: input.parentId,
          type: input.type,
          title: input.title,
          slug: input.slug,
          status: "published",
          permission_mode: "inherit",
          sort_order: 0,
          created_by: input.userId,
          updated_by: input.userId,
          created_at: input.now,
          updated_at: input.now
        }
      });

  if (input.type === "page") {
    const existingVersion = await tx.documentVersion.findFirst({
      where: {
        document_id: document.id,
        version_no: 1
      }
    });

    const version =
      existingVersion ??
      (await tx.documentVersion.create({
        data: {
          tenant_id: input.tenantId,
          document_id: document.id,
          version_no: 1,
          markdown: input.markdown,
          markdown_hash: markdownHash(input.markdown),
          source_type: "manual",
          created_by: input.userId,
          created_at: input.now
        }
      }));

    if (document.current_version_id !== version.id) {
      return tx.document.update({
        where: { id: document.id },
        data: {
          current_version_id: version.id,
          updated_at: input.now
        }
      });
    }
  }

  return document;
}

async function upsertOwnerCollaborator(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    objectType: "knowledge_base" | "document";
    objectId: string;
    userId: string;
    now: Date;
  }
) {
  await tx.collaborator.upsert({
    where: {
      object_type_object_id_subject_type_subject_id: {
        object_type: input.objectType,
        object_id: input.objectId,
        subject_type: "user",
        subject_id: input.userId
      }
    },
    create: {
      tenant_id: input.tenantId,
      object_type: input.objectType,
      object_id: input.objectId,
      subject_type: "user",
      subject_id: input.userId,
      role: "owner",
      source: "system",
      created_by: input.userId,
      created_at: input.now
    },
    update: {
      role: "owner",
      source: "system",
      created_by: input.userId
    }
  });
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value : fallback;
}

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

import { createHash, randomUUID } from "node:crypto";

import {
  chunkMarkdownForIndex,
  type HierarchicalMarkdownChunk,
  type MarkdownChunkingMode,
  type MarkdownParentChunkMode
} from "@openkb/markdown";
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

    let updatedDocument = document;
    if (document.current_version_id !== version.id) {
      updatedDocument = await tx.document.update({
        where: { id: document.id },
        data: {
          current_version_id: version.id,
          updated_at: input.now
        }
      });
    }

    await ensureSeedChunks(tx, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: updatedDocument.id,
      versionId: version.id,
      markdown: version.markdown,
      userId: input.userId,
      now: input.now
    });

    return updatedDocument;
  }

  return document;
}

async function ensureSeedChunks(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    documentId: string;
    versionId: string;
    markdown: string;
    userId: string;
    now: Date;
  }
) {
  const existingChunks = await tx.documentChunk.count({
    where: { version_id: input.versionId }
  });
  if (existingChunks > 0) {
    return;
  }

  const settings = await ensureSeedChunkSettings(tx, input);
  const chunks = materializeSeedChunks(
    chunkMarkdownForIndex(input.markdown, {
      mode: normalizeChunkMode(settings.mode),
      parent_mode: normalizeParentChunkMode(settings.parent_mode),
      parent_delimiter: settings.parent_delimiter,
      child_delimiter: settings.child_delimiter,
      parent_max_characters: settings.parent_max_characters,
      child_max_characters: settings.child_max_characters,
      child_overlap_characters: settings.child_overlap_characters
    })
  );

  if (chunks.length === 0) {
    return;
  }

  await tx.documentChunk.createMany({
    data: chunks.map((chunk) => ({
      id: chunk.id,
      tenant_id: input.tenantId,
      workspace_id: input.workspaceId,
      knowledge_base_id: input.knowledgeBaseId,
      document_id: input.documentId,
      version_id: input.versionId,
      ordinal: chunk.ordinal,
      chunk_type: chunk.chunk_type,
      parent_chunk_id: chunk.parent_chunk_id,
      settings_revision: settings.revision,
      start_line: chunk.start_line,
      end_line: chunk.end_line,
      start_char: chunk.start_char,
      end_char: chunk.end_char,
      parent_ordinal: chunk.parent_ordinal,
      child_ordinal: chunk.child_ordinal,
      heading_path: chunk.heading_path,
      content_text: chunk.content_text,
      content_markdown: chunk.content_markdown,
      token_count: chunk.token_count,
      metadata: chunk.metadata as Prisma.InputJsonValue,
      created_at: input.now
    }))
  });
}

async function ensureSeedChunkSettings(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    userId: string;
    now: Date;
  }
) {
  const existing = await tx.knowledgeBaseChunkSetting.findUnique({
    where: { knowledge_base_id: input.knowledgeBaseId }
  });
  if (existing) {
    return existing;
  }

  return tx.knowledgeBaseChunkSetting.create({
    data: {
      tenant_id: input.tenantId,
      workspace_id: input.workspaceId,
      knowledge_base_id: input.knowledgeBaseId,
      mode: "parent_child",
      parent_mode: "paragraph",
      parent_delimiter: "\n\n",
      child_delimiter: "\n\n",
      parent_max_characters: 4000,
      child_max_characters: 900,
      child_overlap_characters: 120,
      retrieval_model: {
        search_method: "full_text_search",
        top_k: 10,
        score_threshold_enabled: false,
        score_threshold: 0,
        reranking_enable: false,
        reranking_mode: "weighted_score",
        weights: {
          vector_setting: { vector_weight: 0.5 },
          keyword_setting: { keyword_weight: 0.5 }
        },
        metadata_filtering_conditions: null
      },
      revision: 1,
      updated_by: input.userId,
      created_at: input.now,
      updated_at: input.now
    }
  });
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

function materializeSeedChunks(
  chunks: HierarchicalMarkdownChunk[]
): Array<HierarchicalMarkdownChunk & { id: string; parent_chunk_id: string | null }> {
  const ids = chunks.map(() => randomUUID());
  const parentIdByLocalId = new Map<string, string>();

  chunks.forEach((chunk, index) => {
    if (chunk.chunk_type === "parent" && chunk.parent_local_id) {
      parentIdByLocalId.set(chunk.parent_local_id, ids[index]!);
    }
  });

  return chunks.map((chunk, index) => ({
    ...chunk,
    id: ids[index]!,
    parent_chunk_id:
      chunk.chunk_type === "child" && chunk.parent_local_id
        ? (parentIdByLocalId.get(chunk.parent_local_id) ?? null)
        : null
  }));
}

function normalizeChunkMode(value: string): MarkdownChunkingMode {
  return value === "general" ? "general" : "parent_child";
}

function normalizeParentChunkMode(value: string): MarkdownParentChunkMode {
  return value === "full_doc" ? "full_doc" : "paragraph";
}

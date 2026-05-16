import { randomUUID } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { seedDev } from "@openkb/db/seed-dev";
import {
  createOpenKBMilvus,
  getMilvusConfig,
  type MilvusChunkRecord,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionError, PermissionService } from "@openkb/permissions";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { RetrievalError, RetrievalService } from "./index";

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
  "import_format_routes",
  "import_tool_settings",
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

const prisma = createDatabaseClient();
const milvus = createOpenKBMilvus();
const permissions = new PermissionService({ prisma });
const retrieval = new RetrievalService({ prisma, milvus, permissions });

describe("retrieval service integration", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("searches the active Milvus alias and returns only readable documents", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Phase 8 retrieval searches OpenKB content.");
    await indexCurrentChunks(seed, milvus, permissions);

    const response = await retrieval.search({
      user: { user: { id: seed.userId }, tenantId: seed.tenantId },
      query: "Phase 8 retrieval",
      knowledge_base_ids: [seed.knowledgeBaseId],
      top_k: 10,
      filters: {}
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      document_id: seed.documentId,
      knowledge_base_id: seed.knowledgeBaseId,
      title: "Welcome to OpenKB"
    });
    expect(response.results[0]?.path).toEqual([
      "OpenKB Demo",
      "Getting Started",
      "Welcome to OpenKB"
    ]);
  });

  it("applies tags filters with ANY semantics", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Tagged retrieval content for MCP and RAG.", [
      "mcp",
      "rag"
    ]);
    await indexCurrentChunks(seed, milvus, permissions);

    await expect(
      retrieval.search({
        user: { user: { id: seed.userId }, tenantId: seed.tenantId },
        query: "Tagged retrieval content",
        filters: { tags: ["mcp", "other"] }
      })
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ document_id: seed.documentId })]
    });

    await expect(
      retrieval.search({
        user: { user: { id: seed.userId }, tenantId: seed.tenantId },
        query: "Tagged retrieval content",
        filters: { tags: ["missing"] }
      })
    ).resolves.toMatchObject({ results: [] });
  });

  it("lets workspace members search workspace-visible KBs but not guests", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Workspace members can search this document.");
    await indexCurrentChunks(seed, milvus, permissions);
    const member = await createWorkspaceUser(prisma, seed, "member");
    const guest = await createWorkspaceUser(prisma, seed, "guest");

    await expect(
      retrieval.search({
        user: { user: { id: member.id }, tenantId: seed.tenantId },
        query: "Workspace members",
        top_k: 10
      })
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ document_id: seed.documentId })]
    });

    await expect(
      retrieval.search({
        user: { user: { id: guest.id }, tenantId: seed.tenantId },
        query: "Workspace members",
        top_k: 10
      })
    ).resolves.toMatchObject({ results: [] });
  });

  it("does not use tenant admin principals to expand private content access", async () => {
    const seed = await seedDev({ prisma });
    await prisma.knowledgeBase.update({
      where: { id: seed.knowledgeBaseId },
      data: { visibility: "private" }
    });
    await createChunkForSeedDocument(prisma, seed, "Private content should not leak to admins.");
    await indexCurrentChunks(seed, milvus, permissions);
    const workspaceAdmin = await createWorkspaceUser(prisma, seed, "admin", "tenant_admin");

    await expect(
      retrieval.search({
        user: { user: { id: workspaceAdmin.id }, tenantId: seed.tenantId },
        query: "Private content",
        top_k: 10
      })
    ).resolves.toMatchObject({ results: [] });

    await expect(
      retrieval.search({
        user: { user: { id: seed.userId }, tenantId: seed.tenantId },
        query: "Private content",
        top_k: 10
      })
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ document_id: seed.documentId })]
    });
  });

  it("uses PostgreSQL final permission checks when Milvus access principals are stale", async () => {
    const seed = await seedDev({ prisma });
    await prisma.knowledgeBase.update({
      where: { id: seed.knowledgeBaseId },
      data: { visibility: "private" }
    });
    const viewer = await createTenantUser(prisma, seed.tenantId, "stale-viewer@example.com");
    await prisma.collaborator.create({
      data: {
        tenant_id: seed.tenantId,
        object_type: "knowledge_base",
        object_id: seed.knowledgeBaseId,
        subject_type: "user",
        subject_id: viewer.id,
        role: "viewer",
        source: "direct",
        created_by: seed.userId
      }
    });
    await createChunkForSeedDocument(
      prisma,
      seed,
      "Stale Milvus principals must still be denied by PostgreSQL."
    );
    await indexCurrentChunks(seed, milvus, permissions);
    await prisma.collaborator.deleteMany({
      where: {
        object_type: "knowledge_base",
        object_id: seed.knowledgeBaseId,
        subject_type: "user",
        subject_id: viewer.id
      }
    });

    await expect(
      retrieval.search({
        user: { user: { id: viewer.id }, tenantId: seed.tenantId },
        query: "Stale Milvus principals",
        top_k: 10
      })
    ).resolves.toMatchObject({ results: [] });
  });

  it("rejects unreadable knowledge_base_ids scope instead of widening search", async () => {
    const seed = await seedDev({ prisma });
    const user = await createTenantUser(prisma, seed.tenantId, "scope-user@example.com");

    await expect(
      retrieval.search({
        user: { user: { id: user.id }, tenantId: seed.tenantId },
        query: "OpenKB",
        knowledge_base_ids: [seed.knowledgeBaseId]
      })
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("reports SEARCH_INDEX_NOT_READY when the active alias is missing", async () => {
    const seed = await seedDev({ prisma });
    const missingAliasMilvus = createOpenKBMilvus({
      ...getMilvusConfig(),
      activeAlias: `openkb_missing_${randomUUID().replace(/-/g, "_")}`
    });
    const service = new RetrievalService({
      prisma,
      permissions,
      milvus: missingAliasMilvus
    });

    await expect(
      service.search({
        user: { user: { id: seed.userId }, tenantId: seed.tenantId },
        query: "OpenKB"
      })
    ).rejects.toMatchObject({ code: "SEARCH_INDEX_NOT_READY" } satisfies Partial<RetrievalError>);
  });
});

async function createChunkForSeedDocument(
  prismaClient: PrismaClient,
  seed: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    documentId: string;
    userId: string;
  },
  contentText: string,
  tags: string[] = []
) {
  const document = await prismaClient.document.findUniqueOrThrow({
    where: { id: seed.documentId }
  });
  const versionId = document.current_version_id;
  if (!versionId) {
    throw new Error("Seed document is missing current_version_id.");
  }

  await prismaClient.documentChunk.deleteMany({
    where: {
      document_id: seed.documentId,
      version_id: versionId
    }
  });

  await prismaClient.documentChunk.create({
    data: {
      tenant_id: seed.tenantId,
      workspace_id: seed.workspaceId,
      knowledge_base_id: seed.knowledgeBaseId,
      document_id: seed.documentId,
      version_id: versionId,
      ordinal: 0,
      heading_path: ["Welcome to OpenKB"],
      content_text: contentText,
      content_markdown: `# Welcome to OpenKB\n\n${contentText}`,
      token_count: 16,
      metadata: {
        source: "retrieval-test",
        tags
      }
    }
  });

  if (tags.length > 0) {
    const field = await prismaClient.knowledgeBaseMetadataField.upsert({
      where: {
        knowledge_base_id_name: {
          knowledge_base_id: seed.knowledgeBaseId,
          name: "tags"
        }
      },
      create: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        name: "tags",
        type: "string",
        status: "active",
        sort_order: 0,
        created_by: seed.userId,
        updated_by: seed.userId
      },
      update: {
        status: "active",
        updated_by: seed.userId
      }
    });
    await prismaClient.documentMetadataValue.upsert({
      where: {
        document_id_field_id: {
          document_id: seed.documentId,
          field_id: field.id
        }
      },
      create: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        document_id: seed.documentId,
        field_id: field.id,
        value: tags,
        updated_by: seed.userId
      },
      update: {
        value: tags,
        updated_by: seed.userId,
        updated_at: new Date()
      }
    });
  }
}

async function indexCurrentChunks(
  seed: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    documentId: string;
  },
  milvusClient: OpenKBMilvus,
  permissionService: PermissionService
) {
  const collectionName = `openkb_chunks_retrieval_${randomUUID().replace(/-/g, "_")}`;
  const chunk = await prisma.documentChunk.findFirstOrThrow({
    where: { document_id: seed.documentId },
    orderBy: { ordinal: "asc" }
  });
  const document = await prisma.document.findUniqueOrThrow({ where: { id: seed.documentId } });
  const accessPrincipals = await permissionService.getObjectAccessPrincipals(
    "document",
    seed.documentId
  );
  const record: MilvusChunkRecord = {
    id: chunk.id,
    chunk_id: chunk.id,
    tenant_id: seed.tenantId,
    workspace_id: seed.workspaceId,
    knowledge_base_id: seed.knowledgeBaseId,
    document_id: seed.documentId,
    version_id: chunk.version_id,
    is_current: true,
    doc_status: document.status,
    title: document.title,
    heading_path: chunk.heading_path,
    content_text: chunk.content_text,
    content_markdown: chunk.content_markdown,
    metadata: chunk.metadata as Record<string, unknown>,
    access_principals: accessPrincipals,
    created_at: chunk.created_at.getTime(),
    updated_at: document.updated_at.getTime()
  };

  await milvusClient.createChunkCollection(collectionName);
  await milvusClient.insertChunks(collectionName, [record]);
  await milvusClient.flush(collectionName);
  await milvusClient.loadCollection(collectionName);
  await milvusClient.switchAlias("openkb_chunks_active", collectionName);
}

async function createWorkspaceUser(
  prismaClient: PrismaClient,
  seed: { tenantId: string; workspaceId: string },
  workspaceRole: "admin" | "member" | "guest",
  tenantRole: "tenant_admin" | "member" = "member"
) {
  const user = await createTenantUser(
    prismaClient,
    seed.tenantId,
    `${workspaceRole}-${randomUUID()}@example.com`,
    tenantRole
  );
  await prismaClient.workspaceMember.create({
    data: {
      tenant_id: seed.tenantId,
      workspace_id: seed.workspaceId,
      user_id: user.id,
      role: workspaceRole
    }
  });
  return user;
}

async function createTenantUser(
  prismaClient: PrismaClient,
  tenantId: string,
  email: string,
  role: "tenant_admin" | "member" = "member"
) {
  const user = await prismaClient.user.create({
    data: {
      email,
      password_hash: "test-only",
      display_name: email,
      status: "active",
      email_verified_at: new Date()
    }
  });
  await prismaClient.tenantMembership.create({
    data: {
      tenant_id: tenantId,
      user_id: user.id,
      role
    }
  });
  return user;
}

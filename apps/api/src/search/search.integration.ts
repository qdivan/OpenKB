import { createHash, randomUUID } from "node:crypto";

import { AuthService } from "@openkb/auth";
import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { createOpenKBMilvus, type MilvusChunkRecord, type OpenKBMilvus } from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";
import { ContentService } from "../content/content.service";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for search API integration tests.");
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
  "import_format_routes",
  "import_tool_settings",
  "document_asset_bindings",
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
const auth = new AuthService({ prisma });
const permissions = new PermissionService({ prisma });
const milvus = createOpenKBMilvus();
let app: NestFastifyApplication;

describe("Search API integration", () => {
  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("returns 401 for anonymous search requests", async () => {
    const response = await injectSearch({ query: "OpenKB" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required."
    });
  });

  it("returns readable results for authenticated users", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "HTTP search retrieves tagged MCP content.", [
      "mcp",
      "api"
    ]);
    await indexCurrentChunks(seed, milvus, permissions);
    const login = await auth.login({
      email: "admin@openkb.local",
      password: DEV_ADMIN_PASSWORD
    });

    const response = await injectSearch(
      {
        query: "HTTP search",
        filters: { tags: ["mcp"] },
        top_k: 10
      },
      `openkb_session=${login.sessionToken}`
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      query: "HTTP search",
      top_k: 10,
      results: [
        expect.objectContaining({
          document_id: seed.documentId,
          knowledge_base_id: seed.knowledgeBaseId,
          content: expect.stringContaining("HTTP search")
        })
      ]
    });
  });

  it("indexes content published by editors and returns it only to readable users", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);
    const editorUser = await createActiveUser(seed.tenantId, "search-editor@openkb.local");
    const viewerUser = await createActiveUser(seed.tenantId, "search-viewer@openkb.local");
    await prisma.collaborator.createMany({
      data: [
        {
          tenant_id: seed.tenantId,
          object_type: "document",
          object_id: seed.documentId,
          subject_type: "user",
          subject_id: editorUser.id,
          role: "editor",
          source: "direct",
          created_by: seed.userId
        },
        {
          tenant_id: seed.tenantId,
          object_type: "document",
          object_id: seed.documentId,
          subject_type: "user",
          subject_id: viewerUser.id,
          role: "viewer",
          source: "direct",
          created_by: seed.userId
        }
      ]
    });
    const editor = await auth.login({
      email: editorUser.email,
      password: "OpenKB-test-123456"
    });
    const viewer = await auth.login({
      email: viewerUser.email,
      password: "OpenKB-test-123456"
    });
    const current = await content.getDocument(editor.sessionToken, seed.documentId);
    const markdown =
      "# Searchable editor publish\n\nHTTP search editor publish marker confirms permissions.";
    await content.updateDocument(editor.sessionToken, seed.documentId, {
      base_version_id: current.currentVersion?.id ?? null,
      markdown,
      markdown_hash: markdownHash(markdown)
    });

    const published = await content.publishDocument(editor.sessionToken, seed.documentId);
    expect(published.processing_status).toBe("current");
    await expect(
      content.publishDocument(viewer.sessionToken, seed.documentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const indexedRecords = await indexCurrentChunks(seed, milvus, permissions);
    expect(indexedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access_principals: expect.arrayContaining([
            `user:${editorUser.id}`,
            `user:${viewerUser.id}`
          ]),
          content_text: expect.stringContaining("HTTP search editor publish marker")
        })
      ])
    );
    await expect(
      milvus.searchScopedChunks({
        query: "HTTP search",
        tenantId: seed.tenantId,
        knowledgeBaseIds: [seed.knowledgeBaseId],
        limit: 5
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_id: seed.documentId,
          content_text: expect.stringContaining("HTTP search editor publish marker")
        })
      ])
    );

    const editorResponse = await injectSearch(
      { query: "HTTP search", top_k: 5 },
      `openkb_session=${editor.sessionToken}`
    );
    expect(editorResponse.statusCode).toBe(200);
    expect(editorResponse.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_id: seed.documentId,
          content: expect.stringContaining("HTTP search editor publish marker")
        })
      ])
    );

    const viewerResponse = await injectSearch(
      { query: "HTTP search", top_k: 5 },
      `openkb_session=${viewer.sessionToken}`
    );
    expect(viewerResponse.statusCode).toBe(200);
    expect(viewerResponse.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_id: seed.documentId,
          content: expect.stringContaining("HTTP search editor publish marker")
        })
      ])
    );
  });
});

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

async function injectSearch(payload: unknown, cookie?: string) {
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url: "/api/search",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {})
      },
      payload: JSON.stringify(payload)
    });
}

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
  tags: string[]
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
        source: "search-api-test",
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
  const collectionName = `openkb_chunks_api_search_${randomUUID().replace(/-/g, "_")}`;
  const document = await prisma.document.findUniqueOrThrow({ where: { id: seed.documentId } });
  const chunks = await prisma.documentChunk.findMany({
    where: {
      document_id: seed.documentId,
      version_id: document.current_version_id ?? undefined,
      index_role: "content",
      status: "active"
    },
    orderBy: { ordinal: "asc" }
  });
  expect(chunks.length).toBeGreaterThan(0);
  const accessPrincipals = await permissionService.getObjectAccessPrincipals(
    "document",
    seed.documentId
  );
  const records: MilvusChunkRecord[] = chunks.map((chunk) => ({
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
  }));

  await milvusClient.createChunkCollection(collectionName);
  await milvusClient.insertChunks(collectionName, records);
  await milvusClient.flush(collectionName);
  await milvusClient.loadCollection(collectionName);
  await milvusClient.switchAlias("openkb_chunks_active", collectionName);
  return records;
}

async function createActiveUser(tenantId: string, email: string) {
  const now = new Date();
  const passwordHash = await bcrypt.hash("OpenKB-test-123456", 12);
  const user = await prisma.user.create({
    data: {
      email,
      password_hash: passwordHash,
      display_name: email,
      status: "active",
      email_verified_at: now,
      created_at: now,
      updated_at: now
    }
  });
  await prisma.tenantMembership.create({
    data: {
      tenant_id: tenantId,
      user_id: user.id,
      role: "member",
      created_at: now
    }
  });
  return user;
}

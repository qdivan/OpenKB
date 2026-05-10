import { randomUUID } from "node:crypto";

import { AuthService } from "@openkb/auth";
import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { createOpenKBMilvus, type MilvusChunkRecord, type OpenKBMilvus } from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";

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
});

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

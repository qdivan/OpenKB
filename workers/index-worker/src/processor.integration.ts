import { randomUUID } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { seedDev } from "@openkb/db/seed-dev";
import { createOpenKBMilvus } from "@openkb/milvus";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runRebuildOnce } from "./processor";

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

const prisma = createDatabaseClient();
const milvus = createOpenKBMilvus();

describe("index worker", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rebuilds current PostgreSQL chunks into Milvus and switches the active alias", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed);
    const collectionName = `openkb_chunks_test_${randomUUID().replace(/-/g, "_")}`;

    const job = await prisma.indexRebuildJob.create({
      data: {
        tenant_id: seed.tenantId,
        target_collection: collectionName,
        target_alias: "openkb_chunks_active",
        status: "pending",
        started_by: seed.userId
      }
    });

    await expect(milvus.health()).resolves.toMatchObject({ ok: true });
    await expect(runRebuildOnce({ prisma, milvus, env: process.env })).resolves.toMatchObject({
      processed: true,
      job_id: job.id,
      status: "succeeded",
      indexed_chunks: 1
    });

    const rebuilt = await prisma.indexRebuildJob.findUniqueOrThrow({ where: { id: job.id } });
    const profile = await prisma.milvusIndexProfile.findFirstOrThrow({
      where: {
        collection_name: collectionName
      }
    });
    const alias = await milvus.describeAlias("openkb_chunks_active");

    expect(rebuilt.status).toBe("succeeded");
    expect(rebuilt.error).toBeNull();
    expect(profile.status).toBe("active");
    expect(profile.bm25_function_name).toBe("openkb_bm25");
    expect(JSON.stringify(profile.function_metadata)).not.toMatch(/api[_-]?key|secret|token/i);
    expect(alias).toEqual({
      alias: "openkb_chunks_active",
      collection: collectionName
    });
    await expect(milvus.count(collectionName)).resolves.toBeGreaterThanOrEqual(1);
  });
});

async function createChunkForSeedDocument(
  prismaClient: PrismaClient,
  seed: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    documentId: string;
  }
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
      content_text: "Welcome to OpenKB. This chunk is indexed by Phase 7.",
      content_markdown: "# Welcome to OpenKB\n\nThis chunk is indexed by Phase 7.",
      token_count: 12,
      metadata: {
        source: "index-worker-test"
      }
    }
  });
}

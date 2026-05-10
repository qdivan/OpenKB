import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { DEV_ADMIN_EMAIL, seedDev } from "@openkb/db/seed-dev";
import { createOpenKBMilvus, type MilvusChunkRecord, type OpenKBMilvus } from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DifyAuthService } from "./auth";
import { createDifyAdapterHttpServer } from "./server";
import { DifyAdapterService } from "./service";

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
const service = new DifyAdapterService({ prisma });
let server: Server;
let baseUrl: string;

describe("Dify External Knowledge adapter", () => {
  beforeAll(async () => {
    server = createDifyAdapterHttpServer(service);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await service.disconnect();
  });

  it("returns Dify-compatible auth errors", async () => {
    const missing = await postRetrieval(null, {
      knowledge_id: "kb_ext",
      query: "OpenKB",
      retrieval_setting: { top_k: 1, score_threshold: 0 }
    });
    const invalid = await postRetrieval("dify_wrong", {
      knowledge_id: "kb_ext",
      query: "OpenKB",
      retrieval_setting: { top_k: 1, score_threshold: 0 }
    });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error_code: 1001,
      error_msg: "Authorization: Bearer API key is required."
    });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({
      error_code: 1002,
      error_msg: "Dify API key is invalid or expired."
    });
  });

  it("returns records for active keys, mappings and allowed knowledge bases", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Dify external retrieval returns metadata.", [
      "dify",
      "api"
    ]);
    await indexCurrentChunks(seed, milvus, permissions);
    const key = await createDifyKey(seed, { knowledgeId: "dify-openkb" });

    const response = await postRetrieval(key.apiKey, {
      knowledge_id: "dify-openkb",
      query: "Dify external retrieval",
      retrieval_setting: { top_k: 5, score_threshold: 0 },
      metadata_condition: {
        logical_operator: "and",
        conditions: [{ name: "tags", comparison_operator: "contains", value: "dify" }]
      }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      records: [
        {
          content: expect.stringContaining("Dify external retrieval"),
          title: "Welcome to OpenKB",
          metadata: expect.objectContaining({
            document_id: seed.documentId,
            chunk_id: expect.any(String),
            knowledge_base_id: seed.knowledgeBaseId,
            path: "/OpenKB Demo/Getting Started/Welcome to OpenKB",
            url: expect.stringContaining(`/app/kb/${seed.knowledgeBaseId}/docs/${seed.documentId}`)
          })
        }
      ]
    });
    expect(body.records[0].metadata).not.toBeNull();
    expect(body.records[0].score).toBeGreaterThanOrEqual(0);
    expect(body.records[0].score).toBeLessThanOrEqual(1);
  });

  it("rejects missing mappings and forbidden KB scopes", async () => {
    const seed = await seedDev({ prisma });
    const key = await createDifyKey(seed, { knowledgeId: "known" });

    const missing = await postRetrieval(key.apiKey, {
      knowledge_id: "missing",
      query: "OpenKB",
      retrieval_setting: { top_k: 1, score_threshold: 0 }
    });
    await prisma.difyApiKey.update({
      where: { id: key.id },
      data: { allowed_knowledge_base_ids: [] }
    });
    const forbidden = await postRetrieval(key.apiKey, {
      knowledge_id: "known",
      query: "OpenKB",
      retrieval_setting: { top_k: 1, score_threshold: 0 }
    });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error_code: 2001 });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error_code: 2002 });
  });

  it("filters by score threshold and metadata_condition", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Dify metadata filtering keeps matching rows.", [
      "dify"
    ]);
    await indexCurrentChunks(seed, milvus, permissions);
    const key = await createDifyKey(seed, { knowledgeId: "dify-filter" });

    const threshold = await postRetrieval(key.apiKey, {
      knowledge_id: "dify-filter",
      query: "Dify metadata filtering",
      retrieval_setting: { top_k: 5, score_threshold: 0.99 }
    });
    const nonMatchingMetadata = await postRetrieval(key.apiKey, {
      knowledge_id: "dify-filter",
      query: "Dify metadata filtering",
      retrieval_setting: { top_k: 5, score_threshold: 0 },
      metadata_condition: {
        conditions: [{ name: "tags", comparison_operator: "contains", value: "missing" }]
      }
    });

    expect(await threshold.json()).toEqual({ records: [] });
    expect(await nonMatchingMetadata.json()).toEqual({ records: [] });
  });

  it("allows explicitly scoped private KBs and blocks stale PostgreSQL state", async () => {
    const seed = await seedDev({ prisma });
    await prisma.knowledgeBase.update({
      where: { id: seed.knowledgeBaseId },
      data: { visibility: "private" }
    });
    await createChunkForSeedDocument(prisma, seed, "Private scoped Dify knowledge is searchable.", [
      "private"
    ]);
    await indexCurrentChunks(seed, milvus, permissions);
    const key = await createDifyKey(seed, { knowledgeId: "dify-private" });

    const privateResponse = await postRetrieval(key.apiKey, {
      knowledge_id: "dify-private",
      query: "Private scoped Dify",
      retrieval_setting: { top_k: 5, score_threshold: 0 }
    });
    expect((await privateResponse.json()).records).toHaveLength(1);

    await prisma.document.update({
      where: { id: seed.documentId },
      data: { status: "deleted" }
    });
    const staleResponse = await postRetrieval(key.apiKey, {
      knowledge_id: "dify-private",
      query: "Private scoped Dify",
      retrieval_setting: { top_k: 5, score_threshold: 0 }
    });
    expect(await staleResponse.json()).toEqual({ records: [] });
  });

  it("writes audit logs without raw API keys", async () => {
    const seed = await seedDev({ prisma });
    await createChunkForSeedDocument(prisma, seed, "Dify audit logging records returned chunks.");
    await indexCurrentChunks(seed, milvus, permissions);
    const key = await createDifyKey(seed, { knowledgeId: "dify-audit" });

    await postRetrieval(key.apiKey, {
      knowledge_id: "dify-audit",
      query: "Dify audit logging",
      retrieval_setting: { top_k: 5, score_threshold: 0 }
    });
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: "dify.retrieval" }
    });

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      actor_type: "api_key",
      object_type: "knowledge_base",
      object_id: seed.knowledgeBaseId
    });
    expect(JSON.stringify(auditLogs.map((log) => log.metadata))).toContain(key.id);
    expect(JSON.stringify(auditLogs.map((log) => log.metadata))).not.toContain(key.apiKey);
  });
});

async function postRetrieval(apiKey: string | null, payload: unknown) {
  return fetch(`${baseUrl}/retrieval`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(payload)
  });
}

async function createDifyKey(
  seed: {
    knowledgeBaseId: string;
  },
  input: { knowledgeId: string }
) {
  const auth = new DifyAuthService({
    prisma,
    env: {
      ...process.env,
      DIFY_API_KEY_PREFIX: "dify_",
      DIFY_MAX_TOP_K: "20",
      DIFY_RESULT_BASE_URL: "http://localhost:3000"
    }
  });
  return auth.createApiKey({
    createdByEmail: DEV_ADMIN_EMAIL,
    name: `Dify test key ${randomUUID()}`,
    knowledgeId: input.knowledgeId,
    knowledgeBaseId: seed.knowledgeBaseId,
    topKLimit: 10,
    expiresDays: 1
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
  tags: string[] = []
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
        source: "dify-test",
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
  const collectionName = `openkb_chunks_dify_${randomUUID().replace(/-/g, "_")}`;
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

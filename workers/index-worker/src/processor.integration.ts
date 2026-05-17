import { randomUUID } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { seedDev } from "@openkb/db/seed-dev";
import { OpenKBModelClient } from "@openkb/model-client";
import { createOpenKBMilvus, getMilvusConfig } from "@openkb/milvus";
import type { ObjectStorage } from "@openkb/storage";
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
    expect(JSON.stringify(profile.function_metadata)).not.toMatch(
      /api[_-]?key|secret|password|authorization/i
    );
    expect(alias).toEqual({
      alias: "openkb_chunks_active",
      collection: collectionName
    });
    await expect(milvus.count(collectionName)).resolves.toBeGreaterThanOrEqual(1);
  });

  it("uses image embeddings for image asset chunks when the model reports image capability", async () => {
    const seed = await seedDev({ prisma });
    const sourceChunk = await createChunkForSeedDocument(prisma, seed);
    const asset = await prisma.documentAsset.create({
      data: {
        tenant_id: seed.tenantId,
        document_id: seed.documentId,
        object_key: "tenants/test/assets/chart.png",
        filename: "chart.png",
        mime_type: "image/png",
        size_bytes: BigInt(68),
        checksum_sha256: "image-checksum",
        metadata: { source: "index-worker-test" },
        created_by: seed.userId
      }
    });
    const imageChunk = await prisma.documentChunk.create({
      data: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        document_id: seed.documentId,
        version_id: sourceChunk.version_id,
        ordinal: 1,
        heading_path: ["Welcome to OpenKB"],
        content_text: "chart image asset",
        content_markdown: "![chart](asset://chart.png)",
        token_count: 5,
        index_role: "asset_image",
        source_chunk_id: sourceChunk.id,
        metadata: {
          hit_type: "image",
          asset_id: asset.id,
          asset_filename: asset.filename,
          asset_mime_type: asset.mime_type,
          source_chunk_id: sourceChunk.id
        }
      }
    });
    const collectionName = `openkb_chunks_image_${randomUUID().replace(/-/g, "_")}`;
    await prisma.indexRebuildJob.create({
      data: {
        tenant_id: seed.tenantId,
        target_collection: collectionName,
        target_alias: "openkb_chunks_active",
        status: "pending",
        started_by: seed.userId
      }
    });
    const modelClient = createImageCapableModelClient();
    const imageMilvus = createOpenKBMilvus({
      ...getMilvusConfig(process.env),
      vectorDim: 4,
      enableDenseVector: true
    });

    await expect(
      runRebuildOnce({
        prisma,
        milvus: imageMilvus,
        modelClient,
        storage: createMemoryStorage(),
        env: { ...process.env, OPENKB_IMAGE_VECTOR_MODE: "auto" }
      })
    ).resolves.toMatchObject({
      processed: true,
      status: "succeeded",
      indexed_chunks: 2
    });

    const updated = await prisma.documentChunk.findUniqueOrThrow({ where: { id: imageChunk.id } });
    expect(updated.metadata).toMatchObject({
      image_vector_enabled: true,
      image_vector_model: "qwen3-vl-embedding"
    });
    expect(modelClient.seenImageInput()).toBe(true);
  });

  it("falls back to text embedding for internal image assets that are still pending", async () => {
    const seed = await seedDev({ prisma });
    const sourceChunk = await createChunkForSeedDocument(prisma, seed);
    const asset = await prisma.documentAsset.create({
      data: {
        tenant_id: seed.tenantId,
        document_id: null,
        object_key: "tenants/test/assets/pending-chart.png",
        filename: "pending-chart.png",
        mime_type: "image/png",
        size_bytes: BigInt(68),
        checksum_sha256: "pending-image-checksum",
        metadata: { source: "index-worker-test" },
        created_by: seed.userId
      }
    });
    const imageChunk = await prisma.documentChunk.create({
      data: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        document_id: seed.documentId,
        version_id: sourceChunk.version_id,
        ordinal: 1,
        heading_path: ["Welcome to OpenKB"],
        content_text: "pending chart image asset fallback",
        content_markdown: "![pending chart](asset://pending-chart.png)",
        token_count: 6,
        index_role: "asset_image",
        source_chunk_id: sourceChunk.id,
        metadata: {
          hit_type: "image",
          asset_id: asset.id,
          asset_filename: asset.filename,
          asset_mime_type: asset.mime_type,
          source_chunk_id: sourceChunk.id
        }
      }
    });
    const collectionName = `openkb_chunks_pending_image_${randomUUID().replace(/-/g, "_")}`;
    await prisma.indexRebuildJob.create({
      data: {
        tenant_id: seed.tenantId,
        target_collection: collectionName,
        target_alias: "openkb_chunks_active",
        status: "pending",
        started_by: seed.userId
      }
    });
    const modelClient = createImageCapableModelClient();
    const imageMilvus = createOpenKBMilvus({
      ...getMilvusConfig(process.env),
      vectorDim: 4,
      enableDenseVector: true
    });

    await expect(
      runRebuildOnce({
        prisma,
        milvus: imageMilvus,
        modelClient,
        storage: createMemoryStorage(),
        env: { ...process.env, OPENKB_IMAGE_VECTOR_MODE: "auto" }
      })
    ).resolves.toMatchObject({
      processed: true,
      status: "succeeded",
      indexed_chunks: 2
    });

    const updated = await prisma.documentChunk.findUniqueOrThrow({ where: { id: imageChunk.id } });
    expect(updated.metadata).toMatchObject({
      image_vector_enabled: false,
      image_vector_fallback_reason: "asset_not_bound_to_document"
    });
    expect(modelClient.seenImageInput()).toBe(false);
  });

  it("falls back to text embedding when image embedding fails", async () => {
    const seed = await seedDev({ prisma });
    const sourceChunk = await createChunkForSeedDocument(prisma, seed);
    const asset = await prisma.documentAsset.create({
      data: {
        tenant_id: seed.tenantId,
        document_id: seed.documentId,
        object_key: "tenants/test/assets/failing-chart.png",
        filename: "failing-chart.png",
        mime_type: "image/png",
        size_bytes: BigInt(68),
        checksum_sha256: "failing-image-checksum",
        metadata: { source: "index-worker-test" },
        created_by: seed.userId
      }
    });
    const imageChunk = await prisma.documentChunk.create({
      data: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        document_id: seed.documentId,
        version_id: sourceChunk.version_id,
        ordinal: 1,
        heading_path: ["Welcome to OpenKB"],
        content_text: "failing chart image asset fallback",
        content_markdown: "![failing chart](asset://failing-chart.png)",
        token_count: 6,
        index_role: "asset_image",
        source_chunk_id: sourceChunk.id,
        metadata: {
          hit_type: "image",
          asset_id: asset.id,
          asset_filename: asset.filename,
          asset_mime_type: asset.mime_type,
          source_chunk_id: sourceChunk.id
        }
      }
    });
    const collectionName = `openkb_chunks_image_failure_${randomUUID().replace(/-/g, "_")}`;
    await prisma.indexRebuildJob.create({
      data: {
        tenant_id: seed.tenantId,
        target_collection: collectionName,
        target_alias: "openkb_chunks_active",
        status: "pending",
        started_by: seed.userId
      }
    });
    const modelClient = createImageCapableModelClient({ failImageEmbeddings: true });
    const imageMilvus = createOpenKBMilvus({
      ...getMilvusConfig(process.env),
      vectorDim: 4,
      enableDenseVector: true
    });

    await expect(
      runRebuildOnce({
        prisma,
        milvus: imageMilvus,
        modelClient,
        storage: createMemoryStorage(),
        env: { ...process.env, OPENKB_IMAGE_VECTOR_MODE: "auto" }
      })
    ).resolves.toMatchObject({
      processed: true,
      status: "succeeded",
      indexed_chunks: 2
    });

    const updated = await prisma.documentChunk.findUniqueOrThrow({ where: { id: imageChunk.id } });
    expect(updated.metadata).toMatchObject({
      image_vector_enabled: false,
      image_vector_fallback_reason: "image_vector_failed"
    });
    expect(modelClient.seenImageInput()).toBe(true);
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

  await prismaClient.documentChunk.deleteMany({
    where: {
      document_id: seed.documentId,
      version_id: versionId
    }
  });

  return prismaClient.documentChunk.create({
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

function createImageCapableModelClient(options: { failImageEmbeddings?: boolean } = {}) {
  let seenImageInput = false;
  const client = new OpenKBModelClient(
    {
      embedding: {
        provider: "openai_compatible",
        endpoint: "http://model.local/v1/embeddings",
        model: "qwen3-vl-embedding",
        source: "env",
        dim: 4,
        batchSize: 16,
        timeoutMs: 30_000,
        capabilities: {
          input_modalities: ["text"],
          dimensions: 4,
          max_tokens: null,
          languages: [],
          provider_model_type: null,
          supports_batch: true,
          raw_provider: {}
        }
      },
      rerank: {
        provider: "openai_compatible",
        source: "none",
        timeoutMs: 15_000,
        capabilities: {
          input_modalities: ["text"],
          dimensions: null,
          max_tokens: null,
          languages: [],
          provider_model_type: null,
          supports_batch: null,
          raw_provider: {}
        }
      },
      language: {
        provider: "openai_responses",
        source: "none",
        timeoutMs: 30_000,
        maxOutputTokens: 64,
        temperature: 0
      }
    },
    async (url, init) => {
      if (init.method === "GET" && url.endsWith("/v1/models")) {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "qwen3-vl-embedding",
              object: "model",
              capabilities: {
                input_modalities: ["text", "image"],
                dimensions: 4,
                supports_batch: true
              }
            }
          ]
        });
      }
      const body = JSON.parse(init.body ?? "{}") as { input?: unknown[] };
      const inputs = Array.isArray(body.input) ? body.input : [];
      const hasImageInput = inputs.some(
        (input) => typeof input === "object" && input !== null && "image" in input
      );
      seenImageInput = seenImageInput || hasImageInput;
      if (hasImageInput && options.failImageEmbeddings) {
        return errorResponse(502, { error: { message: "image embedding failed" } });
      }
      return jsonResponse({
        object: "list",
        data: inputs.map((_, index) => ({
          object: "embedding",
          index,
          embedding: [index + 0.1, index + 0.2, index + 0.3, index + 0.4]
        }))
      });
    }
  ) as OpenKBModelClient & { seenImageInput: () => boolean };
  client.seenImageInput = () => seenImageInput;
  return client;
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createMemoryStorage(): ObjectStorage {
  return {
    bucket: "openkb-assets",
    ensureBucket: async () => undefined,
    putObject: async () => ({}),
    getObject: async () =>
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK8uPwAAAABJRU5ErkJggg==",
        "base64"
      ),
    headObject: async () => ({ $metadata: {} }),
    deleteObject: async () => undefined,
    createPresignedGetUrl: async () => "http://localhost/assets/chart.png"
  };
}

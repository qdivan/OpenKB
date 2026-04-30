import { Prisma, createDatabaseClient, type PrismaClient } from "@openkb/db";
import {
  createCollectionName,
  createOpenKBMilvus,
  getMilvusConfig,
  type MilvusChunkRecord,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";

export type IndexWorkerOptions = {
  prisma?: PrismaClient;
  milvus?: OpenKBMilvus;
  permissions?: PermissionService;
  env?: NodeJS.ProcessEnv;
};

export type IndexRunResult = {
  processed: boolean;
  job_id?: string;
  status?: "succeeded" | "failed";
  indexed_chunks?: number;
  error?: string;
};

type IndexRebuildJobRow = {
  id: string;
  tenant_id: string | null;
  target_collection: string;
  target_alias: string;
  status: string;
  started_by: string;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
};

type ChunkRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  version_id: string;
  ordinal: number;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  token_count: number | null;
  metadata: unknown;
  created_at: Date;
  title: string;
  doc_status: string;
  document_updated_at: Date;
};

export async function runRebuildOnce(options: IndexWorkerOptions = {}): Promise<IndexRunResult> {
  const prisma = options.prisma ?? createDatabaseClient();
  const permissions = options.permissions ?? new PermissionService({ prisma });
  const milvus = options.milvus ?? createOpenKBMilvus(getMilvusConfig(options.env));
  const shouldDisconnect = !options.prisma;

  try {
    const job = await claimPendingRebuildJob(prisma);
    if (!job) {
      return { processed: false };
    }

    try {
      const indexedChunks = await processRebuildJob(prisma, permissions, milvus, job, options.env);
      return {
        processed: true,
        job_id: job.id,
        status: "succeeded",
        indexed_chunks: indexedChunks
      };
    } catch (error) {
      const code = toStableErrorCode(error);
      await markJobFailed(prisma, job, code);
      return {
        processed: true,
        job_id: job.id,
        status: "failed",
        error: code
      };
    }
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

export async function runIndexWatch(options: IndexWorkerOptions = {}): Promise<void> {
  const pollMs = parsePositiveInt(options.env?.INDEX_WORKER_POLL_MS, 2000);
  for (;;) {
    const result = await runRebuildOnce(options);
    if (!result.processed) {
      await sleep(pollMs);
    }
  }
}

async function processRebuildJob(
  prisma: PrismaClient,
  permissions: PermissionService,
  milvus: OpenKBMilvus,
  job: IndexRebuildJobRow,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const config = getMilvusConfig(env);
  const now = new Date();

  const profile = await prisma.milvusIndexProfile.create({
    data: {
      tenant_id: job.tenant_id,
      alias: job.target_alias,
      collection_name: job.target_collection,
      schema_version: config.schemaVersion,
      vector_dim: config.vectorDim,
      embedding_function_name: config.enableTextEmbedding ? "openkb_text_embedding" : "disabled",
      bm25_function_name: config.enableBm25 ? "openkb_bm25" : null,
      rerank_function_name: config.enableRerank ? "openkb_rerank" : null,
      status: "building",
      function_metadata: {
        schema_version: config.schemaVersion,
        enable_bm25: config.enableBm25,
        enable_text_embedding: config.enableTextEmbedding,
        enable_rerank: config.enableRerank
      },
      created_by: job.started_by,
      created_at: now
    }
  });

  try {
    await milvus.createChunkCollection(job.target_collection);
    const indexedChunks = await insertCurrentChunks(prisma, permissions, milvus, job, env);
    await milvus.flush(job.target_collection);
    await milvus.loadCollection(job.target_collection);
    await milvus.count(job.target_collection);
    await milvus.switchAlias(job.target_alias, job.target_collection);

    await prisma.$transaction([
      prisma.milvusIndexProfile.updateMany({
        where: {
          alias: job.target_alias,
          status: "active",
          id: { not: profile.id }
        },
        data: { status: "deprecated" }
      }),
      prisma.milvusIndexProfile.update({
        where: { id: profile.id },
        data: {
          status: "active",
          activated_at: new Date()
        }
      }),
      prisma.indexRebuildJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          finished_at: new Date(),
          error: null
        }
      })
    ]);

    return indexedChunks;
  } catch (error) {
    await prisma.milvusIndexProfile.update({
      where: { id: profile.id },
      data: { status: "failed" }
    });
    throw error;
  }
}

async function insertCurrentChunks(
  prisma: PrismaClient,
  permissions: PermissionService,
  milvus: OpenKBMilvus,
  job: IndexRebuildJobRow,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const batchSize = parsePositiveInt(env.INDEX_WORKER_BATCH_SIZE, 100);
  let offset = 0;
  let inserted = 0;
  const principalCache = new Map<string, string[]>();

  for (;;) {
    const rows = await readCurrentChunks(prisma, job.tenant_id, batchSize, offset);
    if (rows.length === 0) {
      return inserted;
    }

    const records: MilvusChunkRecord[] = [];
    for (const row of rows) {
      let accessPrincipals = principalCache.get(row.document_id);
      if (!accessPrincipals) {
        accessPrincipals = await permissions.getObjectAccessPrincipals("document", row.document_id);
        principalCache.set(row.document_id, accessPrincipals);
      }
      records.push(toMilvusChunkRecord(row, accessPrincipals));
    }

    inserted += await milvus.insertChunks(job.target_collection, records);
    offset += rows.length;
  }
}

async function claimPendingRebuildJob(prisma: PrismaClient): Promise<IndexRebuildJobRow | null> {
  const jobs = await prisma.$queryRaw<IndexRebuildJobRow[]>`
    UPDATE index_rebuild_jobs
    SET status = 'running', started_at = now(), error = NULL
    WHERE id = (
      SELECT id
      FROM index_rebuild_jobs
      WHERE status = 'pending'
      ORDER BY started_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;

  return jobs[0] ?? null;
}

async function readCurrentChunks(
  prisma: PrismaClient,
  tenantId: string | null,
  limit: number,
  offset: number
): Promise<ChunkRow[]> {
  const tenantFilter = tenantId ? Prisma.sql`AND c.tenant_id = ${tenantId}::uuid` : Prisma.empty;

  return prisma.$queryRaw<ChunkRow[]>`
    SELECT
      c.id::text,
      c.tenant_id::text,
      c.workspace_id::text,
      c.knowledge_base_id::text,
      c.document_id::text,
      c.version_id::text,
      c.ordinal,
      c.heading_path,
      c.content_text,
      c.content_markdown,
      c.token_count,
      c.metadata,
      c.created_at,
      d.title,
      d.status AS doc_status,
      d.updated_at AS document_updated_at
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
    WHERE d.status <> 'deleted'
      AND kb.status = 'active'
      AND d.current_version_id = c.version_id
      ${tenantFilter}
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

async function markJobFailed(
  prisma: PrismaClient,
  job: IndexRebuildJobRow,
  errorCode: string
): Promise<void> {
  await prisma.indexRebuildJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      finished_at: new Date(),
      error: errorCode
    }
  });
}

function toMilvusChunkRecord(row: ChunkRow, accessPrincipals: string[]): MilvusChunkRecord {
  return {
    id: row.id,
    chunk_id: row.id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    knowledge_base_id: row.knowledge_base_id,
    document_id: row.document_id,
    version_id: row.version_id,
    is_current: true,
    doc_status: row.doc_status,
    title: truncate(row.title, 512),
    heading_path: row.heading_path ?? [],
    content_text: truncate(row.content_text, 65_535),
    content_markdown: truncate(row.content_markdown, 65_535),
    metadata: normalizeMetadata(row.metadata, row.ordinal, row.token_count),
    access_principals: accessPrincipals,
    created_at: row.created_at.getTime(),
    updated_at: row.document_updated_at.getTime()
  };
}

function normalizeMetadata(
  metadata: unknown,
  ordinal: number,
  tokenCount: number | null
): Record<string, unknown> {
  return {
    ...(typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)
      : {}),
    ordinal,
    token_count: tokenCount
  };
}

function toStableErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "INDEX_REBUILD_FAILED";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

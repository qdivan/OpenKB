import { Prisma, createDatabaseClient, type PrismaClient } from "@openkb/db";
import {
  createOpenKBModelClient,
  getOpenKBModelClientConfig,
  isEmbeddingConfigured,
  isRerankConfigured,
  normalizeModelCapabilities,
  type OpenKBModelClient,
  type StoredModelSetting
} from "@openkb/model-client";
import {
  createCollectionName,
  createOpenKBMilvus,
  getMilvusConfig,
  type MilvusChunkRecord,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";
import {
  createObjectStorage,
  getObjectStorageConfig,
  StorageConfigError,
  type ObjectStorage
} from "@openkb/storage";

export type IndexWorkerOptions = {
  prisma?: PrismaClient;
  milvus?: OpenKBMilvus;
  permissions?: PermissionService;
  modelClient?: OpenKBModelClient;
  storage?: ObjectStorage;
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
  chunk_type: string;
  parent_chunk_id: string | null;
  settings_revision: number;
  start_line: number | null;
  end_line: number | null;
  start_char: number | null;
  end_char: number | null;
  parent_ordinal: number | null;
  child_ordinal: number | null;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  token_count: number | null;
  metadata: unknown;
  index_role: string;
  source_chunk_id: string | null;
  status: string;
  created_at: Date;
  title: string;
  doc_form: string | null;
  processing_status: string;
  indexing_technique: string | null;
  retrieval_model: unknown;
  doc_status: string;
  document_updated_at: Date;
};

type AssetRow = {
  id: string;
  tenant_id: string;
  document_id: string | null;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: bigint;
};

type DenseVectorResolution = {
  vectors: Array<number[] | undefined>;
  metadataOverrides: Map<string, Record<string, unknown>>;
};

export async function runRebuildOnce(options: IndexWorkerOptions = {}): Promise<IndexRunResult> {
  const prisma = options.prisma ?? createDatabaseClient();
  const permissions = options.permissions ?? new PermissionService({ prisma });
  const modelSettings = options.modelClient
    ? []
    : await prisma.modelSetting.findMany({ where: { kind: { in: ["embedding", "rerank"] } } });
  const modelConfig = options.modelClient
    ? options.modelClient.config
    : getOpenKBModelClientConfig(options.env, modelSettings.map(toStoredModelSetting));
  const milvus =
    options.milvus ??
    createOpenKBMilvus({
      ...getMilvusConfig(options.env),
      vectorDim: modelConfig.embedding.dim,
      enableDenseVector: isEmbeddingConfigured(modelConfig)
    });
  const modelClient = options.modelClient ?? createOpenKBModelClient(modelConfig);
  const shouldDisconnect = !options.prisma;

  try {
    const job = await claimPendingRebuildJob(prisma);
    if (!job) {
      return { processed: false };
    }

    try {
      const indexedChunks = await processRebuildJob(
        prisma,
        permissions,
        milvus,
        modelClient,
        job,
        options.storage,
        options.env
      );
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
  modelClient: OpenKBModelClient,
  job: IndexRebuildJobRow,
  storage: ObjectStorage | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const config = getMilvusConfig(env);
  const modelConfig = modelClient.config;
  const embeddingConfigured = isEmbeddingConfigured(modelConfig);
  const rerankConfigured = isRerankConfigured(modelConfig);
  const embeddingCapabilities = embeddingConfigured
    ? await modelClient
        .resolveEmbeddingCapabilities()
        .catch(() => modelConfig.embedding.capabilities ?? null)
    : null;
  const now = new Date();

  const profile = await prisma.milvusIndexProfile.create({
    data: {
      tenant_id: job.tenant_id,
      alias: job.target_alias,
      collection_name: job.target_collection,
      schema_version: config.schemaVersion,
      vector_dim: modelConfig.embedding.dim,
      embedding_function_name: embeddingConfigured ? "openkb_direct_embedding" : "disabled",
      bm25_function_name: config.enableBm25 ? "openkb_bm25" : null,
      rerank_function_name: rerankConfigured ? "openkb_direct_rerank" : null,
      status: "building",
      function_metadata: {
        schema_version: config.schemaVersion,
        enable_bm25: config.enableBm25,
        dense_vector: embeddingConfigured,
        embedding_endpoint_configured: embeddingConfigured,
        embedding_model: modelConfig.embedding.model ?? null,
        embedding_dim: modelConfig.embedding.dim,
        embedding_capabilities: embeddingCapabilities,
        rerank_endpoint_configured: rerankConfigured,
        rerank_model: modelConfig.rerank.model ?? null,
        rerank_capabilities: modelConfig.rerank.capabilities ?? null
      } as Prisma.InputJsonObject,
      created_by: job.started_by,
      created_at: now
    }
  });

  try {
    await milvus.createChunkCollection(job.target_collection);
    const indexedChunks = await insertCurrentChunks(
      prisma,
      permissions,
      milvus,
      modelClient,
      job,
      storage,
      env
    );
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
  modelClient: OpenKBModelClient,
  job: IndexRebuildJobRow,
  storage: ObjectStorage | undefined,
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

    const { vectors: denseVectors, metadataOverrides } = await resolveDenseVectorsForRows({
      prisma,
      modelClient,
      rows,
      storage,
      env
    });
    await persistChunkMetadataOverrides(prisma, rows, metadataOverrides);

    const records: MilvusChunkRecord[] = [];
    for (const [index, row] of rows.entries()) {
      let accessPrincipals = principalCache.get(row.document_id);
      if (!accessPrincipals) {
        accessPrincipals = await permissions.getObjectAccessPrincipals("document", row.document_id);
        principalCache.set(row.document_id, accessPrincipals);
      }
      records.push(
        toMilvusChunkRecord(
          row,
          accessPrincipals,
          denseVectors[index],
          metadataOverrides.get(row.id)
        )
      );
    }

    inserted += await milvus.insertChunks(job.target_collection, records);
    offset += rows.length;
  }
}

async function resolveDenseVectorsForRows(input: {
  prisma: PrismaClient;
  modelClient: OpenKBModelClient;
  rows: ChunkRow[];
  storage?: ObjectStorage;
  env: NodeJS.ProcessEnv;
}): Promise<DenseVectorResolution> {
  if (!input.modelClient.embeddingConfigured) {
    return { vectors: [], metadataOverrides: new Map() };
  }

  const rows = input.rows;
  const vectors: Array<number[] | undefined> = new Array(rows.length);
  const metadataOverrides = new Map<string, Record<string, unknown>>();
  const textIndexes: number[] = [];
  const imageCandidates: Array<{
    index: number;
    row: ChunkRow;
    metadata: Record<string, unknown>;
    assetId: string;
  }> = [];

  const imageVectorMode = normalizeImageVectorMode(input.env.OPENKB_IMAGE_VECTOR_MODE);
  const maxBytes = parsePositiveInt(input.env.OPENKB_IMAGE_EMBED_MAX_BYTES, 10_485_760);
  const imageCapabilityEnabled =
    imageVectorMode === "auto" && (await modelSupportsImageEmbedding(input.modelClient));

  for (const [index, row] of rows.entries()) {
    const metadata = toSafeRecord(row.metadata);
    if (row.index_role !== "asset_image") {
      textIndexes.push(index);
      continue;
    }

    if (imageVectorMode === "off") {
      markImageFallback(metadataOverrides, row, "image_vector_off");
      textIndexes.push(index);
      continue;
    }
    if (!imageCapabilityEnabled) {
      markImageFallback(metadataOverrides, row, "image_capability_missing");
      textIndexes.push(index);
      continue;
    }

    const assetId = getRecordString(metadata, "asset_id");
    if (!assetId) {
      markImageFallback(metadataOverrides, row, "external_image_not_fetched");
      textIndexes.push(index);
      continue;
    }
    imageCandidates.push({ index, row, metadata, assetId });
  }

  const imageInputs: Array<{ index: number; dataUri: string; text?: string }> = [];
  if (imageCandidates.length > 0) {
    const assetById = await readCandidateAssets(input.prisma, imageCandidates);
    const storage = resolveObjectStorage(input.storage, input.env);

    for (const candidate of imageCandidates) {
      const asset = assetById.get(candidate.assetId);
      if (
        !asset ||
        asset.tenant_id !== candidate.row.tenant_id ||
        asset.document_id !== candidate.row.document_id
      ) {
        markImageFallback(metadataOverrides, candidate.row, "asset_not_bound_to_document");
        textIndexes.push(candidate.index);
        continue;
      }
      if (!isSupportedImageMime(asset.mime_type)) {
        markImageFallback(metadataOverrides, candidate.row, "unsupported_mime_type");
        textIndexes.push(candidate.index);
        continue;
      }
      if (asset.size_bytes > BigInt(maxBytes)) {
        markImageFallback(metadataOverrides, candidate.row, "image_too_large");
        textIndexes.push(candidate.index);
        continue;
      }
      if (!storage) {
        markImageFallback(metadataOverrides, candidate.row, "storage_unconfigured");
        textIndexes.push(candidate.index);
        continue;
      }

      let body: Buffer;
      try {
        body = await storage.getObject({ key: asset.object_key });
      } catch {
        markImageFallback(metadataOverrides, candidate.row, "asset_read_failed");
        textIndexes.push(candidate.index);
        continue;
      }

      imageInputs.push({
        index: candidate.index,
        dataUri: `data:${asset.mime_type};base64,${body.toString("base64")}`,
        text: truncate(candidate.row.content_text, 4096)
      });
    }
  }

  if (imageInputs.length > 0) {
    try {
      const imageVectors = await input.modelClient.embedImages(
        imageInputs.map((image) => ({ dataUri: image.dataUri, text: image.text }))
      );
      for (const [offset, image] of imageInputs.entries()) {
        vectors[image.index] = imageVectors[offset];
        markImageVectorEnabled(
          metadataOverrides,
          rows[image.index],
          input.modelClient.config.embedding.model
        );
      }
    } catch {
      for (const image of imageInputs) {
        const row = rows[image.index];
        if (!row) {
          continue;
        }
        markImageFallback(metadataOverrides, row, "image_vector_failed");
        textIndexes.push(image.index);
      }
    }
  }

  if (textIndexes.length > 0) {
    const textVectors = await input.modelClient.embedTexts(
      textIndexes.map((index) => truncate(rows[index]!.content_text, 65_535))
    );
    for (const [offset, index] of textIndexes.entries()) {
      vectors[index] = textVectors[offset];
    }
  }

  return { vectors, metadataOverrides };
}

async function readCandidateAssets(
  prisma: PrismaClient,
  candidates: Array<{ assetId: string; row: ChunkRow }>
): Promise<Map<string, AssetRow>> {
  const assetIds = unique(candidates.map((candidate) => candidate.assetId));
  if (assetIds.length === 0) {
    return new Map();
  }

  const assets = (await prisma.documentAsset.findMany({
    where: {
      id: { in: assetIds },
      tenant_id: { in: unique(candidates.map((candidate) => candidate.row.tenant_id)) }
    },
    select: {
      id: true,
      tenant_id: true,
      document_id: true,
      object_key: true,
      filename: true,
      mime_type: true,
      size_bytes: true
    }
  })) as AssetRow[];

  return new Map(assets.map((asset) => [asset.id, asset]));
}

async function persistChunkMetadataOverrides(
  prisma: PrismaClient,
  rows: ChunkRow[],
  metadataOverrides: Map<string, Record<string, unknown>>
): Promise<void> {
  for (const row of rows) {
    const override = metadataOverrides.get(row.id);
    if (!override) {
      continue;
    }
    await prisma.documentChunk.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...toSafeRecord(row.metadata),
          ...override
        } as Prisma.InputJsonObject
      }
    });
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
      c.chunk_type,
      c.parent_chunk_id::text,
      c.settings_revision,
      c.start_line,
      c.end_line,
      c.start_char,
      c.end_char,
      c.parent_ordinal,
      c.child_ordinal,
      c.heading_path,
      COALESCE(c.override_content_text, c.content_text) AS content_text,
      COALESCE(c.override_content_markdown, c.content_markdown) AS content_markdown,
      c.token_count,
      c.metadata,
      c.index_role,
      c.source_chunk_id::text,
      c.status,
      c.created_at,
      d.title,
      d.doc_form,
      d.processing_status,
      s.indexing_technique,
      s.retrieval_model,
      d.status AS doc_status,
      d.updated_at AS document_updated_at
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    JOIN knowledge_bases kb ON kb.id = c.knowledge_base_id
    LEFT JOIN knowledge_base_chunk_settings s ON s.knowledge_base_id = c.knowledge_base_id
    WHERE d.status = 'published'
      AND kb.status = 'active'
      AND d.current_version_id = c.version_id
      AND c.chunk_type IN ('general', 'child')
      AND c.status = 'active'
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

function toMilvusChunkRecord(
  row: ChunkRow,
  accessPrincipals: string[],
  denseVector?: number[],
  metadataOverride?: Record<string, unknown>
): MilvusChunkRecord {
  const record: MilvusChunkRecord = {
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
    metadata: normalizeMetadata(row, metadataOverride),
    access_principals: accessPrincipals,
    created_at: row.created_at.getTime(),
    updated_at: row.document_updated_at.getTime()
  };
  if (denseVector) {
    record.dense_vector = denseVector;
  }
  return record;
}

function normalizeMetadata(
  row: ChunkRow,
  metadataOverride: Record<string, unknown> = {}
): Record<string, unknown> {
  const sourceMetadata =
    typeof row.metadata === "object" && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};
  const metadata = {
    ...sourceMetadata,
    ...metadataOverride
  };
  const hitType =
    typeof metadata.hit_type === "string"
      ? metadata.hit_type
      : row.index_role === "summary"
        ? "summary"
        : metadata.qa_pair_id
          ? "qa"
          : "content";
  const originalChunkId =
    typeof metadata.original_chunk_id === "string"
      ? metadata.original_chunk_id
      : (row.source_chunk_id ?? row.id);

  return {
    ...metadata,
    ordinal: row.ordinal,
    token_count: row.token_count,
    chunk_type: row.chunk_type,
    parent_chunk_id: row.parent_chunk_id,
    settings_revision: row.settings_revision,
    start_line: row.start_line,
    end_line: row.end_line,
    start_char: row.start_char,
    end_char: row.end_char,
    parent_ordinal: row.parent_ordinal,
    child_ordinal: row.child_ordinal,
    segment_status: row.status,
    doc_form: row.doc_form,
    document_processing_status: row.processing_status,
    indexing_technique: row.indexing_technique,
    retrieval_model: toSafeRecord(row.retrieval_model),
    index_role: row.index_role,
    source_chunk_id: row.source_chunk_id,
    hit_type: hitType,
    summary_hit: metadata.summary_hit === true || row.index_role === "summary",
    original_chunk_id: originalChunkId
  };
}

function toSafeRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStableErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "INDEX_REBUILD_FAILED";
}

function toStoredModelSetting(setting: {
  kind: string;
  provider: string;
  endpoint: string | null;
  model: string | null;
  enabled: boolean;
  timeout_ms: number | null;
  embedding_dim: number | null;
  embedding_batch_size: number | null;
  llm_temperature: number | null;
  llm_max_output_tokens: number | null;
  encrypted_api_key: string | null;
  api_key_last4: string | null;
  capabilities?: Prisma.JsonValue;
  capabilities_detected_at?: Date | null;
}): StoredModelSetting {
  return {
    kind: setting.kind as StoredModelSetting["kind"],
    provider: setting.provider as StoredModelSetting["provider"],
    endpoint: setting.endpoint,
    model: setting.model,
    enabled: setting.enabled,
    timeout_ms: setting.timeout_ms,
    embedding_dim: setting.embedding_dim,
    embedding_batch_size: setting.embedding_batch_size,
    llm_temperature: setting.llm_temperature,
    llm_max_output_tokens: setting.llm_max_output_tokens,
    encrypted_api_key: setting.encrypted_api_key,
    api_key_last4: setting.api_key_last4,
    capabilities: normalizeModelCapabilities(setting.capabilities),
    capabilities_detected_at: setting.capabilities_detected_at
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeImageVectorMode(value: string | undefined): "auto" | "off" {
  return value?.trim().toLowerCase() === "off" ? "off" : "auto";
}

async function modelSupportsImageEmbedding(modelClient: OpenKBModelClient): Promise<boolean> {
  let modalities = modelClient.config.embedding.capabilities?.input_modalities ?? [];
  try {
    modalities = (await modelClient.resolveEmbeddingCapabilities()).input_modalities;
  } catch {
    // Keep configured capabilities as the offline fallback.
  }
  return modalities.map((modality) => modality.toLowerCase()).includes("image");
}

function isSupportedImageMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  return (
    normalized === "image/png" ||
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "image/webp" ||
    normalized === "image/gif"
  );
}

function resolveObjectStorage(storage: ObjectStorage | undefined, env: NodeJS.ProcessEnv) {
  if (storage) {
    return storage;
  }
  try {
    return createObjectStorage(getObjectStorageConfig(env));
  } catch (error) {
    if (error instanceof StorageConfigError) {
      return null;
    }
    throw error;
  }
}

function markImageVectorEnabled(
  metadataOverrides: Map<string, Record<string, unknown>>,
  row: ChunkRow | undefined,
  model: string | undefined
): void {
  if (!row) {
    return;
  }
  mergeMetadataOverride(metadataOverrides, row.id, {
    image_vector_enabled: true,
    image_vector_source: "image",
    image_vector_model: model ?? null,
    image_vector_fallback_reason: null
  });
}

function markImageFallback(
  metadataOverrides: Map<string, Record<string, unknown>>,
  row: ChunkRow,
  reason: string
): void {
  mergeMetadataOverride(metadataOverrides, row.id, {
    image_vector_enabled: false,
    image_vector_source: "text",
    image_vector_fallback_reason: reason
  });
}

function mergeMetadataOverride(
  metadataOverrides: Map<string, Record<string, unknown>>,
  chunkId: string,
  override: Record<string, unknown>
): void {
  metadataOverrides.set(chunkId, {
    ...(metadataOverrides.get(chunkId) ?? {}),
    ...override
  });
}

function getRecordString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

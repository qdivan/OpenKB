import { createHash, randomUUID } from "node:crypto";

import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  chunkMarkdownForIndex,
  MarkdownConversionError,
  type HierarchicalMarkdownChunk,
  type ImportConversionWarning
} from "@openkb/markdown";
import {
  checksumSha256,
  createAssetObjectKey,
  createObjectStorage,
  sanitizeFilename,
  type ObjectStorage
} from "@openkb/storage";
import {
  convertImportSource,
  getImportToolRuntimeConfig,
  ImportToolError,
  type ImportExtractedAsset,
  type StoredImportFormatRoute,
  type StoredImportToolSetting
} from "@openkb/import-tools";

export type ImportWorkerOptions = {
  prisma?: PrismaClient;
  storage?: ObjectStorage;
  env?: NodeJS.ProcessEnv;
};

export type ImportRunResult = {
  processed: boolean;
  job_id?: string;
  status?: "succeeded" | "failed";
  error?: string;
};

type ClaimedJob = {
  id: string;
};

type ClaimedChunkRebuildJob = {
  id: string;
};

export async function runImportOnce(options: ImportWorkerOptions = {}): Promise<ImportRunResult> {
  const prisma = options.prisma ?? createDatabaseClient();
  const storage = options.storage ?? createObjectStorage();
  const shouldDisconnect = !options.prisma;

  try {
    const claimed = await claimNextImportJob(prisma);
    if (!claimed) {
      const chunkJob = await claimNextChunkRebuildJob(prisma);
      if (!chunkJob) {
        return { processed: false };
      }
      try {
        await processClaimedChunkRebuildJob(prisma, chunkJob.id);
        return { processed: true, job_id: chunkJob.id, status: "succeeded" };
      } catch (error) {
        const code =
          error instanceof WorkerImportError
            ? error.code
            : error instanceof Error
              ? error.message
              : "CHUNK_REBUILD_FAILED";
        await prisma.chunkRebuildJob.update({
          where: { id: chunkJob.id },
          data: {
            status: "failed",
            error: code,
            updated_at: new Date(),
            finished_at: new Date()
          }
        });
        return { processed: true, job_id: chunkJob.id, status: "failed", error: code };
      }
    }

    try {
      await processClaimedImportJob(prisma, storage, claimed.id, options.env ?? process.env);
      return { processed: true, job_id: claimed.id, status: "succeeded" };
    } catch (error) {
      const failure = toImportFailure(error);
      await prisma.importJob.update({
        where: { id: claimed.id },
        data: {
          status: "failed",
          error: failure.code,
          warnings: failure.warnings,
          updated_at: new Date(),
          finished_at: new Date()
        }
      });
      return { processed: true, job_id: claimed.id, status: "failed", error: failure.code };
    }
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}

export async function runImportWatch(options: ImportWorkerOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const pollMs = parsePositiveInt(env.IMPORT_WORKER_POLL_MS, 2000);

  for (;;) {
    const result = await runImportOnce(options);
    if (!result.processed) {
      await sleep(pollMs);
    }
  }
}

async function claimNextImportJob(prisma: PrismaClient): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE import_jobs
    SET status = 'running', updated_at = now()
    WHERE id = (
      SELECT id
      FROM import_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;

  return rows[0] ?? null;
}

async function claimNextChunkRebuildJob(
  prisma: PrismaClient
): Promise<ClaimedChunkRebuildJob | null> {
  const rows = await prisma.$queryRaw<ClaimedChunkRebuildJob[]>`
    UPDATE chunk_rebuild_jobs
    SET status = 'running', updated_at = now(), error = NULL
    WHERE id = (
      SELECT id
      FROM chunk_rebuild_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;

  return rows[0] ?? null;
}

async function processClaimedImportJob(
  prisma: PrismaClient,
  storage: ObjectStorage,
  importJobId: string,
  env: NodeJS.ProcessEnv
) {
  const job = await prisma.importJob.findUnique({ where: { id: importJobId } });
  if (!job || job.status !== "running") {
    throw new WorkerImportError("IMPORT_JOB_NOT_FOUND", "Import job was not found.");
  }

  const asset = await prisma.documentAsset.findUnique({ where: { id: job.source_asset_id } });
  if (!asset || asset.tenant_id !== job.tenant_id) {
    throw new WorkerImportError("ASSET_NOT_FOUND", "Source asset was not found.");
  }

  const [source, toolSettings, formatRoutes] = await Promise.all([
    storage.getObject({ key: asset.object_key }),
    prisma.importToolSetting.findMany(),
    prisma.importFormatRoute.findMany()
  ]);
  const conversion = await convertImportSource({
    filename: asset.filename,
    mimeType: asset.mime_type,
    content: source,
    converter: job.converter,
    env,
    runtimeConfig: getImportToolRuntimeConfig(
      env,
      toolSettings.map(toStoredImportToolSetting),
      formatRoutes.map(toStoredImportFormatRoute)
    )
  });
  const preparedAssets = await persistExtractedAssets(storage, {
    tenantId: job.tenant_id,
    userId: job.created_by,
    sourceAssetId: asset.id,
    assets: conversion.assets
  });
  const markdown = replaceExtractedAssetPlaceholders(conversion.markdown, preparedAssets);
  const now = new Date();
  const title = normalizeTitle(job.title ?? conversion.title);

  try {
    await prisma.$transaction(async (tx) => {
      const knowledgeBase = await tx.knowledgeBase.findUnique({
        where: { id: job.knowledge_base_id }
      });
      if (!knowledgeBase || knowledgeBase.status !== "active") {
        throw new WorkerImportError("OBJECT_NOT_FOUND", "Knowledge base was not found.");
      }

      if (job.parent_id) {
        const parent = await tx.document.findUnique({ where: { id: job.parent_id } });
        if (
          !parent ||
          parent.status === "deleted" ||
          parent.type !== "folder" ||
          parent.knowledge_base_id !== knowledgeBase.id
        ) {
          throw new WorkerImportError("INVALID_PARENT", "Parent folder is invalid.");
        }
      }

      const siblingCount = await tx.document.count({
        where: {
          knowledge_base_id: knowledgeBase.id,
          parent_id: job.parent_id,
          status: { not: "deleted" }
        }
      });
      const document = await tx.document.create({
        data: {
          tenant_id: job.tenant_id,
          workspace_id: knowledgeBase.workspace_id,
          knowledge_base_id: knowledgeBase.id,
          parent_id: job.parent_id,
          type: "page",
          title,
          slug: slugFromTitle(title),
          status: "published",
          permission_mode: "inherit",
          sort_order: siblingCount * 1000,
          created_by: job.created_by,
          updated_by: job.created_by,
          created_at: now,
          updated_at: now
        }
      });
      const version = await tx.documentVersion.create({
        data: {
          tenant_id: job.tenant_id,
          document_id: document.id,
          version_no: 1,
          markdown,
          markdown_hash: markdownHash(markdown),
          source_type: "import",
          source_file_id: asset.id,
          created_by: job.created_by,
          created_at: now
        }
      });
      const settings = await getOrCreateChunkSettings(tx, {
        tenantId: job.tenant_id,
        workspaceId: knowledgeBase.workspace_id,
        knowledgeBaseId: knowledgeBase.id,
        userId: job.created_by
      });
      const chunks = chunkMarkdownForIndex(markdown, {
        mode: settings.mode === "general" ? "general" : "parent_child",
        parent_mode: settings.parent_mode === "full_doc" ? "full_doc" : "paragraph",
        parent_delimiter: settings.parent_delimiter,
        child_delimiter: settings.child_delimiter,
        parent_max_characters: settings.parent_max_characters,
        child_max_characters: settings.child_max_characters,
        child_overlap_characters: settings.child_overlap_characters,
        settings_revision: settings.revision
      });

      await tx.document.update({
        where: { id: document.id },
        data: {
          current_version_id: version.id,
          updated_at: now
        }
      });
      await tx.collaborator.upsert({
        where: {
          object_type_object_id_subject_type_subject_id: {
            object_type: "document",
            object_id: document.id,
            subject_type: "user",
            subject_id: job.created_by
          }
        },
        create: {
          tenant_id: job.tenant_id,
          object_type: "document",
          object_id: document.id,
          subject_type: "user",
          subject_id: job.created_by,
          role: "owner",
          source: "system",
          created_by: job.created_by,
          created_at: now
        },
        update: {
          role: "owner",
          source: "system",
          created_by: job.created_by
        }
      });
      await tx.documentChunk.createMany({
        data: materializeDocumentChunks(chunks).map((chunk) => ({
          id: chunk.id,
          tenant_id: job.tenant_id,
          workspace_id: knowledgeBase.workspace_id,
          knowledge_base_id: knowledgeBase.id,
          document_id: document.id,
          version_id: version.id,
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
          metadata: {
            ...chunk.metadata,
            import_job_id: job.id,
            converter: conversion.converter
          }
        }))
      });
      await tx.documentAsset.update({
        where: { id: asset.id },
        data: {
          document_id: document.id
        }
      });
      if (preparedAssets.length > 0) {
        await tx.documentAsset.createMany({
          data: preparedAssets.map((assetRecord) => ({
            id: assetRecord.id,
            tenant_id: job.tenant_id,
            document_id: document.id,
            object_key: assetRecord.objectKey,
            filename: assetRecord.filename,
            mime_type: assetRecord.contentType,
            size_bytes: BigInt(assetRecord.sizeBytes),
            checksum_sha256: assetRecord.checksumSha256,
            storage_bucket: storage.bucket,
            metadata: {
              kind: assetRecord.kind,
              source: "import_extracted_asset",
              source_asset_id: asset.id,
              import_job_id: job.id
            },
            created_by: job.created_by,
            created_at: now
          }))
        });
      }
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          converter: conversion.converter,
          title,
          document_id: document.id,
          output_version_id: version.id,
          error: null,
          warnings: conversion.warnings,
          metadata: {
            ...conversion.metadata,
            chunk_count: chunks.length,
            source_asset_id: asset.id,
            asset_count: preparedAssets.length
          },
          updated_at: now,
          finished_at: now
        }
      });
      await writeAuditLog(tx, {
        tenantId: job.tenant_id,
        actorUserId: job.created_by,
        action: "import_job.succeeded",
        objectType: "import_job",
        objectId: job.id,
        metadata: {
          document_id: document.id,
          version_id: version.id
        }
      });
    });
  } catch (error) {
    await cleanupPersistedExtractedAssets(storage, preparedAssets);
    throw error;
  }
}

async function processClaimedChunkRebuildJob(prisma: PrismaClient, jobId: string) {
  const job = await prisma.chunkRebuildJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") {
    throw new WorkerImportError("CHUNK_REBUILD_JOB_NOT_FOUND", "Chunk rebuild job was not found.");
  }
  const settings = await prisma.knowledgeBaseChunkSetting.findUnique({
    where: { knowledge_base_id: job.knowledge_base_id }
  });
  if (!settings) {
    throw new WorkerImportError("CHUNK_SETTINGS_NOT_FOUND", "Chunk settings were not found.");
  }

  const documents = await prisma.document.findMany({
    where: {
      knowledge_base_id: job.knowledge_base_id,
      tenant_id: job.tenant_id,
      type: "page",
      status: { not: "deleted" },
      current_version_id: { not: null }
    },
    orderBy: { created_at: "asc" }
  });
  const versionIds = documents.flatMap((document) =>
    document.current_version_id ? [document.current_version_id] : []
  );
  const versions = await prisma.documentVersion.findMany({
    where: { id: { in: versionIds } }
  });
  const versionById = new Map(versions.map((version) => [version.id, version]));
  let chunkCount = 0;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.documentChunk.deleteMany({
      where: {
        knowledge_base_id: job.knowledge_base_id,
        version_id: { in: versionIds }
      }
    });

    for (const document of documents) {
      const version = document.current_version_id
        ? versionById.get(document.current_version_id)
        : null;
      if (!version) {
        continue;
      }
      const chunks = materializeDocumentChunks(
        chunkMarkdownForIndex(version.markdown, {
          mode: settings.mode === "general" ? "general" : "parent_child",
          parent_mode: settings.parent_mode === "full_doc" ? "full_doc" : "paragraph",
          parent_delimiter: settings.parent_delimiter,
          child_delimiter: settings.child_delimiter,
          parent_max_characters: settings.parent_max_characters,
          child_max_characters: settings.child_max_characters,
          child_overlap_characters: settings.child_overlap_characters,
          settings_revision: settings.revision
        })
      );
      chunkCount += chunks.length;
      if (chunks.length === 0) {
        continue;
      }
      await tx.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          id: chunk.id,
          tenant_id: document.tenant_id,
          workspace_id: document.workspace_id,
          knowledge_base_id: document.knowledge_base_id,
          document_id: document.id,
          version_id: version.id,
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
          created_at: now
        }))
      });
    }

    await tx.chunkRebuildJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        error: null,
        metadata: { document_count: documents.length, chunk_count: chunkCount },
        updated_at: now,
        finished_at: now
      }
    });
    await writeAuditLog(tx, {
      tenantId: job.tenant_id,
      actorUserId: job.requested_by,
      action: "chunk_rebuild_job.succeeded",
      objectType: "chunk_rebuild_job",
      objectId: job.id,
      metadata: {
        knowledge_base_id: job.knowledge_base_id,
        settings_revision: settings.revision,
        chunk_count: chunkCount
      }
    });
  });
}

class WorkerImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly warnings: ImportConversionWarning[] = []
  ) {
    super(message);
  }
}

function toImportFailure(error: unknown): {
  code: string;
  warnings: ImportConversionWarning[];
} {
  if (error instanceof MarkdownConversionError) {
    return {
      code: error.code,
      warnings: [
        ...error.warnings,
        ...error.issues.map((issue) => ({
          code: issue.code,
          message: `${issue.message} Line ${issue.line}.`
        }))
      ]
    };
  }

  if (error instanceof ImportToolError) {
    return {
      code: error.code,
      warnings: error.warnings.length
        ? error.warnings
        : [{ code: error.code, message: error.message }]
    };
  }

  if (error instanceof WorkerImportError) {
    return {
      code: error.code,
      warnings: error.warnings.length
        ? error.warnings
        : [{ code: error.code, message: error.message }]
    };
  }

  return {
    code: "CONVERSION_FAILED",
    warnings: [
      {
        code: "CONVERSION_FAILED",
        message: error instanceof Error ? error.message : "Import conversion failed."
      }
    ]
  };
}

async function writeAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    objectType: string;
    objectId: string;
    metadata: Prisma.InputJsonValue;
  }
) {
  await tx.auditLog.create({
    data: {
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      actor_type: "user",
      action: input.action,
      object_type: input.objectType,
      object_id: input.objectId,
      metadata: input.metadata,
      created_at: new Date()
    }
  });
}

function normalizeTitle(value: string): string {
  const normalized = value.trim();
  return normalized || "Imported document";
}

function slugFromTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `import-${Date.now()}`;
}

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

type PersistedExtractedAsset = {
  placeholderId: string;
  id: string;
  filename: string;
  contentType: string;
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
  kind: ImportExtractedAsset["kind"];
};

async function persistExtractedAssets(
  storage: ObjectStorage,
  input: {
    tenantId: string;
    userId: string;
    sourceAssetId: string;
    assets: ImportExtractedAsset[];
  }
): Promise<PersistedExtractedAsset[]> {
  const persisted: PersistedExtractedAsset[] = [];
  for (const asset of input.assets) {
    const id = randomUUID();
    const filename = sanitizeFilename(asset.filename);
    const objectKey = createAssetObjectKey({ tenantId: input.tenantId, assetId: id, filename });
    const checksum = checksumSha256(asset.body);
    await storage.putObject({
      key: objectKey,
      body: asset.body,
      contentType: asset.contentType,
      metadata: {
        source: "import_extracted_asset",
        source_asset_id: input.sourceAssetId,
        created_by: input.userId
      }
    });
    persisted.push({
      placeholderId: asset.placeholderId,
      id,
      filename,
      contentType: asset.contentType,
      objectKey,
      sizeBytes: asset.body.byteLength,
      checksumSha256: checksum,
      kind: asset.kind
    });
  }
  return persisted;
}

async function cleanupPersistedExtractedAssets(
  storage: ObjectStorage,
  assets: PersistedExtractedAsset[]
): Promise<void> {
  await Promise.allSettled(assets.map((asset) => storage.deleteObject({ key: asset.objectKey })));
}

function replaceExtractedAssetPlaceholders(
  markdown: string,
  assets: PersistedExtractedAsset[]
): string {
  return assets.reduce(
    (current, asset) => current.split(`asset://${asset.placeholderId}`).join(`asset://${asset.id}`),
    markdown
  );
}

function toStoredImportToolSetting(setting: unknown): StoredImportToolSetting {
  const row = setting as StoredImportToolSetting;
  return {
    ...row,
    options: row.options ?? {}
  };
}

function toStoredImportFormatRoute(route: unknown): StoredImportFormatRoute {
  return route as StoredImportFormatRoute;
}

type MaterializedChunk = HierarchicalMarkdownChunk & {
  id: string;
  parent_chunk_id: string | null;
};

function materializeDocumentChunks(chunks: HierarchicalMarkdownChunk[]): MaterializedChunk[] {
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

async function getOrCreateChunkSettings(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    userId: string;
  }
) {
  const existing = await tx.knowledgeBaseChunkSetting.findUnique({
    where: { knowledge_base_id: input.knowledgeBaseId }
  });
  if (existing) {
    return existing;
  }
  const legacyChunkCount = await tx.documentChunk.count({
    where: { knowledge_base_id: input.knowledgeBaseId, chunk_type: "general" }
  });
  return tx.knowledgeBaseChunkSetting.create({
    data: {
      tenant_id: input.tenantId,
      workspace_id: input.workspaceId,
      knowledge_base_id: input.knowledgeBaseId,
      mode: legacyChunkCount > 0 ? "general" : "parent_child",
      parent_mode: "paragraph",
      updated_by: input.userId
    }
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

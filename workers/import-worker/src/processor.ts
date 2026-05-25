import { createHash, randomUUID } from "node:crypto";

import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  buildMarkdownAssetIndexEntries,
  chunkMarkdownForIndex,
  extractMarkdownAssetReferencesForIndex,
  MarkdownConversionError,
  type HierarchicalMarkdownChunk,
  type MarkdownAssetIndexAsset,
  type ImportConversionWarning,
  type MarkdownChunkingSettings
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

function toMetadataRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, Prisma.JsonValue>;
}

function pickSourceMetadata(
  metadata: Record<string, Prisma.JsonValue>
): Record<string, Prisma.JsonValue> {
  const preserved: Record<string, Prisma.JsonValue> = {};
  for (const key of ["source_filename", "source_mime_type", "source_size_bytes"]) {
    const value = metadata[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      preserved[key] = value;
    }
  }
  return preserved;
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
      const chunks = materializeDocumentChunks(
        chunkMarkdownForIndex(markdown, {
          mode: settings.mode === "general" ? "general" : "parent_child",
          doc_form: normalizeDocForm(settings.doc_form, settings.mode),
          indexing_technique:
            settings.indexing_technique === "economy" ? "economy" : "high_quality",
          process_rule_mode: normalizeProcessRuleMode(settings.process_rule_mode),
          process_rule: settings.process_rule,
          parent_mode: settings.parent_mode === "full_doc" ? "full_doc" : "paragraph",
          parent_delimiter: settings.parent_delimiter,
          child_delimiter: settings.child_delimiter,
          parent_max_characters: settings.parent_max_characters,
          child_max_characters: settings.child_max_characters,
          child_overlap_characters: settings.child_overlap_characters,
          settings_revision: settings.revision
        })
      );
      const assetEntries = buildMarkdownAssetIndexEntries({
        markdown,
        chunks,
        assetsById: buildImportAssetMap(asset, preparedAssets),
        createId: randomUUID,
        nextOrdinal: nextChunkOrdinal(chunks)
      });

      await tx.document.update({
        where: { id: document.id },
        data: {
          current_version_id: version.id,
          doc_form: normalizeDocForm(settings.doc_form, settings.mode),
          process_rule_snapshot: buildProcessingSnapshot(settings),
          processing_status: "current",
          processing_revision: settings.revision,
          need_summary: summaryIndexEnabled(settings.summary_index_setting),
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
        data: [
          ...chunks.map((chunk) => ({
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
            status: "active",
            metadata: {
              ...chunk.metadata,
              import_job_id: job.id,
              converter: conversion.converter
            }
          })),
          ...assetEntries.map((entry) => ({
            id: entry.chunk.id,
            tenant_id: job.tenant_id,
            workspace_id: knowledgeBase.workspace_id,
            knowledge_base_id: knowledgeBase.id,
            document_id: document.id,
            version_id: version.id,
            ordinal: entry.chunk.ordinal,
            chunk_type: "general",
            parent_chunk_id: null,
            settings_revision: entry.chunk.settings_revision,
            start_line: entry.chunk.start_line,
            end_line: entry.chunk.end_line,
            start_char: entry.chunk.start_char,
            end_char: entry.chunk.end_char,
            parent_ordinal: null,
            child_ordinal: null,
            heading_path: entry.chunk.heading_path,
            content_text: entry.chunk.content_text,
            content_markdown: entry.chunk.content_markdown,
            token_count: entry.chunk.token_count,
            index_role: entry.chunk.index_role,
            source_chunk_id: entry.chunk.source_chunk_id,
            status: "active",
            metadata: {
              ...entry.chunk.metadata,
              import_job_id: job.id,
              converter: conversion.converter
            }
          }))
        ]
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
      if (assetEntries.length > 0) {
        await insertDocumentAssetBindings(tx, {
          document,
          versionId: version.id,
          entries: assetEntries,
          now
        });
      }
      const previousMetadata = toMetadataRecord(job.metadata);
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
            ...pickSourceMetadata(previousMetadata),
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
  const documentIds = documents.map((document) => document.id);

  await prisma.$transaction(async (tx) => {
    await tx.documentSegmentSummary.updateMany({
      where: { document_id: { in: documentIds }, status: "active" },
      data: { status: "deleted", updated_at: now }
    });
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
      const markdownSettings = toMarkdownChunkingSettings(settings, document);
      const qaPairs =
        markdownSettings.doc_form === "qa_model"
          ? await loadIndexableQaPairs(tx, document.id, version.id)
          : [];
      const chunks = materializeDocumentChunks(
        chunkMarkdownForIndex(version.markdown, {
          ...markdownSettings,
          qa_pairs: qaPairs.map((pair) => ({
            id: pair.id,
            question: pair.question,
            answer: pair.answer,
            source: pair.source as "manual" | "csv" | "llm" | "mock",
            source_chunk_id: null,
            generated_mode: getStringFromRecord(pair.metadata, "generated_mode")
          }))
        })
      );
      const assetEntries = buildMarkdownAssetIndexEntries({
        markdown: version.markdown,
        chunks,
        assetsById: await loadMarkdownAssetMap(tx, {
          tenantId: document.tenant_id,
          documentId: document.id,
          markdown: version.markdown,
          actorUserId: job.requested_by
        }),
        createId: randomUUID,
        nextOrdinal: nextChunkOrdinal(chunks)
      });
      chunkCount += chunks.length + assetEntries.length;
      if (chunks.length > 0 || assetEntries.length > 0) {
        await tx.documentChunk.createMany({
          data: [
            ...chunks.map((chunk) => ({
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
              index_role: "content",
              source_chunk_id: null,
              status: "active",
              metadata: {
                ...(toRecord(chunk.metadata) as Record<string, unknown>),
                processing_revision: (document.processing_revision ?? 1) + 1,
                content_version_id: version.id,
                content_markdown_hash: version.markdown_hash
              } as Prisma.InputJsonValue,
              created_at: now
            })),
            ...assetEntries.map((entry) => ({
              id: entry.chunk.id,
              tenant_id: document.tenant_id,
              workspace_id: document.workspace_id,
              knowledge_base_id: document.knowledge_base_id,
              document_id: document.id,
              version_id: version.id,
              ordinal: entry.chunk.ordinal,
              chunk_type: "general",
              parent_chunk_id: null,
              settings_revision: entry.chunk.settings_revision,
              start_line: entry.chunk.start_line,
              end_line: entry.chunk.end_line,
              start_char: entry.chunk.start_char,
              end_char: entry.chunk.end_char,
              parent_ordinal: null,
              child_ordinal: null,
              heading_path: entry.chunk.heading_path,
              content_text: entry.chunk.content_text,
              content_markdown: entry.chunk.content_markdown,
              token_count: entry.chunk.token_count,
              index_role: entry.chunk.index_role,
              source_chunk_id: entry.chunk.source_chunk_id,
              status: "active",
              metadata: {
                ...entry.chunk.metadata,
                processing_revision: (document.processing_revision ?? 1) + 1,
                content_version_id: version.id,
                content_markdown_hash: version.markdown_hash
              } as Prisma.InputJsonValue,
              created_at: now
            }))
          ]
        });
      }
      if (assetEntries.length > 0) {
        await insertDocumentAssetBindings(tx, {
          document,
          versionId: version.id,
          entries: assetEntries,
          now
        });
      }
      const documentSummary = await tx.documentSummary.findUnique({
        where: { document_id: document.id }
      });
      if (documentSummary?.status === "active") {
        await createDocumentSummaryIndexChunk(tx, {
          document,
          version,
          summary: documentSummary.summary,
          summaryId: documentSummary.id,
          ordinal: nextChunkOrdinal([...chunks, ...assetEntries.map((entry) => entry.chunk)]),
          settingsRevision: settings.revision,
          now
        });
        chunkCount += 1;
      }
      await tx.document.update({
        where: { id: document.id },
        data: {
          doc_form: normalizeDocForm(settings.doc_form, settings.mode),
          process_rule_snapshot: buildProcessingSnapshot(settings, document, version),
          processing_status: "current",
          processing_revision: (document.processing_revision ?? 1) + 1,
          need_summary: summaryIndexEnabled(settings.summary_index_setting),
          updated_at: now
        }
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

function buildImportAssetMap(
  sourceAsset: {
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: bigint;
    checksum_sha256: string | null;
    metadata: Prisma.JsonValue;
  },
  assets: PersistedExtractedAsset[]
): Map<string, MarkdownAssetIndexAsset> {
  return new Map<string, MarkdownAssetIndexAsset>([
    [
      sourceAsset.id,
      {
        id: sourceAsset.id,
        filename: sourceAsset.filename,
        mime_type: sourceAsset.mime_type,
        size_bytes: sourceAsset.size_bytes,
        checksum_sha256: sourceAsset.checksum_sha256,
        metadata: sourceAsset.metadata
      }
    ],
    ...assets.map(
      (asset) =>
        [
          asset.id,
          {
            id: asset.id,
            filename: asset.filename,
            mime_type: asset.contentType,
            size_bytes: asset.sizeBytes,
            checksum_sha256: asset.checksumSha256,
            metadata: { kind: asset.kind, source: "import_extracted_asset" }
          } satisfies MarkdownAssetIndexAsset
        ] as const
    )
  ]);
}

async function loadMarkdownAssetMap(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    documentId: string;
    markdown: string;
    actorUserId: string;
  }
): Promise<Map<string, MarkdownAssetIndexAsset>> {
  const assetIds = [
    ...new Set(
      extractMarkdownAssetReferencesForIndex(input.markdown)
        .map((reference) => reference.assetId)
        .filter((assetId): assetId is string => Boolean(assetId))
    )
  ];
  if (assetIds.length === 0) {
    return new Map();
  }
  const assets = await tx.documentAsset.findMany({
    where: {
      tenant_id: input.tenantId,
      id: { in: assetIds },
      OR: [{ document_id: input.documentId }, { document_id: null, created_by: input.actorUserId }]
    }
  });
  const attachableIds = assets
    .filter((asset) => asset.document_id === null)
    .map((asset) => asset.id);
  if (attachableIds.length > 0) {
    await tx.documentAsset.updateMany({
      where: {
        tenant_id: input.tenantId,
        id: { in: attachableIds },
        document_id: null,
        created_by: input.actorUserId
      },
      data: { document_id: input.documentId }
    });
  }

  const boundAssets = await tx.documentAsset.findMany({
    where: {
      tenant_id: input.tenantId,
      id: { in: assetIds },
      document_id: input.documentId
    }
  });

  return new Map(
    boundAssets.map((asset) => [
      asset.id,
      {
        id: asset.id,
        filename: asset.filename,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        checksum_sha256: asset.checksum_sha256,
        metadata: asset.metadata
      }
    ])
  );
}

async function insertDocumentAssetBindings(
  tx: Prisma.TransactionClient,
  input: {
    document: {
      tenant_id: string;
      workspace_id: string;
      knowledge_base_id: string;
      id: string;
    };
    versionId: string;
    entries: ReturnType<typeof buildMarkdownAssetIndexEntries>;
    now: Date;
  }
): Promise<void> {
  for (const entry of input.entries) {
    await tx.$executeRaw`
      INSERT INTO document_asset_bindings (
        id,
        tenant_id,
        workspace_id,
        knowledge_base_id,
        document_id,
        version_id,
        chunk_id,
        asset_id,
        kind,
        alt_text,
        caption,
        filename,
        mime_type,
        size_bytes,
        checksum_sha256,
        raw_url,
        external_url,
        start_line,
        end_line,
        start_char,
        end_char,
        status,
        metadata,
        created_at
      )
      VALUES (
        ${entry.binding.id}::uuid,
        ${input.document.tenant_id}::uuid,
        ${input.document.workspace_id}::uuid,
        ${input.document.knowledge_base_id}::uuid,
        ${input.document.id}::uuid,
        ${input.versionId}::uuid,
        ${entry.binding.source_chunk_id}::uuid,
        ${entry.binding.asset_id}::uuid,
        ${entry.binding.kind},
        ${entry.binding.alt_text},
        ${entry.binding.caption},
        ${entry.binding.filename},
        ${entry.binding.mime_type},
        ${normalizeNullableBigInt(entry.binding.size_bytes)},
        ${entry.binding.checksum_sha256},
        ${entry.binding.raw_url},
        ${entry.binding.external_url},
        ${entry.binding.start_line},
        ${entry.binding.end_line},
        ${entry.binding.start_char},
        ${entry.binding.end_char},
        'active',
        ${JSON.stringify(entry.binding.metadata)}::jsonb,
        ${input.now}
      )
    `;
  }
}

function normalizeNullableBigInt(value: bigint | number | string | null): bigint | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "bigint") {
    return value;
  }
  const parsed = BigInt(value);
  return parsed >= 0n ? parsed : null;
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

async function createDocumentSummaryIndexChunk(
  tx: Prisma.TransactionClient,
  input: {
    document: {
      tenant_id: string;
      workspace_id: string;
      knowledge_base_id: string;
      id: string;
      doc_form?: string | null;
    };
    version: { id: string };
    summary: string;
    summaryId: string;
    ordinal: number;
    settingsRevision: number;
    now: Date;
  }
): Promise<void> {
  await tx.documentChunk.create({
    data: {
      tenant_id: input.document.tenant_id,
      workspace_id: input.document.workspace_id,
      knowledge_base_id: input.document.knowledge_base_id,
      document_id: input.document.id,
      version_id: input.version.id,
      ordinal: input.ordinal,
      chunk_type: "general",
      parent_chunk_id: null,
      settings_revision: input.settingsRevision,
      start_line: null,
      end_line: null,
      start_char: null,
      end_char: null,
      parent_ordinal: null,
      child_ordinal: null,
      heading_path: [],
      content_text: input.summary,
      content_markdown: input.summary,
      token_count: estimateTextTokens(input.summary),
      index_role: "summary",
      source_chunk_id: null,
      status: "active",
      metadata: {
        hit_type: "summary",
        summary_hit: true,
        summary_id: input.summaryId,
        summary_scope: "document",
        summary_text: input.summary,
        original_chunk_id: null,
        doc_form: input.document.doc_form,
        index_role: "summary"
      },
      created_at: input.now
    }
  });
}

function nextChunkOrdinal(chunks: Array<{ ordinal: number }>): number {
  return Math.max(-1, ...chunks.map((chunk) => chunk.ordinal)) + 1;
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.replace(/\s+/g, " ").trim().length / 4));
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
      doc_form: legacyChunkCount > 0 ? "text_model" : "hierarchical_model",
      indexing_technique: "high_quality",
      process_rule_mode: legacyChunkCount > 0 ? "custom" : "hierarchical",
      process_rule: {},
      retrieval_model: {},
      summary_index_setting: { enable: false },
      parent_mode: "paragraph",
      updated_by: input.userId
    }
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDocForm(
  value: unknown,
  mode?: string
): "text_model" | "hierarchical_model" | "qa_model" {
  if (value === "text_model" || value === "hierarchical_model" || value === "qa_model") {
    return value;
  }
  return mode === "general" ? "text_model" : "hierarchical_model";
}

function normalizeProcessRuleMode(value: unknown): "automatic" | "custom" | "hierarchical" {
  if (value === "automatic" || value === "custom" || value === "hierarchical") {
    return value;
  }
  return "custom";
}

function toMarkdownChunkingSettings(
  settings: {
    mode: string;
    doc_form?: string | null;
    indexing_technique?: string | null;
    process_rule_mode?: string | null;
    process_rule?: Prisma.JsonValue;
    parent_mode: string;
    parent_delimiter: string;
    child_delimiter: string;
    parent_max_characters: number;
    child_max_characters: number;
    child_overlap_characters: number;
    revision: number;
  },
  document?: { process_rule_snapshot?: Prisma.JsonValue | null }
): MarkdownChunkingSettings {
  const override = getDocumentProcessingOverride(document?.process_rule_snapshot ?? null);
  const processRule = toRecord(override?.process_rule ?? settings.process_rule);
  const segmentation = toRecord(processRule.segmentation);
  const subchunkSegmentation = toRecord(processRule.subchunk_segmentation);
  return {
    mode:
      settings.mode === "general" || settings.doc_form === "text_model"
        ? "general"
        : "parent_child",
    doc_form: normalizeDocForm(settings.doc_form, settings.mode),
    indexing_technique: settings.indexing_technique === "economy" ? "economy" : "high_quality",
    process_rule_mode: normalizeProcessRuleMode(settings.process_rule_mode),
    process_rule: override?.process_rule ?? settings.process_rule,
    parent_mode:
      override?.parent_mode ?? (settings.parent_mode === "full_doc" ? "full_doc" : "paragraph"),
    parent_delimiter: readRuleSeparator(segmentation, settings.parent_delimiter),
    child_delimiter: readRuleSeparator(subchunkSegmentation, settings.child_delimiter),
    parent_max_characters: readRuleMaxTokens(segmentation, settings.parent_max_characters),
    chunk_overlap_characters: readRuleOverlap(segmentation, 0),
    child_max_characters: readRuleMaxTokens(subchunkSegmentation, settings.child_max_characters),
    child_overlap_characters: readRuleOverlap(
      subchunkSegmentation,
      settings.child_overlap_characters
    ),
    settings_revision: settings.revision
  };
}

function buildProcessingSnapshot(
  settings: {
    doc_form?: string;
    indexing_technique?: string;
    process_rule_mode?: string;
    process_rule?: Prisma.JsonValue;
    retrieval_model?: Prisma.JsonValue;
    summary_index_setting?: Prisma.JsonValue;
    parent_mode: string;
    revision: number;
    mode?: string;
  },
  document?: { process_rule_snapshot?: Prisma.JsonValue | null },
  version?: { id: string; markdown_hash: string }
): Prisma.InputJsonValue {
  const override = getDocumentProcessingOverride(document?.process_rule_snapshot ?? null);
  const processRule = toRecord(override?.process_rule ?? settings.process_rule);
  const parentMode =
    override?.parent_mode ??
    (processRule.parent_mode === "full-doc" || processRule.parent_mode === "full_doc"
      ? "full_doc"
      : settings.parent_mode === "full_doc"
        ? "full_doc"
        : "paragraph");
  return {
    doc_form: normalizeDocForm(settings.doc_form, settings.mode),
    indexing_technique: settings.indexing_technique === "economy" ? "economy" : "high_quality",
    process_rule_mode: normalizeProcessRuleMode(settings.process_rule_mode),
    process_rule: {
      ...(processRule as Record<string, unknown>),
      parent_mode: parentMode === "full_doc" ? "full-doc" : "paragraph"
    },
    retrieval_model: settings.retrieval_model ?? {},
    summary_index_setting: settings.summary_index_setting ?? { enable: false },
    settings_revision: settings.revision,
    content_version_id: version?.id ?? null,
    content_markdown_hash: version?.markdown_hash ?? null,
    document_override: Boolean(override?.parent_mode || override?.process_rule !== undefined)
  };
}

function summaryIndexEnabled(value: unknown): boolean {
  return toRecord(value).enable === true;
}

function getDocumentProcessingOverride(
  snapshot: Prisma.JsonValue | null
): { parent_mode?: "paragraph" | "full_doc"; process_rule?: unknown } | undefined {
  const record = toRecord(snapshot);
  if (record.document_override !== true) {
    return undefined;
  }
  const parentMode = readSnapshotParentMode(record);
  const processRule = record.process_rule;
  if (!parentMode && processRule === undefined) {
    return undefined;
  }
  return {
    ...(parentMode ? { parent_mode: parentMode } : {}),
    ...(processRule !== undefined ? { process_rule: processRule } : {})
  };
}

function readSnapshotParentMode(value: unknown): "paragraph" | "full_doc" | null {
  const record = toRecord(value);
  const processRule = toRecord(record.process_rule ?? record);
  const mode = processRule.parent_mode ?? record.parent_mode;
  if (mode === "full_doc" || mode === "full-doc") {
    return "full_doc";
  }
  if (mode === "paragraph") {
    return "paragraph";
  }
  return null;
}

function readRuleSeparator(record: Record<string, unknown>, fallback: string): string {
  const value = record.separator ?? record.delimiter;
  return typeof value === "string" ? value : fallback;
}

function readRuleMaxTokens(record: Record<string, unknown>, fallback: number): number {
  return Number.isInteger(record.max_tokens) && Number(record.max_tokens) > 0
    ? Number(record.max_tokens)
    : fallback;
}

function readRuleOverlap(record: Record<string, unknown>, fallback: number): number {
  return Number.isInteger(record.chunk_overlap) && Number(record.chunk_overlap) >= 0
    ? Number(record.chunk_overlap)
    : fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadIndexableQaPairs(
  tx: Prisma.TransactionClient,
  documentId: string,
  versionId: string
) {
  const pairs = await tx.documentQaPair.findMany({
    where: { document_id: documentId, status: "active" },
    orderBy: { created_at: "asc" }
  });
  const sourceIds = [
    ...new Set(
      pairs
        .map((pair) => pair.source_chunk_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  ];
  const activeSourceIds = new Set(
    sourceIds.length
      ? (
          await tx.documentChunk.findMany({
            where: {
              id: { in: sourceIds },
              document_id: documentId,
              version_id: versionId,
              status: "active",
              index_role: "content"
            },
            select: { id: true }
          })
        ).map((chunk) => chunk.id)
      : []
  );
  return pairs.filter((pair) => !pair.source_chunk_id || activeSourceIds.has(pair.source_chunk_id));
}

function getStringFromRecord(value: unknown, key: string): string | null {
  const item = toRecord(value)[key];
  return typeof item === "string" && item ? item : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

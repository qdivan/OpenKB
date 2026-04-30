import { createHash } from "node:crypto";

import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  chunkMarkdown,
  convertImportFile,
  MarkdownConversionError,
  type ImportConversionWarning,
  type RequestedImportConverter
} from "@openkb/markdown";
import { createObjectStorage, type ObjectStorage } from "@openkb/storage";

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

export async function runImportOnce(options: ImportWorkerOptions = {}): Promise<ImportRunResult> {
  const prisma = options.prisma ?? createDatabaseClient();
  const storage = options.storage ?? createObjectStorage();
  const shouldDisconnect = !options.prisma;

  try {
    const claimed = await claimNextImportJob(prisma);
    if (!claimed) {
      return { processed: false };
    }

    try {
      await processClaimedImportJob(prisma, storage, claimed.id);
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

async function processClaimedImportJob(
  prisma: PrismaClient,
  storage: ObjectStorage,
  importJobId: string
) {
  const job = await prisma.importJob.findUnique({ where: { id: importJobId } });
  if (!job || job.status !== "running") {
    throw new WorkerImportError("IMPORT_JOB_NOT_FOUND", "Import job was not found.");
  }

  const asset = await prisma.documentAsset.findUnique({ where: { id: job.source_asset_id } });
  if (!asset || asset.tenant_id !== job.tenant_id) {
    throw new WorkerImportError("ASSET_NOT_FOUND", "Source asset was not found.");
  }

  const source = await storage.getObject({ key: asset.object_key });
  const conversion = convertImportFile({
    filename: asset.filename,
    mimeType: asset.mime_type,
    content: source,
    converter: job.converter as RequestedImportConverter
  });
  const chunks = chunkMarkdown(conversion.markdown);
  const now = new Date();
  const title = normalizeTitle(job.title ?? conversion.title);

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
        markdown: conversion.markdown,
        markdown_hash: markdownHash(conversion.markdown),
        source_type: "import",
        source_file_id: asset.id,
        created_by: job.created_by,
        created_at: now
      }
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
      data: chunks.map((chunk) => ({
        tenant_id: job.tenant_id,
        workspace_id: knowledgeBase.workspace_id,
        knowledge_base_id: knowledgeBase.id,
        document_id: document.id,
        version_id: version.id,
        ordinal: chunk.ordinal,
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
          chunk_count: chunks.length,
          source_asset_id: asset.id
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

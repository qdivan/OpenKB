import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import { type RequestedImportConverter } from "@openkb/markdown";
import { PermissionService } from "@openkb/permissions";
import {
  checksumSha256,
  createAssetObjectKey,
  createObjectStorage,
  type ObjectStorage,
  sanitizeFilename,
  StorageConfigError
} from "@openkb/storage";

import { ContentError } from "./errors";

export type UploadInput = {
  filename: string;
  mimeType: string;
  body: Buffer;
  knowledgeBaseId: string;
  parentId?: string | null;
};

export type CreateImportJobInput = {
  source_asset_id?: string;
  knowledge_base_id?: string;
  parent_id?: string | null;
  title?: string | null;
  converter?: RequestedImportConverter;
};

@Injectable()
export class ImportService {
  private readonly prisma: PrismaClient;
  private storage: ObjectStorage | null = null;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PermissionService) private readonly permissions: PermissionService
  ) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async upload(sessionToken: string | null, input: UploadInput) {
    const me = await this.requireMe(sessionToken);
    const knowledgeBase = await this.assertCanEditImportTarget(
      me,
      input.knowledgeBaseId,
      input.parentId ?? null
    );
    const assetId = randomUUID();
    const filename = sanitizeFilename(input.filename);
    const objectKey = createAssetObjectKey({
      tenantId: me.tenantId,
      assetId,
      filename
    });
    const checksum = checksumSha256(input.body);

    const storage = this.getStorage();

    try {
      await storage.ensureBucket();
      await storage.putObject({
        key: objectKey,
        body: input.body,
        contentType: input.mimeType || "application/octet-stream",
        metadata: {
          tenant_id: me.tenantId,
          knowledge_base_id: input.knowledgeBaseId,
          uploaded_by: me.user.id
        }
      });
    } catch (error) {
      throw storageError(error);
    }

    const asset = await this.prisma.documentAsset.create({
      data: {
        id: assetId,
        tenant_id: me.tenantId,
        document_id: null,
        object_key: objectKey,
        filename,
        mime_type: input.mimeType || "application/octet-stream",
        size_bytes: BigInt(input.body.byteLength),
        checksum_sha256: checksum,
        storage_bucket: storage.bucket,
        metadata: {
          upload_source: "api",
          workspace_id: knowledgeBase.workspace_id,
          knowledge_base_id: knowledgeBase.id,
          parent_id: input.parentId ?? null
        },
        created_by: me.user.id,
        created_at: new Date()
      }
    });

    return toAssetDto(asset);
  }

  async createImportJob(sessionToken: string | null, input: CreateImportJobInput) {
    const me = await this.requireMe(sessionToken);
    const sourceAssetId = requireText(input.source_asset_id, "source_asset_id");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const parentId = input.parent_id || null;
    const converter = normalizeRequestedConverter(input.converter ?? "auto");
    const knowledgeBase = await this.assertCanEditImportTarget(me, knowledgeBaseId, parentId);

    const asset = await this.prisma.documentAsset.findUnique({ where: { id: sourceAssetId } });
    if (!asset || asset.tenant_id !== me.tenantId) {
      throw new ContentError("ASSET_NOT_FOUND", "Source asset was not found.", 404);
    }
    if (asset.created_by !== me.user.id && !isAdmin(me)) {
      throw new ContentError("ASSET_NOT_FOUND", "Source asset was not found.", 404);
    }
    if (asset.document_id) {
      throw new ContentError(
        "INVALID_INPUT",
        "Source asset is already attached to a document.",
        400
      );
    }

    const now = new Date();
    const job = await this.prisma.importJob.create({
      data: {
        tenant_id: me.tenantId,
        workspace_id: knowledgeBase.workspace_id,
        knowledge_base_id: knowledgeBase.id,
        parent_id: parentId,
        source_asset_id: asset.id,
        status: "pending",
        converter,
        title: normalizeOptionalText(input.title),
        warnings: [],
        metadata: {},
        created_by: me.user.id,
        created_at: now,
        updated_at: now
      }
    });

    return toImportJobDto(job);
  }

  async getImportJob(sessionToken: string | null, importJobId: string) {
    const me = await this.requireMe(sessionToken);
    const job = await this.prisma.importJob.findUnique({ where: { id: importJobId } });
    if (!job || job.tenant_id !== me.tenantId) {
      throw new ContentError("IMPORT_JOB_NOT_FOUND", "Import job was not found.", 404);
    }
    await this.assertCanReadJob(me, job);
    return toImportJobDto(job);
  }

  async listImportJobs(sessionToken: string | null, knowledgeBaseId: string | undefined) {
    const me = await this.requireMe(sessionToken);
    const knowledgeBaseIdText = requireText(knowledgeBaseId, "knowledge_base_id");
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseIdText);

    const jobs = await this.prisma.importJob.findMany({
      where: {
        tenant_id: me.tenantId,
        knowledge_base_id: knowledgeBaseIdText
      },
      orderBy: { created_at: "desc" },
      take: 50
    });

    return jobs.map(toImportJobDto);
  }

  async createPresignedAssetUrl(sessionToken: string | null, assetId: string) {
    const me = await this.requireMe(sessionToken);
    const asset = await this.prisma.documentAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.tenant_id !== me.tenantId) {
      throw new ContentError("ASSET_NOT_FOUND", "Asset was not found.", 404);
    }

    if (asset.document_id) {
      await this.permissions.requireCanRead(me.user.id, "document", asset.document_id);
    } else if (asset.created_by !== me.user.id && !isAdmin(me)) {
      throw new ContentError("ASSET_NOT_FOUND", "Asset was not found.", 404);
    }

    try {
      return {
        url: await this.getStorage().createPresignedGetUrl({ key: asset.object_key }),
        asset: toAssetDto(asset)
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  private async requireMe(sessionToken: string | null): Promise<AuthenticatedUser> {
    return this.auth.getMe(sessionToken);
  }

  private getStorage(): ObjectStorage {
    if (!this.storage) {
      this.storage = createObjectStorage();
    }
    return this.storage;
  }

  private async assertCanEditImportTarget(
    me: AuthenticatedUser,
    knowledgeBaseId: string,
    parentId: string | null
  ) {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (
      !knowledgeBase ||
      knowledgeBase.tenant_id !== me.tenantId ||
      knowledgeBase.status !== "active"
    ) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }

    if (parentId) {
      const parent = await this.prisma.document.findUnique({ where: { id: parentId } });
      if (
        !parent ||
        parent.tenant_id !== me.tenantId ||
        parent.knowledge_base_id !== knowledgeBase.id ||
        parent.type !== "folder" ||
        parent.status === "deleted"
      ) {
        throw new ContentError("INVALID_INPUT", "Parent folder is invalid.", 400);
      }
      await this.permissions.requireCanEdit(me.user.id, "document", parent.id);
      return knowledgeBase;
    }

    await this.permissions.requireCanEdit(me.user.id, "knowledge_base", knowledgeBase.id);
    return knowledgeBase;
  }

  private async assertCanReadJob(
    me: AuthenticatedUser,
    job: {
      created_by: string;
      knowledge_base_id: string;
      document_id: string | null;
    }
  ) {
    if (job.created_by === me.user.id || isAdmin(me)) {
      return;
    }
    if (job.document_id) {
      await this.permissions.requireCanRead(me.user.id, "document", job.document_id);
      return;
    }
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", job.knowledge_base_id);
  }
}

function storageError(error: unknown): ContentError {
  if (error instanceof StorageConfigError) {
    return new ContentError("STORAGE_ERROR", error.message, 500);
  }
  return new ContentError(
    "STORAGE_ERROR",
    error instanceof Error ? error.message : "Object storage request failed.",
    500
  );
}

function requireText(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ContentError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeRequestedConverter(value: RequestedImportConverter): RequestedImportConverter {
  if (
    value === "auto" ||
    value === "markdown" ||
    value === "text" ||
    value === "html" ||
    value === "csv"
  ) {
    return value;
  }
  throw new ContentError("CONVERTER_UNAVAILABLE", "Converter is not available.", 400);
}

function isAdmin(me: AuthenticatedUser): boolean {
  return me.roles.includes("system_admin") || me.roles.includes("tenant_admin");
}

function toAssetDto(asset: {
  id: string;
  tenant_id: string;
  document_id: string | null;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: bigint;
  checksum_sha256: string | null;
  storage_bucket: string;
  metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
}) {
  return {
    id: asset.id,
    tenant_id: asset.tenant_id,
    document_id: asset.document_id,
    object_key: asset.object_key,
    filename: asset.filename,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes.toString(),
    checksum_sha256: asset.checksum_sha256,
    storage_bucket: asset.storage_bucket,
    metadata: asset.metadata,
    created_by: asset.created_by,
    created_at: asset.created_at.toISOString()
  };
}

export function toImportJobDto(job: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  source_asset_id: string;
  status: string;
  converter: string;
  title: string | null;
  document_id: string | null;
  output_version_id: string | null;
  error: string | null;
  warnings: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}) {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    workspace_id: job.workspace_id,
    knowledge_base_id: job.knowledge_base_id,
    parent_id: job.parent_id,
    source_asset_id: job.source_asset_id,
    status: job.status,
    converter: job.converter,
    title: job.title,
    document_id: job.document_id,
    output_version_id: job.output_version_id,
    error: job.error,
    warnings: job.warnings,
    metadata: job.metadata,
    created_by: job.created_by,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
    finished_at: job.finished_at ? job.finished_at.toISOString() : null
  };
}

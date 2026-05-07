import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AuthService, type AuthenticatedUser } from "@openkb/auth";
import {
  CONTENT_INVITATION_ROLES,
  CONTENT_ROLES,
  createDatabaseClient,
  WORKSPACE_INVITATION_ROLES,
  type ContentInvitationRole,
  type ContentRole,
  type Prisma,
  type PrismaClient,
  type WorkspaceInvitationRole
} from "@openkb/db";
import { normalizeMarkdownSource, validateMarkdownSource } from "@openkb/editor";
import {
  chunkMarkdownForIndex,
  type HierarchicalMarkdownChunk,
  type MarkdownChunkingSettings
} from "@openkb/markdown";
import {
  PermissionService,
  type ContentObjectType,
  type PermissionObjectType
} from "@openkb/permissions";

import { ContentError } from "./errors";
import { toImportJobDto } from "./import.service";

type CreateWorkspaceInput = {
  name?: string;
  slug?: string;
};

type UpdateWorkspaceInput = {
  name?: string;
  slug?: string;
};

type CreateKnowledgeBaseInput = {
  workspace_id?: string;
  title?: string;
  slug?: string;
  visibility?: string;
};

type UpdateKnowledgeBaseInput = {
  title?: string;
  slug?: string;
  visibility?: string;
  status?: string;
};

type UpdateChunkSettingsInput = {
  mode?: string;
  parent_mode?: string;
  parent_delimiter?: string;
  child_delimiter?: string;
  parent_max_characters?: number;
  child_max_characters?: number;
  child_overlap_characters?: number;
};

type ChunkPreviewInput = UpdateChunkSettingsInput & {
  markdown?: string;
  document_id?: string;
};

type CreateDocumentInput = {
  knowledge_base_id?: string;
  parent_id?: string | null;
  type?: string;
  title?: string;
  slug?: string;
  markdown?: string;
  sort_order?: number;
};

type UpdateDocumentInput = {
  title?: string;
  slug?: string;
  parent_id?: string | null;
  markdown?: string;
  markdown_hash?: string;
  base_version_id?: string | null;
  status?: string;
  permission_mode?: string;
  visibility?: string | null;
  sort_order?: number;
};

type CreateCollaboratorInput = {
  subject_type?: string;
  subject_id?: string;
  role?: string;
};

type UpdateCollaboratorInput = {
  role?: string;
};

type CreateInvitationInput = {
  email?: string;
  invited_user_id?: string;
  role?: string;
  expires_at?: string | null;
  max_uses?: number | null;
};

type CreateShareLinkInput = {
  require_login?: boolean;
  restrict_to_workspace_members?: boolean;
  expires_at?: string | null;
};

@Injectable()
export class ContentService {
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PermissionService) private readonly permissions: PermissionService
  ) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async listWorkspaces(sessionToken: string | null) {
    const me = await this.requireMe(sessionToken);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        tenant_id: me.tenantId,
        user_id: me.user.id
      },
      orderBy: { created_at: "asc" }
    });
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        id: { in: memberships.map((membership) => membership.workspace_id) }
      },
      orderBy: { created_at: "asc" }
    });
    const roleByWorkspace = new Map(
      memberships.map((membership) => [membership.workspace_id, membership.role])
    );

    return workspaces.map((workspace) => ({
      ...toWorkspaceDto(workspace),
      role: roleByWorkspace.get(workspace.id) ?? null
    }));
  }

  async createWorkspace(sessionToken: string | null, input: CreateWorkspaceInput) {
    const me = await this.requireMe(sessionToken);
    const name = requireText(input.name, "name");
    const slug = normalizeSlug(input.slug || name);
    const now = new Date();

    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          tenant_id: me.tenantId,
          name,
          slug,
          created_by: me.user.id,
          created_at: now,
          updated_at: now
        }
      });
      await tx.workspaceMember.create({
        data: {
          tenant_id: me.tenantId,
          workspace_id: created.id,
          user_id: me.user.id,
          role: "owner",
          created_at: now
        }
      });
      await this.writeAuditLog(tx, me, "workspace.create", "workspace", created.id);
      return created;
    });

    return toWorkspaceDto(workspace);
  }

  async getWorkspace(sessionToken: string | null, workspaceId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "workspace", workspaceId);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new ContentError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
    }

    return {
      ...toWorkspaceDto(workspace),
      role: await this.permissions.resolveWorkspaceRole(me.user.id, workspace.id)
    };
  }

  async updateWorkspace(
    sessionToken: string | null,
    workspaceId: string,
    input: UpdateWorkspaceInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "workspace", workspaceId);

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name !== undefined ? { name: requireText(input.name, "name") } : {}),
        ...(input.slug !== undefined ? { slug: normalizeSlug(input.slug) } : {}),
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(this.prisma, me, "workspace.update", "workspace", workspace.id);
    return toWorkspaceDto(workspace);
  }

  async listKnowledgeBases(sessionToken: string | null, workspaceId?: string) {
    const me = await this.requireMe(sessionToken);
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        tenant_id: me.tenantId,
        ...(workspaceId ? { workspace_id: workspaceId } : {})
      },
      orderBy: { created_at: "asc" }
    });

    const readable = [];
    for (const knowledgeBase of knowledgeBases) {
      if (await this.permissions.canRead(me.user.id, "knowledge_base", knowledgeBase.id)) {
        readable.push({
          ...toKnowledgeBaseDto(knowledgeBase),
          role: await this.permissions.resolveObjectRole(
            me.user.id,
            "knowledge_base",
            knowledgeBase.id
          )
        });
      }
    }

    return readable;
  }

  async createKnowledgeBase(sessionToken: string | null, input: CreateKnowledgeBaseInput) {
    const me = await this.requireMe(sessionToken);
    const workspaceId = requireText(input.workspace_id, "workspace_id");
    await this.permissions.requireCanManage(me.user.id, "workspace", workspaceId);

    const title = requireText(input.title, "title");
    const slug = normalizeSlug(input.slug || title);
    const visibility = normalizeVisibility(input.visibility ?? "private");
    const now = new Date();

    const knowledgeBase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeBase.create({
        data: {
          tenant_id: me.tenantId,
          workspace_id: workspaceId,
          title,
          slug,
          visibility,
          status: "active",
          created_by: me.user.id,
          created_at: now,
          updated_at: now
        }
      });
      await tx.collaborator.create({
        data: {
          tenant_id: me.tenantId,
          object_type: "knowledge_base",
          object_id: created.id,
          subject_type: "user",
          subject_id: me.user.id,
          role: "owner",
          source: "system",
          created_by: me.user.id,
          created_at: now
        }
      });
      await tx.knowledgeBaseChunkSetting.create({
        data: {
          tenant_id: me.tenantId,
          workspace_id: created.workspace_id,
          knowledge_base_id: created.id,
          mode: "parent_child",
          parent_mode: "paragraph",
          updated_by: me.user.id
        }
      });
      await this.writeAuditLog(tx, me, "knowledge_base.create", "knowledge_base", created.id);
      return created;
    });

    return toKnowledgeBaseDto(knowledgeBase);
  }

  async getKnowledgeBase(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (!knowledgeBase) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }

    return toKnowledgeBaseDto(knowledgeBase);
  }

  async updateKnowledgeBase(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: UpdateKnowledgeBaseInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);

    const knowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: {
        ...(input.title !== undefined ? { title: requireText(input.title, "title") } : {}),
        ...(input.slug !== undefined ? { slug: normalizeSlug(input.slug) } : {}),
        ...(input.visibility !== undefined
          ? { visibility: normalizeVisibility(input.visibility) }
          : {}),
        ...(input.status !== undefined
          ? { status: normalizeKnowledgeBaseStatus(input.status) }
          : {}),
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "knowledge_base.update",
      "knowledge_base",
      knowledgeBase.id
    );
    return toKnowledgeBaseDto(knowledgeBase);
  }

  async getKnowledgeBaseTree(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const documents = await this.prisma.document.findMany({
      where: {
        knowledge_base_id: knowledgeBaseId,
        status: { not: "deleted" }
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
    });

    return documents.map(toDocumentDto);
  }

  async getKnowledgeBaseOverview(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (!knowledgeBase) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }

    const [
      documents,
      currentDocuments,
      latestImportJobs,
      latestChunkRebuildJob,
      latestIndexRebuildJob,
      settings
    ] = await Promise.all([
      this.prisma.document.groupBy({
        by: ["type", "status"],
        where: { knowledge_base_id: knowledgeBaseId, status: { not: "deleted" } },
        _count: { _all: true }
      }),
      this.prisma.document.findMany({
        where: { knowledge_base_id: knowledgeBaseId, status: { not: "deleted" } },
        select: { current_version_id: true, status: true, updated_at: true }
      }),
      this.prisma.importJob.findMany({
        where: { knowledge_base_id: knowledgeBaseId },
        orderBy: { created_at: "desc" },
        take: 5
      }),
      this.prisma.chunkRebuildJob.findFirst({
        where: { knowledge_base_id: knowledgeBaseId },
        orderBy: { created_at: "desc" }
      }),
      this.prisma.indexRebuildJob.findFirst({
        where: { OR: [{ tenant_id: knowledgeBase.tenant_id }, { tenant_id: null }] },
        orderBy: { started_at: "desc" }
      }),
      this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase)
    ]);

    const currentVersionIds = currentDocuments.flatMap((document) =>
      document.current_version_id ? [document.current_version_id] : []
    );
    const publishedVersionIds = currentDocuments.flatMap((document) =>
      document.status === "published" && document.current_version_id
        ? [document.current_version_id]
        : []
    );
    const [chunksByType, staleChunkCount, latestPublishedSearchableChunk] = await Promise.all([
      this.prisma.documentChunk.groupBy({
        by: ["chunk_type"],
        where: { knowledge_base_id: knowledgeBaseId, version_id: { in: currentVersionIds } },
        _count: { _all: true }
      }),
      this.prisma.documentChunk.count({
        where: {
          knowledge_base_id: knowledgeBaseId,
          version_id: { in: currentVersionIds },
          settings_revision: { lt: settings.revision }
        }
      }),
      this.prisma.documentChunk.findFirst({
        where: {
          knowledge_base_id: knowledgeBaseId,
          version_id: { in: publishedVersionIds },
          chunk_type: { in: ["general", "child"] }
        },
        orderBy: { created_at: "desc" },
        select: { created_at: true }
      })
    ]);
    const latestPublishedDocumentAt =
      currentDocuments
        .filter((document) => document.status === "published")
        .map((document) => document.updated_at)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const latestIndexAt =
      latestIndexRebuildJob?.status === "succeeded"
        ? (latestIndexRebuildJob.finished_at ?? latestIndexRebuildJob.started_at)
        : null;
    const newestPublishedIndexInputAt =
      [latestPublishedSearchableChunk?.created_at ?? null, latestPublishedDocumentAt]
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const needsIndexRebuild =
      staleChunkCount > 0 ||
      Boolean(
        newestPublishedIndexInputAt &&
        (!latestIndexAt || newestPublishedIndexInputAt > latestIndexAt)
      );

    return {
      knowledge_base: toKnowledgeBaseDto(knowledgeBase),
      documents: {
        total: sumGroupCounts(documents),
        pages: sumGroupCounts(documents.filter((item) => item.type === "page")),
        folders: sumGroupCounts(documents.filter((item) => item.type === "folder")),
        published: sumGroupCounts(documents.filter((item) => item.status === "published")),
        draft: sumGroupCounts(documents.filter((item) => item.status === "draft"))
      },
      chunks: {
        total: sumGroupCounts(chunksByType),
        general: sumGroupCounts(chunksByType.filter((item) => item.chunk_type === "general")),
        parent: sumGroupCounts(chunksByType.filter((item) => item.chunk_type === "parent")),
        child: sumGroupCounts(chunksByType.filter((item) => item.chunk_type === "child")),
        stale: staleChunkCount
      },
      chunk_settings: toChunkSettingsDto(settings),
      latest_import_jobs: latestImportJobs.map(toImportJobDto),
      latest_chunk_rebuild_job: latestChunkRebuildJob
        ? toChunkRebuildJobDto(latestChunkRebuildJob)
        : null,
      latest_index_rebuild_job: latestIndexRebuildJob
        ? {
            id: latestIndexRebuildJob.id,
            tenant_id: latestIndexRebuildJob.tenant_id,
            target_collection: latestIndexRebuildJob.target_collection,
            target_alias: latestIndexRebuildJob.target_alias,
            status: latestIndexRebuildJob.status,
            started_by: latestIndexRebuildJob.started_by,
            started_at: latestIndexRebuildJob.started_at.toISOString(),
            finished_at: latestIndexRebuildJob.finished_at
              ? latestIndexRebuildJob.finished_at.toISOString()
              : null,
            error: latestIndexRebuildJob.error
          }
        : null,
      needs_chunk_rebuild: staleChunkCount > 0,
      needs_index_rebuild: needsIndexRebuild
    };
  }

  async getChunkSettings(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const settings = await this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase);
    return toChunkSettingsDto(settings);
  }

  async updateChunkSettings(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: UpdateChunkSettingsInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);
    rejectForbiddenChunkSettingKeys(input);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const current = await this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase);
    const patch = normalizeChunkSettingsInput(input);
    const updated = await this.prisma.knowledgeBaseChunkSetting.update({
      where: { knowledge_base_id: knowledgeBaseId },
      data: {
        ...patch,
        revision: current.revision + 1,
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "knowledge_base.chunk_settings.update",
      "knowledge_base",
      knowledgeBaseId
    );
    return toChunkSettingsDto(updated);
  }

  async previewChunks(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: ChunkPreviewInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    rejectForbiddenChunkSettingKeys(input);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const current = await this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase);
    const patch = normalizeChunkSettingsInput(input);
    let markdown = typeof input.markdown === "string" ? input.markdown : "";
    if (!markdown && input.document_id) {
      await this.permissions.requireCanRead(me.user.id, "document", input.document_id);
      const document = await this.prisma.document.findUnique({ where: { id: input.document_id } });
      if (
        !document ||
        document.knowledge_base_id !== knowledgeBaseId ||
        !document.current_version_id
      ) {
        throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
      }
      const version = await this.prisma.documentVersion.findUnique({
        where: { id: document.current_version_id }
      });
      markdown = version?.markdown ?? "";
    }
    const chunks = chunkMarkdownForIndex(markdown, {
      ...toMarkdownChunkingSettings({ ...current, ...patch, revision: current.revision }),
      settings_revision: current.revision
    }).slice(0, 80);
    return { chunks: chunks.map(toPreviewChunkDto), total: chunks.length };
  }

  async listKnowledgeBaseChunks(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: { document_id?: string; type?: string; limit?: string | number | undefined }
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const type = normalizeOptionalChunkType(input.type);
    const limit = clampNumber(input.limit, 100, 1, 500);
    const currentDocuments = await this.prisma.document.findMany({
      where: {
        knowledge_base_id: knowledgeBaseId,
        status: { not: "deleted" },
        ...(input.document_id ? { id: input.document_id } : {})
      },
      select: { current_version_id: true }
    });
    const currentVersionIds = currentDocuments.flatMap((document) =>
      document.current_version_id ? [document.current_version_id] : []
    );
    if (currentVersionIds.length === 0) {
      return [];
    }
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        knowledge_base_id: knowledgeBaseId,
        version_id: { in: currentVersionIds },
        ...(input.document_id ? { document_id: input.document_id } : {}),
        ...(type ? { chunk_type: type } : {})
      },
      orderBy: [{ document_id: "asc" }, { ordinal: "asc" }],
      take: limit
    });
    return chunks.map(toDocumentChunkDto);
  }

  async createChunkRebuildJob(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const settings = await this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase);
    const job = await this.prisma.chunkRebuildJob.create({
      data: {
        tenant_id: knowledgeBase.tenant_id,
        workspace_id: knowledgeBase.workspace_id,
        knowledge_base_id: knowledgeBase.id,
        settings_revision: settings.revision,
        status: "pending",
        requested_by: me.user.id,
        metadata: {}
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "chunk_rebuild_job.create",
      "chunk_rebuild_job",
      job.id
    );
    return toChunkRebuildJobDto(job);
  }

  async getChunkRebuildJob(sessionToken: string | null, jobId: string) {
    const me = await this.requireMe(sessionToken);
    const job = await this.prisma.chunkRebuildJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new ContentError("OBJECT_NOT_FOUND", "Chunk rebuild job was not found.", 404);
    }
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", job.knowledge_base_id);
    return toChunkRebuildJobDto(job);
  }

  async createDocument(sessionToken: string | null, input: CreateDocumentInput) {
    const me = await this.requireMe(sessionToken);
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const parentId = input.parent_id || null;

    if (parentId) {
      await this.permissions.requireCanEdit(me.user.id, "document", parentId);
    } else {
      await this.permissions.requireCanEdit(me.user.id, "knowledge_base", knowledgeBaseId);
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (!knowledgeBase) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    if (parentId) {
      const parent = await this.prisma.document.findUnique({ where: { id: parentId } });
      if (!parent || parent.knowledge_base_id !== knowledgeBaseId || parent.type !== "folder") {
        throw new ContentError("INVALID_INPUT", "Parent folder is invalid.", 400);
      }
    }

    const type = normalizeDocumentType(input.type ?? "page");
    const title = requireText(input.title, "title");
    const slug = normalizeSlug(input.slug || title);
    const markdown = type === "page" ? normalizeAndValidateMarkdown(input.markdown ?? "") : "";
    const now = new Date();

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          tenant_id: me.tenantId,
          workspace_id: knowledgeBase.workspace_id,
          knowledge_base_id: knowledgeBase.id,
          parent_id: parentId,
          type,
          title,
          slug,
          status: "draft",
          permission_mode: "inherit",
          sort_order: Number.isInteger(input.sort_order) ? Number(input.sort_order) : 0,
          created_by: me.user.id,
          updated_by: me.user.id,
          created_at: now,
          updated_at: now
        }
      });
      const withVersion =
        type === "page"
          ? await this.createDocumentVersion(tx, me, created.id, markdown, now)
          : created;
      await tx.collaborator.create({
        data: {
          tenant_id: me.tenantId,
          object_type: "document",
          object_id: created.id,
          subject_type: "user",
          subject_id: me.user.id,
          role: "owner",
          source: "system",
          created_by: me.user.id,
          created_at: now
        }
      });
      await this.writeAuditLog(tx, me, "document.create", "document", created.id);
      return withVersion;
    });

    return this.getDocument(sessionToken, document.id);
  }

  async getDocument(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);

    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;

    return {
      ...toDocumentDto(document),
      currentVersion: version ? toDocumentVersionDto(version) : null,
      role: await this.permissions.resolveObjectRole(me.user.id, "document", document.id)
    };
  }

  async updateDocument(
    sessionToken: string | null,
    documentId: string,
    input: UpdateDocumentInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);

    const current = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!current || current.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    if (input.parent_id !== undefined || input.sort_order !== undefined) {
      await this.permissions.requireCanManage(me.user.id, "document", documentId);
    }
    if (
      input.base_version_id !== undefined &&
      input.base_version_id !== current.current_version_id
    ) {
      const currentVersion = current.current_version_id
        ? await this.prisma.documentVersion.findUnique({
            where: { id: current.current_version_id }
          })
        : null;

      throw new ContentError("VERSION_CONFLICT", "Document version conflict.", 409, {
        current_version_id: current.current_version_id,
        current_version: currentVersion ? toDocumentVersionDto(currentVersion) : null,
        updated_at: current.updated_at.toISOString()
      });
    }

    const normalizedMarkdown =
      input.markdown !== undefined ? normalizeAndValidateMarkdown(input.markdown) : undefined;
    if (
      normalizedMarkdown !== undefined &&
      input.markdown_hash !== undefined &&
      input.markdown_hash !== markdownHash(normalizedMarkdown)
    ) {
      throw new ContentError("INVALID_INPUT", "markdown_hash does not match markdown.", 400);
    }
    const nextParentId = input.parent_id !== undefined ? input.parent_id || null : undefined;
    if (nextParentId !== undefined) {
      await this.assertValidDocumentParent(current, nextParentId);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...(input.title !== undefined ? { title: requireText(input.title, "title") } : {}),
          ...(input.slug !== undefined ? { slug: normalizeSlug(input.slug) } : {}),
          ...(input.status !== undefined ? { status: normalizeDocumentStatus(input.status) } : {}),
          ...(input.permission_mode !== undefined
            ? { permission_mode: normalizePermissionMode(input.permission_mode) }
            : {}),
          ...(input.visibility !== undefined
            ? {
                visibility: input.visibility === null ? null : normalizeVisibility(input.visibility)
              }
            : {}),
          ...(nextParentId !== undefined ? { parent_id: nextParentId } : {}),
          ...(Number.isInteger(input.sort_order) ? { sort_order: Number(input.sort_order) } : {}),
          updated_by: me.user.id,
          updated_at: now
        }
      });

      if (normalizedMarkdown !== undefined && current.type === "page") {
        await this.createDocumentVersion(tx, me, documentId, normalizedMarkdown, now);
      }
      await this.writeAuditLog(tx, me, "document.update", "document", documentId);
    });

    return this.getDocument(sessionToken, documentId);
  }

  async publishDocument(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    if (document.type !== "page" || !document.current_version_id) {
      throw new ContentError(
        "INVALID_INPUT",
        "Only page documents with content can be published.",
        400
      );
    }
    await this.ensureChunksForDocumentVersion(this.prisma, me, document.id);
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: "published",
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(this.prisma, me, "document.publish", "document", documentId);
    return this.getDocument(sessionToken, documentId);
  }

  async unpublishDocument(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: "draft",
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(this.prisma, me, "document.unpublish", "document", documentId);
    return this.getDocument(sessionToken, documentId);
  }

  async deleteDocument(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "document", documentId);
    const deleted = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: "deleted",
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(this.prisma, me, "document.delete", "document", deleted.id);
    return { ok: true };
  }

  async listCollaborators(sessionToken: string | null, objectTypeInput: string, objectId: string) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireContentObjectType(objectTypeInput);
    await this.permissions.requireCanManage(me.user.id, objectType, objectId);

    const collaborators = await this.prisma.collaborator.findMany({
      where: {
        object_type: objectType,
        object_id: objectId
      },
      orderBy: { created_at: "asc" }
    });

    return collaborators.map(toCollaboratorDto);
  }

  async createCollaborator(
    sessionToken: string | null,
    objectTypeInput: string,
    objectId: string,
    input: CreateCollaboratorInput
  ) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireContentObjectType(objectTypeInput);
    await this.permissions.requireCanManage(me.user.id, objectType, objectId);
    const role = normalizeGrantableContentRole(input.role);
    const subjectType = normalizeSubjectType(input.subject_type);
    const subjectId = requireText(input.subject_id, "subject_id");
    await this.assertContentObjectExists(objectType, objectId);

    const collaborator = await this.prisma.collaborator.upsert({
      where: {
        object_type_object_id_subject_type_subject_id: {
          object_type: objectType,
          object_id: objectId,
          subject_type: subjectType,
          subject_id: subjectId
        }
      },
      create: {
        tenant_id: me.tenantId,
        object_type: objectType,
        object_id: objectId,
        subject_type: subjectType,
        subject_id: subjectId,
        role,
        source: "direct",
        created_by: me.user.id,
        created_at: new Date()
      },
      update: {
        role
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "collaborator.upsert",
      "collaborator",
      collaborator.id
    );
    return toCollaboratorDto(collaborator);
  }

  async updateCollaborator(
    sessionToken: string | null,
    collaboratorId: string,
    input: UpdateCollaboratorInput
  ) {
    const me = await this.requireMe(sessionToken);
    const current = await this.getCollaboratorOrThrow(collaboratorId);
    await this.permissions.requireCanManage(
      me.user.id,
      current.object_type as ContentObjectType,
      current.object_id
    );

    if (current.role === "owner") {
      throw new ContentError("INVALID_INPUT", "Owner transfer is not part of this phase.", 400);
    }

    const collaborator = await this.prisma.collaborator.update({
      where: { id: collaboratorId },
      data: {
        role: normalizeGrantableContentRole(input.role)
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "collaborator.update",
      "collaborator",
      collaborator.id
    );
    return toCollaboratorDto(collaborator);
  }

  async deleteCollaborator(sessionToken: string | null, collaboratorId: string) {
    const me = await this.requireMe(sessionToken);
    const current = await this.getCollaboratorOrThrow(collaboratorId);
    await this.permissions.requireCanManage(
      me.user.id,
      current.object_type as ContentObjectType,
      current.object_id
    );
    if (current.role === "owner") {
      throw new ContentError("INVALID_INPUT", "Owner transfer is not part of this phase.", 400);
    }

    await this.prisma.collaborator.delete({ where: { id: collaboratorId } });
    await this.writeAuditLog(
      this.prisma,
      me,
      "collaborator.delete",
      "collaborator",
      collaboratorId
    );
    return { ok: true };
  }

  async createInvitation(
    sessionToken: string | null,
    objectTypeInput: string,
    objectId: string,
    input: CreateInvitationInput
  ) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireObjectType(objectTypeInput);
    await this.permissions.requireCanManage(me.user.id, objectType, objectId);
    await this.assertObjectExists(objectType, objectId);

    const role =
      objectType === "workspace"
        ? normalizeWorkspaceInvitationRole(input.role)
        : normalizeContentInvitationRole(input.role);
    const rawToken = createRawToken();
    const now = new Date();
    const invitation = await this.prisma.invitation.create({
      data: {
        tenant_id: me.tenantId,
        object_type: objectType,
        object_id: objectId,
        email: input.email ? normalizeEmail(input.email) : null,
        invited_user_id: input.invited_user_id || null,
        role,
        token_hash: hashToken(rawToken),
        status: "pending",
        invited_by: me.user.id,
        expires_at: input.expires_at ? new Date(input.expires_at) : null,
        max_uses: Number.isInteger(input.max_uses) ? Number(input.max_uses) : null,
        created_at: now
      }
    });
    await this.writeAuditLog(this.prisma, me, "invitation.create", "invitation", invitation.id);

    return {
      ...toInvitationDto(invitation),
      token: rawToken
    };
  }

  async acceptInvitation(sessionToken: string | null, rawToken: string) {
    const me = await this.requireMe(sessionToken);
    const now = new Date();
    const invitation = await this.prisma.invitation.findFirst({
      where: {
        token_hash: hashToken(rawToken),
        status: "pending"
      }
    });
    if (!invitation) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation was not found.", 404);
    }
    if (invitation.expires_at && invitation.expires_at <= now) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation has expired.", 404);
    }
    if (invitation.max_uses !== null && invitation.used_count >= invitation.max_uses) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation has no remaining uses.", 404);
    }
    if (invitation.email && invitation.email !== me.user.email) {
      throw new ContentError("INVALID_INPUT", "Invitation email does not match user.", 403);
    }
    if (invitation.invited_user_id && invitation.invited_user_id !== me.user.id) {
      throw new ContentError("INVALID_INPUT", "Invitation user does not match session.", 403);
    }

    await this.prisma.$transaction(async (tx) => {
      if (invitation.object_type === "workspace") {
        await tx.workspaceMember.upsert({
          where: {
            workspace_id_user_id: {
              workspace_id: invitation.object_id,
              user_id: me.user.id
            }
          },
          create: {
            tenant_id: invitation.tenant_id,
            workspace_id: invitation.object_id,
            user_id: me.user.id,
            role: invitation.role,
            created_at: now
          },
          update: {
            role: invitation.role
          }
        });
      } else {
        await tx.collaborator.upsert({
          where: {
            object_type_object_id_subject_type_subject_id: {
              object_type: invitation.object_type,
              object_id: invitation.object_id,
              subject_type: "user",
              subject_id: me.user.id
            }
          },
          create: {
            tenant_id: invitation.tenant_id,
            object_type: invitation.object_type,
            object_id: invitation.object_id,
            subject_type: "user",
            subject_id: me.user.id,
            role: invitation.role,
            source: "invitation",
            created_by: invitation.invited_by,
            created_at: now
          },
          update: {
            role: invitation.role,
            source: "invitation"
          }
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: "accepted",
          used_count: { increment: 1 }
        }
      });
      await this.writeAuditLog(tx, me, "invitation.accept", "invitation", invitation.id);
    });

    return { ok: true };
  }

  async revokeInvitation(sessionToken: string | null, invitationId: string) {
    const me = await this.requireMe(sessionToken);
    const invitation = await this.prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation was not found.", 404);
    }
    await this.permissions.requireCanManage(
      me.user.id,
      invitation.object_type as PermissionObjectType,
      invitation.object_id
    );
    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "revoked" }
    });
    await this.writeAuditLog(this.prisma, me, "invitation.revoke", "invitation", invitationId);
    return { ok: true };
  }

  async createShareLink(
    sessionToken: string | null,
    objectTypeInput: string,
    objectId: string,
    input: CreateShareLinkInput
  ) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireContentObjectType(objectTypeInput);
    if (!(await this.permissions.canCreateShareLink(me.user.id, objectType, objectId))) {
      throw new ContentError("INVALID_INPUT", "You cannot create a share link.", 403);
    }
    await this.assertContentObjectExists(objectType, objectId);

    const rawToken = createRawToken();
    const shareLink = await this.prisma.shareLink.create({
      data: {
        tenant_id: me.tenantId,
        object_type: objectType,
        object_id: objectId,
        token_hash: hashToken(rawToken),
        permission: "view",
        require_login: Boolean(input.require_login),
        restrict_to_workspace_members: Boolean(input.restrict_to_workspace_members),
        expires_at: input.expires_at ? new Date(input.expires_at) : null,
        created_by: me.user.id,
        created_at: new Date()
      }
    });
    await this.writeAuditLog(this.prisma, me, "share_link.create", "share_link", shareLink.id);
    return {
      ...toShareLinkDto(shareLink),
      token: rawToken
    };
  }

  async getShare(rawToken: string, sessionToken: string | null) {
    const shareLink = await this.prisma.shareLink.findFirst({
      where: {
        token_hash: hashToken(rawToken),
        revoked_at: null
      }
    });
    if (!shareLink || (shareLink.expires_at && shareLink.expires_at <= new Date())) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }

    let me: AuthenticatedUser | null = null;
    if (shareLink.require_login || shareLink.restrict_to_workspace_members) {
      me = await this.requireMe(sessionToken);
    }

    const object = await this.resolveShareObject(
      shareLink.object_type as ContentObjectType,
      shareLink.object_id
    );
    if (shareLink.restrict_to_workspace_members && me) {
      const role = await this.permissions.resolveWorkspaceRole(me.user.id, object.workspaceId);
      if (role !== "owner" && role !== "admin" && role !== "member") {
        throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
      }
    }

    return {
      share: toShareLinkDto(shareLink),
      object: object.payload
    };
  }

  async revokeShareLink(sessionToken: string | null, shareLinkId: string) {
    const me = await this.requireMe(sessionToken);
    const shareLink = await this.prisma.shareLink.findUnique({ where: { id: shareLinkId } });
    if (!shareLink) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    await this.permissions.requireCanManage(
      me.user.id,
      shareLink.object_type as ContentObjectType,
      shareLink.object_id
    );
    await this.prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { revoked_at: new Date() }
    });
    await this.writeAuditLog(this.prisma, me, "share_link.revoke", "share_link", shareLinkId);
    return { ok: true };
  }

  private async requireMe(sessionToken: string | null): Promise<AuthenticatedUser> {
    return this.auth.getMe(sessionToken);
  }

  private async createDocumentVersion(
    tx: Prisma.TransactionClient,
    me: AuthenticatedUser,
    documentId: string,
    markdown: string,
    now: Date
  ) {
    const latest = await tx.documentVersion.findFirst({
      where: { document_id: documentId },
      orderBy: { version_no: "desc" }
    });
    const version = await tx.documentVersion.create({
      data: {
        tenant_id: me.tenantId,
        document_id: documentId,
        version_no: latest ? latest.version_no + 1 : 1,
        markdown,
        markdown_hash: markdownHash(markdown),
        source_type: "manual",
        created_by: me.user.id,
        created_at: now
      }
    });
    await this.replaceChunksForDocumentVersion(tx, me, documentId, version.id, markdown, now);

    return tx.document.update({
      where: { id: documentId },
      data: {
        current_version_id: version.id,
        updated_by: me.user.id,
        updated_at: now
      }
    });
  }

  private async ensureChunksForDocumentVersion(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    documentId: string
  ) {
    const document = await tx.document.findUnique({ where: { id: documentId } });
    if (!document?.current_version_id) {
      return;
    }
    const existing = await tx.documentChunk.count({
      where: { version_id: document.current_version_id }
    });
    if (existing > 0) {
      return;
    }
    const version = await tx.documentVersion.findUnique({
      where: { id: document.current_version_id }
    });
    if (!version) {
      return;
    }
    await this.replaceChunksForDocumentVersion(
      tx,
      me,
      documentId,
      version.id,
      version.markdown,
      new Date()
    );
  }

  private async replaceChunksForDocumentVersion(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    documentId: string,
    versionId: string,
    markdown: string,
    now: Date
  ) {
    const document = await tx.document.findUnique({ where: { id: documentId } });
    if (!document || document.type !== "page") {
      return;
    }
    const knowledgeBase = await tx.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase) {
      return;
    }
    const settings = await this.getOrCreateChunkSettings(tx, me, knowledgeBase);
    const rows = materializeDocumentChunks(
      chunkMarkdownForIndex(markdown, toMarkdownChunkingSettings(settings))
    ).map((chunk) => ({
      id: chunk.id,
      tenant_id: document.tenant_id,
      workspace_id: document.workspace_id,
      knowledge_base_id: document.knowledge_base_id,
      document_id: document.id,
      version_id: versionId,
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
    }));

    await tx.documentChunk.deleteMany({ where: { version_id: versionId } });
    if (rows.length > 0) {
      await tx.documentChunk.createMany({ data: rows });
    }
  }

  private async getOrCreateChunkSettings(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    knowledgeBase: {
      id: string;
      tenant_id: string;
      workspace_id: string;
    }
  ) {
    const existing = await tx.knowledgeBaseChunkSetting.findUnique({
      where: { knowledge_base_id: knowledgeBase.id }
    });
    if (existing) {
      return existing;
    }
    const legacyChunkCount = await tx.documentChunk.count({
      where: { knowledge_base_id: knowledgeBase.id, chunk_type: "general" }
    });
    return tx.knowledgeBaseChunkSetting.create({
      data: {
        tenant_id: knowledgeBase.tenant_id,
        workspace_id: knowledgeBase.workspace_id,
        knowledge_base_id: knowledgeBase.id,
        mode: legacyChunkCount > 0 ? "general" : "parent_child",
        parent_mode: "paragraph",
        updated_by: me.user.id
      }
    });
  }

  private async requireKnowledgeBase(knowledgeBaseId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (!knowledgeBase || knowledgeBase.status !== "active") {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    return knowledgeBase;
  }

  private async getCollaboratorOrThrow(collaboratorId: string) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId }
    });
    if (!collaborator) {
      throw new ContentError("OBJECT_NOT_FOUND", "Collaborator was not found.", 404);
    }
    return collaborator;
  }

  private async assertObjectExists(objectType: PermissionObjectType, objectId: string) {
    if (objectType === "workspace") {
      const workspace = await this.prisma.workspace.findUnique({ where: { id: objectId } });
      if (!workspace) {
        throw new ContentError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
      }
      return;
    }

    await this.assertContentObjectExists(objectType, objectId);
  }

  private async assertContentObjectExists(objectType: ContentObjectType, objectId: string) {
    const object =
      objectType === "knowledge_base"
        ? await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } })
        : await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!object) {
      throw new ContentError("OBJECT_NOT_FOUND", "Object was not found.", 404);
    }
  }

  private async assertValidDocumentParent(
    current: {
      id: string;
      knowledge_base_id: string;
      type: string;
    },
    nextParentId: string | null
  ) {
    if (nextParentId === null) {
      return;
    }
    if (nextParentId === current.id) {
      throw new ContentError("INVALID_INPUT", "Document cannot be its own parent.", 400);
    }

    const parent = await this.prisma.document.findUnique({ where: { id: nextParentId } });
    if (
      !parent ||
      parent.status === "deleted" ||
      parent.knowledge_base_id !== current.knowledge_base_id ||
      parent.type !== "folder"
    ) {
      throw new ContentError("INVALID_INPUT", "Parent folder is invalid.", 400);
    }
    if (current.type === "folder" && (await this.isDocumentDescendant(nextParentId, current.id))) {
      throw new ContentError("INVALID_INPUT", "Folder cannot be moved into its own child.", 400);
    }
  }

  private async isDocumentDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
    let cursor = await this.prisma.document.findUnique({
      where: { id: candidateId },
      select: { parent_id: true }
    });
    let depth = 0;

    while (cursor?.parent_id) {
      if (cursor.parent_id === ancestorId) {
        return true;
      }
      depth += 1;
      if (depth > 1000) {
        throw new ContentError("INVALID_INPUT", "Document tree is too deep.", 400);
      }
      cursor = await this.prisma.document.findUnique({
        where: { id: cursor.parent_id },
        select: { parent_id: true }
      });
    }

    return false;
  }

  private async resolveShareObject(objectType: ContentObjectType, objectId: string) {
    if (objectType === "knowledge_base") {
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } });
      if (!knowledgeBase) {
        throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
      }
      return {
        workspaceId: knowledgeBase.workspace_id,
        payload: toKnowledgeBaseDto(knowledgeBase)
      };
    }

    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    return {
      workspaceId: document.workspace_id,
      payload: {
        ...toDocumentDto(document),
        currentVersion: version ? toDocumentVersionDto(version) : null
      }
    };
  }

  private async writeAuditLog(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string
  ) {
    await tx.auditLog.create({
      data: {
        tenant_id: me.tenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata: {},
        created_at: new Date()
      }
    });
  }
}

function requireText(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ContentError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return normalized;
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new ContentError("INVALID_INPUT", "slug is invalid.", 400);
  }

  return slug;
}

function normalizeVisibility(value: string): "private" | "workspace" | "public" {
  if (value === "private" || value === "workspace" || value === "public") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "visibility is invalid.", 400);
}

function normalizeKnowledgeBaseStatus(value: string): "active" | "archived" {
  if (value === "active" || value === "archived") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeDocumentStatus(value: string): "draft" | "published" | "archived" | "deleted" {
  if (value === "draft" || value === "published" || value === "archived" || value === "deleted") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeDocumentType(value: string): "folder" | "page" {
  if (value === "folder" || value === "page") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "document type is invalid.", 400);
}

function normalizeAndValidateMarkdown(markdown: string): string {
  const normalized = normalizeMarkdownSource(markdown);
  const validation = validateMarkdownSource(normalized);
  if (!validation.ok) {
    throw new ContentError(
      "MARKDOWN_DIALECT_ERROR",
      "Markdown is outside the enabled Milkdown dialect.",
      400,
      { issues: validation.issues }
    );
  }
  return normalized;
}

function normalizePermissionMode(value: string): "inherit" | "custom" {
  if (value === "inherit" || value === "custom") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "permission_mode is invalid.", 400);
}

function normalizeSubjectType(value: string | undefined): "user" | "group" {
  if (value === "user" || value === "group") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "subject_type is invalid.", 400);
}

function normalizeGrantableContentRole(value: string | undefined): ContentInvitationRole {
  if (CONTENT_INVITATION_ROLES.includes(value as ContentInvitationRole)) {
    return value as ContentInvitationRole;
  }
  if (CONTENT_ROLES.includes(value as ContentRole)) {
    throw new ContentError("INVALID_INPUT", "owner cannot be granted through this API.", 400);
  }
  throw new ContentError("INVALID_INPUT", "role is invalid.", 400);
}

function normalizeContentInvitationRole(value: string | undefined): ContentInvitationRole {
  if (CONTENT_INVITATION_ROLES.includes(value as ContentInvitationRole)) {
    return value as ContentInvitationRole;
  }
  throw new ContentError("INVALID_INPUT", "role is invalid for content invitation.", 400);
}

function normalizeWorkspaceInvitationRole(value: string | undefined): WorkspaceInvitationRole {
  if (WORKSPACE_INVITATION_ROLES.includes(value as WorkspaceInvitationRole)) {
    return value as WorkspaceInvitationRole;
  }
  throw new ContentError("INVALID_INPUT", "role is invalid for workspace invitation.", 400);
}

function normalizeEmail(value: string): string {
  return requireText(value, "email").toLowerCase();
}

function createRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function toWorkspaceDto(workspace: {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: workspace.id,
    tenant_id: workspace.tenant_id,
    name: workspace.name,
    slug: workspace.slug,
    created_by: workspace.created_by,
    created_at: workspace.created_at.toISOString(),
    updated_at: workspace.updated_at.toISOString()
  };
}

function toKnowledgeBaseDto(knowledgeBase: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  slug: string;
  visibility: string;
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: knowledgeBase.id,
    tenant_id: knowledgeBase.tenant_id,
    workspace_id: knowledgeBase.workspace_id,
    title: knowledgeBase.title,
    slug: knowledgeBase.slug,
    visibility: knowledgeBase.visibility,
    status: knowledgeBase.status,
    created_by: knowledgeBase.created_by,
    created_at: knowledgeBase.created_at.toISOString(),
    updated_at: knowledgeBase.updated_at.toISOString()
  };
}

function toDocumentDto(document: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  type: string;
  title: string;
  slug: string;
  status: string;
  permission_mode: string;
  visibility: string | null;
  current_version_id: string | null;
  sort_order: number;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: document.id,
    tenant_id: document.tenant_id,
    workspace_id: document.workspace_id,
    knowledge_base_id: document.knowledge_base_id,
    parent_id: document.parent_id,
    type: document.type,
    title: document.title,
    slug: document.slug,
    status: document.status,
    permission_mode: document.permission_mode,
    visibility: document.visibility,
    current_version_id: document.current_version_id,
    sort_order: document.sort_order,
    created_by: document.created_by,
    updated_by: document.updated_by,
    created_at: document.created_at.toISOString(),
    updated_at: document.updated_at.toISOString()
  };
}

function toDocumentVersionDto(version: {
  id: string;
  document_id: string;
  version_no: number;
  markdown: string;
  markdown_hash: string;
  created_by: string;
  created_at: Date;
}) {
  return {
    id: version.id,
    document_id: version.document_id,
    version_no: version.version_no,
    markdown: version.markdown,
    markdown_hash: version.markdown_hash,
    created_by: version.created_by,
    created_at: version.created_at.toISOString()
  };
}

function toCollaboratorDto(collaborator: {
  id: string;
  tenant_id: string;
  object_type: string;
  object_id: string;
  subject_type: string;
  subject_id: string;
  role: string;
  source: string;
  created_by: string | null;
  created_at: Date;
}) {
  return {
    id: collaborator.id,
    tenant_id: collaborator.tenant_id,
    object_type: collaborator.object_type,
    object_id: collaborator.object_id,
    subject_type: collaborator.subject_type,
    subject_id: collaborator.subject_id,
    role: collaborator.role,
    source: collaborator.source,
    created_by: collaborator.created_by,
    created_at: collaborator.created_at.toISOString()
  };
}

function toInvitationDto(invitation: {
  id: string;
  tenant_id: string;
  object_type: string;
  object_id: string;
  email: string | null;
  invited_user_id: string | null;
  role: string;
  status: string;
  expires_at: Date | null;
  max_uses: number | null;
  used_count: number;
  invited_by: string;
  created_at: Date;
}) {
  return {
    id: invitation.id,
    tenant_id: invitation.tenant_id,
    object_type: invitation.object_type,
    object_id: invitation.object_id,
    email: invitation.email,
    invited_user_id: invitation.invited_user_id,
    role: invitation.role,
    status: invitation.status,
    expires_at: invitation.expires_at ? invitation.expires_at.toISOString() : null,
    max_uses: invitation.max_uses,
    used_count: invitation.used_count,
    invited_by: invitation.invited_by,
    created_at: invitation.created_at.toISOString()
  };
}

function toShareLinkDto(shareLink: {
  id: string;
  tenant_id: string;
  object_type: string;
  object_id: string;
  permission: string;
  require_login: boolean;
  restrict_to_workspace_members: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by: string;
  created_at: Date;
}) {
  return {
    id: shareLink.id,
    tenant_id: shareLink.tenant_id,
    object_type: shareLink.object_type,
    object_id: shareLink.object_id,
    permission: shareLink.permission,
    require_login: shareLink.require_login,
    restrict_to_workspace_members: shareLink.restrict_to_workspace_members,
    expires_at: shareLink.expires_at ? shareLink.expires_at.toISOString() : null,
    revoked_at: shareLink.revoked_at ? shareLink.revoked_at.toISOString() : null,
    created_by: shareLink.created_by,
    created_at: shareLink.created_at.toISOString()
  };
}

type MaterializedChunk = HierarchicalMarkdownChunk & {
  id: string;
  parent_chunk_id: string | null;
};

function materializeDocumentChunks(chunks: HierarchicalMarkdownChunk[]): MaterializedChunk[] {
  const parentIdByLocalId = new Map<string, string>();
  const ids = chunks.map(() => randomUUID());
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

function toMarkdownChunkingSettings(input: {
  mode: string;
  parent_mode: string;
  parent_delimiter: string;
  child_delimiter: string;
  parent_max_characters: number;
  child_max_characters: number;
  child_overlap_characters: number;
  revision: number;
}): MarkdownChunkingSettings {
  return {
    mode: input.mode === "general" ? "general" : "parent_child",
    parent_mode: input.parent_mode === "full_doc" ? "full_doc" : "paragraph",
    parent_delimiter: input.parent_delimiter,
    child_delimiter: input.child_delimiter,
    parent_max_characters: input.parent_max_characters,
    child_max_characters: input.child_max_characters,
    child_overlap_characters: input.child_overlap_characters,
    settings_revision: input.revision
  };
}

function normalizeChunkSettingsInput(input: UpdateChunkSettingsInput) {
  const next: {
    mode?: string;
    parent_mode?: string;
    parent_delimiter?: string;
    child_delimiter?: string;
    parent_max_characters?: number;
    child_max_characters?: number;
    child_overlap_characters?: number;
  } = {};
  if (input.mode !== undefined) {
    next.mode =
      input.mode === "general" || input.mode === "parent_child" ? input.mode : failInput();
  }
  if (input.parent_mode !== undefined) {
    next.parent_mode =
      input.parent_mode === "paragraph" || input.parent_mode === "full_doc"
        ? input.parent_mode
        : failInput();
  }
  if (input.parent_delimiter !== undefined) {
    next.parent_delimiter = requireShortText(input.parent_delimiter, "parent_delimiter");
  }
  if (input.child_delimiter !== undefined) {
    next.child_delimiter = requireShortText(input.child_delimiter, "child_delimiter");
  }
  if (input.parent_max_characters !== undefined) {
    next.parent_max_characters = clampNumber(input.parent_max_characters, 4000, 200, 65_535);
  }
  if (input.child_max_characters !== undefined) {
    next.child_max_characters = clampNumber(input.child_max_characters, 900, 100, 65_535);
  }
  if (input.child_overlap_characters !== undefined) {
    next.child_overlap_characters = clampNumber(input.child_overlap_characters, 120, 0, 10_000);
  }
  const childMax = next.child_max_characters ?? input.child_max_characters;
  const overlap = next.child_overlap_characters ?? input.child_overlap_characters;
  if (typeof childMax === "number" && typeof overlap === "number" && overlap >= childMax) {
    throw new ContentError(
      "INVALID_INPUT",
      "child_overlap_characters must be lower than child_max_characters.",
      400
    );
  }
  return next;
}

function rejectForbiddenChunkSettingKeys(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const forbidden = Object.keys(value as Record<string, unknown>).find((key) =>
    /(model|provider|embedding|rerank|endpoint|api[_-]?key|secret|token)/i.test(key)
  );
  if (forbidden) {
    throw new ContentError("INVALID_INPUT", `Chunk settings cannot include ${forbidden}.`, 400);
  }
}

function normalizeOptionalChunkType(value: unknown): "general" | "parent" | "child" | null {
  return value === "general" || value === "parent" || value === "child" ? value : null;
}

function toChunkSettingsDto(settings: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  mode: string;
  parent_mode: string;
  parent_delimiter: string;
  child_delimiter: string;
  parent_max_characters: number;
  child_max_characters: number;
  child_overlap_characters: number;
  revision: number;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: settings.id,
    tenant_id: settings.tenant_id,
    workspace_id: settings.workspace_id,
    knowledge_base_id: settings.knowledge_base_id,
    mode: settings.mode,
    parent_mode: settings.parent_mode,
    parent_delimiter: settings.parent_delimiter,
    child_delimiter: settings.child_delimiter,
    parent_max_characters: settings.parent_max_characters,
    child_max_characters: settings.child_max_characters,
    child_overlap_characters: settings.child_overlap_characters,
    revision: settings.revision,
    updated_by: settings.updated_by,
    created_at: settings.created_at.toISOString(),
    updated_at: settings.updated_at.toISOString()
  };
}

function toChunkRebuildJobDto(job: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  settings_revision: number;
  status: string;
  requested_by: string;
  error: string | null;
  metadata: Prisma.JsonValue;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}) {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    workspace_id: job.workspace_id,
    knowledge_base_id: job.knowledge_base_id,
    settings_revision: job.settings_revision,
    status: job.status,
    requested_by: job.requested_by,
    error: job.error,
    metadata: job.metadata,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
    finished_at: job.finished_at ? job.finished_at.toISOString() : null
  };
}

function toDocumentChunkDto(chunk: {
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
  metadata: Prisma.JsonValue;
  created_at: Date;
}) {
  return {
    id: chunk.id,
    tenant_id: chunk.tenant_id,
    workspace_id: chunk.workspace_id,
    knowledge_base_id: chunk.knowledge_base_id,
    document_id: chunk.document_id,
    version_id: chunk.version_id,
    ordinal: chunk.ordinal,
    chunk_type: chunk.chunk_type,
    parent_chunk_id: chunk.parent_chunk_id,
    settings_revision: chunk.settings_revision,
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
    metadata: chunk.metadata,
    created_at: chunk.created_at.toISOString()
  };
}

function toPreviewChunkDto(chunk: HierarchicalMarkdownChunk) {
  return {
    ordinal: chunk.ordinal,
    chunk_type: chunk.chunk_type,
    parent_ordinal: chunk.parent_ordinal,
    child_ordinal: chunk.child_ordinal,
    heading_path: chunk.heading_path,
    content_text: chunk.content_text,
    content_markdown: chunk.content_markdown,
    token_count: chunk.token_count,
    start_line: chunk.start_line,
    end_line: chunk.end_line,
    start_char: chunk.start_char,
    end_char: chunk.end_char,
    metadata: chunk.metadata
  };
}

function sumGroupCounts(items: Array<{ _count: { _all: number } }>): number {
  return items.reduce((sum, item) => sum + item._count._all, 0);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function requireShortText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new ContentError("INVALID_INPUT", `${field} is invalid.`, 400);
  }
  return value;
}

function failInput(): never {
  throw new ContentError("INVALID_INPUT", "Chunk settings are invalid.", 400);
}

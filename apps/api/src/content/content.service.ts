import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AuthService, type AuthenticatedUser } from "@openkb/auth";
import {
  CONTENT_INVITATION_ROLES,
  CONTENT_ROLES,
  createDatabaseClient,
  KNOWLEDGE_BASE_METADATA_FIELD_TYPES,
  WORKSPACE_ROLES,
  WORKSPACE_INVITATION_ROLES,
  type ContentInvitationRole,
  type ContentRole,
  type KnowledgeBaseMetadataFieldType,
  type Prisma,
  type PrismaClient,
  type WorkspaceRole,
  type WorkspaceInvitationRole
} from "@openkb/db";
import { normalizeMarkdownSource, validateMarkdownSource } from "@openkb/editor";
import {
  buildMarkdownAssetIndexEntries,
  chunkMarkdownForIndex,
  extractMarkdownAssetReferencesForIndex,
  type HierarchicalMarkdownChunk,
  type MarkdownAssetIndexAsset,
  type MarkdownChunkingSettings
} from "@openkb/markdown";
import {
  createOpenKBModelClient,
  getOpenKBModelClientConfig,
  ModelClientError,
  type StoredModelSetting
} from "@openkb/model-client";
import {
  PermissionService,
  type ContentObjectType,
  type PermissionObjectType
} from "@openkb/permissions";
import bcrypt from "bcryptjs";

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
  doc_form?: string;
};

type UpdateKnowledgeBaseInput = {
  title?: string;
  slug?: string;
  visibility?: string;
  status?: string;
};

type AdminContentTakeoverInput = {
  reason?: string;
  role?: string;
};

type CreateKnowledgeBaseMetadataFieldInput = {
  name?: string;
  type?: string;
  sort_order?: number;
};

type UpdateKnowledgeBaseMetadataFieldInput = {
  name?: string;
  type?: string;
  status?: string;
  sort_order?: number;
};

type UpdateChunkSettingsInput = {
  mode?: string;
  doc_form?: string;
  indexing_technique?: string;
  process_rule_mode?: string;
  process_rule?: unknown;
  retrieval_model?: unknown;
  summary_index_setting?: unknown;
  parent_mode?: string;
  parent_delimiter?: string;
  child_delimiter?: string;
  parent_max_characters?: number;
  chunk_overlap_characters?: number;
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

type UpdateDocumentMetadataInput = {
  values?: Record<string, unknown>;
};

type UpdateDocumentProcessingInput = {
  parent_mode?: string;
  process_rule?: unknown;
  doc_language?: string | null;
  need_summary?: boolean;
};

type UpdateSegmentInput = {
  status?: string;
  override_content_text?: string | null;
  override_content_markdown?: string | null;
  reset_override?: unknown;
};

type CreateQaPairInput = {
  question?: string;
  answer?: string;
  source?: string;
  source_chunk_id?: string | null;
  metadata?: unknown;
};

type UpdateQaPairInput = {
  question?: string;
  answer?: string;
  status?: string;
  source_chunk_id?: string | null;
  metadata?: unknown;
};

type ImportQaPairsInput = {
  csv?: string;
  rows?: Array<{
    question?: string;
    answer?: string;
    source_chunk_id?: string | null;
    metadata?: unknown;
    metadata_json?: string;
  }>;
};

type GenerateQaPairsInput = {
  mode?: string;
  scope?: string;
  count?: number;
  overwrite?: boolean;
};

type GenerateSummaryInput = {
  scope?: string;
  mode?: string;
  chunk_id?: string;
  summary?: string;
};

type MetadataFieldRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

type DocumentMetadataContext = {
  document: {
    id: string;
    tenant_id: string;
    workspace_id: string;
    knowledge_base_id: string;
    title: string;
    created_by: string;
    created_at: Date;
    updated_at: Date;
  };
  knowledgeBase: {
    id: string;
    title: string;
  };
  fields: MetadataFieldRow[];
  values: Array<{ field_id: string; value: Prisma.JsonValue }>;
  creator: { display_name: string; email: string } | null;
  currentVersion: { source_type: string } | null;
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
  require_approval?: boolean;
  expires_at?: string | null;
  max_uses?: number | null;
};

type CreateShareLinkInput = {
  password?: string | null;
  require_login?: boolean;
  restrict_to_workspace_members?: boolean;
  expires_at?: string | null;
};

type UpdateWorkspaceMemberInput = {
  role?: string;
};

type UserSummary = {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
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
        ...(me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId }),
        user_id: me.user.id
      },
      orderBy: { created_at: "asc" }
    });
    const isAdminVisible = me.roles.includes("system_admin") || me.roles.includes("tenant_admin");
    const workspaces = await this.prisma.workspace.findMany({
      where: isAdminVisible
        ? {
            ...(me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId })
          }
        : {
            id: { in: memberships.map((membership) => membership.workspace_id) }
          },
      orderBy: { created_at: "asc" }
    });
    const roleByWorkspace = new Map(
      memberships.map((membership) => [membership.workspace_id, membership.role])
    );

    return workspaces.map((workspace) => ({
      ...toWorkspaceDto(workspace),
      role: roleByWorkspace.get(workspace.id) ?? null,
      admin_visible:
        roleByWorkspace.get(workspace.id) === undefined &&
        this.canAdminViewTenant(me, workspace.tenant_id),
      can_read_content: isWorkspaceContentReader(roleByWorkspace.get(workspace.id)),
      requires_takeover: false
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
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new ContentError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
    }
    const role = await this.permissions.resolveWorkspaceRole(me.user.id, workspace.id);
    if (!role && !this.canAdminViewTenant(me, workspace.tenant_id)) {
      throw new ContentError("FORBIDDEN", "You do not have access to this object.", 403);
    }

    return {
      ...toWorkspaceDto(workspace),
      role,
      admin_visible: !role && this.canAdminViewTenant(me, workspace.tenant_id),
      can_read_content: isWorkspaceContentReader(role),
      requires_takeover: false
    };
  }

  async updateWorkspace(
    sessionToken: string | null,
    workspaceId: string,
    input: UpdateWorkspaceInput
  ) {
    const me = await this.requireMe(sessionToken);
    const canManage = await this.permissions.canManage(me.user.id, "workspace", workspaceId);
    if (!canManage) {
      const existing = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!existing || !this.canAdminManageTenant(me, existing.tenant_id)) {
        throw new ContentError("FORBIDDEN", "You do not have access to this object.", 403);
      }
    }

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
        ...(me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId }),
        ...(workspaceId ? { workspace_id: workspaceId } : {})
      },
      orderBy: { created_at: "asc" }
    });

    const readable = [];
    for (const knowledgeBase of knowledgeBases) {
      const canRead = await this.permissions.canRead(
        me.user.id,
        "knowledge_base",
        knowledgeBase.id
      );
      const role = await this.permissions.resolveObjectRole(
        me.user.id,
        "knowledge_base",
        knowledgeBase.id
      );
      const adminVisible = !canRead && this.canAdminViewTenant(me, knowledgeBase.tenant_id);
      if (canRead || adminVisible) {
        readable.push({
          ...toKnowledgeBaseDto(knowledgeBase),
          role,
          admin_visible: adminVisible,
          can_read_content: canRead,
          requires_takeover: adminVisible
        });
      }
    }

    return readable;
  }

  async createKnowledgeBase(sessionToken: string | null, input: CreateKnowledgeBaseInput) {
    const me = await this.requireMe(sessionToken);
    const workspaceId = requireText(input.workspace_id, "workspace_id");
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new ContentError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
    }
    const canManageWorkspace = await this.permissions.canManage(
      me.user.id,
      "workspace",
      workspaceId
    );
    if (!canManageWorkspace && !this.canAdminManageTenant(me, workspace.tenant_id)) {
      throw new ContentError("FORBIDDEN", "You do not have access to this object.", 403);
    }

    const title = requireText(input.title, "title");
    const slug = normalizeSlug(input.slug || title);
    const visibility = normalizeVisibility(input.visibility ?? "private");
    const docForm =
      input.doc_form === undefined || input.doc_form === null
        ? "text_model"
        : normalizeCreateDocForm(input.doc_form);
    const processRuleMode = docForm === "hierarchical_model" ? "hierarchical" : "automatic";
    const processRule = defaultProcessRule(docForm);
    const parentMode = docForm === "hierarchical_model" ? "paragraph" : "paragraph";
    const mode = docForm === "text_model" ? "general" : "parent_child";
    const now = new Date();

    const knowledgeBase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeBase.create({
        data: {
          tenant_id: workspace.tenant_id,
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
          tenant_id: workspace.tenant_id,
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
          tenant_id: workspace.tenant_id,
          workspace_id: created.workspace_id,
          knowledge_base_id: created.id,
          mode,
          doc_form: docForm,
          process_rule_mode: processRuleMode,
          process_rule: processRule,
          parent_mode: parentMode,
          updated_by: me.user.id
        }
      });
      await this.writeAuditLog(tx, me, "knowledge_base.create", "knowledge_base", created.id);
      return created;
    });

    return {
      ...toKnowledgeBaseDto(knowledgeBase),
      role: "owner",
      admin_visible: false,
      can_read_content: true,
      requires_takeover: false
    };
  }

  async getKnowledgeBase(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (!knowledgeBase) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    const canRead = await this.permissions.canRead(me.user.id, "knowledge_base", knowledgeBase.id);
    const role = await this.permissions.resolveObjectRole(
      me.user.id,
      "knowledge_base",
      knowledgeBase.id
    );
    const adminVisible = !canRead && this.canAdminViewTenant(me, knowledgeBase.tenant_id);
    if (!canRead && !adminVisible) {
      throw new ContentError("FORBIDDEN", "You do not have access to this object.", 403);
    }

    return {
      ...toKnowledgeBaseDto(knowledgeBase),
      role,
      admin_visible: adminVisible,
      can_read_content: canRead,
      requires_takeover: adminVisible
    };
  }

  async updateKnowledgeBase(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: UpdateKnowledgeBaseInput
  ) {
    const me = await this.requireMe(sessionToken);
    const canManage = await this.permissions.canManage(
      me.user.id,
      "knowledge_base",
      knowledgeBaseId
    );
    if (!canManage) {
      const existing = await this.prisma.knowledgeBase.findUnique({
        where: { id: knowledgeBaseId }
      });
      if (!existing || !this.canAdminManageTenant(me, existing.tenant_id)) {
        throw new ContentError("FORBIDDEN", "You do not have access to this object.", 403);
      }
    }

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

  async listKnowledgeBaseMetadataFields(sessionToken: string | null, knowledgeBaseId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const fields = await this.prisma.knowledgeBaseMetadataField.findMany({
      where: { knowledge_base_id: knowledgeBase.id, status: "active" },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
    });
    return {
      built_in: BUILT_IN_DIFY_METADATA_FIELDS,
      custom: fields.map(toKnowledgeBaseMetadataFieldDto)
    };
  }

  async createKnowledgeBaseMetadataField(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: CreateKnowledgeBaseMetadataFieldInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.requireKnowledgeBase(knowledgeBaseId);
    const name = normalizeMetadataFieldName(input.name);
    const type = normalizeMetadataFieldType(input.type);
    const sortOrder = Number.isInteger(input.sort_order) ? Number(input.sort_order) : 0;
    const field = await this.prisma.knowledgeBaseMetadataField.create({
      data: {
        tenant_id: knowledgeBase.tenant_id,
        workspace_id: knowledgeBase.workspace_id,
        knowledge_base_id: knowledgeBase.id,
        name,
        type,
        status: "active",
        sort_order: sortOrder,
        created_by: me.user.id,
        updated_by: me.user.id
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "knowledge_base.metadata_field.create",
      "knowledge_base",
      knowledgeBase.id,
      { field_id: field.id, name: field.name, type: field.type }
    );
    return toKnowledgeBaseMetadataFieldDto(field);
  }

  async updateKnowledgeBaseMetadataField(
    sessionToken: string | null,
    knowledgeBaseId: string,
    fieldId: string,
    input: UpdateKnowledgeBaseMetadataFieldInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);
    const current = await this.prisma.knowledgeBaseMetadataField.findFirst({
      where: { id: fieldId, knowledge_base_id: knowledgeBaseId }
    });
    if (!current) {
      throw new ContentError("OBJECT_NOT_FOUND", "Metadata field was not found.", 404);
    }
    const field = await this.prisma.knowledgeBaseMetadataField.update({
      where: { id: fieldId },
      data: {
        ...(input.name !== undefined ? { name: normalizeMetadataFieldName(input.name) } : {}),
        ...(input.type !== undefined ? { type: normalizeMetadataFieldType(input.type) } : {}),
        ...(input.status !== undefined
          ? { status: normalizeMetadataFieldStatus(input.status) }
          : {}),
        ...(input.sort_order !== undefined && Number.isInteger(input.sort_order)
          ? { sort_order: Number(input.sort_order) }
          : {}),
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "knowledge_base.metadata_field.update",
      "knowledge_base",
      knowledgeBaseId,
      { field_id: field.id, name: field.name, type: field.type, status: field.status }
    );
    return toKnowledgeBaseMetadataFieldDto(field);
  }

  async deleteKnowledgeBaseMetadataField(
    sessionToken: string | null,
    knowledgeBaseId: string,
    fieldId: string
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "knowledge_base", knowledgeBaseId);
    const current = await this.prisma.knowledgeBaseMetadataField.findFirst({
      where: { id: fieldId, knowledge_base_id: knowledgeBaseId }
    });
    if (!current) {
      throw new ContentError("OBJECT_NOT_FOUND", "Metadata field was not found.", 404);
    }
    const field = await this.prisma.knowledgeBaseMetadataField.update({
      where: { id: fieldId },
      data: { status: "archived", updated_by: me.user.id, updated_at: new Date() }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "knowledge_base.metadata_field.archive",
      "knowledge_base",
      knowledgeBaseId,
      { field_id: field.id, name: field.name }
    );
    return toKnowledgeBaseMetadataFieldDto(field);
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
        select: {
          current_version_id: true,
          processing_status: true,
          status: true,
          updated_at: true
        }
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
    const [chunksByType, staleChunkCount, currentChunkVersions, latestPublishedSearchableChunk] =
      await Promise.all([
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
        this.prisma.documentChunk.findMany({
          where: { knowledge_base_id: knowledgeBaseId, version_id: { in: currentVersionIds } },
          distinct: ["version_id"],
          select: { version_id: true }
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
    const chunkedVersionIds = new Set(currentChunkVersions.map((chunk) => chunk.version_id));
    const missingCurrentChunkCount = currentVersionIds.filter(
      (id) => !chunkedVersionIds.has(id)
    ).length;
    const needsReprocessCount = currentDocuments.filter(
      (document) => document.processing_status !== "current"
    ).length;

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
      needs_chunk_rebuild:
        staleChunkCount > 0 || missingCurrentChunkCount > 0 || needsReprocessCount > 0,
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
    const candidate = syncChunkSettingsProcessRule({ ...current, ...patch }, input);
    patch.process_rule = candidate.process_rule as Prisma.InputJsonValue;
    validateChunkSettingsCandidate(candidate);
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.knowledgeBaseChunkSetting.update({
        where: { knowledge_base_id: knowledgeBaseId },
        data: {
          ...patch,
          revision: current.revision + 1,
          updated_by: me.user.id,
          updated_at: new Date()
        }
      });
      await tx.document.updateMany({
        where: { knowledge_base_id: knowledgeBaseId, type: "page", status: { not: "deleted" } },
        data: {
          doc_form: next.doc_form,
          processing_status: "needs_reprocess",
          processing_revision: { increment: 1 }
        }
      });
      return next;
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
    const candidate = syncChunkSettingsProcessRule({ ...current, ...patch }, input);
    validateChunkSettingsCandidate(candidate);
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
      ...toMarkdownChunkingSettings({ ...candidate, revision: current.revision }),
      settings_revision: current.revision
    }).slice(0, 80);
    return { chunks: chunks.map(toPreviewChunkDto), total: chunks.length };
  }

  async listKnowledgeBaseChunks(
    sessionToken: string | null,
    knowledgeBaseId: string,
    input: {
      document_id?: string;
      type?: string;
      limit?: string | number | undefined;
      status?: string;
    }
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "knowledge_base", knowledgeBaseId);
    const type = normalizeOptionalChunkType(input.type);
    const statusFilter = normalizeOptionalSegmentStatusFilter(input.status);
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
        ...(type ? { chunk_type: type } : {}),
        ...toChunkStatusWhere(statusFilter)
      },
      orderBy: [{ document_id: "asc" }, { ordinal: "asc" }],
      take: limit
    });
    return chunks.map(toDocumentChunkDto);
  }

  async updateDocumentSegment(
    sessionToken: string | null,
    documentId: string,
    chunkId: string,
    input: UpdateSegmentInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const chunk = await this.prisma.documentChunk.findUnique({ where: { id: chunkId } });
    if (!chunk || chunk.document_id !== documentId) {
      throw new ContentError("OBJECT_NOT_FOUND", "Segment was not found.", 404);
    }
    const status = normalizeOptionalSegmentStatus(input.status) ?? chunk.status;
    const resetOverride = input.reset_override === true;
    const now = new Date();
    const overrideText = resetOverride
      ? null
      : input.override_content_text === undefined
        ? chunk.override_content_text
        : emptyToNull(input.override_content_text);
    const overrideMarkdown = resetOverride
      ? null
      : input.override_content_markdown === undefined
        ? chunk.override_content_markdown
        : emptyToNull(input.override_content_markdown);
    const hasOverride = Boolean(overrideText || overrideMarkdown);
    const updated = await this.prisma.documentChunk.update({
      where: { id: chunk.id },
      data: {
        status,
        override_content_text: overrideText,
        override_content_markdown: overrideMarkdown,
        overridden_by: hasOverride ? me.user.id : null,
        overridden_at: hasOverride ? now : null,
        disabled_at: status === "disabled" || status === "deleted" ? now : null,
        metadata: {
          ...(toRecord(chunk.metadata) as Record<string, unknown>),
          segment_status: status,
          has_override: hasOverride
        }
      }
    });
    await this.writeAuditLog(this.prisma, me, "document.segment.update", "document", documentId, {
      chunk_id: chunk.id,
      previous_status: chunk.status,
      status,
      has_override: hasOverride,
      reset_override: resetOverride
    });
    return toSegmentUpdateDto(updated);
  }

  async getDocumentProcessing(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const settings = await this.prisma.knowledgeBaseChunkSetting.findUnique({
      where: { knowledge_base_id: document.knowledge_base_id }
    });
    return {
      document_id: document.id,
      knowledge_base_id: document.knowledge_base_id,
      doc_form: document.doc_form ?? settings?.doc_form ?? "hierarchical_model",
      parent_mode:
        getDocumentProcessingOverride(document.process_rule_snapshot)?.parent_mode ??
        settings?.parent_mode ??
        "paragraph",
      process_rule_snapshot: document.process_rule_snapshot,
      processing_status: document.processing_status,
      processing_revision: document.processing_revision,
      doc_language: document.doc_language,
      need_summary: document.need_summary,
      knowledge_base_settings: settings ? toChunkSettingsDto(settings) : null
    };
  }

  async updateDocumentProcessing(
    sessionToken: string | null,
    documentId: string,
    input: UpdateDocumentProcessingInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.type !== "page") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const knowledgeBase = await this.requireKnowledgeBase(document.knowledge_base_id);
    const settings = await this.getOrCreateChunkSettings(this.prisma, me, knowledgeBase);
    const currentVersion = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    const currentOverride = getDocumentProcessingOverride(document.process_rule_snapshot);
    const nextParentMode =
      input.parent_mode === undefined
        ? (currentOverride?.parent_mode ?? settings.parent_mode)
        : normalizeParentMode(input.parent_mode);
    const snapshot = buildDocumentProcessingSnapshot(
      settings,
      {
        parent_mode: nextParentMode,
        process_rule: input.process_rule ?? currentOverride?.process_rule
      },
      {
        content_version_id: currentVersion?.id ?? document.current_version_id,
        content_markdown_hash: currentVersion?.markdown_hash ?? null
      }
    );
    const updated = await this.prisma.document.update({
      where: { id: document.id },
      data: {
        doc_form: settings.doc_form,
        process_rule_snapshot: snapshot,
        processing_status: "needs_reprocess",
        processing_revision: document.processing_revision + 1,
        doc_language:
          input.doc_language === undefined
            ? document.doc_language
            : emptyToNull(input.doc_language),
        need_summary:
          typeof input.need_summary === "boolean" ? input.need_summary : document.need_summary,
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAuditLog(
      this.prisma,
      me,
      "document.processing.update",
      "document",
      document.id,
      { processing_revision: updated.processing_revision }
    );
    return this.getDocumentProcessing(sessionToken, document.id);
  }

  async reprocessDocument(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document?.current_version_id || document.type !== "page") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: document.current_version_id }
    });
    if (!version) {
      throw new ContentError("OBJECT_NOT_FOUND", "Current document version was not found.", 404);
    }
    await this.prisma.$transaction(async (tx) => {
      const result = await this.replaceChunksForDocumentVersion(
        tx,
        me,
        document.id,
        version.id,
        version.markdown,
        new Date()
      );
      await this.writeAuditLog(tx, me, "document.processing.reprocess", "document", document.id, {
        version_id: version.id,
        markdown_hash: version.markdown_hash,
        qa_pairs_skipped: result.qaPairsSkipped
      });
    });
    return this.getDocument(sessionToken, document.id);
  }

  async listQaPairs(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const pairs = await this.prisma.documentQaPair.findMany({
      where: { document_id: documentId, status: { not: "deleted" } },
      orderBy: { created_at: "asc" }
    });
    return pairs.map(toQaPairDto);
  }

  async createQaPair(sessionToken: string | null, documentId: string, input: CreateQaPairInput) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const sourceChunkId = await this.resolveOptionalSourceChunkId(
      document.id,
      input.source_chunk_id
    );
    const pair = await this.prisma.documentQaPair.create({
      data: {
        tenant_id: document.tenant_id,
        workspace_id: document.workspace_id,
        knowledge_base_id: document.knowledge_base_id,
        document_id: document.id,
        question: requireText(input.question, "question"),
        answer: requireText(input.answer, "answer"),
        source_chunk_id: sourceChunkId,
        source: normalizeQaSource(input.source),
        status: "active",
        metadata: normalizeQaMetadata(input.metadata),
        created_by: me.user.id
      }
    });
    await this.prisma.document.update({
      where: { id: document.id },
      data: { processing_status: "needs_reprocess", updated_at: new Date() }
    });
    await this.writeAuditLog(this.prisma, me, "document.qa_pair.create", "document", document.id, {
      qa_pair_id: pair.id
    });
    return toQaPairDto(pair);
  }

  async updateQaPair(
    sessionToken: string | null,
    documentId: string,
    qaPairId: string,
    input: UpdateQaPairInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const existing = await this.prisma.documentQaPair.findUnique({ where: { id: qaPairId } });
    if (!existing || existing.document_id !== document.id) {
      throw new ContentError("OBJECT_NOT_FOUND", "QA pair was not found.", 404);
    }
    const sourceChunkId =
      input.source_chunk_id === undefined
        ? existing.source_chunk_id
        : await this.resolveOptionalSourceChunkId(document.id, input.source_chunk_id);
    const pair = await this.prisma.documentQaPair.update({
      where: { id: qaPairId },
      data: {
        ...(input.question !== undefined
          ? { question: requireText(input.question, "question") }
          : {}),
        ...(input.answer !== undefined ? { answer: requireText(input.answer, "answer") } : {}),
        ...(input.status !== undefined ? { status: normalizeSegmentStatus(input.status) } : {}),
        ...(input.metadata !== undefined ? { metadata: normalizeQaMetadata(input.metadata) } : {}),
        source_chunk_id: sourceChunkId,
        updated_at: new Date()
      }
    });
    await this.prisma.document.update({
      where: { id: document.id },
      data: { processing_status: "needs_reprocess", updated_at: new Date() }
    });
    await this.writeAuditLog(this.prisma, me, "document.qa_pair.update", "document", document.id, {
      qa_pair_id: pair.id,
      status: pair.status
    });
    return toQaPairDto(pair);
  }

  async importQaPairs(sessionToken: string | null, documentId: string, input: ImportQaPairsInput) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const rows = normalizeQaImportRows(input);
    const items = [];
    const errors: Array<{ row: number; error: string }> = [];
    let skipped = 0;
    for (const [index, row] of rows.entries()) {
      try {
        const question = requireText(row.question, "question");
        const answer = requireText(row.answer, "answer");
        const sourceChunkId = await this.resolveOptionalSourceChunkId(
          document.id,
          row.source_chunk_id
        );
        const item = await this.prisma.documentQaPair.create({
          data: {
            tenant_id: document.tenant_id,
            workspace_id: document.workspace_id,
            knowledge_base_id: document.knowledge_base_id,
            document_id: document.id,
            question,
            answer,
            source_chunk_id: sourceChunkId,
            source: "csv",
            status: "active",
            metadata: normalizeQaMetadata(row.metadata),
            created_by: me.user.id
          }
        });
        items.push(toQaPairDto(item));
      } catch (error) {
        skipped += 1;
        errors.push({
          row: index + 1,
          error: error instanceof Error ? error.message : "Invalid QA row."
        });
      }
    }
    if (items.length > 0) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: { processing_status: "needs_reprocess", updated_at: new Date() }
      });
    }
    await this.writeAuditLog(this.prisma, me, "document.qa_pair.import", "document", document.id, {
      created: items.length,
      skipped
    });
    return { created: items.length, skipped, errors, items };
  }

  async generateQaPairs(
    sessionToken: string | null,
    documentId: string,
    input: GenerateQaPairsInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const mode = normalizeGenerationMode(input.mode);
    const scope = input.scope === "segments" ? "segments" : "document";
    const count = normalizeGenerationCount(input.count, 5, 20);
    if (!document.current_version_id) {
      throw new ContentError(
        "REPROCESS_REQUIRED",
        "Reprocess the document before generating QA pairs.",
        409
      );
    }
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document_id: document.id,
        version_id: document.current_version_id,
        status: "active",
        index_role: "content",
        chunk_type: { in: ["general", "child"] }
      },
      orderBy: { ordinal: "asc" },
      take: Math.max(count, 1)
    });
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    if (chunks.length === 0) {
      throw new ContentError(
        "REPROCESS_REQUIRED",
        "Reprocess the document before generating QA pairs.",
        409
      );
    }
    const warnings: string[] = [];
    let generatedRows: Array<{
      question: string;
      answer: string;
      source_chunk_id?: string | null;
    }>;
    if (mode === "llm") {
      const prompt = buildQaGenerationPrompt(
        document.title,
        version?.markdown ?? "",
        chunks,
        count
      );
      const text = await this.generateLanguageTextOrThrow(prompt);
      generatedRows = parseGeneratedQaPairs(text, chunks, count);
      if (generatedRows.length === 0) {
        warnings.push("LLM response did not contain valid QA pairs; deterministic mock was used.");
        generatedRows = generateMockQaPairs(
          document.title,
          version?.markdown ?? "",
          chunks,
          count,
          scope
        );
      }
    } else {
      generatedRows = generateMockQaPairs(
        document.title,
        version?.markdown ?? "",
        chunks,
        count,
        scope
      );
    }
    if (input.overwrite === true) {
      await this.prisma.documentQaPair.updateMany({
        where: { document_id: document.id, source: { in: ["llm", "mock"] }, status: "active" },
        data: { status: "deleted", updated_at: new Date() }
      });
    }
    const items = [];
    for (const row of generatedRows.slice(0, count)) {
      const item = await this.prisma.documentQaPair.create({
        data: {
          tenant_id: document.tenant_id,
          workspace_id: document.workspace_id,
          knowledge_base_id: document.knowledge_base_id,
          document_id: document.id,
          question: row.question,
          answer: row.answer,
          source_chunk_id: row.source_chunk_id ?? null,
          source: mode,
          status: "active",
          metadata: { generated_mode: mode, generation_scope: scope },
          created_by: me.user.id
        }
      });
      items.push(toQaPairDto(item));
    }
    if (items.length > 0) {
      await this.prisma.document.update({
        where: { id: document.id },
        data: { processing_status: "needs_reprocess", updated_at: new Date() }
      });
    }
    await this.writeAuditLog(
      this.prisma,
      me,
      "document.qa_pair.generate",
      "document",
      document.id,
      {
        mode,
        scope,
        created: items.length,
        overwrite: input.overwrite === true
      }
    );
    return { created: items.length, skipped: 0, items, warnings };
  }

  async listDocumentSummaries(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const [documentSummary, segmentSummaries] = await Promise.all([
      this.prisma.documentSummary.findUnique({ where: { document_id: document.id } }),
      this.prisma.documentSegmentSummary.findMany({
        where: { document_id: document.id, status: { not: "deleted" } },
        orderBy: { updated_at: "desc" }
      })
    ]);
    return {
      document_summary: documentSummary ? toDocumentSummaryDto(documentSummary) : null,
      segment_summaries: segmentSummaries.map(toSegmentSummaryDto)
    };
  }

  async generateSegmentSummary(
    sessionToken: string | null,
    documentId: string,
    input: GenerateSummaryInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.requirePageDocument(documentId);
    const mode = normalizeSummaryMode(input.mode, input.summary);
    const scope = normalizeSummaryScope(input.scope, input.chunk_id);
    const chunkId =
      typeof input.chunk_id === "string" && input.chunk_id.trim() ? input.chunk_id : null;
    if (scope === "segment" && !chunkId) {
      throw new ContentError(
        "INVALID_INPUT",
        "chunk_id is required when summary scope is segment.",
        400
      );
    }
    if (scope !== "segment" && chunkId) {
      throw new ContentError(
        "INVALID_INPUT",
        "chunk_id can only be used when summary scope is segment.",
        400
      );
    }
    if (!document.current_version_id) {
      throw new ContentError(
        "REPROCESS_REQUIRED",
        "Reprocess the document before generating summaries.",
        409
      );
    }
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document_id: document.id,
        version_id: document.current_version_id,
        status: "active",
        index_role: "content",
        chunk_type: { in: ["general", "child"] },
        ...(chunkId ? { id: chunkId } : {})
      },
      orderBy: { ordinal: "asc" }
    });
    if (scope === "segment" && chunks.length === 0) {
      throw new ContentError("OBJECT_NOT_FOUND", "Segment was not found.", 404);
    }
    if (chunks.length === 0) {
      throw new ContentError(
        "REPROCESS_REQUIRED",
        "Reprocess the document before generating summaries.",
        409
      );
    }
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    if (scope === "document") {
      const sourceChunk = chunks[0] ?? null;
      const summary = await this.resolveSummaryText({
        mode,
        manualSummary: input.summary,
        title: document.title,
        content: version?.markdown ?? sourceChunk?.content_text ?? "",
        scope: "document"
      });
      const row = await this.upsertDocumentSummary(me, document, summary, mode, sourceChunk?.id);
      await this.writeAuditLog(
        this.prisma,
        me,
        "document.summary.generate",
        "document",
        document.id,
        {
          scope,
          mode,
          summary_id: row.id
        }
      );
      return {
        ...toDocumentSummaryDto(row),
        needs_index_rebuild: true,
        needs_chunk_rebuild: false,
        rebuild_hint:
          "Summary updated in PostgreSQL. Rebuild the Milvus index before search, MCP, or Dify use it."
      };
    }

    const targetChunks = scope === "all_segments" ? chunks : chunks.slice(0, 1);
    const summaries = [];
    for (const chunk of targetChunks) {
      const summary = await this.resolveSummaryText({
        mode,
        manualSummary: input.summary,
        title: document.title,
        content: chunk.override_content_text ?? chunk.content_text,
        scope: "segment"
      });
      summaries.push(await this.upsertSegmentSummary(me, document, chunk, summary, mode));
    }
    await this.writeAuditLog(
      this.prisma,
      me,
      "document.summary.generate",
      "document",
      document.id,
      {
        scope,
        mode,
        chunk_id: chunkId,
        count: summaries.length
      }
    );
    return {
      document_summary: null,
      segment_summaries: summaries.map(toSegmentSummaryDto),
      needs_index_rebuild: true,
      needs_chunk_rebuild: false,
      rebuild_hint:
        "Summary updated in PostgreSQL. Rebuild the Milvus index before search, MCP, or Dify use it."
    };
  }

  private async resolveOptionalSourceChunkId(
    documentId: string,
    value: string | null | undefined
  ): Promise<string | null> {
    if (value === undefined || value === null || !String(value).trim()) {
      return null;
    }
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { current_version_id: true }
    });
    const chunk = await this.prisma.documentChunk.findUnique({ where: { id: String(value) } });
    if (
      !chunk ||
      !document?.current_version_id ||
      chunk.document_id !== documentId ||
      chunk.version_id !== document.current_version_id ||
      chunk.status !== "active" ||
      chunk.index_role !== "content"
    ) {
      throw new ContentError("OBJECT_NOT_FOUND", "Source segment was not found.", 404);
    }
    return chunk.id;
  }

  private async generateLanguageTextOrThrow(prompt: string): Promise<string> {
    const settings = await this.prisma.modelSetting.findMany();
    const client = createOpenKBModelClient(
      getOpenKBModelClientConfig(process.env, settings.map(toStoredModelSetting))
    );
    try {
      return await client.generateLanguageText(prompt);
    } catch (error) {
      if (error instanceof ModelClientError) {
        throw new ContentError(error.code, error.message, error.statusCode);
      }
      throw error;
    }
  }

  private async resolveSummaryText(input: {
    mode: "manual" | "llm" | "mock";
    manualSummary?: string;
    title: string;
    content: string;
    scope: "document" | "segment";
  }): Promise<string> {
    if (input.mode === "manual") {
      return requireText(input.manualSummary, "summary");
    }
    if (input.mode === "llm") {
      const generated = await this.generateLanguageTextOrThrow(
        buildSummaryGenerationPrompt(input.title, input.content, input.scope)
      );
      return normalizeGeneratedText(generated, "summary");
    }
    return summarizeText(input.content || input.title);
  }

  private async upsertDocumentSummary(
    me: AuthenticatedUser,
    document: Awaited<ReturnType<ContentService["requirePageDocument"]>>,
    summary: string,
    mode: "manual" | "llm" | "mock",
    sourceChunkId?: string | null
  ) {
    const row = await this.prisma.documentSummary.upsert({
      where: { document_id: document.id },
      create: {
        tenant_id: document.tenant_id,
        workspace_id: document.workspace_id,
        knowledge_base_id: document.knowledge_base_id,
        document_id: document.id,
        summary,
        status: "active",
        metadata: { generated_mode: mode },
        created_by: me.user.id
      },
      update: {
        summary,
        status: "active",
        metadata: { generated_mode: mode },
        updated_at: new Date()
      }
    });
    await this.replaceSummaryIndexChunk({
      document,
      summary,
      summaryId: row.id,
      summaryScope: "document",
      sourceChunkId: sourceChunkId ?? null
    });
    return row;
  }

  private async upsertSegmentSummary(
    me: AuthenticatedUser,
    document: Awaited<ReturnType<ContentService["requirePageDocument"]>>,
    chunk: Awaited<ReturnType<PrismaClient["documentChunk"]["findFirst"]>> & { id: string },
    summary: string,
    mode: "manual" | "llm" | "mock"
  ) {
    const row = await this.prisma.documentSegmentSummary.upsert({
      where: { chunk_id: chunk.id },
      create: {
        tenant_id: document.tenant_id,
        workspace_id: document.workspace_id,
        knowledge_base_id: document.knowledge_base_id,
        document_id: document.id,
        chunk_id: chunk.id,
        summary,
        status: "active",
        metadata: { generated_mode: mode },
        created_by: me.user.id
      },
      update: {
        summary,
        status: "active",
        metadata: { generated_mode: mode },
        updated_at: new Date()
      }
    });
    await this.replaceSummaryIndexChunk({
      document,
      summary,
      summaryId: row.id,
      summaryScope: "segment",
      sourceChunkId: chunk.id,
      sourceChunk: chunk
    });
    return row;
  }

  private async replaceSummaryIndexChunk(input: {
    document: Awaited<ReturnType<ContentService["requirePageDocument"]>>;
    summary: string;
    summaryId: string;
    summaryScope: "document" | "segment";
    sourceChunkId: string | null;
    sourceChunk?: {
      settings_revision: number;
      heading_path: string[];
      start_line: number | null;
      end_line: number | null;
      start_char: number | null;
      end_char: number | null;
    } | null;
  }): Promise<void> {
    if (!input.document.current_version_id) {
      return;
    }
    await this.prisma.documentChunk.deleteMany({
      where: {
        document_id: input.document.id,
        index_role: "summary",
        ...(input.summaryScope === "segment"
          ? { source_chunk_id: input.sourceChunkId }
          : { source_chunk_id: null })
      }
    });
    const latest = await this.prisma.documentChunk.findFirst({
      where: { version_id: input.document.current_version_id },
      orderBy: { ordinal: "desc" }
    });
    await this.prisma.documentChunk.create({
      data: {
        tenant_id: input.document.tenant_id,
        workspace_id: input.document.workspace_id,
        knowledge_base_id: input.document.knowledge_base_id,
        document_id: input.document.id,
        version_id: input.document.current_version_id,
        ordinal: (latest?.ordinal ?? -1) + 1,
        chunk_type: "general",
        parent_chunk_id: null,
        settings_revision: input.sourceChunk?.settings_revision ?? 1,
        start_line: input.sourceChunk?.start_line ?? null,
        end_line: input.sourceChunk?.end_line ?? null,
        start_char: input.sourceChunk?.start_char ?? null,
        end_char: input.sourceChunk?.end_char ?? null,
        parent_ordinal: null,
        child_ordinal: null,
        heading_path: input.sourceChunk?.heading_path ?? [],
        content_text: input.summary,
        content_markdown: input.summary,
        token_count: estimateTextTokens(input.summary),
        index_role: "summary",
        source_chunk_id: input.summaryScope === "segment" ? input.sourceChunkId : null,
        status: "active",
        metadata: {
          hit_type: "summary",
          summary_hit: true,
          summary_id: input.summaryId,
          summary_scope: input.summaryScope,
          summary_text: input.summary,
          original_chunk_id: input.sourceChunkId,
          doc_form: input.document.doc_form,
          index_role: "summary"
        }
      }
    });
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
      currentVersion: version ? toDocumentVersionDto(version, true) : null,
      role: await this.permissions.resolveObjectRole(me.user.id, "document", document.id)
    };
  }

  async getDocumentMetadata(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const context = await this.loadDocumentMetadataContext(documentId);
    if (!context) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    return toDocumentMetadataDto(context);
  }

  async updateDocumentMetadata(
    sessionToken: string | null,
    documentId: string,
    input: UpdateDocumentMetadataInput
  ) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const context = await this.loadDocumentMetadataContext(documentId);
    if (!context) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const rawValues =
      typeof input.values === "object" && input.values !== null && !Array.isArray(input.values)
        ? input.values
        : {};
    const customFields = context.fields.filter((field) => field.status === "active");
    await this.prisma.$transaction(async (tx) => {
      for (const field of customFields) {
        if (!Object.prototype.hasOwnProperty.call(rawValues, field.name)) {
          continue;
        }
        const rawValue = rawValues[field.name];
        if (rawValue === null || rawValue === undefined || rawValue === "") {
          await tx.documentMetadataValue.deleteMany({
            where: { document_id: context.document.id, field_id: field.id }
          });
          continue;
        }
        const value = normalizeMetadataValue(rawValue, field.type, field.name);
        await tx.documentMetadataValue.upsert({
          where: {
            document_id_field_id: {
              document_id: context.document.id,
              field_id: field.id
            }
          },
          create: {
            tenant_id: context.document.tenant_id,
            workspace_id: context.document.workspace_id,
            knowledge_base_id: context.document.knowledge_base_id,
            document_id: context.document.id,
            field_id: field.id,
            value: value as Prisma.InputJsonValue,
            updated_by: me.user.id
          },
          update: {
            value: value as Prisma.InputJsonValue,
            updated_by: me.user.id,
            updated_at: new Date()
          }
        });
      }
      await this.writeAuditLog(
        tx,
        me,
        "document.metadata.update",
        "document",
        context.document.id,
        {
          field_names: Object.keys(rawValues).filter((name) =>
            customFields.some((field) => field.name === name)
          )
        }
      );
    });
    const updated = await this.loadDocumentMetadataContext(documentId);
    if (!updated) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    return toDocumentMetadataDto(updated);
  }

  async listDocumentVersions(sessionToken: string | null, documentId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }

    const versions = await this.prisma.documentVersion.findMany({
      where: { document_id: documentId },
      orderBy: { version_no: "desc" }
    });
    return versions.map((version) =>
      toDocumentVersionSummaryDto(version, version.id === document.current_version_id)
    );
  }

  async getDocumentVersion(sessionToken: string | null, documentId: string, versionId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanRead(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const version = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, document_id: documentId }
    });
    if (!version) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document version was not found.", 404);
    }
    return toDocumentVersionDto(version, version.id === document.current_version_id);
  }

  async restoreDocumentVersion(sessionToken: string | null, documentId: string, versionId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanEdit(me.user.id, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    if (document.type !== "page") {
      throw new ContentError("INVALID_INPUT", "Only page documents can restore versions.", 400);
    }
    const sourceVersion = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, document_id: documentId }
    });
    if (!sourceVersion) {
      throw new ContentError("OBJECT_NOT_FOUND", "Document version was not found.", 404);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.documentVersion.findFirst({
        where: { document_id: documentId },
        orderBy: { version_no: "desc" }
      });
      const restored = await tx.documentVersion.create({
        data: {
          tenant_id: document.tenant_id,
          document_id: documentId,
          version_no: latest ? latest.version_no + 1 : 1,
          markdown: sourceVersion.markdown,
          markdown_hash: sourceVersion.markdown_hash,
          source_type: "manual",
          source_file_id: sourceVersion.source_file_id,
          created_by: me.user.id,
          created_at: now
        }
      });
      const knowledgeBase = await tx.knowledgeBase.findUnique({
        where: { id: document.knowledge_base_id }
      });
      if (!knowledgeBase) {
        throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
      }
      const settings = await this.getOrCreateChunkSettings(tx, me, knowledgeBase);
      await tx.document.update({
        where: { id: documentId },
        data: {
          current_version_id: restored.id,
          doc_form: settings.doc_form,
          process_rule_snapshot: buildDocumentProcessingSnapshot(
            settings,
            getDocumentProcessingOverride(document.process_rule_snapshot),
            {
              content_version_id: restored.id,
              content_markdown_hash: restored.markdown_hash
            }
          ),
          processing_status: "needs_reprocess",
          processing_revision: { increment: 1 },
          updated_by: me.user.id,
          updated_at: now
        }
      });
      await this.writeAuditLog(tx, me, "document.version.restore", "document", documentId, {
        restored_from_version_id: sourceVersion.id,
        new_version_id: restored.id
      });
    });

    return this.getDocument(sessionToken, documentId);
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
        current_version: currentVersion ? toDocumentVersionDto(currentVersion, true) : null,
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
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: document.current_version_id }
    });
    if (!version) {
      throw new ContentError("OBJECT_NOT_FOUND", "Current document version was not found.", 404);
    }
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: "published",
          updated_by: me.user.id,
          updated_at: now
        }
      });
      const shouldReprocess = await this.shouldReprocessDocumentOnPublish(
        tx,
        me,
        document,
        version
      );
      const result = shouldReprocess
        ? await this.replaceChunksForDocumentVersion(
            tx,
            me,
            document.id,
            version.id,
            version.markdown,
            now
          )
        : { qaPairsSkipped: 0 };
      await this.writeAuditLog(tx, me, "document.publish", "document", documentId, {
        reprocessed: shouldReprocess,
        ...(shouldReprocess
          ? {
              reprocessed_version_id: version.id,
              markdown_hash: version.markdown_hash,
              qa_pairs_skipped: result.qaPairsSkipped
            }
          : {})
      });
    });
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

  async listWorkspaceMembers(sessionToken: string | null, workspaceId: string) {
    const me = await this.requireMe(sessionToken);
    await this.permissions.requireCanManage(me.user.id, "workspace", workspaceId);
    await this.assertObjectExists("workspace", workspaceId);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: "asc" }
    });
    const userMap = await this.loadUsersById(members.map((member) => member.user_id));

    return members.map((member) =>
      toWorkspaceMemberDto(member, userMap.get(member.user_id) ?? null)
    );
  }

  async updateWorkspaceMember(
    sessionToken: string | null,
    memberId: string,
    input: UpdateWorkspaceMemberInput
  ) {
    const me = await this.requireMe(sessionToken);
    const member = await this.getWorkspaceMemberOrThrow(memberId);
    await this.permissions.requireCanManage(me.user.id, "workspace", member.workspace_id);

    if (member.role === "owner") {
      throw new ContentError("INVALID_INPUT", "Owner transfer is not part of this phase.", 400);
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        role: normalizeGrantableWorkspaceRole(input.role)
      }
    });
    const userMap = await this.loadUsersById([updated.user_id]);
    await this.writeAuditLog(
      this.prisma,
      me,
      "workspace_member.update",
      "workspace_member",
      updated.id
    );
    return toWorkspaceMemberDto(updated, userMap.get(updated.user_id) ?? null);
  }

  async deleteWorkspaceMember(sessionToken: string | null, memberId: string) {
    const me = await this.requireMe(sessionToken);
    const member = await this.getWorkspaceMemberOrThrow(memberId);
    await this.permissions.requireCanManage(me.user.id, "workspace", member.workspace_id);

    if (member.role === "owner") {
      throw new ContentError("INVALID_INPUT", "Owner transfer is not part of this phase.", 400);
    }
    if (member.user_id === me.user.id) {
      throw new ContentError("INVALID_INPUT", "Managers cannot remove themselves.", 400);
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
    await this.writeAuditLog(
      this.prisma,
      me,
      "workspace_member.delete",
      "workspace_member",
      memberId
    );
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

    const userMap = await this.loadUsersById(
      collaborators
        .filter((collaborator) => collaborator.subject_type === "user")
        .map((collaborator) => collaborator.subject_id)
    );

    return collaborators.map((collaborator) =>
      toCollaboratorDto(collaborator, userMap.get(collaborator.subject_id) ?? null)
    );
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
    const user =
      collaborator.subject_type === "user"
        ? await this.prisma.user.findUnique({
            where: { id: collaborator.subject_id },
            select: { id: true, email: true, display_name: true, status: true }
          })
        : null;
    return toCollaboratorDto(collaborator, user);
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
    const user =
      collaborator.subject_type === "user"
        ? await this.prisma.user.findUnique({
            where: { id: collaborator.subject_id },
            select: { id: true, email: true, display_name: true, status: true }
          })
        : null;
    return toCollaboratorDto(collaborator, user);
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
        require_approval: Boolean(input.require_approval),
        invited_by: me.user.id,
        expires_at: input.expires_at ? new Date(input.expires_at) : null,
        max_uses: Number.isInteger(input.max_uses) ? Number(input.max_uses) : null,
        created_at: now
      }
    });
    if (invitation.email) {
      await this.prisma.authEmailOutbox.create({
        data: {
          tenant_id: invitation.tenant_id,
          to_email: invitation.email,
          template: "email_verification",
          subject: "You have been invited to OpenKB",
          link_url: buildWebUrl(`/invite/${rawToken}`),
          payload: {
            kind: "invitation",
            object_type: invitation.object_type,
            object_id: invitation.object_id,
            role: invitation.role,
            require_approval: invitation.require_approval
          },
          status: "pending",
          created_at: now
        }
      });
    }
    await this.writeAuditLog(this.prisma, me, "invitation.create", "invitation", invitation.id);

    return {
      ...toInvitationDto(invitation),
      token: rawToken
    };
  }

  async listInvitations(sessionToken: string | null, objectTypeInput: string, objectId: string) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireObjectType(objectTypeInput);
    await this.permissions.requireCanManage(me.user.id, objectType, objectId);

    const invitations = await this.prisma.invitation.findMany({
      where: {
        object_type: objectType,
        object_id: objectId
      },
      orderBy: { created_at: "desc" }
    });

    return invitations.map(toInvitationDto);
  }

  async getInvitationByToken(rawToken: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { token_hash: hashToken(rawToken) }
    });
    if (!invitation || invitation.status === "revoked") {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation was not found.", 404);
    }
    if (invitation.expires_at && invitation.expires_at <= new Date()) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation has expired.", 404);
    }
    const object = await this.describeInvitationObject(
      invitation.object_type,
      invitation.object_id
    );
    return {
      invitation: toInvitationDto(invitation),
      object
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
      if (invitation.require_approval) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: {
            status: "awaiting_approval",
            invited_user_id: me.user.id,
            used_count: { increment: 1 }
          }
        });
        await this.writeAuditLog(
          tx,
          me,
          "invitation.accept.awaiting_approval",
          "invitation",
          invitation.id
        );
        return;
      }

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

    return { ok: true, status: invitation.require_approval ? "awaiting_approval" : "accepted" };
  }

  async approveInvitation(sessionToken: string | null, invitationId: string) {
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
    if (invitation.status !== "awaiting_approval" || !invitation.invited_user_id) {
      throw new ContentError("INVALID_INPUT", "Invitation is not awaiting approval.", 400);
    }

    await this.prisma.$transaction(async (tx) => {
      if (invitation.object_type === "workspace") {
        await tx.workspaceMember.upsert({
          where: {
            workspace_id_user_id: {
              workspace_id: invitation.object_id,
              user_id: invitation.invited_user_id!
            }
          },
          create: {
            tenant_id: invitation.tenant_id,
            workspace_id: invitation.object_id,
            user_id: invitation.invited_user_id!,
            role: invitation.role,
            created_at: new Date()
          },
          update: { role: invitation.role }
        });
      } else {
        await tx.collaborator.upsert({
          where: {
            object_type_object_id_subject_type_subject_id: {
              object_type: invitation.object_type,
              object_id: invitation.object_id,
              subject_type: "user",
              subject_id: invitation.invited_user_id!
            }
          },
          create: {
            tenant_id: invitation.tenant_id,
            object_type: invitation.object_type,
            object_id: invitation.object_id,
            subject_type: "user",
            subject_id: invitation.invited_user_id!,
            role: invitation.role,
            source: "invitation",
            created_by: invitation.invited_by,
            created_at: new Date()
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
          approved_by: me.user.id
        }
      });
      await this.writeAuditLog(tx, me, "invitation.approve", "invitation", invitation.id);
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
    const objectType = this.permissions.requireObjectType(objectTypeInput);
    const canCreate =
      objectType === "workspace"
        ? await this.permissions.canManage(me.user.id, "workspace", objectId)
        : await this.permissions.canCreateShareLink(me.user.id, objectType, objectId);
    if (!canCreate) {
      throw new ContentError("INVALID_INPUT", "You cannot create a share link.", 403);
    }
    await this.assertObjectExists(objectType, objectId);

    const rawToken = createRawToken();
    const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
    const now = new Date();
    const shareLink = await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.updateMany({
        where: {
          object_type: objectType,
          object_id: objectId,
          revoked_at: null
        },
        data: { revoked_at: now }
      });
      return tx.shareLink.create({
        data: {
          tenant_id: me.tenantId,
          object_type: objectType,
          object_id: objectId,
          token_hash: hashToken(rawToken),
          permission: "view",
          password_hash: passwordHash,
          require_login: Boolean(input.require_login),
          restrict_to_workspace_members: Boolean(input.restrict_to_workspace_members),
          expires_at: input.expires_at ? new Date(input.expires_at) : null,
          created_by: me.user.id,
          created_at: now
        }
      });
    });
    await this.writeAuditLog(this.prisma, me, "share_link.create", "share_link", shareLink.id);
    return {
      ...toShareLinkDto(shareLink),
      token: rawToken,
      url: buildWebUrl(`/share/${rawToken}`)
    };
  }

  async listShareLinks(sessionToken: string | null, objectTypeInput: string, objectId: string) {
    const me = await this.requireMe(sessionToken);
    const objectType = this.permissions.requireObjectType(objectTypeInput);
    await this.permissions.requireCanManage(me.user.id, objectType, objectId);

    const shareLinks = await this.prisma.shareLink.findMany({
      where: {
        object_type: objectType,
        object_id: objectId
      },
      orderBy: { created_at: "desc" }
    });

    return shareLinks.map(toShareLinkDto);
  }

  async getShare(
    rawToken: string,
    sessionToken: string | null,
    cookieHeader?: string,
    documentId?: string
  ) {
    const shareLink = await this.prisma.shareLink.findFirst({
      where: {
        token_hash: hashToken(rawToken),
        revoked_at: null
      }
    });
    if (!shareLink || (shareLink.expires_at && shareLink.expires_at <= new Date())) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    if (shareLink.password_hash && !hasValidShareAccessCookie(cookieHeader, shareLink)) {
      throw new ContentError("SHARE_PASSWORD_REQUIRED", "Share password is required.", 403);
    }

    let me: AuthenticatedUser | null = null;
    if (shareLink.require_login || shareLink.restrict_to_workspace_members) {
      me = await this.requireMe(sessionToken);
    }

    const object = await this.resolveShareObject(
      shareLink.object_type as PermissionObjectType,
      shareLink.object_id,
      documentId
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

  async verifySharePassword(rawToken: string, password: string) {
    const shareLink = await this.prisma.shareLink.findFirst({
      where: {
        token_hash: hashToken(rawToken),
        revoked_at: null
      }
    });
    if (
      !shareLink ||
      (shareLink.expires_at && shareLink.expires_at <= new Date()) ||
      !shareLink.password_hash
    ) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    if (!(await bcrypt.compare(password ?? "", shareLink.password_hash))) {
      throw new ContentError("SHARE_PASSWORD_REQUIRED", "Share password is incorrect.", 403);
    }

    await this.prisma.auditLog.create({
      data: {
        tenant_id: shareLink.tenant_id,
        actor_user_id: null,
        actor_type: "system",
        action: "share_link.password.verify",
        object_type: "share_link",
        object_id: shareLink.id,
        metadata: {},
        created_at: new Date()
      }
    });

    return {
      ok: true,
      cookie: createShareAccessCookie(shareLink)
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
      shareLink.object_type as PermissionObjectType,
      shareLink.object_id
    );
    await this.prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { revoked_at: new Date() }
    });
    await this.writeAuditLog(this.prisma, me, "share_link.revoke", "share_link", shareLinkId);
    return { ok: true };
  }

  async resetShareLink(sessionToken: string | null, shareLinkId: string) {
    const me = await this.requireMe(sessionToken);
    const current = await this.prisma.shareLink.findUnique({ where: { id: shareLinkId } });
    if (!current) {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    await this.permissions.requireCanManage(
      me.user.id,
      current.object_type as PermissionObjectType,
      current.object_id
    );

    const rawToken = createRawToken();
    const now = new Date();
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({
        where: { id: shareLinkId },
        data: { revoked_at: now }
      });
      return tx.shareLink.create({
        data: {
          tenant_id: current.tenant_id,
          object_type: current.object_type,
          object_id: current.object_id,
          token_hash: hashToken(rawToken),
          permission: "view",
          password_hash: current.password_hash,
          require_login: current.require_login,
          restrict_to_workspace_members: current.restrict_to_workspace_members,
          expires_at: current.expires_at,
          created_by: me.user.id,
          created_at: now
        }
      });
    });
    await this.writeAuditLog(this.prisma, me, "share_link.reset", "share_link", next.id);
    return {
      ...toShareLinkDto(next),
      token: rawToken,
      url: buildWebUrl(`/share/${rawToken}`)
    };
  }

  async takeoverContentAccess(
    sessionToken: string | null,
    objectType: string,
    objectId: string,
    input: AdminContentTakeoverInput = {}
  ) {
    const me = await this.requireMe(sessionToken);
    if (!me.roles.includes("system_admin")) {
      throw new ContentError("FORBIDDEN", "Only system admins can take over content access.", 403);
    }
    const normalizedObjectType = normalizeContentObjectType(objectType);
    const role = normalizeTakeoverRole(input.role);
    const reason = requireText(input.reason ?? "Admin content access takeover", "reason");
    const context =
      normalizedObjectType === "knowledge_base"
        ? await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } })
        : await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!context || ("status" in context && context.status === "deleted")) {
      throw new ContentError("OBJECT_NOT_FOUND", "Content object was not found.", 404);
    }

    const collaborator = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.collaborator.upsert({
        where: {
          object_type_object_id_subject_type_subject_id: {
            object_type: normalizedObjectType,
            object_id: objectId,
            subject_type: "user",
            subject_id: me.user.id
          }
        },
        create: {
          tenant_id: context.tenant_id,
          object_type: normalizedObjectType,
          object_id: objectId,
          subject_type: "user",
          subject_id: me.user.id,
          role,
          source: "admin_takeover",
          created_by: me.user.id,
          created_at: new Date()
        },
        update: { role }
      });
      await this.writeAuditLog(
        tx,
        me,
        "admin.content_access.takeover",
        normalizedObjectType,
        objectId,
        {
          role,
          reason,
          object_tenant_id: context.tenant_id
        },
        context.tenant_id
      );
      return updated;
    });

    return {
      ok: true,
      collaborator_id: collaborator.id,
      object_type: normalizedObjectType,
      object_id: objectId,
      role
    };
  }

  private async requireMe(sessionToken: string | null): Promise<AuthenticatedUser> {
    return this.auth.getMe(sessionToken);
  }

  private canAdminViewTenant(me: AuthenticatedUser, tenantId: string): boolean {
    return (
      me.roles.includes("system_admin") ||
      (me.roles.includes("tenant_admin") && me.tenantId === tenantId)
    );
  }

  private canAdminManageTenant(me: AuthenticatedUser, tenantId: string): boolean {
    return this.canAdminViewTenant(me, tenantId);
  }

  private async createDocumentVersion(
    tx: Prisma.TransactionClient,
    me: AuthenticatedUser,
    documentId: string,
    markdown: string,
    now: Date
  ) {
    const document = await tx.document.findUnique({ where: { id: documentId } });
    if (!document || document.type !== "page") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const knowledgeBase = await tx.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase) {
      throw new ContentError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    const settings = await this.getOrCreateChunkSettings(tx, me, knowledgeBase);
    const latest = await tx.documentVersion.findFirst({
      where: { document_id: documentId },
      orderBy: { version_no: "desc" }
    });
    const version = await tx.documentVersion.create({
      data: {
        tenant_id: document.tenant_id,
        document_id: documentId,
        version_no: latest ? latest.version_no + 1 : 1,
        markdown,
        markdown_hash: markdownHash(markdown),
        source_type: "manual",
        created_by: me.user.id,
        created_at: now
      }
    });

    return tx.document.update({
      where: { id: documentId },
      data: {
        current_version_id: version.id,
        doc_form: settings.doc_form,
        process_rule_snapshot: buildDocumentProcessingSnapshot(
          settings,
          getDocumentProcessingOverride(document.process_rule_snapshot),
          {
            content_version_id: version.id,
            content_markdown_hash: version.markdown_hash
          }
        ),
        processing_status: "needs_reprocess",
        processing_revision: latest ? { increment: 1 } : 1,
        need_summary:
          typeof toRecord(settings.summary_index_setting).enable === "boolean"
            ? Boolean(toRecord(settings.summary_index_setting).enable)
            : document.need_summary,
        updated_by: me.user.id,
        updated_at: now
      }
    });
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
      return { qaPairsSkipped: 0 };
    }
    const knowledgeBase = await tx.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase) {
      return { qaPairsSkipped: 0 };
    }
    const settings = await this.getOrCreateChunkSettings(tx, me, knowledgeBase);
    const qaPairSelection =
      settings.doc_form === "qa_model"
        ? await loadIndexableQaPairs(tx, document.id, versionId)
        : { pairs: [], skipped: 0 };
    const nextProcessingRevision = (document.processing_revision ?? 1) + 1;
    const currentMarkdownHash = markdownHash(markdown);
    const processingSnapshot = buildDocumentProcessingSnapshot(
      settings,
      getDocumentProcessingOverride(document.process_rule_snapshot),
      {
        content_version_id: versionId,
        content_markdown_hash: currentMarkdownHash
      }
    );
    const chunks = materializeDocumentChunks(
      chunkMarkdownForIndex(markdown, {
        ...toMarkdownChunkingSettings(settings, document),
        qa_pairs: qaPairSelection.pairs.map((pair) => ({
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
      markdown,
      chunks,
      assetsById: await loadMarkdownAssetMap(tx, {
        tenantId: document.tenant_id,
        documentId: document.id,
        markdown,
        actorUserId: me.user.id,
        allowAnyPendingAsset: isAdmin(me)
      }),
      createId: randomUUID,
      nextOrdinal: nextChunkOrdinal(chunks)
    });
    const rows = chunks.map((chunk) => {
      const chunkMetadata = toRecord(chunk.metadata);
      return {
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
        index_role: "content",
        source_chunk_id: null,
        metadata: {
          ...chunkMetadata,
          processing_revision: nextProcessingRevision,
          content_version_id: versionId,
          content_markdown_hash: currentMarkdownHash
        } as Prisma.InputJsonValue,
        created_at: now
      };
    });
    const assetRows = assetEntries.map((entry) => ({
      id: entry.chunk.id,
      tenant_id: document.tenant_id,
      workspace_id: document.workspace_id,
      knowledge_base_id: document.knowledge_base_id,
      document_id: document.id,
      version_id: versionId,
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
      metadata: {
        ...entry.chunk.metadata,
        processing_revision: nextProcessingRevision,
        content_version_id: versionId,
        content_markdown_hash: currentMarkdownHash
      } as Prisma.InputJsonValue,
      created_at: now
    }));

    await tx.documentSegmentSummary.updateMany({
      where: { document_id: document.id, status: "active" },
      data: { status: "deleted", updated_at: now }
    });
    await tx.documentChunk.deleteMany({ where: { version_id: versionId } });
    const allRows = [...rows, ...assetRows];
    if (allRows.length > 0) {
      await tx.documentChunk.createMany({ data: allRows });
    }
    if (assetEntries.length > 0) {
      await insertDocumentAssetBindings(tx, {
        document,
        versionId,
        entries: assetEntries,
        now
      });
    }
    const documentSummary = await tx.documentSummary.findUnique({
      where: { document_id: document.id }
    });
    if (documentSummary?.status === "active") {
      await tx.documentChunk.create({
        data: {
          tenant_id: document.tenant_id,
          workspace_id: document.workspace_id,
          knowledge_base_id: document.knowledge_base_id,
          document_id: document.id,
          version_id: versionId,
          ordinal: nextChunkOrdinal(allRows),
          chunk_type: "general",
          parent_chunk_id: null,
          settings_revision: settings.revision,
          start_line: null,
          end_line: null,
          start_char: null,
          end_char: null,
          parent_ordinal: null,
          child_ordinal: null,
          heading_path: [],
          content_text: documentSummary.summary,
          content_markdown: documentSummary.summary,
          token_count: estimateTextTokens(documentSummary.summary),
          index_role: "summary",
          source_chunk_id: null,
          status: "active",
          metadata: {
            hit_type: "summary",
            summary_hit: true,
            summary_id: documentSummary.id,
            summary_scope: "document",
            summary_text: documentSummary.summary,
            original_chunk_id: null,
            doc_form: settings.doc_form,
            index_role: "summary"
          } as Prisma.InputJsonValue,
          created_at: now
        }
      });
    }
    await tx.document.update({
      where: { id: document.id },
      data: {
        doc_form: settings.doc_form,
        process_rule_snapshot: processingSnapshot,
        processing_status: "current",
        processing_revision: nextProcessingRevision,
        need_summary:
          typeof toRecord(settings.summary_index_setting).enable === "boolean"
            ? Boolean(toRecord(settings.summary_index_setting).enable)
            : document.need_summary,
        updated_at: now
      }
    });
    return { qaPairsSkipped: qaPairSelection.skipped };
  }

  private async shouldReprocessDocumentOnPublish(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    document: {
      id: string;
      knowledge_base_id: string;
      processing_status: string;
      process_rule_snapshot: Prisma.JsonValue | null;
    },
    version: { id: string; markdown: string }
  ) {
    const knowledgeBase = await tx.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase) {
      return true;
    }
    const settings = await this.getOrCreateChunkSettings(tx, me, knowledgeBase);
    const contentChunkCount = await tx.documentChunk.count({
      where: {
        document_id: document.id,
        version_id: version.id,
        index_role: "content"
      }
    });
    if (contentChunkCount === 0 || document.processing_status !== "current") {
      return true;
    }
    const snapshot = toRecord(document.process_rule_snapshot);
    return (
      snapshot.content_version_id !== version.id ||
      snapshot.content_markdown_hash !== markdownHash(version.markdown) ||
      snapshot.settings_revision !== settings.revision
    );
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
        doc_form: legacyChunkCount > 0 ? "text_model" : "hierarchical_model",
        indexing_technique: "high_quality",
        process_rule_mode: legacyChunkCount > 0 ? "custom" : "hierarchical",
        process_rule: defaultProcessRule(
          legacyChunkCount > 0 ? "text_model" : "hierarchical_model"
        ),
        retrieval_model: defaultRetrievalModel(),
        summary_index_setting: { enable: false },
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

  private async requirePageDocument(documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.type !== "page" || document.status === "deleted") {
      throw new ContentError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    return document;
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

  private async getWorkspaceMemberOrThrow(memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member) {
      throw new ContentError("OBJECT_NOT_FOUND", "Workspace member was not found.", 404);
    }
    return member;
  }

  private async loadUsersById(userIds: string[]) {
    const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
    if (uniqueIds.length === 0) {
      return new Map<string, UserSummary>();
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        email: true,
        display_name: true,
        status: true
      }
    });
    return new Map(users.map((user) => [user.id, user]));
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

  private async describeInvitationObject(objectType: string, objectId: string) {
    if (objectType === "workspace") {
      const workspace = await this.prisma.workspace.findUnique({ where: { id: objectId } });
      if (!workspace) {
        throw new ContentError("INVITATION_NOT_FOUND", "Invitation object was not found.", 404);
      }
      return { type: "workspace", id: workspace.id, title: workspace.name };
    }
    if (objectType === "knowledge_base") {
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } });
      if (!knowledgeBase) {
        throw new ContentError("INVITATION_NOT_FOUND", "Invitation object was not found.", 404);
      }
      return { type: "knowledge_base", id: knowledgeBase.id, title: knowledgeBase.title };
    }
    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document) {
      throw new ContentError("INVITATION_NOT_FOUND", "Invitation object was not found.", 404);
    }
    return { type: "document", id: document.id, title: document.title };
  }

  private async resolveShareObject(
    objectType: PermissionObjectType,
    objectId: string,
    requestedDocumentId?: string
  ) {
    if (objectType === "workspace") {
      const workspace = await this.prisma.workspace.findUnique({ where: { id: objectId } });
      if (!workspace) {
        throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
      }
      const knowledgeBases = await this.prisma.knowledgeBase.findMany({
        where: {
          workspace_id: objectId,
          status: "active"
        },
        orderBy: [{ created_at: "asc" }]
      });
      return {
        workspaceId: workspace.id,
        payload: {
          ...toWorkspaceDto(workspace),
          knowledge_bases: knowledgeBases.map(toKnowledgeBaseDto)
        }
      };
    }

    if (objectType === "knowledge_base") {
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } });
      if (!knowledgeBase) {
        throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
      }
      const documents = await this.prisma.document.findMany({
        where: {
          knowledge_base_id: objectId,
          status: { not: "deleted" }
        },
        orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
      });
      const selected =
        (requestedDocumentId
          ? documents.find((document) => document.id === requestedDocumentId)
          : documents.find((document) => document.type === "page")) ?? null;
      const version = selected?.current_version_id
        ? await this.prisma.documentVersion.findUnique({
            where: { id: selected.current_version_id }
          })
        : null;
      return {
        workspaceId: knowledgeBase.workspace_id,
        payload: {
          ...toKnowledgeBaseDto(knowledgeBase),
          documents: documents.map(toDocumentDto),
          selectedDocument: selected
            ? {
                ...toDocumentDto(selected),
                currentVersion: version ? toDocumentVersionDto(version, true) : null
              }
            : null
        }
      };
    }

    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document || document.status === "deleted") {
      throw new ContentError("SHARE_LINK_NOT_FOUND", "Share link was not found.", 404);
    }
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    return {
      workspaceId: document.workspace_id,
      payload: {
        ...toDocumentDto(document),
        currentVersion: version ? toDocumentVersionDto(version, true) : null
      }
    };
  }

  private async loadDocumentMetadataContext(
    documentId: string
  ): Promise<DocumentMetadataContext | null> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      return null;
    }
    const [knowledgeBase, fields, values, creator, currentVersion] = await Promise.all([
      this.prisma.knowledgeBase.findUnique({ where: { id: document.knowledge_base_id } }),
      this.prisma.knowledgeBaseMetadataField.findMany({
        where: { knowledge_base_id: document.knowledge_base_id, status: "active" },
        orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
      }),
      this.prisma.documentMetadataValue.findMany({ where: { document_id: document.id } }),
      this.prisma.user.findUnique({ where: { id: document.created_by } }),
      document.current_version_id
        ? this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
        : Promise.resolve(null)
    ]);
    if (!knowledgeBase) {
      return null;
    }
    return { document, knowledgeBase, fields, values, creator, currentVersion };
  }

  private async writeAuditLog(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string,
    metadata: Prisma.InputJsonObject = {},
    tenantId = me.tenantId
  ) {
    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata,
        created_at: new Date()
      }
    });
  }
}

const BUILT_IN_DIFY_METADATA_FIELDS = [
  {
    name: "document_name",
    type: "string",
    source: "built_in",
    read_only: true,
    description: "Document title shown by Dify-compatible retrieval."
  },
  {
    name: "uploader",
    type: "string",
    source: "built_in",
    read_only: true,
    description: "Display name or email of the document creator."
  },
  {
    name: "upload_date",
    type: "time",
    source: "built_in",
    read_only: true,
    description: "Document creation time."
  },
  {
    name: "last_update_date",
    type: "time",
    source: "built_in",
    read_only: true,
    description: "Document last update time."
  },
  {
    name: "source",
    type: "string",
    source: "built_in",
    read_only: true,
    description: "OpenKB source category such as online_document or file_upload."
  }
] as const;

function toKnowledgeBaseMetadataFieldDto(field: MetadataFieldRow) {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    source: "custom",
    read_only: false,
    status: field.status,
    sort_order: field.sort_order,
    created_at: field.created_at.toISOString(),
    updated_at: field.updated_at.toISOString()
  };
}

function toDocumentMetadataDto(context: DocumentMetadataContext) {
  const customValues = new Map(context.values.map((value) => [value.field_id, value.value]));
  const builtInValues = buildBuiltInDifyMetadata(context);
  const values: Record<string, unknown> = { ...builtInValues };
  for (const field of context.fields) {
    if (customValues.has(field.id)) {
      values[field.name] = customValues.get(field.id);
    }
  }
  return {
    knowledge_base_id: context.document.knowledge_base_id,
    document_id: context.document.id,
    fields: {
      built_in: BUILT_IN_DIFY_METADATA_FIELDS,
      custom: context.fields.map(toKnowledgeBaseMetadataFieldDto)
    },
    values
  };
}

function buildBuiltInDifyMetadata(context: DocumentMetadataContext): Record<string, unknown> {
  return {
    document_name: context.document.title,
    uploader: context.creator?.display_name || context.creator?.email || null,
    upload_date: context.document.created_at.toISOString(),
    last_update_date: context.document.updated_at.toISOString(),
    source: context.currentVersion?.source_type === "import" ? "file_upload" : "online_document"
  };
}

function normalizeMetadataFieldName(value: string | undefined): string {
  const name = requireText(value, "name");
  if (name.length > 80) {
    throw new ContentError("INVALID_INPUT", "metadata field name is too long.", 400);
  }
  const lower = name.toLowerCase();
  if (
    name.includes(".") ||
    lower.startsWith("openkb_") ||
    BUILT_IN_DIFY_METADATA_FIELDS.some((field) => field.name === name)
  ) {
    throw new ContentError("INVALID_INPUT", "metadata field name is reserved.", 400);
  }
  return name;
}

function normalizeMetadataFieldType(value: string | undefined): KnowledgeBaseMetadataFieldType {
  if (KNOWLEDGE_BASE_METADATA_FIELD_TYPES.includes(value as KnowledgeBaseMetadataFieldType)) {
    return value as KnowledgeBaseMetadataFieldType;
  }
  throw new ContentError("INVALID_INPUT", "metadata field type is invalid.", 400);
}

function normalizeMetadataFieldStatus(value: string): "active" | "archived" {
  if (value === "active" || value === "archived") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "metadata field status is invalid.", 400);
}

function normalizeMetadataValue(value: unknown, type: string, fieldName: string): string | number {
  if (type === "string") {
    if (typeof value !== "string") {
      throw new ContentError("INVALID_INPUT", `${fieldName} must be a string.`, 400);
    }
    return value;
  }
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
      throw new ContentError("INVALID_INPUT", `${fieldName} must be a number.`, 400);
    }
    return number;
  }
  if (type === "time") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new ContentError("INVALID_INPUT", `${fieldName} must be a valid time.`, 400);
    }
    return date.toISOString();
  }
  throw new ContentError("INVALID_INPUT", `${fieldName} has invalid metadata type.`, 400);
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

function normalizeContentObjectType(value: string): ContentObjectType {
  if (value === "knowledge_base" || value === "document") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "object_type is invalid.", 400);
}

function normalizeTakeoverRole(value: string | undefined): ContentInvitationRole {
  if (value === undefined || value.trim() === "") {
    return "viewer";
  }
  return normalizeGrantableContentRole(value);
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

function normalizeGrantableWorkspaceRole(value: string | undefined): WorkspaceInvitationRole {
  if (WORKSPACE_INVITATION_ROLES.includes(value as WorkspaceInvitationRole)) {
    return value as WorkspaceInvitationRole;
  }
  if (WORKSPACE_ROLES.includes(value as WorkspaceRole)) {
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

function isWorkspaceContentReader(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
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

function buildWebUrl(path: string): string {
  const baseUrl = process.env.WEB_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3100";
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function shareAccessCookieName(shareLinkId: string): string {
  return `openkb_share_${shareLinkId}`;
}

function createShareAccessCookie(shareLink: { id: string; password_hash: string | null }): string {
  if (!shareLink.password_hash) {
    throw new ContentError("INVALID_INPUT", "Share link has no password.", 400);
  }
  const expiresAt = new Date(
    Date.now() + parsePositiveInt(process.env.SHARE_ACCESS_TTL_HOURS, 24) * 60 * 60 * 1000
  );
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const signature = signShareAccessCookie(shareLink.id, exp, shareLink.password_hash);
  const parts = [
    `${shareAccessCookieName(shareLink.id)}=${encodeURIComponent(`${exp}.${signature}`)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`
  ];
  if (shouldUseSecureCookie()) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function hasValidShareAccessCookie(
  cookieHeader: string | undefined,
  shareLink: { id: string; password_hash: string | null }
): boolean {
  if (!cookieHeader || !shareLink.password_hash) {
    return false;
  }
  const value = getCookieValue(cookieHeader, shareAccessCookieName(shareLink.id));
  if (!value) {
    return false;
  }
  const [rawExp, signature] = value.split(".");
  const exp = Number(rawExp);
  if (!Number.isInteger(exp) || !signature || exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = signShareAccessCookie(shareLink.id, exp, shareLink.password_hash);
  return safeEqual(signature, expected);
}

function signShareAccessCookie(shareLinkId: string, exp: number, passwordHash: string): string {
  return createHmac("sha256", passwordHash).update(`${shareLinkId}.${exp}`).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  for (const cookie of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

function shouldUseSecureCookie(): boolean {
  const value = process.env.AUTH_COOKIE_SECURE?.toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const baseUrl = process.env.APP_BASE_URL || process.env.WEB_BASE_URL || "";
  return baseUrl.startsWith("https://");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  doc_form?: string | null;
  process_rule_snapshot?: Prisma.JsonValue;
  processing_status?: string;
  processing_revision?: number;
  doc_language?: string | null;
  need_summary?: boolean;
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
    doc_form: document.doc_form ?? null,
    process_rule_snapshot: document.process_rule_snapshot ?? {},
    processing_status: document.processing_status ?? "current",
    processing_revision: document.processing_revision ?? 1,
    doc_language: document.doc_language ?? null,
    need_summary: document.need_summary ?? false,
    created_by: document.created_by,
    updated_by: document.updated_by,
    created_at: document.created_at.toISOString(),
    updated_at: document.updated_at.toISOString()
  };
}

function toDocumentVersionSummaryDto(
  version: {
    id: string;
    document_id: string;
    version_no: number;
    markdown_hash: string;
    source_type: string;
    source_file_id: string | null;
    created_by: string;
    created_at: Date;
  },
  isCurrent: boolean
) {
  return {
    id: version.id,
    document_id: version.document_id,
    version_no: version.version_no,
    markdown_hash: version.markdown_hash,
    source_type: version.source_type,
    source_file_id: version.source_file_id,
    created_by: version.created_by,
    created_at: version.created_at.toISOString(),
    is_current: isCurrent
  };
}

function toDocumentVersionDto(
  version: {
    id: string;
    document_id: string;
    version_no: number;
    markdown: string;
    markdown_hash: string;
    source_type: string;
    source_file_id: string | null;
    created_by: string;
    created_at: Date;
  },
  isCurrent = false
) {
  return {
    id: version.id,
    document_id: version.document_id,
    version_no: version.version_no,
    markdown: version.markdown,
    markdown_hash: version.markdown_hash,
    source_type: version.source_type,
    source_file_id: version.source_file_id,
    created_by: version.created_by,
    created_at: version.created_at.toISOString(),
    is_current: isCurrent
  };
}

function toWorkspaceMemberDto(
  member: {
    id: string;
    tenant_id: string;
    workspace_id: string;
    user_id: string;
    role: string;
    created_at: Date;
  },
  user: UserSummary | null = null
) {
  return {
    id: member.id,
    tenant_id: member.tenant_id,
    workspace_id: member.workspace_id,
    user_id: member.user_id,
    role: member.role,
    created_at: member.created_at.toISOString(),
    user: user
      ? {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          status: user.status
        }
      : null
  };
}

function toCollaboratorDto(
  collaborator: {
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
  },
  user: UserSummary | null = null
) {
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
    created_at: collaborator.created_at.toISOString(),
    user: user
      ? {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          status: user.status
        }
      : null
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
  require_approval: boolean;
  approved_by: string | null;
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
    require_approval: invitation.require_approval,
    approved_by: invitation.approved_by,
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
  password_hash?: string | null;
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
    has_password: Boolean(shareLink.password_hash),
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

function nextChunkOrdinal(chunks: Array<{ ordinal: number }>): number {
  return Math.max(-1, ...chunks.map((chunk) => chunk.ordinal)) + 1;
}

async function loadMarkdownAssetMap(
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    tenantId: string;
    documentId: string;
    markdown: string;
    actorUserId: string;
    allowAnyPendingAsset?: boolean;
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
      OR: [
        { document_id: input.documentId },
        {
          document_id: null,
          ...(input.allowAnyPendingAsset ? {} : { created_by: input.actorUserId })
        }
      ]
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
        ...(input.allowAnyPendingAsset ? {} : { created_by: input.actorUserId })
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

function isAdmin(me: AuthenticatedUser): boolean {
  return me.roles.includes("system_admin") || me.roles.includes("tenant_admin");
}

async function insertDocumentAssetBindings(
  tx: Prisma.TransactionClient | PrismaClient,
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

function toMarkdownChunkingSettings(
  input: {
    mode: string;
    doc_form?: string;
    indexing_technique?: string;
    process_rule_mode?: string;
    process_rule?: unknown;
    parent_mode: string;
    parent_delimiter: string;
    child_delimiter: string;
    parent_max_characters: number;
    child_max_characters: number;
    child_overlap_characters: number;
    revision: number;
  },
  document?: { process_rule_snapshot?: Prisma.JsonValue }
): MarkdownChunkingSettings {
  const override = getDocumentProcessingOverride(document?.process_rule_snapshot);
  const processRule = toRecord(override?.process_rule ?? input.process_rule);
  const segmentation = toRecord(processRule.segmentation);
  const subchunkSegmentation = toRecord(processRule.subchunk_segmentation);
  return {
    mode: input.mode === "general" || input.doc_form === "text_model" ? "general" : "parent_child",
    doc_form: normalizeDocForm(input.doc_form),
    indexing_technique: normalizeIndexingTechnique(input.indexing_technique),
    process_rule_mode: normalizeProcessRuleMode(input.process_rule_mode),
    process_rule: override?.process_rule ?? input.process_rule,
    parent_mode: normalizeParentMode(
      override?.parent_mode ?? (input.parent_mode === "full_doc" ? "full_doc" : "paragraph")
    ),
    parent_delimiter: readRuleSeparator(segmentation, input.parent_delimiter),
    child_delimiter: readRuleSeparator(subchunkSegmentation, input.child_delimiter),
    parent_max_characters: readRuleMaxTokens(segmentation, input.parent_max_characters),
    chunk_overlap_characters: readRuleOverlap(segmentation, 0),
    child_max_characters: readRuleMaxTokens(subchunkSegmentation, input.child_max_characters),
    child_overlap_characters: readRuleOverlap(subchunkSegmentation, input.child_overlap_characters),
    settings_revision: input.revision
  };
}

function normalizeChunkSettingsInput(input: UpdateChunkSettingsInput) {
  const next: {
    mode?: string;
    doc_form?: string;
    indexing_technique?: string;
    process_rule_mode?: string;
    process_rule?: Prisma.InputJsonValue;
    retrieval_model?: Prisma.InputJsonValue;
    summary_index_setting?: Prisma.InputJsonValue;
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
  if (input.doc_form !== undefined) {
    const nextDocForm = normalizeDocForm(input.doc_form);
    next.doc_form = nextDocForm;
    next.mode = nextDocForm === "text_model" ? "general" : "parent_child";
    next.process_rule_mode = nextDocForm === "hierarchical_model" ? "hierarchical" : "custom";
    next.process_rule = defaultProcessRule(nextDocForm);
  }
  if (input.indexing_technique !== undefined) {
    next.indexing_technique = normalizeIndexingTechnique(input.indexing_technique);
  }
  if (input.process_rule_mode !== undefined) {
    next.process_rule_mode = normalizeProcessRuleMode(input.process_rule_mode);
  }
  if (input.process_rule !== undefined) {
    next.process_rule = normalizeProcessRule(input.process_rule);
  }
  if (input.retrieval_model !== undefined) {
    next.retrieval_model = normalizeRetrievalModel(input.retrieval_model);
  }
  if (input.summary_index_setting !== undefined) {
    next.summary_index_setting = normalizeSummaryIndexSetting(input.summary_index_setting);
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

function syncChunkSettingsProcessRule<
  T extends {
    process_rule?: unknown;
    doc_form?: string | null;
    parent_mode?: string | null;
    parent_delimiter?: string;
    child_delimiter?: string;
    parent_max_characters?: number;
    child_max_characters?: number;
    child_overlap_characters?: number;
  }
>(settings: T, input: UpdateChunkSettingsInput = {}) {
  const processRule = toRecord(normalizeProcessRule(settings.process_rule));
  const segmentation = toRecord(processRule.segmentation);
  const subchunkSegmentation = toRecord(processRule.subchunk_segmentation);
  const parentMax = input.parent_max_characters ?? settings.parent_max_characters;
  const childMax = input.child_max_characters ?? settings.child_max_characters;
  const parentOverlap =
    input.chunk_overlap_characters ??
    (typeof segmentation.chunk_overlap === "number" ? segmentation.chunk_overlap : undefined);
  const childOverlap =
    input.child_overlap_characters ??
    (typeof subchunkSegmentation.chunk_overlap === "number"
      ? subchunkSegmentation.chunk_overlap
      : settings.child_overlap_characters);
  const nextProcessRule = normalizeProcessRule({
    ...processRule,
    parent_mode:
      input.parent_mode ??
      processRule.parent_mode ??
      (settings.parent_mode === "full_doc" ? "full-doc" : "paragraph"),
    segmentation: {
      ...segmentation,
      ...(input.parent_delimiter !== undefined || settings.parent_delimiter !== undefined
        ? { separator: input.parent_delimiter ?? settings.parent_delimiter }
        : {}),
      ...(parentMax !== undefined ? { max_tokens: parentMax } : {}),
      ...(parentOverlap !== undefined ? { chunk_overlap: parentOverlap } : {})
    },
    subchunk_segmentation: {
      ...subchunkSegmentation,
      ...(input.child_delimiter !== undefined || settings.child_delimiter !== undefined
        ? { separator: input.child_delimiter ?? settings.child_delimiter }
        : {}),
      ...(childMax !== undefined ? { max_tokens: childMax } : {}),
      ...(childOverlap !== undefined ? { chunk_overlap: childOverlap } : {})
    }
  });
  return {
    ...settings,
    process_rule: nextProcessRule
  };
}

function rejectForbiddenChunkSettingKeys(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  const forbidden = Object.keys(value as Record<string, unknown>).find((key) => {
    if (key === "retrieval_model") {
      return false;
    }
    return /(provider|embedding[_-]?model|reranking[_-]?model|endpoint|api[_-]?key|secret|token)/i.test(
      key
    );
  });
  if (forbidden) {
    throw new ContentError("INVALID_INPUT", `Chunk settings cannot include ${forbidden}.`, 400);
  }
}

function normalizeOptionalChunkType(value: unknown): "general" | "parent" | "child" | null {
  return value === "general" || value === "parent" || value === "child" ? value : null;
}

function normalizeDocForm(value: unknown): "text_model" | "hierarchical_model" | "qa_model" {
  if (value === "text_model" || value === "hierarchical_model" || value === "qa_model") {
    return value;
  }
  return "hierarchical_model";
}

function normalizeCreateDocForm(value: unknown): "text_model" | "hierarchical_model" | "qa_model" {
  if (value === "text_model" || value === "hierarchical_model" || value === "qa_model") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "doc_form is invalid.", 400);
}

function normalizeIndexingTechnique(value: unknown): "economy" | "high_quality" {
  return value === "economy" ? "economy" : "high_quality";
}

function normalizeProcessRuleMode(value: unknown): "automatic" | "custom" | "hierarchical" {
  if (value === "automatic" || value === "custom" || value === "hierarchical") {
    return value;
  }
  return "custom";
}

function normalizeParentMode(value: unknown): "paragraph" | "full_doc" {
  if (value === "full_doc" || value === "full-doc") {
    return "full_doc";
  }
  if (value === "paragraph") {
    return "paragraph";
  }
  throw new ContentError("INVALID_INPUT", "parent_mode is invalid.", 400);
}

function normalizeOptionalSegmentStatus(value: unknown): "active" | "disabled" | "deleted" | null {
  if (value === "active" || value === "disabled" || value === "deleted") {
    return value;
  }
  return value === undefined ? null : failInput();
}

function normalizeOptionalSegmentStatusFilter(
  value: unknown
): "active" | "disabled" | "deleted" | "all" | null {
  if (value === "active" || value === "disabled" || value === "deleted" || value === "all") {
    return value;
  }
  return value === undefined ? null : failInput();
}

function toChunkStatusWhere(status: "active" | "disabled" | "deleted" | "all" | null) {
  if (status === "all") {
    return {};
  }
  if (status) {
    return { status };
  }
  return { status: { in: ["active", "disabled"] } };
}

function normalizeQaSource(value: unknown): "manual" | "csv" | "llm" | "mock" {
  if (value === "csv" || value === "llm" || value === "mock") {
    return value;
  }
  return "manual";
}

function normalizeSegmentStatus(value: unknown): "active" | "disabled" | "deleted" {
  if (value === "active" || value === "disabled" || value === "deleted") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeGenerationMode(value: unknown): "llm" | "mock" {
  if (value === "llm" || value === "mock") {
    return value;
  }
  throw new ContentError("INVALID_INPUT", "mode must be llm or mock.", 400);
}

function normalizeSummaryMode(value: unknown, manualSummary: unknown): "manual" | "llm" | "mock" {
  if (value === "manual" || value === "llm" || value === "mock") {
    return value;
  }
  return typeof manualSummary === "string" && manualSummary.trim() ? "manual" : "mock";
}

function normalizeSummaryScope(
  value: unknown,
  chunkId: unknown
): "document" | "segment" | "all_segments" {
  if (value === "document" || value === "segment" || value === "all_segments") {
    return value;
  }
  return typeof chunkId === "string" && chunkId.trim() ? "segment" : "document";
}

function normalizeGenerationCount(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ContentError("INVALID_INPUT", `count must be between 1 and ${max}.`, 400);
  }
  return value;
}

function normalizeQaMetadata(value: unknown): Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.InputJsonValue;
  }
  throw new ContentError("INVALID_INPUT", "metadata must be an object.", 400);
}

function normalizeQaImportRows(input: ImportQaPairsInput): Array<{
  question?: string;
  answer?: string;
  source_chunk_id?: string | null;
  metadata?: unknown;
  metadata_json?: string;
}> {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const csvRows = typeof input.csv === "string" && input.csv.trim() ? parseQaCsv(input.csv) : [];
  const combined = [...rows, ...csvRows];
  if (combined.length === 0) {
    throw new ContentError("INVALID_INPUT", "QA import requires csv or rows.", 400);
  }
  return combined.map((row) => ({
    question: row.question,
    answer: row.answer,
    source_chunk_id: row.source_chunk_id ?? null,
    metadata:
      row.metadata !== undefined
        ? row.metadata
        : typeof row.metadata_json === "string" && row.metadata_json.trim()
          ? parseMetadataJson(row.metadata_json)
          : {}
  }));
}

function parseQaCsv(csv: string): Array<{
  question?: string;
  answer?: string;
  source_chunk_id?: string | null;
  metadata?: unknown;
  metadata_json?: string;
}> {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0]!.map((header) => header.trim());
  const questionIndex = headers.indexOf("question");
  const answerIndex = headers.indexOf("answer");
  if (questionIndex < 0 || answerIndex < 0) {
    throw new ContentError("INVALID_INPUT", "CSV must include question and answer columns.", 400);
  }
  const sourceIndex = headers.indexOf("source_chunk_id");
  const metadataIndex = headers.indexOf("metadata_json");
  return rows.slice(1).map((row) => ({
    question: row[questionIndex] ?? "",
    answer: row[answerIndex] ?? "",
    source_chunk_id: sourceIndex >= 0 ? (row[sourceIndex] ?? null) : null,
    metadata_json: metadataIndex >= 0 ? row[metadataIndex] : undefined
  }));
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index] ?? "";
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value)) {
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value));
}

function parseMetadataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to a stable validation error.
  }
  throw new ContentError("INVALID_INPUT", "metadata_json must be a JSON object.", 400);
}

function normalizeProcessRule(value: unknown): Prisma.InputJsonValue {
  const record = toRecord(value);
  return {
    pre_processing_rules: Array.isArray(record.pre_processing_rules)
      ? record.pre_processing_rules
      : [
          { id: "remove_extra_spaces", enabled: true },
          { id: "remove_urls_emails", enabled: false }
        ],
    segmentation: normalizeSegmentation(record.segmentation, {
      separator: "\n\n",
      max_tokens: 1024,
      chunk_overlap: 50
    }),
    parent_mode:
      record.parent_mode === "full-doc" || record.parent_mode === "full_doc"
        ? "full-doc"
        : "paragraph",
    subchunk_segmentation: normalizeSegmentation(record.subchunk_segmentation, {
      separator: "\n",
      max_tokens: 512,
      chunk_overlap: 50
    })
  };
}

function normalizeSegmentation(
  value: unknown,
  fallback: { separator: string; max_tokens: number; chunk_overlap: number }
) {
  const record = toRecord(value);
  const separator =
    typeof record.separator === "string"
      ? record.separator
      : typeof record.delimiter === "string"
        ? record.delimiter
        : fallback.separator;
  const maxTokens = clampNumber(record.max_tokens, fallback.max_tokens, 100, 65_535);
  const chunkOverlap = clampNumber(record.chunk_overlap, fallback.chunk_overlap, 0, 10_000);
  if (chunkOverlap >= maxTokens) {
    throw new ContentError("INVALID_INPUT", "chunk_overlap must be lower than max_tokens.", 400);
  }
  return {
    separator: separator.slice(0, 64),
    max_tokens: maxTokens,
    chunk_overlap: chunkOverlap
  };
}

function validateChunkSettingsCandidate(input: {
  doc_form?: string | null;
  process_rule_mode?: string | null;
  parent_mode?: string | null;
  process_rule?: unknown;
}) {
  const docForm = normalizeDocForm(input.doc_form);
  const processRuleMode = normalizeProcessRuleMode(input.process_rule_mode);
  if (docForm === "text_model" && processRuleMode === "hierarchical") {
    throw new ContentError(
      "INVALID_INPUT",
      "text_model supports automatic or custom process rules, not hierarchical.",
      400
    );
  }
  if (docForm === "hierarchical_model" && processRuleMode !== "hierarchical") {
    throw new ContentError(
      "INVALID_INPUT",
      "hierarchical_model requires hierarchical process rules.",
      400
    );
  }
  if (docForm === "qa_model" && processRuleMode === "hierarchical") {
    throw new ContentError(
      "INVALID_INPUT",
      "qa_model does not support hierarchical process rules.",
      400
    );
  }
  normalizeProcessRule(input.process_rule);
  if (input.parent_mode !== undefined && input.parent_mode !== null) {
    normalizeParentMode(input.parent_mode);
  }
}

function normalizeRetrievalModel(value: unknown): Prisma.InputJsonValue {
  const record = toRecord(value);
  const method =
    record.search_method === "semantic_search" ||
    record.search_method === "full_text_search" ||
    record.search_method === "hybrid_search" ||
    record.search_method === "keyword_search"
      ? record.search_method
      : "full_text_search";
  const topK = clampNumber(record.top_k, 10, 1, 20);
  const scoreThreshold =
    typeof record.score_threshold === "number" && Number.isFinite(record.score_threshold)
      ? Math.min(Math.max(record.score_threshold, 0), 1)
      : 0;
  const weights = toRecord(record.weights);
  return {
    search_method: method,
    top_k: topK,
    score_threshold_enabled: record.score_threshold_enabled === true,
    score_threshold: scoreThreshold,
    reranking_enable: record.reranking_enable === true,
    reranking_mode:
      record.reranking_mode === "reranking_model" ? "reranking_model" : "weighted_score",
    weights: {
      vector_setting: {
        vector_weight: normalizeWeight(toRecord(weights.vector_setting).vector_weight, 0.5)
      },
      keyword_setting: {
        keyword_weight: normalizeWeight(toRecord(weights.keyword_setting).keyword_weight, 0.5)
      }
    },
    metadata_filtering_conditions:
      typeof record.metadata_filtering_conditions === "object"
        ? (record.metadata_filtering_conditions as Prisma.InputJsonValue)
        : null
  };
}

function normalizeWeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1)
    : fallback;
}

function normalizeSummaryIndexSetting(value: unknown): Prisma.InputJsonValue {
  const record = toRecord(value);
  return {
    enable: record.enable === true,
    summary_prompt:
      typeof record.summary_prompt === "string" ? record.summary_prompt.slice(0, 4000) : null
  };
}

function defaultProcessRule(docForm: "text_model" | "hierarchical_model" | "qa_model") {
  if (docForm === "hierarchical_model") {
    return normalizeProcessRule({
      parent_mode: "paragraph",
      segmentation: { separator: "\n\n", max_tokens: 1024, chunk_overlap: 0 },
      subchunk_segmentation: { separator: "\n", max_tokens: 512, chunk_overlap: 50 }
    });
  }
  return normalizeProcessRule({
    segmentation: { separator: "\n\n", max_tokens: 1024, chunk_overlap: 50 }
  });
}

function defaultRetrievalModel() {
  return normalizeRetrievalModel({
    search_method: "full_text_search",
    top_k: 10,
    score_threshold_enabled: false,
    score_threshold: 0,
    reranking_enable: false
  });
}

function readSnapshotParentMode(value: unknown): "paragraph" | "full_doc" | null {
  const snapshot = toRecord(value);
  const processRule = toRecord(snapshot.process_rule ?? snapshot);
  const mode = processRule.parent_mode ?? snapshot.parent_mode;
  if (mode === "full-doc" || mode === "full_doc") {
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
  return clampNumber(record.max_tokens, fallback, 100, 65_535);
}

function readRuleOverlap(record: Record<string, unknown>, fallback: number): number {
  return clampNumber(record.chunk_overlap, fallback, 0, 10_000);
}

function buildDocumentProcessingSnapshot(
  settings: {
    doc_form: string;
    indexing_technique: string;
    process_rule_mode: string;
    process_rule: unknown;
    retrieval_model: unknown;
    summary_index_setting: unknown;
    parent_mode: string;
    revision: number;
  },
  override?: { parent_mode?: string; process_rule?: unknown },
  content?: { content_version_id?: string | null; content_markdown_hash?: string | null }
): Prisma.InputJsonValue {
  const processRule =
    override?.process_rule !== undefined
      ? normalizeProcessRule(override.process_rule)
      : normalizeProcessRule(settings.process_rule);
  const parentMode =
    override?.parent_mode === "full_doc" || override?.parent_mode === "full-doc"
      ? "full-doc"
      : readSnapshotParentMode(processRule) === "full_doc"
        ? "full-doc"
        : settings.parent_mode === "full_doc"
          ? "full-doc"
          : "paragraph";
  return {
    doc_form: normalizeDocForm(settings.doc_form),
    indexing_technique: normalizeIndexingTechnique(settings.indexing_technique),
    process_rule_mode: normalizeProcessRuleMode(settings.process_rule_mode),
    process_rule: {
      ...toRecord(processRule),
      parent_mode: parentMode
    } as Prisma.InputJsonObject,
    parent_mode: parentMode,
    retrieval_model: toRecord(settings.retrieval_model),
    summary_index_setting: toRecord(settings.summary_index_setting),
    settings_revision: settings.revision,
    content_version_id: content?.content_version_id ?? null,
    content_markdown_hash: content?.content_markdown_hash ?? null,
    document_override: Boolean(override?.parent_mode || override?.process_rule !== undefined)
  } as Prisma.InputJsonObject;
}

function getDocumentProcessingOverride(
  snapshot: Prisma.JsonValue | undefined
): { parent_mode?: string; process_rule?: unknown } | undefined {
  const record = toRecord(snapshot);
  if (record.document_override !== true) {
    return undefined;
  }
  const processRule = record.process_rule;
  const parentMode = readSnapshotParentMode(record);
  if (processRule === undefined && parentMode === null) {
    return undefined;
  }
  return {
    ...(parentMode ? { parent_mode: parentMode } : {}),
    ...(processRule !== undefined ? { process_rule: processRule } : {})
  };
}

async function loadIndexableQaPairs(
  tx: Prisma.TransactionClient | PrismaClient,
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
  const indexable = pairs.filter(
    (pair) => !pair.source_chunk_id || activeSourceIds.has(pair.source_chunk_id)
  );
  return { pairs: indexable, skipped: pairs.length - indexable.length };
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStringFromRecord(value: unknown, key: string): string | null {
  const item = toRecord(value)[key];
  return typeof item === "string" && item ? item : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizeText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.replace(/\s+/g, " ").trim().length / 4));
}

function normalizeGeneratedText(value: string, field: string): string {
  const normalized = value
    .trim()
    .replace(/^```(?:json|markdown|text)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!normalized) {
    throw new ContentError("MODEL_RESPONSE_INVALID", `Generated ${field} is empty.`, 502);
  }
  return normalized.length > 4000 ? normalized.slice(0, 4000) : normalized;
}

function buildSummaryGenerationPrompt(
  title: string,
  content: string,
  scope: "document" | "segment"
) {
  return [
    `Generate a concise ${scope} summary for OpenKB retrieval indexing.`,
    "Return only the summary text. Do not include markdown fences.",
    `Title: ${title}`,
    "Content:",
    content.slice(0, 8000)
  ].join("\n\n");
}

function buildQaGenerationPrompt(
  title: string,
  markdown: string,
  chunks: Array<{ id: string; content_text: string }>,
  count: number
): string {
  const segmentText = chunks
    .map(
      (chunk, index) => `Segment ${index + 1} (${chunk.id}):\n${chunk.content_text.slice(0, 1200)}`
    )
    .join("\n\n");
  return [
    "Generate OpenKB QA pairs for retrieval.",
    `Return JSON only: [{\"question\":\"...\",\"answer\":\"...\",\"source_chunk_id\":\"optional chunk id\"}].`,
    `Generate at most ${count} pairs. Answers must be grounded in the content.`,
    `Document title: ${title}`,
    "Markdown:",
    markdown.slice(0, 5000),
    "Segments:",
    segmentText
  ].join("\n\n");
}

function parseGeneratedQaPairs(
  text: string,
  chunks: Array<{ id: string }>,
  count: number
): Array<{ question: string; answer: string; source_chunk_id?: string | null }> {
  const chunkIds = new Set(chunks.map((chunk) => chunk.id));
  const normalized = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return [];
  }
  const record = toRecord(parsed);
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record.items)
      ? record.items
      : [];
  return rows
    .flatMap((row) => {
      const record = toRecord(row);
      const question = typeof record.question === "string" ? record.question.trim() : "";
      const answer = typeof record.answer === "string" ? record.answer.trim() : "";
      const sourceChunkId =
        typeof record.source_chunk_id === "string" && chunkIds.has(record.source_chunk_id)
          ? record.source_chunk_id
          : null;
      return question && answer ? [{ question, answer, source_chunk_id: sourceChunkId }] : [];
    })
    .slice(0, count);
}

function generateMockQaPairs(
  title: string,
  markdown: string,
  chunks: Array<{ id: string; content_text: string }>,
  count: number,
  scope: "document" | "segments"
): Array<{ question: string; answer: string; source_chunk_id?: string | null }> {
  const sources =
    scope === "segments" && chunks.length > 0
      ? chunks
      : [{ id: chunks[0]?.id ?? null, content_text: markdown || title }];
  return sources
    .slice(0, count)
    .map((chunk, index) => {
      const answer = summarizeText(chunk.content_text || markdown || title);
      return {
        question:
          index === 0 ? `${title} 的核心内容是什么？` : `${title} 片段 ${index + 1} 讲了什么？`,
        answer,
        source_chunk_id: chunk.id
      };
    })
    .filter((item) => item.answer);
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
  api_key_last4?: string | null;
  capabilities?: unknown;
  capabilities_detected_at?: Date | string | null;
}): StoredModelSetting {
  return setting as StoredModelSetting;
}

function toChunkSettingsDto(settings: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  mode: string;
  doc_form: string;
  indexing_technique: string;
  process_rule_mode: string;
  process_rule: Prisma.JsonValue;
  retrieval_model: Prisma.JsonValue;
  summary_index_setting: Prisma.JsonValue;
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
  const segmentation = toRecord(toRecord(settings.process_rule).segmentation);
  return {
    id: settings.id,
    tenant_id: settings.tenant_id,
    workspace_id: settings.workspace_id,
    knowledge_base_id: settings.knowledge_base_id,
    mode: settings.mode,
    doc_form: settings.doc_form,
    indexing_technique: settings.indexing_technique,
    process_rule_mode: settings.process_rule_mode,
    process_rule: settings.process_rule,
    retrieval_model: settings.retrieval_model,
    summary_index_setting: settings.summary_index_setting,
    parent_mode: settings.parent_mode,
    parent_delimiter: settings.parent_delimiter,
    child_delimiter: settings.child_delimiter,
    parent_max_characters: settings.parent_max_characters,
    chunk_overlap_characters: readRuleOverlap(
      segmentation,
      settings.doc_form === "hierarchical_model" ? 0 : 50
    ),
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
  index_role: string;
  source_chunk_id: string | null;
  status: string;
  override_content_text: string | null;
  override_content_markdown: string | null;
  overridden_by: string | null;
  overridden_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
}) {
  const effectiveText = chunk.override_content_text ?? chunk.content_text;
  const effectiveMarkdown = chunk.override_content_markdown ?? chunk.content_markdown;
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
    content_text: effectiveText,
    content_markdown: effectiveMarkdown,
    source_content_text: chunk.content_text,
    source_content_markdown: chunk.content_markdown,
    token_count: chunk.token_count,
    metadata: chunk.metadata,
    index_role: chunk.index_role,
    source_chunk_id: chunk.source_chunk_id,
    status: chunk.status,
    has_override: Boolean(chunk.override_content_text || chunk.override_content_markdown),
    overridden_by: chunk.overridden_by,
    overridden_at: chunk.overridden_at ? chunk.overridden_at.toISOString() : null,
    disabled_at: chunk.disabled_at ? chunk.disabled_at.toISOString() : null,
    created_at: chunk.created_at.toISOString()
  };
}

function toSegmentUpdateDto(chunk: Parameters<typeof toDocumentChunkDto>[0]) {
  return {
    ...toDocumentChunkDto(chunk),
    needs_index_rebuild: true,
    needs_chunk_rebuild: false,
    rebuild_hint:
      "PostgreSQL segment updated. Rebuild the Milvus index before Web Search, MCP, or Dify use this change."
  };
}

function toQaPairDto(pair: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  question: string;
  answer: string;
  source_chunk_id: string | null;
  source: string;
  status: string;
  metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: pair.id,
    tenant_id: pair.tenant_id,
    workspace_id: pair.workspace_id,
    knowledge_base_id: pair.knowledge_base_id,
    document_id: pair.document_id,
    question: pair.question,
    answer: pair.answer,
    source_chunk_id: pair.source_chunk_id,
    source: pair.source,
    status: pair.status,
    metadata: pair.metadata,
    created_by: pair.created_by,
    created_at: pair.created_at.toISOString(),
    updated_at: pair.updated_at.toISOString()
  };
}

function toSegmentSummaryDto(summary: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  chunk_id: string;
  summary: string;
  status: string;
  metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: summary.id,
    tenant_id: summary.tenant_id,
    workspace_id: summary.workspace_id,
    knowledge_base_id: summary.knowledge_base_id,
    document_id: summary.document_id,
    chunk_id: summary.chunk_id,
    summary: summary.summary,
    status: summary.status,
    metadata: summary.metadata,
    created_by: summary.created_by,
    created_at: summary.created_at.toISOString(),
    updated_at: summary.updated_at.toISOString()
  };
}

function toDocumentSummaryDto(summary: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  summary: string;
  status: string;
  metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: summary.id,
    tenant_id: summary.tenant_id,
    workspace_id: summary.workspace_id,
    knowledge_base_id: summary.knowledge_base_id,
    document_id: summary.document_id,
    summary: summary.summary,
    status: summary.status,
    metadata: summary.metadata,
    created_by: summary.created_by,
    created_at: summary.created_at.toISOString(),
    updated_at: summary.updated_at.toISOString()
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

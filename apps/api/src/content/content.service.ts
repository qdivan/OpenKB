import { createHash, randomBytes } from "node:crypto";

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
import {
  PermissionService,
  type ContentObjectType,
  type PermissionObjectType
} from "@openkb/permissions";

import { ContentError } from "./errors";

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
    const markdown = type === "page" ? (input.markdown ?? "") : "";
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
    if (
      input.markdown !== undefined &&
      input.markdown_hash !== undefined &&
      input.markdown_hash !== markdownHash(input.markdown)
    ) {
      throw new ContentError("INVALID_INPUT", "markdown_hash does not match markdown.", 400);
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
          ...(Number.isInteger(input.sort_order) ? { sort_order: Number(input.sort_order) } : {}),
          updated_by: me.user.id,
          updated_at: now
        }
      });

      if (input.markdown !== undefined && current.type === "page") {
        await this.createDocumentVersion(tx, me, documentId, input.markdown, now);
      }
      await this.writeAuditLog(tx, me, "document.update", "document", documentId);
    });

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

    return tx.document.update({
      where: { id: documentId },
      data: {
        current_version_id: version.id,
        updated_by: me.user.id,
        updated_at: now
      }
    });
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

import {
  CONTENT_ROLES,
  createDatabaseClient,
  WORKSPACE_ROLES,
  type ContentRole,
  type PrismaClient,
  type WorkspaceRole
} from "@openkb/db";

export const PERMISSIONS_PACKAGE_NAME = "@openkb/permissions";

export type ContentObjectType = "knowledge_base" | "document";
export type PermissionObjectType = "workspace" | ContentObjectType;

export type PermissionErrorCode =
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "OBJECT_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND";

export class PermissionError extends Error {
  constructor(
    public readonly code: PermissionErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export type PermissionServiceOptions = {
  prisma?: PrismaClient;
};

export type PermissionPackageStatus = {
  packageName: typeof PERMISSIONS_PACKAGE_NAME;
  workspaceRoles: readonly WorkspaceRole[];
  contentRoles: readonly ContentRole[];
  implementsPermissionService: true;
};

export const permissionPackageStatus: PermissionPackageStatus = {
  packageName: PERMISSIONS_PACKAGE_NAME,
  workspaceRoles: WORKSPACE_ROLES,
  contentRoles: CONTENT_ROLES,
  implementsPermissionService: true
};

const contentRoleRank: Record<ContentRole, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  owner: 4
};

export class PermissionService {
  private readonly prisma: PrismaClient;

  constructor(options: PermissionServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async resolveWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspace_id: workspaceId,
        user_id: userId
      }
    });

    return isWorkspaceRole(membership?.role) ? membership.role : null;
  }

  async resolveObjectRole(
    userId: string,
    objectType: ContentObjectType,
    objectId: string
  ): Promise<ContentRole | null> {
    if (objectType === "knowledge_base") {
      return this.resolveDirectContentRole(userId, "knowledge_base", objectId);
    }

    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document || document.status === "deleted") {
      return null;
    }

    const directRole = await this.resolveDirectContentRole(userId, "document", objectId);
    if (directRole || document.permission_mode === "custom") {
      return directRole;
    }

    return this.resolveDirectContentRole(userId, "knowledge_base", document.knowledge_base_id);
  }

  async canRead(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<boolean> {
    if (objectType === "workspace") {
      return (await this.resolveWorkspaceRole(userId, objectId)) !== null;
    }

    if (await this.resolveObjectRole(userId, objectType, objectId)) {
      return true;
    }

    const context = await this.resolveReadableContext(objectType, objectId);
    if (!context) {
      return false;
    }

    if (context.visibility === "public") {
      return true;
    }

    if (context.visibility === "workspace") {
      const role = await this.resolveWorkspaceRole(userId, context.workspaceId);
      return role === "owner" || role === "admin" || role === "member";
    }

    return false;
  }

  async canEdit(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<boolean> {
    if (objectType === "workspace") {
      const role = await this.resolveWorkspaceRole(userId, objectId);
      return role === "owner" || role === "admin";
    }

    const role = await this.resolveObjectRole(userId, objectType, objectId);
    return role === "owner" || role === "manager" || role === "editor";
  }

  async canManage(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<boolean> {
    if (objectType === "workspace") {
      const role = await this.resolveWorkspaceRole(userId, objectId);
      return role === "owner" || role === "admin";
    }

    const role = await this.resolveObjectRole(userId, objectType, objectId);
    return role === "owner" || role === "manager";
  }

  async canManageWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    return this.canManage(userId, "workspace", workspaceId);
  }

  async canCreateShareLink(
    userId: string,
    objectType: ContentObjectType,
    objectId: string
  ): Promise<boolean> {
    return this.canManage(userId, objectType, objectId);
  }

  async getAccessPrincipals(userId: string, tenantId?: string): Promise<string[]> {
    const [memberships, groups, tenantMemberships, collaborators] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: {
          user_id: userId,
          ...(tenantId ? { tenant_id: tenantId } : {})
        }
      }),
      this.prisma.groupMember.findMany({
        where: {
          user_id: userId,
          ...(tenantId ? { tenant_id: tenantId } : {})
        }
      }),
      this.prisma.tenantMembership.findMany({
        where: {
          user_id: userId,
          ...(tenantId ? { tenant_id: tenantId } : {})
        }
      }),
      this.prisma.collaborator.findMany({
        where: {
          subject_type: "user",
          subject_id: userId,
          ...(tenantId ? { tenant_id: tenantId } : {})
        }
      })
    ]);

    return [
      `user:${userId}`,
      ...tenantMemberships.map((membership) => `tenant:${membership.tenant_id}:${membership.role}`),
      ...memberships.map((membership) => `workspace:${membership.workspace_id}:${membership.role}`),
      ...groups.map((membership) => `group:${membership.group_id}`),
      ...collaborators.map(
        (collaborator) =>
          `${principalObjectPrefix(collaborator.object_type)}:${collaborator.object_id}:${collaborator.role}`
      )
    ];
  }

  async getObjectAccessPrincipals(
    objectType: ContentObjectType,
    objectId: string
  ): Promise<string[]> {
    const context = await this.resolveIndexableContext(objectType, objectId);
    if (!context) {
      return [];
    }

    const collaborators = await this.prisma.collaborator.findMany({
      where: {
        OR: [
          {
            object_type: objectType,
            object_id: objectId
          },
          ...(objectType === "document" && context.documentPermissionMode !== "custom"
            ? [
                {
                  object_type: "knowledge_base",
                  object_id: context.knowledgeBaseId
                }
              ]
            : [])
        ]
      }
    });

    const principals = new Set<string>([
      `tenant:${context.tenantId}:system_admin`,
      `tenant:${context.tenantId}:tenant_admin`
    ]);

    if (context.visibility === "public") {
      principals.add("public");
    }

    if (context.visibility === "workspace") {
      principals.add(`workspace:${context.workspaceId}:owner`);
      principals.add(`workspace:${context.workspaceId}:admin`);
      principals.add(`workspace:${context.workspaceId}:member`);
    }

    for (const collaborator of collaborators) {
      if (collaborator.subject_type === "user") {
        principals.add(`user:${collaborator.subject_id}`);
      }
      if (collaborator.subject_type === "group") {
        principals.add(`group:${collaborator.subject_id}`);
      }
      principals.add(
        `${principalObjectPrefix(collaborator.object_type)}:${collaborator.object_id}:${collaborator.role}`
      );
    }

    return [...principals].sort();
  }

  requireObjectType(objectType: string): PermissionObjectType {
    if (
      objectType === "workspace" ||
      objectType === "knowledge_base" ||
      objectType === "document"
    ) {
      return objectType;
    }

    throw new PermissionError("INVALID_INPUT", "Object type is invalid.", 400);
  }

  requireContentObjectType(objectType: string): ContentObjectType {
    if (objectType === "knowledge_base" || objectType === "document") {
      return objectType;
    }

    throw new PermissionError("INVALID_INPUT", "Content object type is invalid.", 400);
  }

  async requireCanRead(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<void> {
    if (!(await this.canRead(userId, objectType, objectId))) {
      throw new PermissionError("FORBIDDEN", "You do not have read access.", 403);
    }
  }

  async requireCanEdit(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<void> {
    if (!(await this.canEdit(userId, objectType, objectId))) {
      throw new PermissionError("FORBIDDEN", "You do not have edit access.", 403);
    }
  }

  async requireCanManage(
    userId: string,
    objectType: PermissionObjectType,
    objectId: string
  ): Promise<void> {
    if (!(await this.canManage(userId, objectType, objectId))) {
      throw new PermissionError("FORBIDDEN", "You do not have manage access.", 403);
    }
  }

  private async resolveDirectContentRole(
    userId: string,
    objectType: ContentObjectType,
    objectId: string
  ): Promise<ContentRole | null> {
    const groupIds = await this.prisma.groupMember
      .findMany({
        where: { user_id: userId },
        select: { group_id: true }
      })
      .then((memberships) => memberships.map((membership) => membership.group_id));

    const collaborators = await this.prisma.collaborator.findMany({
      where: {
        object_type: objectType,
        object_id: objectId,
        OR: [
          {
            subject_type: "user",
            subject_id: userId
          },
          ...(groupIds.length > 0
            ? [
                {
                  subject_type: "group",
                  subject_id: { in: groupIds }
                }
              ]
            : [])
        ]
      }
    });

    return collaborators.reduce<ContentRole | null>((bestRole, collaborator) => {
      if (!isContentRole(collaborator.role)) {
        return bestRole;
      }

      if (!bestRole || contentRoleRank[collaborator.role] > contentRoleRank[bestRole]) {
        return collaborator.role;
      }

      return bestRole;
    }, null);
  }

  private async resolveReadableContext(
    objectType: ContentObjectType,
    objectId: string
  ): Promise<{ workspaceId: string; visibility: string } | null> {
    if (objectType === "knowledge_base") {
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } });
      if (!knowledgeBase || knowledgeBase.status !== "active") {
        return null;
      }

      return {
        workspaceId: knowledgeBase.workspace_id,
        visibility: knowledgeBase.visibility
      };
    }

    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document || document.status === "deleted") {
      return null;
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase || knowledgeBase.status !== "active") {
      return null;
    }

    return {
      workspaceId: document.workspace_id,
      visibility:
        document.permission_mode === "custom" && document.visibility
          ? document.visibility
          : knowledgeBase.visibility
    };
  }

  private async resolveIndexableContext(
    objectType: ContentObjectType,
    objectId: string
  ): Promise<{
    tenantId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    visibility: string;
    documentPermissionMode?: string;
  } | null> {
    if (objectType === "knowledge_base") {
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({ where: { id: objectId } });
      if (!knowledgeBase || knowledgeBase.status !== "active") {
        return null;
      }
      return {
        tenantId: knowledgeBase.tenant_id,
        workspaceId: knowledgeBase.workspace_id,
        knowledgeBaseId: knowledgeBase.id,
        visibility: knowledgeBase.visibility
      };
    }

    const document = await this.prisma.document.findUnique({ where: { id: objectId } });
    if (!document || document.status === "deleted") {
      return null;
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: document.knowledge_base_id }
    });
    if (!knowledgeBase || knowledgeBase.status !== "active") {
      return null;
    }

    return {
      tenantId: document.tenant_id,
      workspaceId: document.workspace_id,
      knowledgeBaseId: document.knowledge_base_id,
      visibility:
        document.permission_mode === "custom" && document.visibility
          ? document.visibility
          : knowledgeBase.visibility,
      documentPermissionMode: document.permission_mode
    };
  }
}

function isWorkspaceRole(role: string | undefined): role is WorkspaceRole {
  return WORKSPACE_ROLES.includes(role as WorkspaceRole);
}

function isContentRole(role: string | undefined): role is ContentRole {
  return CONTENT_ROLES.includes(role as ContentRole);
}

function principalObjectPrefix(objectType: string): "kb" | "document" {
  return objectType === "knowledge_base" ? "kb" : "document";
}

import { createHash } from "node:crypto";

import { createDatabaseClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { AuthService } from "@openkb/auth";
import { PermissionService } from "@openkb/permissions";
import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ContentService } from "./content.service";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for content integration tests.");
}

const allTables = [
  "audit_logs",
  "auth_email_outbox",
  "auth_tokens",
  "auth_sessions",
  "dify_knowledge_mappings",
  "dify_api_keys",
  "mcp_personal_access_tokens",
  "mcp_oauth_refresh_tokens",
  "mcp_oauth_authorization_codes",
  "mcp_oauth_grants",
  "mcp_oauth_clients",
  "index_rebuild_jobs",
  "milvus_index_profiles",
  "import_format_routes",
  "import_tool_settings",
  "document_chunks",
  "import_jobs",
  "share_links",
  "invitations",
  "collaborators",
  "document_versions",
  "document_assets",
  "documents",
  "knowledge_bases",
  "workspace_members",
  "workspaces",
  "group_members",
  "groups",
  "auth_settings",
  "tenant_memberships",
  "tenants",
  "users"
] as const;

const prisma = createDatabaseClient();
const auth = new AuthService({ prisma });
const permissions = new PermissionService({ prisma });

describe("ContentService integration", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await permissions.disconnect();
  });

  it("seeds a fixed dev admin that can log in and create content", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const workspace = await content.createWorkspace(login.sessionToken, {
        name: "Product",
        slug: "product"
      });
      const knowledgeBase = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: workspace.id,
        title: "Product Docs",
        slug: "product-docs",
        visibility: "private"
      });
      const document = await content.createDocument(login.sessionToken, {
        knowledge_base_id: knowledgeBase.id,
        title: "Roadmap",
        slug: "roadmap",
        markdown: "# Roadmap"
      });

      expect(login.me.roles).toContain("system_admin");
      expect(workspace.slug).toBe("product");
      expect(knowledgeBase.visibility).toBe("private");
      expect(document.currentVersion).toMatchObject({ markdown: "# Roadmap" });
      const seededOverview = await content.getKnowledgeBaseOverview(
        login.sessionToken,
        seed.knowledgeBaseId
      );
      expect(seededOverview.chunks.total).toBeGreaterThan(0);
    } finally {
      await content.disconnect();
    }
  });

  it("keeps invitation owner grants out and returns read-only share links", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });

      await expect(
        content.createInvitation(login.sessionToken, "workspace", seed.workspaceId, {
          role: "owner"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        content.createInvitation(login.sessionToken, "knowledge_base", seed.knowledgeBaseId, {
          role: "owner"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      const share = await content.createShareLink(
        login.sessionToken,
        "document",
        seed.documentId,
        {}
      );
      const shared = await content.getShare(share.token, null);

      expect(share.permission).toBe("view");
      expect(shared.object.id).toBe(seed.documentId);
    } finally {
      await content.disconnect();
    }
  });

  it("requires approval before invitation grants access", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const admin = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const invitedUser = await createActiveUser(seed.tenantId, "viewer@openkb.local");
      const invited = await auth.login({
        email: invitedUser.email,
        password: "OpenKB-test-123456"
      });

      const invitation = await content.createInvitation(
        admin.sessionToken,
        "knowledge_base",
        seed.knowledgeBaseId,
        {
          email: invitedUser.email,
          role: "viewer",
          require_approval: true
        }
      );
      const accepted = await content.acceptInvitation(invited.sessionToken, invitation.token);

      expect(accepted.status).toBe("awaiting_approval");
      expect(
        await permissions.canRead(invited.me.user.id, "knowledge_base", seed.knowledgeBaseId)
      ).toBe(false);

      await content.approveInvitation(admin.sessionToken, invitation.id);
      expect(
        await permissions.canRead(invited.me.user.id, "knowledge_base", seed.knowledgeBaseId)
      ).toBe(true);
    } finally {
      await content.disconnect();
    }
  });

  it("protects share links with password cookies and invalidates reset tokens", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const admin = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const share = await content.createShareLink(admin.sessionToken, "document", seed.documentId, {
        password: "reader-pass"
      });

      await expect(content.getShare(share.token, null)).rejects.toMatchObject({
        code: "SHARE_PASSWORD_REQUIRED"
      });

      const verified = await content.verifySharePassword(share.token, "reader-pass");
      const shared = await content.getShare(share.token, null, verified.cookie);
      expect(shared.object.id).toBe(seed.documentId);

      const reset = await content.resetShareLink(admin.sessionToken, share.id);
      await expect(content.getShare(share.token, null, verified.cookie)).rejects.toMatchObject({
        code: "SHARE_LINK_NOT_FOUND"
      });
      await expect(content.getShare(reset.token, null, verified.cookie)).rejects.toMatchObject({
        code: "SHARE_PASSWORD_REQUIRED"
      });
      const nextVerified = await content.verifySharePassword(reset.token, "reader-pass");
      const nextShared = await content.getShare(reset.token, null, nextVerified.cookie);
      expect(nextShared.object.id).toBe(seed.documentId);
    } finally {
      await content.disconnect();
    }
  });

  it("keeps member-only share links out of reach for workspace guests", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const admin = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const guestUser = await createActiveUser(seed.tenantId, "guest@openkb.local");
      await prisma.workspaceMember.create({
        data: {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          user_id: guestUser.id,
          role: "guest"
        }
      });
      const guest = await auth.login({
        email: guestUser.email,
        password: "OpenKB-test-123456"
      });
      const share = await content.createShareLink(admin.sessionToken, "document", seed.documentId, {
        require_login: true,
        restrict_to_workspace_members: true
      });

      await expect(content.getShare(share.token, guest.sessionToken)).rejects.toMatchObject({
        code: "SHARE_LINK_NOT_FOUND"
      });
    } finally {
      await content.disconnect();
    }
  });

  it("rejects stale document saves with current version details", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const initial = await content.getDocument(login.sessionToken, seed.documentId);
      const staleVersionId = initial.currentVersion?.id ?? null;

      const updated = await content.updateDocument(login.sessionToken, seed.documentId, {
        base_version_id: staleVersionId,
        markdown: "# Updated",
        markdown_hash: markdownHash("# Updated")
      });

      expect(updated.currentVersion?.id).not.toBe(staleVersionId);
      await expect(
        content.updateDocument(login.sessionToken, seed.documentId, {
          base_version_id: staleVersionId,
          markdown: "# Stale",
          markdown_hash: markdownHash("# Stale")
        })
      ).rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: {
          current_version_id: updated.currentVersion?.id
        }
      });
      await expect(
        content.updateDocument(login.sessionToken, seed.documentId, {
          base_version_id: updated.currentVersion?.id ?? null,
          markdown: "# Invalid",
          markdown_hash: "bad"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });

  it("lists, reads, and restores document versions without deleting history", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const initial = await content.getDocument(login.sessionToken, seed.documentId);
      const firstVersionId = initial.currentVersion?.id;
      expect(firstVersionId).toBeTruthy();
      expect(initial.currentVersion?.is_current).toBe(true);

      const nextMarkdown = "# Restorable\n\nNew content";
      const updated = await content.updateDocument(login.sessionToken, seed.documentId, {
        base_version_id: firstVersionId ?? null,
        markdown: nextMarkdown,
        markdown_hash: markdownHash(nextMarkdown)
      });
      expect(updated.currentVersion?.version_no).toBe(2);
      expect(updated.currentVersion?.is_current).toBe(true);

      const versions = await content.listDocumentVersions(login.sessionToken, seed.documentId);
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({
        id: updated.currentVersion?.id,
        is_current: true,
        source_type: "manual"
      });

      const firstVersion = await content.getDocumentVersion(
        login.sessionToken,
        seed.documentId,
        firstVersionId ?? ""
      );
      expect(firstVersion.markdown).toContain("Welcome to OpenKB");

      const restored = await content.restoreDocumentVersion(
        login.sessionToken,
        seed.documentId,
        firstVersionId ?? ""
      );
      expect(restored.currentVersion?.id).not.toBe(firstVersionId);
      expect(restored.currentVersion?.version_no).toBe(3);
      expect(restored.currentVersion?.markdown).toBe(firstVersion.markdown);
      expect(restored.currentVersion?.is_current).toBe(true);

      const afterRestore = await content.listDocumentVersions(login.sessionToken, seed.documentId);
      expect(afterRestore).toHaveLength(3);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "document.version.restore", object_id: seed.documentId },
        orderBy: { created_at: "desc" }
      });
      expect(audit.metadata).toMatchObject({
        restored_from_version_id: firstVersionId,
        new_version_id: restored.currentVersion?.id
      });
    } finally {
      await content.disconnect();
    }
  });

  it("rejects markdown outside the enabled dialect", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const markdown = "```mermaid\ngraph TD\n```";

      await expect(
        content.updateDocument(login.sessionToken, seed.documentId, {
          base_version_id: null,
          markdown,
          markdown_hash: markdownHash(markdown)
        })
      ).rejects.toMatchObject({
        code: "VERSION_CONFLICT"
      });

      const current = await content.getDocument(login.sessionToken, seed.documentId);
      await expect(
        content.updateDocument(login.sessionToken, seed.documentId, {
          base_version_id: current.currentVersion?.id ?? null,
          markdown,
          markdown_hash: markdownHash(markdown)
        })
      ).rejects.toMatchObject({
        code: "MARKDOWN_DIALECT_ERROR",
        details: {
          issues: [
            {
              code: "UNSUPPORTED_MERMAID"
            }
          ]
        }
      });
    } finally {
      await content.disconnect();
    }
  });

  it("moves and sorts documents while preventing tree cycles", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const childFolder = await content.createDocument(login.sessionToken, {
        knowledge_base_id: seed.knowledgeBaseId,
        parent_id: seed.folderId,
        type: "folder",
        title: "Nested",
        slug: "nested"
      });

      const moved = await content.updateDocument(login.sessionToken, seed.documentId, {
        parent_id: null,
        sort_order: 2000
      });

      expect(moved.parent_id).toBeNull();
      expect(moved.sort_order).toBe(2000);
      await expect(
        content.updateDocument(login.sessionToken, seed.folderId, {
          parent_id: childFolder.id
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });
});

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

async function createActiveUser(tenantId: string, email: string) {
  const now = new Date();
  const passwordHash = await bcrypt.hash("OpenKB-test-123456", 12);
  const user = await prisma.user.create({
    data: {
      email,
      password_hash: passwordHash,
      display_name: email,
      status: "active",
      email_verified_at: now,
      created_at: now,
      updated_at: now
    }
  });
  await prisma.tenantMembership.create({
    data: {
      tenant_id: tenantId,
      user_id: user.id,
      role: "member",
      created_at: now
    }
  });
  return user;
}

import { createHash, randomUUID } from "node:crypto";

import { createDatabaseClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { AuthService } from "@openkb/auth";
import { PermissionService } from "@openkb/permissions";
import { getMilvusConfig } from "@openkb/milvus";
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
  "document_metadata_values",
  "knowledge_base_metadata_fields",
  "document_summaries",
  "document_segment_summaries",
  "document_qa_pairs",
  "document_asset_bindings",
  "document_chunks",
  "import_jobs",
  "share_links",
  "invitations",
  "collaborators",
  "document_versions",
  "document_assets",
  "document_user_activities",
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

function tokenFromLink(link: string): string {
  const parsed = new URL(link);
  const token = parsed.searchParams.get("token");
  if (!token) {
    throw new Error(`Missing token in link: ${link}`);
  }
  return token;
}

async function createTypedPage(
  content: ContentService,
  sessionToken: string,
  workspaceId: string,
  docForm: "text_model" | "hierarchical_model" | "qa_model",
  options: { title?: string; markdown?: string } = {}
) {
  const suffix = randomUUID().slice(0, 8);
  const knowledgeBase = await content.createKnowledgeBase(sessionToken, {
    workspace_id: workspaceId,
    title: options.title ?? `Typed ${docForm} ${suffix}`,
    slug: `typed-${docForm.replaceAll("_", "-")}-${suffix}`,
    doc_form: docForm
  });
  const document = await content.createDocument(sessionToken, {
    knowledge_base_id: knowledgeBase.id,
    title: options.title ?? `Typed ${docForm}`,
    slug: `typed-doc-${suffix}`,
    markdown: options.markdown ?? "# Typed document\n\nContent for typed knowledge base tests."
  });
  return { knowledgeBase, document };
}

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
      await content.createDocument(login.sessionToken, {
        knowledge_base_id: knowledgeBase.id,
        title: "Planning",
        slug: "planning",
        type: "folder"
      });

      expect(login.me.roles).toContain("system_admin");
      expect(workspace.slug).toBe("product");
      expect(knowledgeBase.visibility).toBe("private");
      expect(document.currentVersion).toMatchObject({ markdown: "# Roadmap" });
      const productOverview = await content.getKnowledgeBaseOverview(
        login.sessionToken,
        knowledgeBase.id
      );
      expect(productOverview.documents).toMatchObject({
        total: 1,
        pages: 1,
        folders: 1
      });
      const seededOverview = await content.getKnowledgeBaseOverview(
        login.sessionToken,
        seed.knowledgeBaseId
      );
      expect(seededOverview.chunks.total).toBeGreaterThan(0);
    } finally {
      await content.disconnect();
    }
  });

  it("returns personal workspace metadata and dashboard activity", async () => {
    await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const workspaces = await content.listWorkspaces(login.sessionToken);
      const personalWorkspace = workspaces.find((workspace) => workspace.is_personal);
      expect(personalWorkspace).toMatchObject({
        kind: "personal",
        personal_owner_user_id: login.me.user.id,
        role: "owner"
      });

      const knowledgeBase = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: personalWorkspace!.id,
        title: "Personal Notes",
        slug: "personal-notes",
        visibility: "private"
      });
      const document = await content.createDocument(login.sessionToken, {
        knowledge_base_id: knowledgeBase.id,
        title: "Private Note",
        slug: "private-note",
        markdown: "# Private Note\n\nOnly visible in my personal space."
      });
      await content.getDocument(login.sessionToken, document.id);

      const dashboard = await content.getWorkspaceDashboard(
        login.sessionToken,
        personalWorkspace!.id
      );
      expect(dashboard.workspace).toMatchObject({ is_personal: true });
      expect(dashboard.knowledge_bases).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: knowledgeBase.id })])
      );
      expect(dashboard.knowledge_bases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: knowledgeBase.id,
            doc_form: "text_model",
            page_count: 1,
            folder_count: 0,
            document_count: 1,
            needs_reprocess_count: 1
          })
        ])
      );
      expect(dashboard.recent_edited).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: document.id })])
      );
      expect(dashboard.recent_viewed).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: document.id })])
      );
      expect(dashboard.counts.favorites).toBe(0);
      expect(dashboard.counts.comments).toBe(0);
    } finally {
      await content.disconnect();
    }
  });

  it("creates and updates team space avatar metadata without allowing client-created personal spaces", async () => {
    await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      await expect(
        content.createWorkspace(login.sessionToken, {
          name: "Bad Personal",
          slug: "bad-personal",
          kind: "personal"
        } as never)
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        content.createWorkspace(login.sessionToken, {
          name: "Bad Owner",
          slug: "bad-owner",
          personal_owner_user_id: login.me.user.id
        } as never)
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      const workspace = await content.createWorkspace(login.sessionToken, {
        name: "AI Team",
        slug: "ai-team",
        avatar_color: "#0284C7",
        avatar_initials: "AI"
      });
      expect(workspace).toMatchObject({
        kind: "team",
        is_personal: false,
        avatar_color: "#0284C7",
        avatar_initials: "AI"
      });
      const members = await content.listWorkspaceMembers(login.sessionToken, workspace.id);
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: login.me.user.id, role: "owner" })
        ])
      );

      const updated = await content.updateWorkspace(login.sessionToken, workspace.id, {
        name: "AI Projects",
        slug: "ai-projects",
        avatar_color: "#7C3AED",
        avatar_initials: "AP"
      });
      expect(updated).toMatchObject({
        name: "AI Projects",
        slug: "ai-projects",
        avatar_color: "#7C3AED",
        avatar_initials: "AP"
      });

      const personalWorkspace = (await content.listWorkspaces(login.sessionToken)).find(
        (item) => item.is_personal && item.personal_owner_user_id === login.me.user.id
      );
      await expect(
        content.updateWorkspace(login.sessionToken, personalWorkspace!.id, {
          name: "Renamed Personal"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });

  it("initializes Dify-style knowledge base types during creation", async () => {
    await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const workspace = await content.createWorkspace(login.sessionToken, {
        name: "Typed KB Workspace",
        slug: "typed-kb-workspace"
      });

      const defaultKb = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: workspace.id,
        title: "Default Segments",
        slug: "default-segments"
      });
      const textKb = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: workspace.id,
        title: "Segments",
        slug: "segments",
        doc_form: "text_model"
      });
      const hierarchicalKb = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: workspace.id,
        title: "Parent Child",
        slug: "parent-child",
        doc_form: "hierarchical_model"
      });
      const qaKb = await content.createKnowledgeBase(login.sessionToken, {
        workspace_id: workspace.id,
        title: "QA",
        slug: "qa",
        doc_form: "qa_model"
      });

      await expect(
        content.createKnowledgeBase(login.sessionToken, {
          workspace_id: workspace.id,
          title: "Bad Type",
          slug: "bad-type",
          doc_form: "unknown_model"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        content.getChunkSettings(login.sessionToken, defaultKb.id)
      ).resolves.toMatchObject({
        mode: "general",
        doc_form: "text_model",
        process_rule_mode: "automatic"
      });
      await expect(content.getChunkSettings(login.sessionToken, textKb.id)).resolves.toMatchObject({
        mode: "general",
        doc_form: "text_model",
        process_rule_mode: "automatic"
      });
      await expect(
        content.getChunkSettings(login.sessionToken, hierarchicalKb.id)
      ).resolves.toMatchObject({
        mode: "parent_child",
        doc_form: "hierarchical_model",
        process_rule_mode: "hierarchical",
        parent_mode: "paragraph"
      });
      await expect(content.getChunkSettings(login.sessionToken, qaKb.id)).resolves.toMatchObject({
        mode: "parent_child",
        doc_form: "qa_model",
        process_rule_mode: "automatic"
      });

      await expect(
        content.updateChunkSettings(login.sessionToken, hierarchicalKb.id, {
          doc_form: "text_model"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        content.updateChunkSettings(login.sessionToken, hierarchicalKb.id, {
          doc_form: "hierarchical_model",
          indexing_technique: "economy"
        })
      ).resolves.toMatchObject({
        doc_form: "hierarchical_model",
        indexing_technique: "economy"
      });
      await expect(
        content.updateChunkSettings(login.sessionToken, hierarchicalKb.id, {
          parent_mode: "full_doc"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });

  it("lets system admins discover private workspaces without reading content until audited takeover", async () => {
    await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const rootLogin = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const second = await auth.createAdminUser(rootLogin.sessionToken, {
        email: "second-admin@example.com",
        tenant_role: "system_admin"
      });
      await auth.confirmPasswordReset({
        token: tokenFromLink(second.setup_link),
        password: "second-password"
      });
      const secondLogin = await auth.login({
        email: "second-admin@example.com",
        password: "second-password"
      });
      const workspace = await content.createWorkspace(secondLogin.sessionToken, {
        name: "Second Admin Space",
        slug: "second-admin-space"
      });
      const knowledgeBase = await content.createKnowledgeBase(secondLogin.sessionToken, {
        workspace_id: workspace.id,
        title: "Private Admin KB",
        slug: "private-admin-kb",
        visibility: "private"
      });
      const document = await content.createDocument(secondLogin.sessionToken, {
        knowledge_base_id: knowledgeBase.id,
        title: "Private Note",
        slug: "private-note",
        markdown: "# Private Note"
      });

      const visibleWorkspaces = await content.listWorkspaces(rootLogin.sessionToken);
      expect(visibleWorkspaces.find((item) => item.id === workspace.id)).toMatchObject({
        admin_visible: true,
        can_read_content: false
      });
      const visibleKnowledgeBases = await content.listKnowledgeBases(
        rootLogin.sessionToken,
        workspace.id
      );
      expect(visibleKnowledgeBases).toContainEqual(
        expect.objectContaining({
          id: knowledgeBase.id,
          admin_visible: true,
          can_read_content: false,
          requires_takeover: true
        })
      );
      await expect(
        content.getKnowledgeBaseTree(rootLogin.sessionToken, knowledgeBase.id)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(content.getDocument(rootLogin.sessionToken, document.id)).rejects.toMatchObject({
        code: "FORBIDDEN"
      });

      await content.takeoverContentAccess(
        rootLogin.sessionToken,
        "knowledge_base",
        knowledgeBase.id,
        {
          reason: "integration test"
        }
      );
      await expect(
        content.getKnowledgeBaseTree(rootLogin.sessionToken, knowledgeBase.id)
      ).resolves.toHaveLength(1);
      await expect(content.getDocument(rootLogin.sessionToken, document.id)).resolves.toMatchObject(
        {
          id: document.id
        }
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "admin.content_access.takeover" }
      });
      expect(audit.metadata).toMatchObject({ reason: "integration test" });
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

  it("requires document manager permission to change document visibility", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const editorUser = await createActiveUser(seed.tenantId, "doc-editor@openkb.local");
      await prisma.collaborator.create({
        data: {
          tenant_id: seed.tenantId,
          object_type: "document",
          object_id: seed.documentId,
          subject_type: "user",
          subject_id: editorUser.id,
          role: "editor",
          source: "direct",
          created_by: seed.userId
        }
      });
      const editor = await auth.login({
        email: editorUser.email,
        password: "OpenKB-test-123456"
      });
      const current = await content.getDocument(editor.sessionToken, seed.documentId);
      const editorMarkdown = "# Editor update\n\nEditors can update content.";

      await expect(
        content.updateDocument(editor.sessionToken, seed.documentId, {
          base_version_id: current.currentVersion?.id ?? null,
          markdown: editorMarkdown,
          markdown_hash: markdownHash(editorMarkdown)
        })
      ).resolves.toMatchObject({ title: current.title });

      await expect(
        content.updateDocument(editor.sessionToken, seed.documentId, {
          permission_mode: "custom",
          visibility: "public"
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await content.disconnect();
    }
  });

  it("only lets a document editor bind their own pending Markdown assets during reprocess", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const editorUser = await createActiveUser(seed.tenantId, "asset-editor@openkb.local");
      const otherUser = await createActiveUser(seed.tenantId, "asset-owner@openkb.local");
      await prisma.collaborator.create({
        data: {
          tenant_id: seed.tenantId,
          object_type: "document",
          object_id: seed.documentId,
          subject_type: "user",
          subject_id: editorUser.id,
          role: "editor",
          source: "direct",
          created_by: seed.userId
        }
      });
      const ownAssetId = randomUUID();
      const otherAssetId = randomUUID();
      const [ownAsset, otherAsset] = await Promise.all([
        prisma.documentAsset.create({
          data: {
            id: ownAssetId,
            tenant_id: seed.tenantId,
            document_id: null,
            object_key: `tenants/${seed.tenantId}/assets/${ownAssetId}/own.png`,
            filename: "own.png",
            mime_type: "image/png",
            size_bytes: BigInt(128),
            checksum_sha256: "own-checksum",
            metadata: { source: "content-test" },
            created_by: editorUser.id
          }
        }),
        prisma.documentAsset.create({
          data: {
            id: otherAssetId,
            tenant_id: seed.tenantId,
            document_id: null,
            object_key: `tenants/${seed.tenantId}/assets/${otherAssetId}/other.png`,
            filename: "other.png",
            mime_type: "image/png",
            size_bytes: BigInt(128),
            checksum_sha256: "other-checksum",
            metadata: { source: "content-test" },
            created_by: otherUser.id
          }
        })
      ]);
      const editor = await auth.login({
        email: editorUser.email,
        password: "OpenKB-test-123456"
      });
      const current = await content.getDocument(editor.sessionToken, seed.documentId);
      const markdown = `# Asset Ownership

![own asset](asset://${ownAsset.id})

![other asset](asset://${otherAsset.id})`;

      await content.updateDocument(editor.sessionToken, seed.documentId, {
        base_version_id: current.currentVersion?.id ?? null,
        markdown,
        markdown_hash: markdownHash(markdown)
      });
      await content.reprocessDocument(editor.sessionToken, seed.documentId);

      await expect(
        prisma.documentAsset.findUniqueOrThrow({ where: { id: ownAsset.id } })
      ).resolves.toMatchObject({ document_id: seed.documentId });
      await expect(
        prisma.documentAsset.findUniqueOrThrow({ where: { id: otherAsset.id } })
      ).resolves.toMatchObject({ document_id: null });
      await expect(
        prisma.documentAssetBinding.findFirst({ where: { asset_id: ownAsset.id } })
      ).resolves.toMatchObject({ document_id: seed.documentId });
      await expect(
        prisma.documentAssetBinding.findFirst({ where: { asset_id: otherAsset.id } })
      ).resolves.toBeNull();
      const assetChunkAssetIds = (
        await prisma.documentChunk.findMany({
          where: { document_id: seed.documentId, index_role: "asset_image" },
          select: { metadata: true }
        })
      ).map((chunk) => (chunk.metadata as { asset_id?: string }).asset_id);
      expect(assetChunkAssetIds).toContain(ownAsset.id);
      expect(assetChunkAssetIds).not.toContain(otherAsset.id);
      await expect(
        prisma.documentChunk.findFirst({
          where: { document_id: seed.documentId, index_role: "asset_image" },
          select: { metadata: true }
        })
      ).resolves.toMatchObject({
        metadata: expect.objectContaining({
          doc_type: "image",
          segment_attachment_id: expect.any(String),
          attachment_info: expect.objectContaining({
            id: ownAsset.id,
            name: ownAsset.filename,
            mime_type: ownAsset.mime_type
          })
        })
      });
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
      expect(restored.processing_status).toBe("needs_reprocess");

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

  it("reprocesses current document chunks when publishing and queues an index rebuild", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const initial = await content.getDocument(login.sessionToken, seed.documentId);
      const nextMarkdown = `# Explicit Reprocess

First paragraph about Liu Bei and Zhuge Liang. ${"OpenKB ".repeat(30)}

Second paragraph about Cao Cao at Guandu. ${"Retrieval ".repeat(30)}

Third paragraph about Red Cliff. ${"Milvus ".repeat(30)}`;
      const updated = await content.updateDocument(login.sessionToken, seed.documentId, {
        base_version_id: initial.currentVersion?.id ?? null,
        markdown: nextMarkdown,
        markdown_hash: markdownHash(nextMarkdown)
      });

      expect(updated.processing_status).toBe("needs_reprocess");
      await expect(
        prisma.documentChunk.count({ where: { version_id: updated.currentVersion?.id } })
      ).resolves.toBe(0);

      const indexJobsBefore = await prisma.indexRebuildJob.count();
      const published = await content.publishDocument(login.sessionToken, seed.documentId);
      expect(published.status).toBe("published");
      expect(published.processing_status).toBe("current");
      expect(published.retrieval_freshness).toMatchObject({
        state: "indexing",
        chunks_current: true,
        index_current: false
      });
      const chunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        {
          document_id: seed.documentId
        }
      );
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.version_id === published.currentVersion?.id)).toBe(true);
      await expect(prisma.indexRebuildJob.count()).resolves.toBe(indexJobsBefore + 1);
    } finally {
      await content.disconnect();
    }
  });

  it("reuses existing global index rebuild jobs and enforces publish permissions", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);
    const milvusConfig = getMilvusConfig();

    try {
      const admin = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const editorUser = await createActiveUser(seed.tenantId, "publisher@openkb.local");
      const viewerUser = await createActiveUser(seed.tenantId, "read-only-publisher@openkb.local");
      await prisma.collaborator.createMany({
        data: [
          {
            tenant_id: seed.tenantId,
            object_type: "document",
            object_id: seed.documentId,
            subject_type: "user",
            subject_id: editorUser.id,
            role: "editor",
            source: "direct",
            created_by: seed.userId
          },
          {
            tenant_id: seed.tenantId,
            object_type: "document",
            object_id: seed.documentId,
            subject_type: "user",
            subject_id: viewerUser.id,
            role: "viewer",
            source: "direct",
            created_by: seed.userId
          }
        ]
      });

      const editor = await auth.login({
        email: editorUser.email,
        password: "OpenKB-test-123456"
      });
      const viewer = await auth.login({
        email: viewerUser.email,
        password: "OpenKB-test-123456"
      });

      const current = await content.getDocument(editor.sessionToken, seed.documentId);
      const markdown = "# Permissioned publish\n\nEditors publish searchable chunks.";
      await content.updateDocument(editor.sessionToken, seed.documentId, {
        base_version_id: current.currentVersion?.id ?? null,
        markdown,
        markdown_hash: markdownHash(markdown)
      });
      const globalJob = await prisma.indexRebuildJob.create({
        data: {
          tenant_id: null,
          target_collection: `openkb_chunks_global_${randomUUID().replace(/-/g, "_")}`,
          target_alias: milvusConfig.activeAlias,
          status: "pending",
          started_by: seed.userId,
          started_at: new Date(Date.now() - 60_000)
        }
      });

      const published = await content.publishDocument(editor.sessionToken, seed.documentId);
      expect(published.processing_status).toBe("current");
      expect(published.retrieval_freshness).toMatchObject({
        state: "indexing",
        chunks_current: true
      });
      await expect(prisma.indexRebuildJob.count()).resolves.toBe(1);
      const refreshedGlobalJob = await prisma.indexRebuildJob.findUniqueOrThrow({
        where: { id: globalJob.id }
      });
      expect(refreshedGlobalJob.tenant_id).toBeNull();
      expect(refreshedGlobalJob.started_at.getTime()).toBeGreaterThan(
        globalJob.started_at.getTime()
      );

      const readable = await content.getDocument(viewer.sessionToken, seed.documentId);
      expect(readable.id).toBe(seed.documentId);
      await expect(
        content.publishDocument(viewer.sessionToken, seed.documentId)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await content.publishDocument(admin.sessionToken, seed.documentId);
      await expect(prisma.indexRebuildJob.count()).resolves.toBe(1);
    } finally {
      await content.disconnect();
    }
  });

  it("does not wipe current segment management state on repeated publish", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const reprocessed = await content.reprocessDocument(login.sessionToken, seed.documentId);
      expect(reprocessed.processing_status).toBe("current");
      const chunk = await prisma.documentChunk.findFirstOrThrow({
        where: {
          document_id: seed.documentId,
          version_id: reprocessed.currentVersion?.id,
          index_role: "content",
          status: "active",
          chunk_type: { in: ["general", "child"] }
        },
        orderBy: { ordinal: "asc" }
      });
      await content.updateDocumentSegment(login.sessionToken, seed.documentId, chunk.id, {
        override_content_text: "Stable override text",
        override_content_markdown: "Stable override text"
      });
      await content.generateSegmentSummary(login.sessionToken, seed.documentId, {
        scope: "segment",
        mode: "manual",
        chunk_id: chunk.id,
        summary: "Stable segment summary."
      });

      const published = await content.publishDocument(login.sessionToken, seed.documentId);
      expect(published.processing_status).toBe("current");
      const indexJobsAfterPublish = await prisma.indexRebuildJob.count();
      const chunkAfterPublish = await prisma.documentChunk.findUniqueOrThrow({
        where: { id: chunk.id }
      });
      expect(chunkAfterPublish.override_content_text).toBe("Stable override text");
      await expect(
        prisma.documentSegmentSummary.findUniqueOrThrow({ where: { chunk_id: chunk.id } })
      ).resolves.toMatchObject({ status: "active" });
      await content.publishDocument(login.sessionToken, seed.documentId);
      await expect(prisma.indexRebuildJob.count()).resolves.toBe(indexJobsAfterPublish);
    } finally {
      await content.disconnect();
    }
  });

  it("round-trips Dify chunk overlap settings and snapshots explicit reprocess rules", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const { knowledgeBase, document: page } = await createTypedPage(
        content,
        login.sessionToken,
        seed.workspaceId,
        "text_model",
        {
          title: "Chunk Rule Roundtrip",
          markdown: "# Chunk Rule Roundtrip\n\nThis document checks custom overlap settings."
        }
      );

      const settings = await content.updateChunkSettings(login.sessionToken, knowledgeBase.id, {
        doc_form: "text_model",
        process_rule_mode: "custom",
        parent_delimiter: " ",
        parent_max_characters: 260,
        chunk_overlap_characters: 26,
        process_rule: {
          segmentation: { separator: " ", max_tokens: 260, chunk_overlap: 26 }
        },
        summary_index_setting: { enable: true, summary_prompt: "Summarize for retrieval." }
      });
      expect(settings.process_rule).toMatchObject({
        segmentation: { separator: " ", max_tokens: 260, chunk_overlap: 26 }
      });
      expect(settings.chunk_overlap_characters).toBe(26);
      expect(settings.summary_index_setting).toMatchObject({
        enable: true,
        summary_prompt: "Summarize for retrieval."
      });

      let document = await content.getDocument(login.sessionToken, page.id);
      expect(document.processing_status).toBe("needs_reprocess");
      const reprocessed = await content.reprocessDocument(login.sessionToken, page.id);
      expect(reprocessed.processing_status).toBe("current");
      expect(reprocessed.process_rule_snapshot).toMatchObject({
        doc_form: "text_model",
        process_rule: {
          segmentation: { separator: " ", max_tokens: 260, chunk_overlap: 26 }
        },
        settings_revision: settings.revision,
        content_version_id: reprocessed.currentVersion?.id,
        content_markdown_hash: reprocessed.currentVersion?.markdown_hash
      });

      await expect(
        content.updateChunkSettings(login.sessionToken, seed.knowledgeBaseId, {
          doc_form: "qa_model"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        content.updateChunkSettings(login.sessionToken, seed.knowledgeBaseId, {
          doc_form: "text_model",
          process_rule_mode: "hierarchical"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });

  it("requires current-version segments before QA or summary generation", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const current = await content.getDocument(login.sessionToken, seed.documentId);
      const nextMarkdown = `# Needs Reprocess

This new version should not use stale chunks for derived QA or summary generation.`;
      await content.updateDocument(login.sessionToken, seed.documentId, {
        base_version_id: current.currentVersion?.id ?? null,
        markdown: nextMarkdown,
        markdown_hash: markdownHash(nextMarkdown)
      });

      await expect(
        content.generateQaPairs(login.sessionToken, seed.documentId, {
          mode: "mock",
          scope: "document"
        })
      ).rejects.toMatchObject({ code: "REPROCESS_REQUIRED" });

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "document",
          mode: "mock"
        })
      ).rejects.toMatchObject({ code: "REPROCESS_REQUIRED" });

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "all_segments",
          mode: "mock"
        })
      ).rejects.toMatchObject({ code: "REPROCESS_REQUIRED" });
    } finally {
      await content.disconnect();
    }
  });

  it("manages document segments without mutating Markdown versions", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const document = await content.getDocument(login.sessionToken, seed.documentId);
      const originalMarkdown = document.currentVersion?.markdown ?? "";
      const chunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        { document_id: seed.documentId }
      );
      const chunk = chunks.find((item) => item.chunk_type !== "parent") ?? chunks[0];
      if (!chunk) {
        throw new Error("Expected seeded document chunks.");
      }

      const overridden = await content.updateDocumentSegment(
        login.sessionToken,
        seed.documentId,
        chunk.id,
        {
          override_content_text: "Override retrieval text",
          override_content_markdown: "Override retrieval text",
          status: "disabled"
        }
      );
      expect(overridden).toMatchObject({
        content_text: "Override retrieval text",
        has_override: true,
        needs_chunk_rebuild: false,
        needs_index_rebuild: true,
        status: "disabled"
      });

      const defaultChunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        { document_id: seed.documentId }
      );
      expect(defaultChunks.some((item) => item.id === chunk.id && item.status === "disabled")).toBe(
        true
      );

      await content.updateDocumentSegment(login.sessionToken, seed.documentId, chunk.id, {
        status: "deleted"
      });
      const hiddenDeleted = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        { document_id: seed.documentId }
      );
      expect(hiddenDeleted.some((item) => item.id === chunk.id)).toBe(false);
      const deletedOnly = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        { document_id: seed.documentId, status: "deleted" }
      );
      expect(deletedOnly.map((item) => item.id)).toContain(chunk.id);

      const restored = await content.updateDocumentSegment(
        login.sessionToken,
        seed.documentId,
        chunk.id,
        {
          reset_override: true,
          status: "active"
        }
      );
      expect(restored.has_override).toBe(false);
      expect(restored.content_text).toBe(restored.source_content_text);

      const afterSegmentEdit = await content.getDocument(login.sessionToken, seed.documentId);
      expect(afterSegmentEdit.currentVersion?.markdown).toBe(originalMarkdown);

      await content.reprocessDocument(login.sessionToken, seed.documentId);
      await expect(
        prisma.documentChunk.findUnique({ where: { id: chunk.id } })
      ).resolves.toBeNull();
      const reprocessedChunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        seed.knowledgeBaseId,
        { document_id: seed.documentId, status: "all" }
      );
      expect(reprocessedChunks.length).toBeGreaterThan(0);
      expect(
        reprocessedChunks.every((item) => item.status === "active" && !item.has_override)
      ).toBe(true);
    } finally {
      await content.disconnect();
    }
  });

  it("imports and indexes QA pairs only after explicit reprocess", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const { knowledgeBase, document } = await createTypedPage(
        content,
        login.sessionToken,
        seed.workspaceId,
        "qa_model",
        {
          title: "QA Import",
          markdown: "# QA Import\n\nA QA knowledge base indexes questions and returns answers."
        }
      );
      const imported = await content.importQaPairs(login.sessionToken, document.id, {
        csv: "question,answer\nWho swore brotherhood?,Liu Bei Guan Yu and Zhang Fei."
      });
      expect(imported).toMatchObject({ created: 1, skipped: 0 });
      await expect(
        prisma.documentChunk.count({
          where: { document_id: document.id, metadata: { path: ["qa_pair_id"], not: null } }
        })
      ).resolves.toBe(0);

      const reprocessed = await content.reprocessDocument(login.sessionToken, document.id);
      expect(reprocessed.processing_status).toBe("current");
      const chunks = await prisma.documentChunk.findMany({
        where: { document_id: document.id, knowledge_base_id: knowledgeBase.id, status: "active" },
        select: { content_text: true, metadata: true, index_role: true }
      });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        content_text: "Who swore brotherhood?",
        index_role: "content"
      });
      expect(chunks[0]?.metadata).toMatchObject({
        hit_type: "qa",
        qa_answer: "Liu Bei Guan Yu and Zhang Fei."
      });
    } finally {
      await content.disconnect();
    }
  });

  it("stores mock QA as first-class source and skips invalid source segments on qa_model reprocess", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const { document } = await createTypedPage(
        content,
        login.sessionToken,
        seed.workspaceId,
        "qa_model",
        {
          title: "QA Mock",
          markdown: "# QA Mock\n\nA seeded source segment exists only for QA generation."
        }
      );
      const sourceChunk = await prisma.documentChunk.create({
        data: {
          tenant_id: document.tenant_id,
          workspace_id: document.workspace_id,
          knowledge_base_id: document.knowledge_base_id,
          document_id: document.id,
          version_id: document.currentVersion!.id,
          ordinal: 0,
          chunk_type: "general",
          settings_revision: 1,
          content_text: "A seeded source segment exists only for QA generation.",
          content_markdown: "A seeded source segment exists only for QA generation.",
          token_count: 9,
          metadata: {}
        }
      });
      const generated = await content.generateQaPairs(login.sessionToken, document.id, {
        mode: "mock",
        scope: "segments",
        count: 1
      });
      expect(generated.created).toBe(1);
      expect(generated.items[0]).toMatchObject({
        source: "mock",
        metadata: { generated_mode: "mock" }
      });
      expect(generated.items[0]?.source_chunk_id).toEqual(expect.any(String));

      expect(generated.items[0]?.source_chunk_id).toBe(sourceChunk.id);

      await content.updateDocumentSegment(login.sessionToken, document.id, sourceChunk.id, {
        status: "disabled"
      });
      await content.reprocessDocument(login.sessionToken, document.id);

      await expect(
        prisma.documentChunk.count({
          where: { document_id: document.id, metadata: { path: ["hit_type"], equals: "qa" } }
        })
      ).resolves.toBe(0);
    } finally {
      await content.disconnect();
    }
  });

  it("generates document and segment summaries as derived index rows without changing markdown", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const before = await content.getDocument(login.sessionToken, seed.documentId);
      const originalMarkdown = before.currentVersion?.markdown ?? "";
      await content.reprocessDocument(login.sessionToken, seed.documentId);

      const documentSummary = await content.generateSegmentSummary(
        login.sessionToken,
        seed.documentId,
        {
          scope: "document",
          mode: "manual",
          summary: "This document introduces the OpenKB seed content."
        }
      );
      expect(documentSummary).toMatchObject({
        summary: "This document introduces the OpenKB seed content.",
        needs_index_rebuild: true
      });

      const generated = await content.generateSegmentSummary(login.sessionToken, seed.documentId, {
        scope: "all_segments",
        mode: "mock"
      });
      expect(generated).toMatchObject({
        needs_index_rebuild: true,
        needs_chunk_rebuild: false
      });

      const summaries = await content.listDocumentSummaries(login.sessionToken, seed.documentId);
      expect(summaries.document_summary?.summary).toContain("OpenKB seed content");
      expect(summaries.segment_summaries.length).toBeGreaterThan(0);
      await expect(
        prisma.documentChunk.count({
          where: { document_id: seed.documentId, index_role: "summary", status: "active" }
        })
      ).resolves.toBeGreaterThanOrEqual(2);

      await content.reprocessDocument(login.sessionToken, seed.documentId);
      const activeSummaryChunksAfterReprocess = await prisma.documentChunk.findMany({
        where: { document_id: seed.documentId, index_role: "summary", status: "active" }
      });
      expect(
        activeSummaryChunksAfterReprocess.some(
          (chunk) =>
            (chunk.metadata as { summary_id?: string; summary_scope?: string }).summary_id ===
              documentSummary.id &&
            (chunk.metadata as { summary_id?: string; summary_scope?: string }).summary_scope ===
              "document"
        )
      ).toBe(true);

      const after = await content.getDocument(login.sessionToken, seed.documentId);
      expect(after.currentVersion?.markdown).toBe(originalMarkdown);
    } finally {
      await content.disconnect();
    }
  });

  it("rejects ambiguous segment summary chunk_id usage", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      await content.reprocessDocument(login.sessionToken, seed.documentId);
      const chunk = await prisma.documentChunk.findFirstOrThrow({
        where: { document_id: seed.documentId, status: "active", index_role: "content" },
        orderBy: { ordinal: "asc" }
      });

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "segment",
          mode: "mock"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "document",
          chunk_id: chunk.id,
          mode: "manual",
          summary: "Document summary should not target one segment."
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "all_segments",
          chunk_id: chunk.id,
          mode: "mock"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await content.disconnect();
    }
  });

  it("rejects segment summary generation for stale chunk ids from old versions", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      await content.reprocessDocument(login.sessionToken, seed.documentId);
      const staleChunk = await prisma.documentChunk.findFirstOrThrow({
        where: { document_id: seed.documentId, status: "active", index_role: "content" },
        orderBy: { ordinal: "asc" }
      });

      const current = await content.getDocument(login.sessionToken, seed.documentId);
      const nextMarkdown = `# Fresh Current Version

Only chunks from this version may be used for segment summaries.`;
      await content.updateDocument(login.sessionToken, seed.documentId, {
        base_version_id: current.currentVersion?.id ?? null,
        markdown: nextMarkdown,
        markdown_hash: markdownHash(nextMarkdown)
      });
      await content.reprocessDocument(login.sessionToken, seed.documentId);

      await expect(
        content.generateSegmentSummary(login.sessionToken, seed.documentId, {
          scope: "segment",
          chunk_id: staleChunk.id,
          mode: "mock"
        })
      ).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" });
    } finally {
      await content.disconnect();
    }
  });

  it("reprocesses Dify hierarchical paragraph and full document parent chunks", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const markdown = `# Parent Child

Paragraph one. ${"Shu Han ".repeat(50)}

Paragraph two. ${"Wei kingdom ".repeat(50)}

Paragraph three. ${"Wu fleet ".repeat(50)}`;
      const { knowledgeBase, document } = await createTypedPage(
        content,
        login.sessionToken,
        seed.workspaceId,
        "hierarchical_model",
        { title: "Parent Child", markdown }
      );
      await content.updateChunkSettings(login.sessionToken, knowledgeBase.id, {
        process_rule: {
          parent_mode: "paragraph",
          segmentation: { separator: "\n\n", max_tokens: 180, chunk_overlap: 0 },
          subchunk_segmentation: { separator: " ", max_tokens: 120, chunk_overlap: 20 }
        }
      });

      await content.reprocessDocument(login.sessionToken, document.id);
      const paragraphChunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        knowledgeBase.id,
        { document_id: document.id, limit: 500 }
      );
      const paragraphParents = paragraphChunks.filter((chunk) => chunk.chunk_type === "parent");
      const paragraphChildren = paragraphChunks.filter((chunk) => chunk.chunk_type === "child");
      expect(paragraphParents.length).toBeGreaterThan(1);
      expect(paragraphChildren.length).toBeGreaterThanOrEqual(paragraphParents.length);
      expect(paragraphChildren.every((chunk) => Boolean(chunk.parent_chunk_id))).toBe(true);
      expect(paragraphChunks[0]?.metadata).toMatchObject({
        doc_form: "hierarchical_model",
        process_rule_mode: "hierarchical",
        parent_mode: "paragraph"
      });

      await content.updateDocumentProcessing(login.sessionToken, document.id, {
        parent_mode: "full_doc"
      });
      await content.reprocessDocument(login.sessionToken, document.id);
      const fullDocChunks = await content.listKnowledgeBaseChunks(
        login.sessionToken,
        knowledgeBase.id,
        { document_id: document.id, limit: 500 }
      );
      const fullDocParents = fullDocChunks.filter((chunk) => chunk.chunk_type === "parent");
      const fullDocChildren = fullDocChunks.filter((chunk) => chunk.chunk_type === "child");
      expect(fullDocParents).toHaveLength(1);
      expect(fullDocChildren.length).toBeGreaterThan(1);
      expect(fullDocChunks[0]?.metadata).toMatchObject({ parent_mode: "full_doc" });
    } finally {
      await content.disconnect();
    }
  });

  it("manages Dify-style knowledge base and document metadata", async () => {
    const seed = await seedDev({ prisma });
    const content = new ContentService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });

      const fields = await content.listKnowledgeBaseMetadataFields(
        login.sessionToken,
        seed.knowledgeBaseId
      );
      expect(fields.built_in.map((field) => field.name)).toEqual([
        "document_name",
        "uploader",
        "upload_date",
        "last_update_date",
        "source"
      ]);

      await expect(
        content.createKnowledgeBaseMetadataField(login.sessionToken, seed.knowledgeBaseId, {
          name: "document_name",
          type: "string"
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      const dynastyField = await content.createKnowledgeBaseMetadataField(
        login.sessionToken,
        seed.knowledgeBaseId,
        {
          name: "dynasty",
          type: "string",
          sort_order: 1
        }
      );
      const chapterField = await content.createKnowledgeBaseMetadataField(
        login.sessionToken,
        seed.knowledgeBaseId,
        {
          name: "chapter_no",
          type: "number",
          sort_order: 2
        }
      );

      const saved = await content.updateDocumentMetadata(login.sessionToken, seed.documentId, {
        values: {
          dynasty: "shu",
          chapter_no: "1"
        }
      });
      expect(saved.values).toMatchObject({
        document_name: "Welcome to OpenKB",
        uploader: "OpenKB Dev Admin",
        source: "online_document",
        dynasty: "shu",
        chapter_no: 1
      });
      expect(saved.fields.custom.map((field) => field.name)).toEqual(["dynasty", "chapter_no"]);

      await expect(
        content.updateDocumentMetadata(login.sessionToken, seed.documentId, {
          values: { chapter_no: "not-a-number" }
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await expect(
        content.updateDocumentMetadata(login.sessionToken, seed.documentId, {
          values: { dynasty: { value: "shu" } }
        })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      await content.deleteKnowledgeBaseMetadataField(
        login.sessionToken,
        seed.knowledgeBaseId,
        dynastyField.id
      );
      const afterArchive = await content.getDocumentMetadata(login.sessionToken, seed.documentId);
      expect(afterArchive.fields.custom.map((field) => field.name)).toEqual(["chapter_no"]);
      expect(afterArchive.values).not.toHaveProperty("dynasty");
      expect(afterArchive.values).toMatchObject({ chapter_no: 1 });

      await content.deleteKnowledgeBaseMetadataField(
        login.sessionToken,
        seed.knowledgeBaseId,
        chapterField.id
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "knowledge_base.metadata_field.archive", object_id: seed.knowledgeBaseId },
        orderBy: { created_at: "desc" }
      });
      expect(audit.metadata).toMatchObject({ field_id: chapterField.id });
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

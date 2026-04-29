import { createHash } from "node:crypto";

import { createDatabaseClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { AuthService } from "@openkb/auth";
import { PermissionService } from "@openkb/permissions";
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
    await seedDev({ prisma });
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
});

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

import { createHash, randomBytes } from "node:crypto";

import { AuthService } from "@openkb/auth";
import { createDatabaseClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import { PermissionService } from "@openkb/permissions";
import { createObjectStorage } from "@openkb/storage";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ImportService } from "./import.service";

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
  "document_asset_bindings",
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
const storage = createObjectStorage();

describe("ImportService", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
    await storage.ensureBucket();
  });

  afterAll(async () => {
    await permissions.disconnect();
  });

  it("uploads source assets, creates pending jobs, lists jobs, and returns presigned URLs", async () => {
    const seed = await seedDev({ prisma });
    const imports = new ImportService(auth, permissions);

    try {
      const login = await auth.login({
        email: "admin@openkb.local",
        password: DEV_ADMIN_PASSWORD
      });
      const asset = await imports.upload(login.sessionToken, {
        filename: "Roadmap.md",
        mimeType: "text/markdown",
        body: Buffer.from("# Roadmap"),
        knowledgeBaseId: seed.knowledgeBaseId,
        parentId: seed.folderId
      });
      await expect(storage.headObject({ key: asset.object_key })).resolves.toBeTruthy();

      const job = await imports.createImportJob(login.sessionToken, {
        source_asset_id: asset.id,
        knowledge_base_id: seed.knowledgeBaseId,
        parent_id: seed.folderId,
        title: "Imported Roadmap",
        converter: "auto"
      });
      const listed = await imports.listImportJobs(login.sessionToken, seed.knowledgeBaseId);
      const signed = await imports.createPresignedAssetUrl(login.sessionToken, asset.id);

      expect(job).toMatchObject({
        status: "pending",
        title: "Imported Roadmap",
        source_asset_id: asset.id
      });
      expect(listed.map((item) => item.id)).toContain(job.id);
      expect(signed.url).toContain("X-Amz-Signature");
    } finally {
      await imports.disconnect();
    }
  });

  it("blocks upload/import for users without edit permission and protects document-bound URLs", async () => {
    const seed = await seedDev({ prisma });
    const imports = new ImportService(auth, permissions);
    const viewerSessionToken = await createActiveSessionWithoutWorkspaceAccess(seed.tenantId);

    try {
      await expect(
        imports.upload(viewerSessionToken, {
          filename: "Blocked.md",
          mimeType: "text/markdown",
          body: Buffer.from("# Blocked"),
          knowledgeBaseId: seed.knowledgeBaseId
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const sourceAsset = await prisma.documentAsset.create({
        data: {
          tenant_id: seed.tenantId,
          document_id: seed.documentId,
          object_key: "tenants/test/assets/protected.md",
          filename: "protected.md",
          mime_type: "text/markdown",
          size_bytes: 1,
          checksum_sha256: "0".repeat(64),
          storage_bucket: "openkb-assets",
          metadata: {},
          created_by: seed.userId
        }
      });
      await expect(
        imports.createPresignedAssetUrl(viewerSessionToken, sourceAsset.id)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await imports.disconnect();
    }
  });
});

async function createActiveSessionWithoutWorkspaceAccess(tenantId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `viewer-${Date.now()}@openkb.local`,
      display_name: "No Access Viewer",
      status: "active",
      email_verified_at: new Date()
    }
  });
  await prisma.tenantMembership.create({
    data: {
      tenant_id: tenantId,
      user_id: user.id,
      role: "member"
    }
  });

  const rawToken = randomBytes(32).toString("base64url");
  await prisma.authSession.create({
    data: {
      tenant_id: tenantId,
      user_id: user.id,
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      created_at: new Date()
    }
  });
  return rawToken;
}

import { randomUUID } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { seedDev } from "@openkb/db/seed-dev";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionService } from "./service";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for permission integration tests.");
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

let prisma: PrismaClient;
let permissions: PermissionService;

describe("PermissionService integration", () => {
  beforeAll(() => {
    prisma = createDatabaseClient();
    permissions = new PermissionService({ prisma });
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
  });

  afterAll(async () => {
    await permissions.disconnect();
  });

  it("applies workspace visibility and private KB rules without admin bypass", async () => {
    const seed = await seedDev({ prisma });
    const member = await createUser(prisma, seed.tenantId, "member@example.com");
    const guest = await createUser(prisma, seed.tenantId, "guest@example.com");
    const workspaceAdmin = await createUser(prisma, seed.tenantId, "workspace-admin@example.com");
    const privateKb = await prisma.knowledgeBase.create({
      data: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        title: "Private KB",
        slug: `private-${randomUUID()}`,
        visibility: "private",
        status: "active",
        created_by: seed.userId
      }
    });

    await prisma.workspaceMember.createMany({
      data: [
        {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          user_id: member.id,
          role: "member"
        },
        {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          user_id: guest.id,
          role: "guest"
        },
        {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          user_id: workspaceAdmin.id,
          role: "admin"
        }
      ]
    });

    expect(await permissions.canRead(member.id, "knowledge_base", seed.knowledgeBaseId)).toBe(true);
    expect(await permissions.canRead(guest.id, "knowledge_base", seed.knowledgeBaseId)).toBe(false);
    expect(await permissions.canRead(workspaceAdmin.id, "knowledge_base", privateKb.id)).toBe(
      false
    );

    await prisma.collaborator.create({
      data: {
        tenant_id: seed.tenantId,
        object_type: "knowledge_base",
        object_id: privateKb.id,
        subject_type: "user",
        subject_id: member.id,
        role: "viewer",
        source: "direct",
        created_by: seed.userId
      }
    });

    expect(await permissions.canRead(member.id, "knowledge_base", privateKb.id)).toBe(true);
    expect(await permissions.resolveObjectRole(member.id, "knowledge_base", privateKb.id)).toBe(
      "viewer"
    );
  });

  it("enforces viewer/editor/manager document capabilities", async () => {
    const seed = await seedDev({ prisma });
    const viewer = await createUser(prisma, seed.tenantId, "viewer@example.com");
    const editor = await createUser(prisma, seed.tenantId, "editor@example.com");
    const manager = await createUser(prisma, seed.tenantId, "manager@example.com");

    await prisma.collaborator.createMany({
      data: [
        collaborator(seed, viewer.id, "viewer"),
        collaborator(seed, editor.id, "editor"),
        collaborator(seed, manager.id, "manager")
      ]
    });

    expect(await permissions.canRead(viewer.id, "document", seed.documentId)).toBe(true);
    expect(await permissions.canEdit(viewer.id, "document", seed.documentId)).toBe(false);
    expect(await permissions.canEdit(editor.id, "document", seed.documentId)).toBe(true);
    expect(await permissions.canManage(editor.id, "document", seed.documentId)).toBe(false);
    expect(await permissions.canManage(manager.id, "document", seed.documentId)).toBe(true);
  });

  it("returns access principals for later indexing prefilters", async () => {
    const seed = await seedDev({ prisma });

    const principals = await permissions.getAccessPrincipals(seed.userId, seed.tenantId);

    expect(principals).toContain(`user:${seed.userId}`);
    expect(principals).toContain(`tenant:${seed.tenantId}:system_admin`);
    expect(principals).toContain(`workspace:${seed.workspaceId}:owner`);
  });
});

async function createUser(prisma: PrismaClient, tenantId: string, email: string) {
  const user = await prisma.user.create({
    data: {
      email,
      password_hash: "hash",
      display_name: email,
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
  return user;
}

function collaborator(
  seed: Awaited<ReturnType<typeof seedDev>>,
  userId: string,
  role: "viewer" | "editor" | "manager"
) {
  return {
    tenant_id: seed.tenantId,
    object_type: "document",
    object_id: seed.documentId,
    subject_type: "user",
    subject_id: userId,
    role,
    source: "direct",
    created_by: seed.userId
  };
}

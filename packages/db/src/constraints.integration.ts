import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedFirstAdmin } from "./seed-first-admin";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const pool = new Pool({ connectionString: databaseUrl });

const allTables = [
  "audit_logs",
  "auth_email_outbox",
  "auth_tokens",
  "auth_sessions",
  "model_settings",
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
  "chunk_rebuild_jobs",
  "document_chunks",
  "knowledge_base_chunk_settings",
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

type BaseRows = {
  tenantId: string;
  userId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  documentId: string;
};

async function resetDatabase() {
  await pool.query(`TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`);
}

async function insertBaseRows(): Promise<BaseRows> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const knowledgeBaseId = randomUUID();
  const documentId = randomUUID();

  await pool.query(
    "INSERT INTO users (id, email, password_hash, display_name, status, email_verified_at, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now(), now())",
    [userId, `${userId}@example.com`, "hash", "Constraint User"]
  );
  await pool.query("INSERT INTO tenants (id, name, slug, created_at) VALUES ($1, $2, $3, now())", [
    tenantId,
    "Constraint Tenant",
    `tenant-${tenantId}`
  ]);
  await pool.query(
    "INSERT INTO workspaces (id, tenant_id, name, slug, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())",
    [workspaceId, tenantId, "Workspace", `workspace-${workspaceId}`, userId]
  );
  await pool.query(
    "INSERT INTO knowledge_bases (id, tenant_id, workspace_id, title, slug, visibility, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'private', 'active', $6, now(), now())",
    [knowledgeBaseId, tenantId, workspaceId, "Knowledge Base", `kb-${knowledgeBaseId}`, userId]
  );
  await pool.query(
    "INSERT INTO documents (id, tenant_id, workspace_id, knowledge_base_id, type, title, slug, status, created_by, updated_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'page', $5, $6, 'draft', $7, $7, now(), now())",
    [documentId, tenantId, workspaceId, knowledgeBaseId, "Document", `doc-${documentId}`, userId]
  );

  return {
    tenantId,
    userId,
    workspaceId,
    knowledgeBaseId,
    documentId
  };
}

describe("OpenKB PostgreSQL constraints", () => {
  beforeAll(async () => {
    const result = await pool.query("SELECT to_regclass('public.users') AS users_table");
    expect(result.rows[0]?.users_table).toBe("users");
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects content roles in workspace_members", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO workspace_members (tenant_id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, 'manager', now())",
        [base.tenantId, base.workspaceId, base.userId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects workspace roles in collaborators", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO collaborators (tenant_id, object_type, object_id, subject_type, subject_id, role, source, created_by, created_at) VALUES ($1, 'knowledge_base', $2, 'user', $3, 'admin', 'direct', $3, now())",
        [base.tenantId, base.knowledgeBaseId, base.userId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects owner grants through workspace invitations", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO invitations (tenant_id, object_type, object_id, role, token_hash, status, invited_by, created_at) VALUES ($1, 'workspace', $2, 'owner', $3, 'pending', $4, now())",
        [base.tenantId, base.workspaceId, randomUUID(), base.userId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects owner grants through content invitations", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO invitations (tenant_id, object_type, object_id, role, token_hash, status, invited_by, created_at) VALUES ($1, 'document', $2, 'owner', $3, 'pending', $4, now())",
        [base.tenantId, base.documentId, randomUUID(), base.userId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps share links read-only", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO share_links (tenant_id, object_type, object_id, token_hash, permission, created_by, created_at) VALUES ($1, 'document', $2, $3, 'edit', $4, now())",
        [base.tenantId, base.documentId, randomUUID(), base.userId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("allows only one instance-default auth_settings row", async () => {
    await pool.query(
      "INSERT INTO auth_settings (tenant_id, created_at, updated_at) VALUES (NULL, now(), now())"
    );

    await expect(
      pool.query(
        "INSERT INTO auth_settings (tenant_id, created_at, updated_at) VALUES (NULL, now(), now())"
      )
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("models folders as documents and does not create a folders table", async () => {
    const base = await insertBaseRows();
    const folderId = randomUUID();

    await pool.query(
      "INSERT INTO documents (id, tenant_id, workspace_id, knowledge_base_id, type, title, slug, status, created_by, updated_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'folder', $5, $6, 'draft', $7, $7, now(), now())",
      [
        folderId,
        base.tenantId,
        base.workspaceId,
        base.knowledgeBaseId,
        "Folder",
        `folder-${folderId}`,
        base.userId
      ]
    );

    const document = await pool.query("SELECT type FROM documents WHERE id = $1", [folderId]);
    const foldersTable = await pool.query("SELECT to_regclass('public.folders') AS folders_table");

    expect(document.rows[0]?.type).toBe("folder");
    expect(foldersTable.rows[0]?.folders_table).toBeNull();
  });

  it("does not add knowledge-base model configuration or plaintext provider key storage", async () => {
    const forbiddenTables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [
        [
          "folders",
          "knowledge_base_model_configs",
          "embedding_provider_keys",
          "rerank_provider_keys"
        ]
      ]
    );
    const forbiddenColumns = await pool.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = ANY($1::text[])",
      [["embedding_api_key", "rerank_api_key", "provider_api_key", "api_key", "model_config"]]
    );
    const modelSettingsColumns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'model_settings' ORDER BY column_name"
    );

    expect(forbiddenTables.rowCount).toBe(0);
    expect(forbiddenColumns.rowCount).toBe(0);
    expect(modelSettingsColumns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining(["encrypted_api_key", "api_key_last4"])
    );
  });

  it("constrains model provider formats by model kind", async () => {
    const base = await insertBaseRows();

    await expect(
      pool.query(
        "INSERT INTO model_settings (kind, provider, enabled, updated_by) VALUES ('embedding', 'openai_responses', false, $1)",
        [base.userId]
      )
    ).rejects.toThrow();

    await expect(
      pool.query(
        "INSERT INTO model_settings (kind, provider, enabled, updated_by) VALUES ('language', 'openai_compatible', false, $1)",
        [base.userId]
      )
    ).rejects.toThrow();

    await expect(
      pool.query(
        "INSERT INTO model_settings (kind, provider, enabled, updated_by) VALUES ('language', 'openai_chat_completions', false, $1)",
        [base.userId]
      )
    ).resolves.toBeDefined();
  });

  it("seeds the first admin idempotently", async () => {
    const env = {
      ...process.env,
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "not-a-default-password",
      ADMIN_DISPLAY_NAME: "Admin User",
      DEFAULT_TENANT_NAME: "Default Tenant",
      DEFAULT_TENANT_SLUG: "default"
    };

    const first = await seedFirstAdmin({ env });
    const second = await seedFirstAdmin({ env });

    const users = await pool.query("SELECT id, email, password_hash, status FROM users");
    const tenants = await pool.query("SELECT id, slug FROM tenants");
    const memberships = await pool.query("SELECT role FROM tenant_memberships");
    const authSettings = await pool.query("SELECT tenant_id FROM auth_settings");

    expect(second).toEqual(first);
    expect(users.rowCount).toBe(1);
    expect(users.rows[0]).toMatchObject({
      email: "admin@example.com",
      status: "active"
    });
    expect(users.rows[0]?.password_hash).not.toBe("not-a-default-password");
    expect(tenants.rows).toEqual([{ id: first.tenantId, slug: "default" }]);
    expect(memberships.rows).toEqual([{ role: "system_admin" }]);
    expect(authSettings.rows).toEqual([{ tenant_id: null }]);
  });
});

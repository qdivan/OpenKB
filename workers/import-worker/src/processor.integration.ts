import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { DEV_ADMIN_PASSWORD, seedDev } from "@openkb/db/seed-dev";
import {
  createObjectStorage,
  createAssetObjectKey,
  checksumSha256,
  type ObjectStorage
} from "@openkb/storage";
import { AuthService } from "@openkb/auth";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runImportOnce } from "./processor";

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
const storage = createObjectStorage();
const auth = new AuthService({ prisma });

describe("import worker", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${allTables.join(", ")} RESTART IDENTITY CASCADE`
    );
    await storage.ensureBucket();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("imports Markdown, text, HTML, and CSV into documents, versions, and chunks", async () => {
    const seed = await seedDev({ prisma });
    const login = await auth.login({
      email: "admin@openkb.local",
      password: DEV_ADMIN_PASSWORD
    });

    const sourceFiles = [
      { filename: "phase-6.md", body: "# Phase 6\n\nMarkdown import.", converter: "auto" },
      { filename: "notes.txt", body: "Plain notes\n\n# escaped heading", converter: "auto" },
      { filename: "page.html", body: "<h1>HTML</h1><p>Converted</p>", converter: "auto" },
      { filename: "data.csv", body: "Name,Value\nOpenKB,Import", converter: "auto" }
    ] as const;

    for (const sourceFile of sourceFiles) {
      const asset = await createSourceAsset(prisma, {
        tenantId: seed.tenantId,
        userId: seed.userId,
        knowledgeBaseId: seed.knowledgeBaseId,
        filename: sourceFile.filename,
        body: sourceFile.body
      });
      await prisma.importJob.create({
        data: {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          knowledge_base_id: seed.knowledgeBaseId,
          parent_id: seed.folderId,
          source_asset_id: asset.id,
          status: "pending",
          converter: sourceFile.converter,
          created_by: seed.userId
        }
      });
    }

    for (const _ of sourceFiles) {
      expect(await runImportOnce({ prisma, storage })).toMatchObject({
        processed: true,
        status: "succeeded"
      });
    }
    expect(await runImportOnce({ prisma, storage })).toEqual({ processed: false });

    const importedDocuments = await prisma.document.findMany({
      where: {
        knowledge_base_id: seed.knowledgeBaseId,
        created_by: login.me.user.id,
        title: { in: ["phase-6", "notes", "page", "data"] }
      }
    });
    const jobs = await prisma.importJob.findMany({ where: { status: "succeeded" } });
    const versions = await prisma.documentVersion.findMany({
      where: {
        source_type: "import"
      }
    });
    const chunks = await prisma.documentChunk.findMany({
      where: {
        knowledge_base_id: seed.knowledgeBaseId
      }
    });

    expect(importedDocuments).toHaveLength(sourceFiles.length);
    expect(importedDocuments.every((document) => document.parent_id === seed.folderId)).toBe(true);
    expect(jobs).toHaveLength(sourceFiles.length);
    expect(versions).toHaveLength(sourceFiles.length);
    expect(versions.every((version) => version.source_file_id)).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(sourceFiles.length);
  });

  it("records failed jobs for unavailable converters without creating documents", async () => {
    const seed = await seedDev({ prisma });
    await prisma.importFormatRoute.create({
      data: {
        format: "pdf",
        enabled: true,
        primary_tool: "mineru",
        fallback_tools: [],
        updated_by: seed.userId
      }
    });
    const asset = await createSourceAsset(prisma, {
      tenantId: seed.tenantId,
      userId: seed.userId,
      knowledgeBaseId: seed.knowledgeBaseId,
      filename: "paper.pdf",
      body: "%PDF unavailable"
    });
    const job = await prisma.importJob.create({
      data: {
        tenant_id: seed.tenantId,
        workspace_id: seed.workspaceId,
        knowledge_base_id: seed.knowledgeBaseId,
        source_asset_id: asset.id,
        status: "pending",
        converter: "auto",
        created_by: seed.userId
      }
    });

    expect(await runImportOnce({ prisma, storage })).toMatchObject({
      processed: true,
      status: "failed",
      error: "CONVERTER_UNAVAILABLE"
    });

    const failed = await prisma.importJob.findUnique({ where: { id: job.id } });
    const importedDocuments = await prisma.document.findMany({
      where: {
        knowledge_base_id: seed.knowledgeBaseId,
        title: "paper"
      }
    });

    expect(failed).toMatchObject({
      status: "failed",
      error: "CONVERTER_UNAVAILABLE",
      document_id: null
    });
    expect(importedDocuments).toHaveLength(0);
  });

  it("imports complex files through a configured external adapter", async () => {
    const seed = await seedDev({ prisma });
    const tempDir = await mkdtemp(join(tmpdir(), "openkb-markitdown-test-"));
    const scriptPath = join(tempDir, "mock-markitdown.cjs");
    await writeFile(
      scriptPath,
      `
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args[args.indexOf("-o") + 1];
if (!output) process.exit(2);
fs.writeFileSync(output, "# Mock PDF\\n\\nConverted from PDF.");
`
    );

    try {
      await prisma.importToolSetting.create({
        data: {
          tool_key: "markitdown",
          enabled: true,
          mode: "local_cli",
          command: `"${process.execPath}" "${scriptPath}"`,
          timeout_ms: 30000,
          max_file_mb: 100,
          options: {},
          updated_by: seed.userId
        }
      });
      const asset = await createSourceAsset(prisma, {
        tenantId: seed.tenantId,
        userId: seed.userId,
        knowledgeBaseId: seed.knowledgeBaseId,
        filename: "paper.pdf",
        body: "%PDF mock"
      });
      const job = await prisma.importJob.create({
        data: {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          knowledge_base_id: seed.knowledgeBaseId,
          source_asset_id: asset.id,
          status: "pending",
          converter: "auto",
          created_by: seed.userId
        }
      });

      expect(await runImportOnce({ prisma, storage })).toMatchObject({
        processed: true,
        status: "succeeded"
      });

      const succeeded = await prisma.importJob.findUnique({ where: { id: job.id } });
      const version = await prisma.documentVersion.findFirst({
        where: { source_file_id: asset.id }
      });
      expect(succeeded).toMatchObject({
        status: "succeeded",
        converter: "markitdown"
      });
      expect(version?.markdown).toContain("Converted from PDF.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("cleans up extracted asset objects when the import transaction rolls back", async () => {
    const seed = await seedDev({ prisma });
    const tempDir = await mkdtemp(join(tmpdir(), "openkb-pandoc-test-"));
    const scriptPath = join(tempDir, "mock-pandoc.cjs");
    await writeFile(
      scriptPath,
      `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const output = args[args.indexOf("-o") + 1];
const mediaDir = args[args.indexOf("--extract-media") + 1];
if (!output || !mediaDir) process.exit(2);
fs.mkdirSync(mediaDir, { recursive: true });
fs.writeFileSync(path.join(mediaDir, "figure.png"), Buffer.from("mock-image"));
fs.writeFileSync(output, "# Mock DOCX\\n\\n![Figure](media/figure.png)");
`
    );
    const uploadedKeys: string[] = [];
    const deletedKeys: string[] = [];
    const trackingStorage: ObjectStorage = {
      bucket: storage.bucket,
      ensureBucket: () => storage.ensureBucket(),
      getObject: (input) => storage.getObject(input),
      headObject: (input) => storage.headObject(input),
      createPresignedGetUrl: (input) => storage.createPresignedGetUrl(input),
      async putObject(input) {
        uploadedKeys.push(input.key);
        return storage.putObject(input);
      },
      async deleteObject(input) {
        deletedKeys.push(input.key);
        return storage.deleteObject(input);
      }
    };

    try {
      await prisma.importToolSetting.create({
        data: {
          tool_key: "pandoc",
          enabled: true,
          mode: "local_cli",
          command: `"${process.execPath}" "${scriptPath}"`,
          timeout_ms: 30000,
          max_file_mb: 100,
          options: {},
          updated_by: seed.userId
        }
      });
      await prisma.importFormatRoute.create({
        data: {
          format: "docx",
          enabled: true,
          primary_tool: "pandoc",
          fallback_tools: [],
          updated_by: seed.userId
        }
      });
      const asset = await createSourceAsset(prisma, {
        tenantId: seed.tenantId,
        userId: seed.userId,
        knowledgeBaseId: seed.knowledgeBaseId,
        filename: "report.docx",
        body: "mock docx"
      });
      await prisma.document.update({
        where: { id: seed.folderId },
        data: { type: "page" }
      });
      await prisma.importJob.create({
        data: {
          tenant_id: seed.tenantId,
          workspace_id: seed.workspaceId,
          knowledge_base_id: seed.knowledgeBaseId,
          parent_id: seed.folderId,
          source_asset_id: asset.id,
          status: "pending",
          converter: "auto",
          created_by: seed.userId
        }
      });

      expect(await runImportOnce({ prisma, storage: trackingStorage })).toMatchObject({
        processed: true,
        status: "failed",
        error: "INVALID_PARENT"
      });
      expect(uploadedKeys).toHaveLength(1);
      expect(deletedKeys).toEqual(uploadedKeys);
      await expect(storage.headObject({ key: uploadedKeys[0]! })).rejects.toBeTruthy();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function createSourceAsset(
  prismaClient: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    knowledgeBaseId: string;
    filename: string;
    body: string;
  }
) {
  const id = randomUUID();
  const body = Buffer.from(input.body);
  const objectKey = createAssetObjectKey({
    tenantId: input.tenantId,
    assetId: id,
    filename: input.filename
  });
  await storage.putObject({
    key: objectKey,
    body,
    contentType: "application/octet-stream"
  });

  return prismaClient.documentAsset.create({
    data: {
      id,
      tenant_id: input.tenantId,
      object_key: objectKey,
      filename: input.filename,
      mime_type: "application/octet-stream",
      size_bytes: BigInt(body.byteLength),
      checksum_sha256: checksumSha256(body),
      storage_bucket: storage.bucket,
      metadata: {
        knowledge_base_id: input.knowledgeBaseId
      },
      created_by: input.userId
    }
  });
}

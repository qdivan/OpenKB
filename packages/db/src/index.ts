export { Prisma, PrismaClient } from "@prisma/client";

import { PrismaClient } from "@prisma/client";

export const DB_PACKAGE_NAME = "@openkb/db";
export const DATABASE_RUNTIME = "postgresql";

export const USER_STATUSES = [
  "pending_email_verification",
  "pending_activation",
  "active",
  "suspended",
  "deleted"
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUTH_TOKEN_PURPOSES = [
  "email_verification",
  "password_reset",
  "account_setup"
] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const AUTH_EMAIL_OUTBOX_STATUSES = ["pending", "sent", "failed"] as const;
export type AuthEmailOutboxStatus = (typeof AUTH_EMAIL_OUTBOX_STATUSES)[number];

export const TENANT_ROLES = ["system_admin", "tenant_admin", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const WORKSPACE_ROLES = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const CONTENT_ROLES = ["owner", "manager", "editor", "viewer"] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

export const CONTENT_INVITATION_ROLES = ["manager", "editor", "viewer"] as const;
export type ContentInvitationRole = (typeof CONTENT_INVITATION_ROLES)[number];

export const WORKSPACE_INVITATION_ROLES = ["admin", "member", "guest"] as const;
export type WorkspaceInvitationRole = (typeof WORKSPACE_INVITATION_ROLES)[number];

export const SHARE_LINK_PERMISSION = "view" as const;

export const CHUNK_TYPES = ["general", "parent", "child"] as const;
export type ChunkType = (typeof CHUNK_TYPES)[number];

export const KNOWLEDGE_BASE_DOC_FORMS = ["text_model", "hierarchical_model", "qa_model"] as const;
export type KnowledgeBaseDocForm = (typeof KNOWLEDGE_BASE_DOC_FORMS)[number];

export const KNOWLEDGE_BASE_INDEXING_TECHNIQUES = ["economy", "high_quality"] as const;
export type KnowledgeBaseIndexingTechnique = (typeof KNOWLEDGE_BASE_INDEXING_TECHNIQUES)[number];

export const KNOWLEDGE_BASE_PROCESS_RULE_MODES = ["automatic", "custom", "hierarchical"] as const;
export type KnowledgeBaseProcessRuleMode = (typeof KNOWLEDGE_BASE_PROCESS_RULE_MODES)[number];

export const KNOWLEDGE_BASE_CHUNK_MODES = ["general", "parent_child"] as const;
export type KnowledgeBaseChunkMode = (typeof KNOWLEDGE_BASE_CHUNK_MODES)[number];

export const KNOWLEDGE_BASE_CHUNK_PARENT_MODES = ["paragraph", "full_doc"] as const;
export type KnowledgeBaseChunkParentMode = (typeof KNOWLEDGE_BASE_CHUNK_PARENT_MODES)[number];

export const DOCUMENT_PROCESSING_STATUSES = [
  "current",
  "needs_reprocess",
  "processing",
  "failed"
] as const;
export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number];

export const DOCUMENT_SEGMENT_STATUSES = ["active", "disabled", "deleted"] as const;
export type DocumentSegmentStatus = (typeof DOCUMENT_SEGMENT_STATUSES)[number];

export const DOCUMENT_CHUNK_INDEX_ROLES = [
  "content",
  "summary",
  "asset_image",
  "asset_attachment"
] as const;
export type DocumentChunkIndexRole = (typeof DOCUMENT_CHUNK_INDEX_ROLES)[number];

export const DOCUMENT_QA_PAIR_SOURCES = ["manual", "csv", "llm", "mock"] as const;
export type DocumentQaPairSource = (typeof DOCUMENT_QA_PAIR_SOURCES)[number];

export const KNOWLEDGE_BASE_METADATA_FIELD_TYPES = ["string", "number", "time"] as const;
export type KnowledgeBaseMetadataFieldType = (typeof KNOWLEDGE_BASE_METADATA_FIELD_TYPES)[number];

export const KNOWLEDGE_BASE_METADATA_FIELD_STATUSES = ["active", "archived"] as const;
export type KnowledgeBaseMetadataFieldStatus =
  (typeof KNOWLEDGE_BASE_METADATA_FIELD_STATUSES)[number];

export const CHUNK_REBUILD_JOB_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;
export type ChunkRebuildJobStatus = (typeof CHUNK_REBUILD_JOB_STATUSES)[number];

export type DatabaseStatus = {
  packageName: typeof DB_PACKAGE_NAME;
  runtime: typeof DATABASE_RUNTIME;
  migrationsImplemented: true;
};

export const databaseStatus: DatabaseStatus = {
  packageName: DB_PACKAGE_NAME,
  runtime: DATABASE_RUNTIME,
  migrationsImplemented: true
};

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return databaseUrl;
}

export function createDatabaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl()
      }
    }
  });
}

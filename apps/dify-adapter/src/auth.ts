import { createHash, randomBytes } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";

import { getDifyAdapterConfig, type DifyAdapterConfig } from "./config";
import { DifyAdapterError } from "./errors";

export type DifyApiKeyContext = {
  id: string;
  tenantId: string;
  name: string;
  allowedKnowledgeBaseIds: string[];
  allowedMetadataFilters: Record<string, unknown>;
  retrievalTopKLimit: number;
};

export type CreateDifyApiKeyInput = {
  createdByEmail: string;
  name: string;
  knowledgeId: string;
  knowledgeBaseId: string;
  topKLimit?: number | null;
  expiresDays?: number | null;
};

export type CreateDifyApiKeyResult = {
  id: string;
  tenantId: string;
  knowledgeId: string;
  knowledgeBaseId: string;
  name: string;
  expiresAt: string | null;
  apiKey: string;
};

export class DifyAuthService {
  private readonly prisma: PrismaClient;
  private readonly config: DifyAdapterConfig;
  private readonly now: () => Date;

  constructor(
    options: {
      prisma?: PrismaClient;
      env?: NodeJS.ProcessEnv;
      now?: () => Date;
    } = {}
  ) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.config = getDifyAdapterConfig(options.env);
    this.now = options.now ?? (() => new Date());
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async authenticateAuthorizationHeader(
    authorizationHeader: string | string[] | undefined
  ): Promise<DifyApiKeyContext> {
    const bearer = extractBearerToken(authorizationHeader);
    if (!bearer) {
      throw new DifyAdapterError(
        "AUTHENTICATION_REQUIRED",
        "Authorization: Bearer API key is required.",
        401
      );
    }

    if (!bearer.startsWith(this.config.apiKeyPrefix)) {
      throw new DifyAdapterError("INVALID_API_KEY", "Dify API key is invalid or expired.", 401);
    }

    const key = await this.prisma.difyApiKey.findFirst({
      where: { key_hash: hashToken(bearer) }
    });
    const now = this.now();
    if (!key || key.status !== "active" || (key.expires_at && key.expires_at <= now)) {
      throw new DifyAdapterError("INVALID_API_KEY", "Dify API key is invalid or expired.", 401);
    }

    await this.prisma.difyApiKey.update({
      where: { id: key.id },
      data: { last_used_at: now }
    });

    return {
      id: key.id,
      tenantId: key.tenant_id,
      name: key.name,
      allowedKnowledgeBaseIds: key.allowed_knowledge_base_ids,
      allowedMetadataFilters: toRecord(key.allowed_metadata_filters),
      retrievalTopKLimit: key.retrieval_top_k_limit
    };
  }

  async createApiKey(input: CreateDifyApiKeyInput): Promise<CreateDifyApiKeyResult> {
    const createdByEmail = requireText(
      input.createdByEmail,
      "DIFY_KEY_CREATED_BY_EMAIL"
    ).toLowerCase();
    const name = requireText(input.name, "DIFY_API_KEY_NAME");
    const knowledgeId = requireText(input.knowledgeId, "DIFY_KNOWLEDGE_ID");
    const knowledgeBaseId = requireText(input.knowledgeBaseId, "DIFY_KNOWLEDGE_BASE_ID");
    const creator = await this.prisma.user.findUnique({ where: { email: createdByEmail } });
    if (!creator || creator.status !== "active") {
      throw new DifyAdapterError("INVALID_REQUEST", "Active key creator was not found.", 400);
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { user_id: creator.id },
      orderBy: { created_at: "asc" }
    });
    if (!membership) {
      throw new DifyAdapterError("INVALID_REQUEST", "Key creator has no tenant membership.", 400);
    }

    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        tenant_id: membership.tenant_id,
        status: "active"
      }
    });
    if (!knowledgeBase) {
      throw new DifyAdapterError("KNOWLEDGE_NOT_FOUND", "Knowledge base was not found.", 404);
    }

    const now = this.now();
    const rawKey = `${this.config.apiKeyPrefix}${randomBytes(32).toString("base64url")}`;
    const expiresAt =
      input.expiresDays && input.expiresDays > 0
        ? new Date(now.getTime() + input.expiresDays * 24 * 60 * 60 * 1000)
        : null;
    const topKLimit =
      input.topKLimit && input.topKLimit > 0
        ? Math.min(input.topKLimit, this.config.maxTopK)
        : this.config.maxTopK;

    const result = await this.prisma.$transaction(async (tx) => {
      const apiKey = await tx.difyApiKey.create({
        data: {
          tenant_id: membership.tenant_id,
          name,
          key_hash: hashToken(rawKey),
          status: "active",
          allowed_knowledge_base_ids: [knowledgeBase.id],
          allowed_metadata_filters: {},
          retrieval_top_k_limit: topKLimit,
          expires_at: expiresAt,
          created_by: creator.id,
          created_at: now,
          updated_at: now
        }
      });
      await tx.difyKnowledgeMapping.upsert({
        where: {
          tenant_id_dify_knowledge_id: {
            tenant_id: membership.tenant_id,
            dify_knowledge_id: knowledgeId
          }
        },
        create: {
          tenant_id: membership.tenant_id,
          dify_knowledge_id: knowledgeId,
          knowledge_base_id: knowledgeBase.id,
          status: "active",
          created_by: creator.id,
          created_at: now,
          updated_at: now
        },
        update: {
          knowledge_base_id: knowledgeBase.id,
          status: "active",
          created_by: creator.id,
          updated_at: now
        }
      });
      return apiKey;
    });

    return {
      id: result.id,
      tenantId: result.tenant_id,
      knowledgeId,
      knowledgeBaseId: knowledgeBase.id,
      name: result.name,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      apiKey: rawKey
    };
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function requireText(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new DifyAdapterError("INVALID_REQUEST", `${field} is required.`, 400);
  }
  return normalized;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

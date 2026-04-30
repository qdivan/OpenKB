import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { RetrievalError, RetrievalService, type RetrievalSearchResult } from "@openkb/retrieval";

import { DifyAuthService, type DifyApiKeyContext } from "./auth";
import { getDifyAdapterConfig, type DifyAdapterConfig } from "./config";
import { DifyAdapterError } from "./errors";
import {
  matchesMetadataConditions,
  normalizeOptionalMetadataCondition,
  type MetadataCondition
} from "./metadata-condition";

export type DifyRetrievalResponse = {
  records: DifyRetrievalRecord[];
};

export type DifyRetrievalRecord = {
  content: string;
  score: number;
  title: string;
  metadata: Record<string, unknown>;
};

export type DifyRequestMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export type NormalizedDifyRetrievalRequest = {
  knowledgeId: string;
  query: string;
  topK: number;
  scoreThreshold: number;
  metadataCondition: MetadataCondition | null;
  rawMetadataCondition: unknown;
};

type DifyKnowledgeMappingRow = {
  id: string;
  tenant_id: string;
  dify_knowledge_id: string;
  knowledge_base_id: string;
  status: string;
};

export class DifyAdapterService {
  private readonly prisma: PrismaClient;
  private readonly auth: DifyAuthService;
  private readonly retrieval: RetrievalService;
  private readonly config: DifyAdapterConfig;

  constructor(
    options: {
      prisma?: PrismaClient;
      auth?: DifyAuthService;
      retrieval?: RetrievalService;
      env?: NodeJS.ProcessEnv;
    } = {}
  ) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.config = getDifyAdapterConfig(options.env);
    this.auth = options.auth ?? new DifyAuthService({ prisma: this.prisma, env: options.env });
    this.retrieval = options.retrieval ?? new RetrievalService({ prisma: this.prisma });
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async retrieve(
    authorizationHeader: string | string[] | undefined,
    body: unknown,
    meta: DifyRequestMeta = {}
  ): Promise<DifyRetrievalResponse> {
    const apiKey = await this.auth.authenticateAuthorizationHeader(authorizationHeader);
    const request = normalizeDifyRetrievalRequest(body, {
      maxTopK: this.config.maxTopK,
      keyTopKLimit: apiKey.retrievalTopKLimit
    });
    const mapping = await this.resolveKnowledgeMapping(apiKey, request.knowledgeId);
    const keyMetadataCondition = normalizeOptionalMetadataCondition(apiKey.allowedMetadataFilters);

    let searchResponse;
    try {
      searchResponse = await this.retrieval.searchAppScope({
        app: {
          tenantId: apiKey.tenantId,
          knowledgeBaseIds: [mapping.knowledge_base_id]
        },
        query: request.query,
        top_k: request.topK,
        filters: {}
      });
    } catch (error) {
      if (error instanceof RetrievalError && error.code === "SEARCH_INDEX_NOT_READY") {
        throw new DifyAdapterError(
          "SEARCH_INDEX_NOT_READY",
          "Search index is not ready. Rebuild the active Milvus index first.",
          503
        );
      }
      if (error instanceof RetrievalError) {
        throw new DifyAdapterError("INVALID_REQUEST", error.message, error.statusCode);
      }
      throw error;
    }

    const records = searchResponse.results
      .filter((result) => normalizedScore(result.score) >= request.scoreThreshold)
      .filter((result) =>
        matchesMetadataConditions(result.metadata, [
          keyMetadataCondition,
          request.metadataCondition
        ])
      )
      .map((result) => this.toDifyRecord(result));

    await this.writeAuditLog(apiKey, mapping, request, records, meta);

    return {
      records
    };
  }

  private async resolveKnowledgeMapping(
    apiKey: DifyApiKeyContext,
    knowledgeId: string
  ): Promise<DifyKnowledgeMappingRow> {
    const mapping = await this.prisma.difyKnowledgeMapping.findFirst({
      where: {
        tenant_id: apiKey.tenantId,
        dify_knowledge_id: knowledgeId,
        status: "active"
      }
    });
    if (!mapping) {
      throw new DifyAdapterError("KNOWLEDGE_NOT_FOUND", "Dify knowledge_id was not found.", 404);
    }

    if (!apiKey.allowedKnowledgeBaseIds.includes(mapping.knowledge_base_id)) {
      throw new DifyAdapterError(
        "KNOWLEDGE_SCOPE_FORBIDDEN",
        "Dify API key is not allowed to access this knowledge base.",
        403
      );
    }

    return mapping;
  }

  private toDifyRecord(result: RetrievalSearchResult): DifyRetrievalRecord {
    const score = normalizedScore(result.score);
    const path = `/${result.path.filter(Boolean).join("/")}`;
    const url = this.config.resultBaseUrl
      ? `${this.config.resultBaseUrl}/app/kb/${result.knowledge_base_id}/docs/${result.document_id}`
      : `/app/kb/${result.knowledge_base_id}/docs/${result.document_id}`;
    return {
      content: result.content,
      score,
      title: result.title,
      metadata: {
        ...result.metadata,
        document_id: result.document_id,
        chunk_id: result.chunk_id,
        knowledge_base_id: result.knowledge_base_id,
        workspace_id: result.workspace_id,
        heading_path: result.heading_path,
        path,
        url,
        updated_at: result.updated_at,
        raw_score: result.score
      }
    };
  }

  private async writeAuditLog(
    apiKey: DifyApiKeyContext,
    mapping: DifyKnowledgeMappingRow,
    request: NormalizedDifyRetrievalRequest,
    records: DifyRetrievalRecord[],
    meta: DifyRequestMeta
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: apiKey.tenantId,
        actor_type: "api_key",
        action: "dify.retrieval",
        object_type: "knowledge_base",
        object_id: mapping.knowledge_base_id,
        metadata: {
          dify_api_key_id: apiKey.id,
          api_key_type: "dify",
          dify_knowledge_id: request.knowledgeId,
          knowledge_base_id: mapping.knowledge_base_id,
          top_k: request.topK,
          score_threshold: request.scoreThreshold,
          metadata_condition: request.rawMetadataCondition ?? null,
          document_ids_returned: unique(
            records.map((record) => String(record.metadata.document_id ?? ""))
          ).filter(Boolean),
          chunk_ids_returned: records
            .map((record) => String(record.metadata.chunk_id ?? ""))
            .filter(Boolean)
        },
        ip: meta.ip ?? null,
        user_agent: meta.userAgent ?? null
      }
    });
  }
}

export function normalizeDifyRetrievalRequest(
  value: unknown,
  limits: { maxTopK: number; keyTopKLimit: number }
): NormalizedDifyRetrievalRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DifyAdapterError("INVALID_REQUEST", "Request body must be a JSON object.", 400);
  }

  const body = value as Record<string, unknown>;
  const knowledgeId = requireText(body.knowledge_id, "knowledge_id");
  const query = requireText(body.query, "query");
  const retrievalSetting = requireObject(body.retrieval_setting, "retrieval_setting");
  const requestedTopK = normalizePositiveInteger(retrievalSetting.top_k, "retrieval_setting.top_k");
  const scoreThreshold = normalizeScoreThreshold(
    retrievalSetting.score_threshold,
    "retrieval_setting.score_threshold"
  );
  const metadataCondition = normalizeOptionalMetadataCondition(body.metadata_condition);

  return {
    knowledgeId,
    query,
    topK: Math.min(requestedTopK, limits.keyTopKLimit, limits.maxTopK),
    scoreThreshold,
    metadataCondition,
    rawMetadataCondition: body.metadata_condition
  };
}

export function normalizedScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(Math.max(score, 0), 1);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DifyAdapterError("INVALID_REQUEST", `${field} is required.`, 400);
  }
  return value.trim();
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DifyAdapterError("INVALID_REQUEST", `${field} is required.`, 400);
  }
  return value as Record<string, unknown>;
}

function normalizePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DifyAdapterError("INVALID_REQUEST", `${field} must be a positive integer.`, 400);
  }
  return value;
}

function normalizeScoreThreshold(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DifyAdapterError("INVALID_REQUEST", `${field} must be between 0 and 1.`, 400);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

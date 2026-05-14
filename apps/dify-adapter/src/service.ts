import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
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

type DifyMetadataContext = {
  knowledgeBases: Map<string, { id: string; title: string; slug: string }>;
  documents: Map<
    string,
    {
      id: string;
      title: string;
      slug: string;
      created_by: string;
      created_at: Date;
      updated_at: Date;
      current_version_id: string | null;
    }
  >;
  creators: Map<string, { display_name: string; email: string }>;
  currentVersions: Map<string, { id: string; source_type: string }>;
  metadataValues: Map<string, Record<string, unknown>>;
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
        score_threshold: request.scoreThreshold,
        filters: {
          metadata_condition: request.rawMetadataCondition
        }
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

    const candidateRecords = await this.toDifyRecords(searchResponse.results);
    const records = candidateRecords
      .filter((record) => normalizedScore(record.score) >= request.scoreThreshold)
      .filter((record) =>
        matchesMetadataConditions(record.metadata, [
          keyMetadataCondition,
          request.metadataCondition
        ])
      );

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

  private async toDifyRecords(results: RetrievalSearchResult[]): Promise<DifyRetrievalRecord[]> {
    const context = await this.loadDifyMetadataContext(results);
    return results.map((result) => this.toDifyRecord(result, context));
  }

  private async loadDifyMetadataContext(
    results: RetrievalSearchResult[]
  ): Promise<DifyMetadataContext> {
    const knowledgeBaseIds = unique(results.map((result) => result.knowledge_base_id));
    const documentIds = unique(results.map((result) => result.document_id));
    const [knowledgeBases, documents] = await Promise.all([
      knowledgeBaseIds.length
        ? this.prisma.knowledgeBase.findMany({
            where: { id: { in: knowledgeBaseIds } },
            select: { id: true, title: true, slug: true }
          })
        : Promise.resolve([]),
      documentIds.length
        ? this.prisma.document.findMany({
            where: { id: { in: documentIds } },
            select: {
              id: true,
              title: true,
              slug: true,
              created_by: true,
              created_at: true,
              updated_at: true,
              current_version_id: true
            }
          })
        : Promise.resolve([])
    ]);
    const creatorIds = unique(documents.map((document) => document.created_by));
    const currentVersionIds = unique(
      documents.flatMap((document) =>
        document.current_version_id ? [document.current_version_id] : []
      )
    );
    const [creators, versions, fields, values] = await Promise.all([
      creatorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, display_name: true, email: true }
          })
        : Promise.resolve([]),
      currentVersionIds.length
        ? this.prisma.documentVersion.findMany({
            where: { id: { in: currentVersionIds } },
            select: { id: true, source_type: true }
          })
        : Promise.resolve([]),
      knowledgeBaseIds.length
        ? this.prisma.knowledgeBaseMetadataField.findMany({
            where: { knowledge_base_id: { in: knowledgeBaseIds }, status: "active" },
            select: { id: true, name: true }
          })
        : Promise.resolve([]),
      documentIds.length
        ? this.prisma.documentMetadataValue.findMany({
            where: { document_id: { in: documentIds } },
            select: { document_id: true, field_id: true, value: true }
          })
        : Promise.resolve([])
    ]);
    const fieldNames = new Map(fields.map((field) => [field.id, field.name]));
    const metadataValues = new Map<string, Record<string, unknown>>();
    for (const value of values) {
      const fieldName = fieldNames.get(value.field_id);
      if (!fieldName) {
        continue;
      }
      const current = metadataValues.get(value.document_id) ?? {};
      current[fieldName] = normalizeJsonValue(value.value);
      metadataValues.set(value.document_id, current);
    }

    return {
      knowledgeBases: new Map(
        knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase])
      ),
      documents: new Map(documents.map((document) => [document.id, document])),
      creators: new Map(creators.map((creator) => [creator.id, creator])),
      currentVersions: new Map(versions.map((version) => [version.id, version])),
      metadataValues
    };
  }

  private toDifyRecord(
    result: RetrievalSearchResult,
    context: DifyMetadataContext
  ): DifyRetrievalRecord {
    const score = normalizedScore(result.score);
    const path = `/${result.path.filter(Boolean).join("/")}`;
    const url = this.config.resultBaseUrl
      ? `${this.config.resultBaseUrl}/app/kb/${result.knowledge_base_id}/docs/${result.document_id}`
      : `/app/kb/${result.knowledge_base_id}/docs/${result.document_id}`;
    const retrievalMetadata = toRecord(result.metadata.openkb_retrieval);
    const knowledgeBase = context.knowledgeBases.get(result.knowledge_base_id);
    const document = context.documents.get(result.document_id);
    const creator = document ? context.creators.get(document.created_by) : null;
    const version = document?.current_version_id
      ? context.currentVersions.get(document.current_version_id)
      : null;
    const documentMetadata = {
      document_name: document?.title ?? result.title,
      uploader: creator?.display_name || creator?.email || null,
      upload_date: document?.created_at.toISOString() ?? null,
      last_update_date: document?.updated_at.toISOString() ?? result.updated_at,
      source: version?.source_type === "import" ? "file_upload" : "online_document",
      ...(context.metadataValues.get(result.document_id) ?? {})
    };
    const scoreSource =
      typeof retrievalMetadata.rerank_score === "number" && retrievalMetadata.rerank_failed !== true
        ? "rerank"
        : "retrieval";
    return {
      content: result.content,
      score,
      title: document?.title ?? result.title,
      metadata: {
        ...result.metadata,
        ...documentMetadata,
        document_id: result.document_id,
        chunk_id: result.chunk_id,
        segment_id: result.chunk_id,
        knowledge_base_id: result.knowledge_base_id,
        knowledge_base_title: knowledgeBase?.title ?? null,
        workspace_id: result.workspace_id,
        document_title: document?.title ?? result.title,
        document_slug: document?.slug ?? null,
        document_name: document?.title ?? result.title,
        dataset_name: knowledgeBase?.title ?? null,
        heading_path: result.heading_path,
        context_mode: result.context_mode ?? retrievalMetadata.context_mode ?? null,
        match_chunk_id: result.match_chunk?.chunk_id ?? result.chunk_id,
        parent_chunk_id: result.parent_chunk?.chunk_id ?? null,
        path,
        path_parts: result.path,
        url,
        absolute_url: url.startsWith("http://") || url.startsWith("https://") ? url : null,
        updated_at: result.updated_at,
        retrieval_mode: String(
          result.context_mode ?? retrievalMetadata.context_mode ?? retrievalMetadata.mode ?? "chunk"
        ),
        doc_form: stringOrNull(result.metadata.doc_form),
        indexing_technique: stringOrNull(result.metadata.indexing_technique),
        retrieval_model: toRecord(result.metadata.retrieval_model),
        segment_status: stringOrNull(result.metadata.segment_status) ?? "active",
        hit_type: stringOrNull(result.metadata.hit_type) ?? "content",
        summary_hit: result.metadata.summary_hit === true,
        summary_id: stringOrNull(result.metadata.summary_id),
        summary_chunk_id: stringOrNull(result.metadata.summary_chunk_id),
        summary_scope: stringOrNull(result.metadata.summary_scope),
        summary_text: stringOrNull(result.metadata.summary_text),
        original_chunk_id: stringOrNull(result.metadata.original_chunk_id) ?? result.chunk_id,
        qa_pair_id: stringOrNull(result.metadata.qa_pair_id),
        qa_question: stringOrNull(result.metadata.qa_question),
        qa_answer: stringOrNull(result.metadata.qa_answer),
        qa_source: stringOrNull(result.metadata.qa_source),
        score,
        score_source: scoreSource,
        raw_score:
          typeof retrievalMetadata.raw_score === "number"
            ? retrievalMetadata.raw_score
            : result.score,
        rerank_score:
          typeof retrievalMetadata.rerank_score === "number"
            ? retrievalMetadata.rerank_score
            : null,
        rerank_failed: retrievalMetadata.rerank_failed === true
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
  if (Object.keys(body).length === 0) {
    throw new DifyAdapterError(
      "INVALID_REQUEST",
      "OpenKB Dify adapter was reached, but the request body is missing knowledge_id, query, and retrieval_setting. In Dify, configure the External Knowledge API endpoint as the base URL; Dify will append /retrieval.",
      400
    );
  }
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

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizeJsonValue(value: Prisma.JsonValue): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import {
  createOpenKBMilvus,
  MilvusError,
  type MilvusSearchChunkResult,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";

export const RETRIEVAL_PACKAGE_NAME = "@openkb/retrieval";
export const RETRIEVAL_INDEX_BACKEND = "milvus";
export const DEFAULT_SEARCH_TOP_K = 10;
export const MAX_SEARCH_TOP_K = 20;
export const MAX_QUERY_LENGTH = 500;

export type RetrievalErrorCode = "INVALID_INPUT" | "SEARCH_FAILED" | "SEARCH_INDEX_NOT_READY";

export class RetrievalError extends Error {
  constructor(
    public readonly code: RetrievalErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export type RetrievalUserContext = {
  user: {
    id: string;
  };
  tenantId: string;
  roles?: string[];
};

export type RetrievalSearchInput = {
  user: RetrievalUserContext;
  query: unknown;
  knowledge_base_ids?: unknown;
  top_k?: unknown;
  filters?: unknown;
};

export type NormalizedRetrievalSearchInput = {
  query: string;
  knowledgeBaseIds: string[];
  topK: number;
  candidateLimit: number;
};

export type RetrievalSearchResult = {
  chunk_id: string;
  document_id: string;
  knowledge_base_id: string;
  workspace_id: string;
  title: string;
  path: string[];
  heading_path: string[];
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type RetrievalSearchResponse = {
  query: string;
  top_k: number;
  results: RetrievalSearchResult[];
};

export type RetrievalServiceOptions = {
  prisma?: PrismaClient;
  milvus?: OpenKBMilvus;
  permissions?: PermissionService;
};

export type RetrievalPackageStatus = {
  packageName: typeof RETRIEVAL_PACKAGE_NAME;
  indexBackend: typeof RETRIEVAL_INDEX_BACKEND;
  finalPermissionCheckRequired: true;
};

export const retrievalPackageStatus: RetrievalPackageStatus = {
  packageName: RETRIEVAL_PACKAGE_NAME,
  indexBackend: RETRIEVAL_INDEX_BACKEND,
  finalPermissionCheckRequired: true
};

export class RetrievalService {
  private readonly prisma: PrismaClient;
  private readonly milvus: OpenKBMilvus;
  private readonly permissions: PermissionService;

  constructor(options: RetrievalServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.milvus = options.milvus ?? createOpenKBMilvus();
    this.permissions = options.permissions ?? new PermissionService({ prisma: this.prisma });
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async search(input: RetrievalSearchInput): Promise<RetrievalSearchResponse> {
    const normalized = normalizeRetrievalSearchInput(input);
    const userId = input.user.user.id;
    const tenantId = input.user.tenantId;

    for (const knowledgeBaseId of normalized.knowledgeBaseIds) {
      await this.permissions.requireCanRead(userId, "knowledge_base", knowledgeBaseId);
    }

    const accessPrincipals = filterRetrievalAccessPrincipals(
      await this.permissions.getAccessPrincipals(userId, tenantId)
    );

    let candidates: MilvusSearchChunkResult[];
    try {
      candidates = await this.milvus.searchChunks({
        query: normalized.query,
        tenantId,
        accessPrincipals,
        knowledgeBaseIds: normalized.knowledgeBaseIds,
        limit: normalized.candidateLimit
      });
    } catch (error) {
      if (error instanceof MilvusError && error.code === "SEARCH_INDEX_NOT_READY") {
        throw new RetrievalError(
          "SEARCH_INDEX_NOT_READY",
          "Search index is not ready. Rebuild the active Milvus index first.",
          503
        );
      }
      if (error instanceof MilvusError) {
        throw new RetrievalError("SEARCH_FAILED", error.message, error.statusCode);
      }
      throw error;
    }

    const allowed = await this.finalPermissionFilter(userId, candidates, normalized.topK);
    const paths = await this.resolveDocumentPaths(allowed);

    return {
      query: normalized.query,
      top_k: normalized.topK,
      results: allowed.map((candidate) => ({
        chunk_id: candidate.chunk_id,
        document_id: candidate.document_id,
        knowledge_base_id: candidate.knowledge_base_id,
        workspace_id: candidate.workspace_id,
        title: candidate.title,
        path: paths.get(candidate.document_id) ?? [candidate.title],
        heading_path: candidate.heading_path,
        content: trimResultContent(candidate.content_text),
        score: candidate.score,
        metadata: candidate.metadata,
        updated_at: toIsoString(candidate.updated_at)
      }))
    };
  }

  private async finalPermissionFilter(
    userId: string,
    candidates: MilvusSearchChunkResult[],
    topK: number
  ): Promise<MilvusSearchChunkResult[]> {
    const allowed: MilvusSearchChunkResult[] = [];
    const seenChunkIds = new Set<string>();

    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (!candidate.chunk_id || !candidate.document_id || seenChunkIds.has(candidate.chunk_id)) {
        continue;
      }

      seenChunkIds.add(candidate.chunk_id);
      if (await this.permissions.canRead(userId, "document", candidate.document_id)) {
        allowed.push(candidate);
      }
      if (allowed.length >= topK) {
        break;
      }
    }

    return allowed;
  }

  private async resolveDocumentPaths(
    candidates: MilvusSearchChunkResult[]
  ): Promise<Map<string, string[]>> {
    if (candidates.length === 0) {
      return new Map();
    }

    const knowledgeBaseIds = unique(candidates.map((candidate) => candidate.knowledge_base_id));
    const [knowledgeBases, documents] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: knowledgeBaseIds } },
        select: { id: true, title: true }
      }),
      this.prisma.document.findMany({
        where: {
          knowledge_base_id: { in: knowledgeBaseIds },
          status: { not: "deleted" }
        },
        select: { id: true, parent_id: true, knowledge_base_id: true, title: true }
      })
    ]);

    const kbTitleById = new Map(knowledgeBases.map((kb) => [kb.id, kb.title]));
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const pathByDocumentId = new Map<string, string[]>();

    for (const candidate of candidates) {
      const chain: string[] = [];
      let cursor = documentById.get(candidate.document_id);
      const visited = new Set<string>();

      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        chain.unshift(cursor.title);
        cursor = cursor.parent_id ? documentById.get(cursor.parent_id) : undefined;
      }

      const kbTitle = kbTitleById.get(candidate.knowledge_base_id);
      pathByDocumentId.set(candidate.document_id, kbTitle ? [kbTitle, ...chain] : chain);
    }

    return pathByDocumentId;
  }
}

export function normalizeRetrievalSearchInput(
  input: RetrievalSearchInput
): NormalizedRetrievalSearchInput {
  if (typeof input.query !== "string") {
    throw new RetrievalError("INVALID_INPUT", "query is required.", 400);
  }

  const query = input.query.trim();
  if (!query) {
    throw new RetrievalError("INVALID_INPUT", "query is required.", 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new RetrievalError("INVALID_INPUT", "query is too long.", 400, {
      max_length: MAX_QUERY_LENGTH
    });
  }

  const knowledgeBaseIds = normalizeStringArray(input.knowledge_base_ids, "knowledge_base_ids");
  const topK = normalizeTopK(input.top_k);
  assertNoUnsupportedFilters(input.filters);

  return {
    query,
    knowledgeBaseIds,
    topK,
    candidateLimit: calculateCandidateLimit(topK)
  };
}

export function calculateCandidateLimit(topK: number): number {
  return Math.min(Math.max(topK * 5, 20), 100);
}

export function filterRetrievalAccessPrincipals(principals: string[]): string[] {
  return unique(
    principals.filter((principal) => !/^tenant:[^:]+:(system_admin|tenant_admin)$/.test(principal))
  );
}

function normalizeTopK(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_SEARCH_TOP_K;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RetrievalError("INVALID_INPUT", "top_k must be a positive integer.", 400);
  }

  return Math.min(value, MAX_SEARCH_TOP_K);
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", `${fieldName} must be an array.`, 400);
  }

  const ids = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new RetrievalError("INVALID_INPUT", `${fieldName} contains an invalid id.`, 400);
    }
    return item.trim();
  });
  return unique(ids);
}

function assertNoUnsupportedFilters(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", "filters must be an object.", 400);
  }
  if (Object.keys(value).length > 0) {
    throw new RetrievalError("INVALID_INPUT", "Search filters are not supported yet.", 400);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function trimResultContent(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 600 ? `${compact.slice(0, 597)}...` : compact;
}

function toIsoString(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

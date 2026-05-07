import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import {
  createOpenKBModelClient,
  type OpenKBModelClient,
  type RerankDocumentScore
} from "@openkb/model-client";
import {
  createOpenKBMilvus,
  MilvusError,
  type MilvusSearchMode,
  type MilvusSearchChunkResult,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";

export const RETRIEVAL_PACKAGE_NAME = "@openkb/retrieval";
export const RETRIEVAL_INDEX_BACKEND = "milvus";
export const DEFAULT_SEARCH_TOP_K = 10;
export const MAX_SEARCH_TOP_K = 20;
export const MAX_QUERY_LENGTH = 500;
export const RETRIEVAL_MODES = [
  "bm25",
  "dense",
  "dense_rerank",
  "hybrid",
  "hybrid_rerank"
] as const;
export const RETRIEVAL_CONTEXT_MODES = [
  "chunk",
  "parent_child",
  "paragraph_parent_child",
  "full_text"
] as const;

export type RetrievalErrorCode = "INVALID_INPUT" | "SEARCH_FAILED" | "SEARCH_INDEX_NOT_READY";
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];
export type RetrievalContextMode = (typeof RETRIEVAL_CONTEXT_MODES)[number];

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
  context_mode?: unknown;
};

export type RetrievalAppSearchInput = {
  app: {
    tenantId: string;
    knowledgeBaseIds: string[];
  };
  query: unknown;
  top_k?: unknown;
  filters?: unknown;
  context_mode?: unknown;
};

export type RetrievalSearchFilters = {
  tags: string[];
};

export type NormalizedRetrievalSearchInput = {
  query: string;
  knowledgeBaseIds: string[];
  topK: number;
  candidateLimit: number;
  filters: RetrievalSearchFilters;
  requestedContextMode?: RetrievalContextMode;
};

export type RetrievalChunkContext = {
  chunk_id: string;
  chunk_type: string;
  heading_path: string[];
  content: string;
  token_count?: number | null;
  start_line?: number | null;
  end_line?: number | null;
  start_char?: number | null;
  end_char?: number | null;
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
  context_mode?: RetrievalContextMode;
  match_chunk?: RetrievalChunkContext;
  parent_chunk?: RetrievalChunkContext | null;
};

export type RetrievalSearchResponse = {
  query: string;
  top_k: number;
  context_mode?: RetrievalContextMode;
  results: RetrievalSearchResult[];
};

export type RetrievalModeResolution = {
  requestedMode: RetrievalMode;
  effectiveMode: RetrievalMode;
  embeddingConfigured: boolean;
  rerankConfigured: boolean;
};

export type RetrievalServiceOptions = {
  prisma?: PrismaClient;
  milvus?: OpenKBMilvus;
  permissions?: PermissionService;
  modelClient?: OpenKBModelClient;
  env?: NodeJS.ProcessEnv;
};

type ContextualCandidate = MilvusSearchChunkResult & {
  contextMode: RetrievalContextMode;
  resultContent: string;
  matchChunk: RetrievalChunkContext;
  parentChunk: RetrievalChunkContext | null;
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
  private readonly modelClient: OpenKBModelClient;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: RetrievalServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.milvus = options.milvus ?? createOpenKBMilvus();
    this.permissions = options.permissions ?? new PermissionService({ prisma: this.prisma });
    this.modelClient = options.modelClient ?? createOpenKBModelClient();
    this.env = options.env ?? process.env;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async search(input: RetrievalSearchInput): Promise<RetrievalSearchResponse> {
    const normalized = normalizeRetrievalSearchInput(input);
    const userId = input.user.user.id;
    const tenantId = input.user.tenantId;
    const mode = await this.resolveSearchMode(tenantId);
    const queryVector = await this.embedQueryIfNeeded(normalized.query, mode.effectiveMode);

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
        mode: toMilvusSearchMode(mode.effectiveMode),
        queryVector,
        tenantId,
        accessPrincipals,
        knowledgeBaseIds: normalized.knowledgeBaseIds,
        filters: normalized.filters,
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

    const allowed = await this.finalPermissionFilter(
      userId,
      tenantId,
      candidates,
      normalized.candidateLimit
    );
    const ranked = await this.applyRerank(normalized.query, allowed, mode.effectiveMode);
    const contextMode = await this.resolveContextMode(
      tenantId,
      normalized.knowledgeBaseIds,
      normalized.requestedContextMode
    );
    const contextual = (
      await this.expandResultContext(ranked, contextMode, normalized.candidateLimit)
    ).slice(0, normalized.topK);
    const paths = await this.resolveDocumentPaths(contextual);

    return this.toSearchResponse(normalized.query, normalized.topK, contextual, paths, contextMode);
  }

  async searchAppScope(input: RetrievalAppSearchInput): Promise<RetrievalSearchResponse> {
    const normalized = normalizeRetrievalAppSearchInput(input);
    const tenantId = input.app.tenantId;
    const mode = await this.resolveSearchMode(tenantId);
    const queryVector = await this.embedQueryIfNeeded(normalized.query, mode.effectiveMode);
    const activeKnowledgeBaseIds = await this.resolveActiveAppKnowledgeBaseIds(
      tenantId,
      normalized.knowledgeBaseIds
    );

    if (activeKnowledgeBaseIds.length === 0) {
      return {
        query: normalized.query,
        top_k: normalized.topK,
        results: []
      };
    }

    let candidates: MilvusSearchChunkResult[];
    try {
      candidates = await this.milvus.searchScopedChunks({
        query: normalized.query,
        mode: toMilvusSearchMode(mode.effectiveMode),
        queryVector,
        tenantId,
        knowledgeBaseIds: activeKnowledgeBaseIds,
        filters: normalized.filters,
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

    const allowed = await this.finalAppScopeFilter(
      tenantId,
      activeKnowledgeBaseIds,
      candidates,
      normalized.candidateLimit
    );
    const ranked = await this.applyRerank(normalized.query, allowed, mode.effectiveMode);
    const contextMode = await this.resolveContextMode(
      tenantId,
      activeKnowledgeBaseIds,
      normalized.requestedContextMode
    );
    const contextual = (
      await this.expandResultContext(ranked, contextMode, normalized.candidateLimit)
    ).slice(0, normalized.topK);
    const paths = await this.resolveDocumentPaths(contextual);
    return this.toSearchResponse(normalized.query, normalized.topK, contextual, paths, contextMode);
  }

  async resolveSearchMode(tenantId: string): Promise<RetrievalModeResolution> {
    const [setting, activeProfile] = await Promise.all([
      this.prisma.retrievalSetting.findFirst({
        where: { tenant_id: tenantId },
        select: { mode: true }
      }),
      this.prisma.milvusIndexProfile.findFirst({
        where: {
          alias: this.milvus.config.activeAlias,
          status: "active",
          OR: [{ tenant_id: tenantId }, { tenant_id: null }]
        },
        orderBy: { activated_at: "desc" }
      })
    ]);
    const resolution = resolveEffectiveRetrievalMode({
      storedMode: setting?.mode,
      envDefaultMode: this.env.OPENKB_RETRIEVAL_DEFAULT_MODE,
      embeddingConfigured: this.modelClient.embeddingConfigured,
      rerankConfigured: this.modelClient.rerankConfigured
    });

    if (
      retrievalModeNeedsEmbedding(resolution.effectiveMode) &&
      !activeProfileSupportsDenseVector(activeProfile, {
        dim: this.modelClient.config.embedding.dim,
        model: this.modelClient.config.embedding.model
      })
    ) {
      throw new RetrievalError(
        "SEARCH_INDEX_NOT_READY",
        "Dense retrieval is enabled, but the active Milvus index does not contain matching dense vectors. Rebuild the active index first.",
        503,
        {
          mode: resolution.effectiveMode,
          active_alias: this.milvus.config.activeAlias,
          required_embedding_dim: this.modelClient.config.embedding.dim,
          required_embedding_model: this.modelClient.config.embedding.model ?? null
        }
      );
    }

    return resolution;
  }

  private toSearchResponse(
    query: string,
    topK: number,
    allowed: ContextualCandidate[],
    paths: Map<string, string[]>,
    contextMode: RetrievalContextMode
  ): RetrievalSearchResponse {
    return {
      query,
      top_k: topK,
      context_mode: contextMode,
      results: allowed.map((candidate) => ({
        chunk_id: candidate.chunk_id,
        document_id: candidate.document_id,
        knowledge_base_id: candidate.knowledge_base_id,
        workspace_id: candidate.workspace_id,
        title: candidate.title,
        path: paths.get(candidate.document_id) ?? [candidate.title],
        heading_path: candidate.heading_path,
        content: trimResultContent(candidate.resultContent),
        score: candidate.score,
        metadata: candidate.metadata,
        updated_at: toIsoString(candidate.updated_at),
        context_mode: candidate.contextMode,
        match_chunk: candidate.matchChunk,
        parent_chunk: candidate.parentChunk
      }))
    };
  }

  private async finalPermissionFilter(
    userId: string,
    tenantId: string,
    candidates: MilvusSearchChunkResult[],
    limit: number
  ): Promise<MilvusSearchChunkResult[]> {
    const sortedCandidates = candidates
      .filter((candidate) => candidate.chunk_id && candidate.document_id)
      .sort((a, b) => b.score - a.score);
    if (sortedCandidates.length === 0) {
      return [];
    }

    const chunkIds = unique(sortedCandidates.map((candidate) => candidate.chunk_id));
    const chunks = await this.prisma.documentChunk.findMany({
      where: { id: { in: chunkIds }, tenant_id: tenantId },
      select: {
        id: true,
        tenant_id: true,
        document_id: true,
        knowledge_base_id: true,
        version_id: true
      }
    });
    const documentIds = unique(chunks.map((chunk) => chunk.document_id));
    const knowledgeBaseIds = unique(chunks.map((chunk) => chunk.knowledge_base_id));
    const [documents, knowledgeBases] = await Promise.all([
      this.prisma.document.findMany({
        where: { id: { in: documentIds }, tenant_id: tenantId, status: "published" },
        select: {
          id: true,
          knowledge_base_id: true,
          current_version_id: true,
          status: true
        }
      }),
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: knowledgeBaseIds }, tenant_id: tenantId, status: "active" },
        select: { id: true }
      })
    ]);

    const documentById = new Map(documents.map((document) => [document.id, document]));
    const activeKnowledgeBaseIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.id));
    const validChunkIds = new Set(
      chunks
        .filter((chunk) => {
          const document = documentById.get(chunk.document_id);
          return (
            document?.status === "published" &&
            document.current_version_id === chunk.version_id &&
            document.knowledge_base_id === chunk.knowledge_base_id &&
            activeKnowledgeBaseIds.has(chunk.knowledge_base_id)
          );
        })
        .map((chunk) => chunk.id)
    );
    const allowed: MilvusSearchChunkResult[] = [];
    const seenChunkIds = new Set<string>();

    for (const candidate of sortedCandidates) {
      if (!candidate.chunk_id || !candidate.document_id || seenChunkIds.has(candidate.chunk_id)) {
        continue;
      }
      if (!validChunkIds.has(candidate.chunk_id)) {
        continue;
      }

      seenChunkIds.add(candidate.chunk_id);
      if (await this.permissions.canRead(userId, "document", candidate.document_id)) {
        allowed.push(candidate);
      }
      if (allowed.length >= limit) {
        break;
      }
    }

    return allowed;
  }

  private async finalAppScopeFilter(
    tenantId: string,
    knowledgeBaseIds: string[],
    candidates: MilvusSearchChunkResult[],
    limit: number
  ): Promise<MilvusSearchChunkResult[]> {
    const sortedCandidates = candidates
      .filter((candidate) => candidate.chunk_id && candidate.document_id)
      .sort((a, b) => b.score - a.score);
    if (sortedCandidates.length === 0) {
      return [];
    }

    const allowedKnowledgeBaseIds = new Set(knowledgeBaseIds);
    const chunkIds = unique(sortedCandidates.map((candidate) => candidate.chunk_id));
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        id: { in: chunkIds },
        tenant_id: tenantId,
        knowledge_base_id: { in: knowledgeBaseIds }
      },
      select: {
        id: true,
        document_id: true,
        knowledge_base_id: true,
        version_id: true
      }
    });
    const documentIds = unique(chunks.map((chunk) => chunk.document_id));
    const [documents, knowledgeBases] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          id: { in: documentIds },
          tenant_id: tenantId,
          knowledge_base_id: { in: knowledgeBaseIds },
          status: "published"
        },
        select: {
          id: true,
          knowledge_base_id: true,
          current_version_id: true,
          status: true
        }
      }),
      this.prisma.knowledgeBase.findMany({
        where: {
          id: { in: knowledgeBaseIds },
          tenant_id: tenantId,
          status: "active"
        },
        select: {
          id: true
        }
      })
    ]);

    const documentById = new Map(documents.map((document) => [document.id, document]));
    const activeKnowledgeBaseIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.id));
    const validChunkIds = new Set(
      chunks
        .filter((chunk) => {
          const document = documentById.get(chunk.document_id);
          return (
            document?.status === "published" &&
            document.current_version_id === chunk.version_id &&
            document.knowledge_base_id === chunk.knowledge_base_id &&
            allowedKnowledgeBaseIds.has(chunk.knowledge_base_id) &&
            activeKnowledgeBaseIds.has(chunk.knowledge_base_id)
          );
        })
        .map((chunk) => chunk.id)
    );

    const allowed: MilvusSearchChunkResult[] = [];
    const seenChunkIds = new Set<string>();
    for (const candidate of sortedCandidates) {
      if (
        seenChunkIds.has(candidate.chunk_id) ||
        !allowedKnowledgeBaseIds.has(candidate.knowledge_base_id) ||
        !validChunkIds.has(candidate.chunk_id)
      ) {
        continue;
      }

      seenChunkIds.add(candidate.chunk_id);
      allowed.push(candidate);
      if (allowed.length >= limit) {
        break;
      }
    }

    return allowed;
  }

  private async resolveActiveAppKnowledgeBaseIds(
    tenantId: string,
    knowledgeBaseIds: string[]
  ): Promise<string[]> {
    if (knowledgeBaseIds.length === 0) {
      return [];
    }

    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        id: { in: knowledgeBaseIds },
        tenant_id: tenantId,
        status: "active"
      },
      select: { id: true }
    });

    const activeIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.id));
    return knowledgeBaseIds.filter((knowledgeBaseId) => activeIds.has(knowledgeBaseId));
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

  private async resolveContextMode(
    tenantId: string,
    knowledgeBaseIds: string[],
    requested?: RetrievalContextMode
  ): Promise<RetrievalContextMode> {
    if (requested) {
      return requested;
    }
    if (knowledgeBaseIds.length !== 1) {
      return "chunk";
    }
    const setting = await this.prisma.knowledgeBaseChunkSetting.findFirst({
      where: {
        tenant_id: tenantId,
        knowledge_base_id: knowledgeBaseIds[0]
      },
      select: { mode: true, parent_mode: true }
    });
    if (setting?.mode !== "parent_child") {
      return "chunk";
    }
    return setting.parent_mode === "full_doc" ? "full_text" : "parent_child";
  }

  private async expandResultContext(
    candidates: MilvusSearchChunkResult[],
    contextMode: RetrievalContextMode,
    limit: number
  ): Promise<ContextualCandidate[]> {
    if (candidates.length === 0) {
      return [];
    }
    if (contextMode === "chunk") {
      return candidates.map((candidate) => this.toContextualCandidate(candidate, contextMode));
    }
    if (contextMode === "full_text") {
      return this.expandFullTextContext(candidates, limit);
    }

    const parentIds = unique(
      candidates.flatMap((candidate) => {
        const parentChunkId = getMetadataString(candidate.metadata, "parent_chunk_id");
        return parentChunkId ? [parentChunkId] : [];
      })
    );
    if (parentIds.length === 0) {
      return candidates.map((candidate) => this.toContextualCandidate(candidate, contextMode));
    }

    const parents = await this.prisma.documentChunk.findMany({
      where: { id: { in: parentIds }, chunk_type: "parent" }
    });
    const parentById = new Map(parents.map((parent) => [parent.id, parent]));
    const seen = new Set<string>();
    const expanded: ContextualCandidate[] = [];

    for (const candidate of candidates) {
      const parentChunkId = getMetadataString(candidate.metadata, "parent_chunk_id");
      const parent = parentChunkId ? parentById.get(parentChunkId) : undefined;
      const key = parent?.id ?? candidate.chunk_id;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      expanded.push(this.toContextualCandidate(candidate, contextMode, parent ?? null));
      if (expanded.length >= limit) {
        break;
      }
    }

    return expanded;
  }

  private async expandFullTextContext(
    candidates: MilvusSearchChunkResult[],
    limit: number
  ): Promise<ContextualCandidate[]> {
    const documentIds = unique(candidates.map((candidate) => candidate.document_id));
    const documents = await this.prisma.document.findMany({
      where: { id: { in: documentIds }, status: "published" },
      select: { id: true, current_version_id: true }
    });
    const versionIds = unique(
      documents.flatMap((document) =>
        document.current_version_id ? [document.current_version_id] : []
      )
    );
    const versions = await this.prisma.documentVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, markdown: true }
    });
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const seenDocuments = new Set<string>();
    const expanded: ContextualCandidate[] = [];

    for (const candidate of candidates) {
      if (seenDocuments.has(candidate.document_id)) {
        continue;
      }
      seenDocuments.add(candidate.document_id);
      const versionId = documentById.get(candidate.document_id)?.current_version_id;
      const markdown = versionId ? versionById.get(versionId)?.markdown : undefined;
      expanded.push(this.toContextualCandidate(candidate, "full_text", null, markdown));
      if (expanded.length >= limit) {
        break;
      }
    }

    return expanded;
  }

  private toContextualCandidate(
    candidate: MilvusSearchChunkResult,
    contextMode: RetrievalContextMode,
    parent?: {
      id: string;
      chunk_type: string;
      heading_path: string[];
      content_text: string;
      token_count: number | null;
      start_line: number | null;
      end_line: number | null;
      start_char: number | null;
      end_char: number | null;
    } | null,
    fullText?: string
  ): ContextualCandidate {
    const matchChunk = toRetrievalChunkContext(candidate);
    const parentChunk = parent ? toDatabaseChunkContext(parent) : null;
    const resultContent =
      contextMode === "full_text"
        ? (fullText ?? candidate.content_text)
        : parentChunk
          ? parentChunk.content
          : candidate.content_text;
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        openkb_retrieval: {
          ...toRecord(candidate.metadata.openkb_retrieval),
          context_mode: contextMode,
          match_chunk_id: candidate.chunk_id,
          parent_chunk_id: parentChunk?.chunk_id ?? null
        }
      },
      contextMode,
      resultContent,
      matchChunk,
      parentChunk
    };
  }

  private async embedQueryIfNeeded(
    query: string,
    mode: RetrievalMode
  ): Promise<number[] | undefined> {
    if (!retrievalModeNeedsEmbedding(mode)) {
      return undefined;
    }

    try {
      return await this.modelClient.embedText(query);
    } catch (error) {
      if (error instanceof Error) {
        throw new RetrievalError("SEARCH_FAILED", error.message, 502);
      }
      throw error;
    }
  }

  private async applyRerank(
    query: string,
    candidates: MilvusSearchChunkResult[],
    mode: RetrievalMode
  ): Promise<MilvusSearchChunkResult[]> {
    const annotated = candidates.map((candidate) =>
      annotateRetrievalMetadata(candidate, {
        mode,
        rawScore: candidate.score
      })
    );

    if (!retrievalModeNeedsRerank(mode) || !this.modelClient.rerankConfigured) {
      return annotated;
    }

    let rerankScores: RerankDocumentScore[];
    try {
      rerankScores = await this.modelClient.rerankDocuments({
        query,
        documents: candidates.map((candidate) => candidate.content_text)
      });
    } catch {
      return annotated.map((candidate) =>
        annotateRetrievalMetadata(candidate, {
          mode,
          rawScore: getRawScore(candidate),
          rerankFailed: true
        })
      );
    }

    const used = new Set<number>();
    const reranked = rerankScores.flatMap((score) => {
      const candidate = annotated[score.index];
      if (!candidate) {
        return [];
      }
      used.add(score.index);
      return [
        annotateRetrievalMetadata(
          {
            ...candidate,
            score: score.relevance_score
          },
          {
            mode,
            rawScore: getRawScore(candidate),
            rerankScore: score.relevance_score
          }
        )
      ];
    });

    const missing = annotated.filter((_, index) => !used.has(index));
    return [...reranked, ...missing];
  }
}

export function resolveEffectiveRetrievalMode(input: {
  storedMode?: string | null;
  envDefaultMode?: string | null;
  embeddingConfigured: boolean;
  rerankConfigured: boolean;
}): RetrievalModeResolution {
  const fallback = input.embeddingConfigured ? "hybrid" : "bm25";
  const requestedMode = normalizeRetrievalMode(input.storedMode ?? input.envDefaultMode, fallback);
  let effectiveMode = requestedMode;

  if (!input.embeddingConfigured && retrievalModeNeedsEmbedding(effectiveMode)) {
    effectiveMode = "bm25";
  }

  if (!input.rerankConfigured && retrievalModeNeedsRerank(effectiveMode)) {
    effectiveMode = stripRerankMode(effectiveMode);
  }

  return {
    requestedMode,
    effectiveMode,
    embeddingConfigured: input.embeddingConfigured,
    rerankConfigured: input.rerankConfigured
  };
}

export function normalizeRetrievalMode(
  value: string | null | undefined,
  fallback: RetrievalMode = "bm25"
): RetrievalMode {
  return RETRIEVAL_MODES.includes(value as RetrievalMode) ? (value as RetrievalMode) : fallback;
}

export function retrievalModeNeedsEmbedding(mode: RetrievalMode): boolean {
  return (
    mode === "dense" || mode === "dense_rerank" || mode === "hybrid" || mode === "hybrid_rerank"
  );
}

export function retrievalModeNeedsRerank(mode: RetrievalMode): boolean {
  return mode === "dense_rerank" || mode === "hybrid_rerank";
}

export function stripRerankMode(mode: RetrievalMode): RetrievalMode {
  if (mode === "dense_rerank") {
    return "dense";
  }
  if (mode === "hybrid_rerank") {
    return "hybrid";
  }
  return mode;
}

export function toMilvusSearchMode(mode: RetrievalMode): MilvusSearchMode {
  if (mode === "dense" || mode === "dense_rerank") {
    return "dense";
  }
  if (mode === "hybrid" || mode === "hybrid_rerank") {
    return "hybrid";
  }
  return "bm25";
}

export function activeProfileSupportsDenseVector(
  profile: {
    vector_dim: number;
    embedding_function_name: string;
    function_metadata: unknown;
  } | null,
  expected: { dim: number; model?: string }
): boolean {
  if (!profile || profile.vector_dim !== expected.dim) {
    return false;
  }
  const metadata = toRecord(profile.function_metadata);
  const model = typeof metadata.embedding_model === "string" ? metadata.embedding_model : null;
  return (
    metadata.dense_vector === true &&
    profile.embedding_function_name === "openkb_direct_embedding" &&
    Boolean(expected.model) &&
    model === expected.model
  );
}

function annotateRetrievalMetadata(
  candidate: MilvusSearchChunkResult,
  input: {
    mode: RetrievalMode;
    rawScore: number;
    rerankScore?: number;
    rerankFailed?: boolean;
  }
): MilvusSearchChunkResult {
  const previous = toRecord(candidate.metadata.openkb_retrieval);
  const openkbRetrieval: Record<string, unknown> = {
    ...previous,
    mode: input.mode,
    raw_score: input.rawScore
  };
  if (input.rerankScore !== undefined) {
    openkbRetrieval.rerank_score = input.rerankScore;
  }
  if (input.rerankFailed) {
    openkbRetrieval.rerank_failed = true;
  }

  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      openkb_retrieval: openkbRetrieval
    }
  };
}

function getRawScore(candidate: MilvusSearchChunkResult): number {
  const retrievalMetadata = toRecord(candidate.metadata.openkb_retrieval);
  const rawScore = retrievalMetadata.raw_score;
  return typeof rawScore === "number" ? rawScore : candidate.score;
}

export function normalizeRetrievalSearchInput(
  input: RetrievalSearchInput
): NormalizedRetrievalSearchInput {
  const query = normalizeQuery(input.query);
  const knowledgeBaseIds = normalizeStringArray(input.knowledge_base_ids, "knowledge_base_ids");
  const topK = normalizeTopK(input.top_k);
  const filters = normalizeSearchFilters(input.filters);

  return {
    query,
    knowledgeBaseIds,
    topK,
    candidateLimit: calculateCandidateLimit(topK),
    filters,
    requestedContextMode: normalizeRetrievalContextMode(input.context_mode)
  };
}

export function normalizeRetrievalAppSearchInput(
  input: RetrievalAppSearchInput
): NormalizedRetrievalSearchInput {
  const query = normalizeQuery(input.query);
  const knowledgeBaseIds = normalizeStringArray(input.app.knowledgeBaseIds, "app.knowledgeBaseIds");
  if (knowledgeBaseIds.length === 0) {
    throw new RetrievalError("INVALID_INPUT", "app.knowledgeBaseIds is required.", 400);
  }
  const topK = normalizeTopK(input.top_k);
  const filters = normalizeSearchFilters(input.filters);

  return {
    query,
    knowledgeBaseIds,
    topK,
    candidateLimit: calculateCandidateLimit(topK),
    filters,
    requestedContextMode: normalizeRetrievalContextMode(input.context_mode)
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

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new RetrievalError("INVALID_INPUT", "query is required.", 400);
  }

  const query = value.trim();
  if (!query) {
    throw new RetrievalError("INVALID_INPUT", "query is required.", 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new RetrievalError("INVALID_INPUT", "query is too long.", 400, {
      max_length: MAX_QUERY_LENGTH
    });
  }

  return query;
}

export function normalizeRetrievalContextMode(value: unknown): RetrievalContextMode | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (RETRIEVAL_CONTEXT_MODES.includes(value as RetrievalContextMode)) {
    return value as RetrievalContextMode;
  }
  throw new RetrievalError("INVALID_INPUT", "context_mode is not supported.", 400);
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

function normalizeSearchFilters(value: unknown): RetrievalSearchFilters {
  if (value === undefined || value === null) {
    return { tags: [] };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", "filters must be an object.", 400);
  }

  const filters = value as Record<string, unknown>;
  const unknownKeys = Object.keys(filters).filter((key) => key !== "tags");
  if (unknownKeys.length > 0) {
    throw new RetrievalError("INVALID_INPUT", "Search filter is not supported.", 400, {
      unsupported_filters: unknownKeys
    });
  }

  return {
    tags: normalizeStringArray(filters.tags, "filters.tags")
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function trimResultContent(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 4000 ? `${compact.slice(0, 3997)}...` : compact;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIsoString(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function toRetrievalChunkContext(candidate: MilvusSearchChunkResult): RetrievalChunkContext {
  return {
    chunk_id: candidate.chunk_id,
    chunk_type: getMetadataString(candidate.metadata, "chunk_type") ?? "general",
    heading_path: candidate.heading_path,
    content: trimResultContent(candidate.content_text),
    token_count: getMetadataNumber(candidate.metadata, "token_count"),
    start_line: getMetadataNumber(candidate.metadata, "start_line"),
    end_line: getMetadataNumber(candidate.metadata, "end_line"),
    start_char: getMetadataNumber(candidate.metadata, "start_char"),
    end_char: getMetadataNumber(candidate.metadata, "end_char")
  };
}

function toDatabaseChunkContext(chunk: {
  id: string;
  chunk_type: string;
  heading_path: string[];
  content_text: string;
  token_count: number | null;
  start_line: number | null;
  end_line: number | null;
  start_char: number | null;
  end_char: number | null;
}): RetrievalChunkContext {
  return {
    chunk_id: chunk.id,
    chunk_type: chunk.chunk_type,
    heading_path: chunk.heading_path,
    content: trimResultContent(chunk.content_text),
    token_count: chunk.token_count,
    start_line: chunk.start_line,
    end_line: chunk.end_line,
    start_char: chunk.start_char,
    end_char: chunk.end_char
  };
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value ? value : null;
}

function getMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

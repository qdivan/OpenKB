import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import {
  createOpenKBModelClient,
  getOpenKBModelClientConfig,
  normalizeModelCapabilities,
  type OpenKBModelClient,
  type RerankDocumentScore,
  type StoredModelSetting
} from "@openkb/model-client";
import {
  createOpenKBMilvus,
  MilvusError,
  type MilvusHybridWeights,
  type MilvusSearchMode,
  type MilvusSearchChunkResult,
  type OpenKBMilvus
} from "@openkb/milvus";
import { PermissionService } from "@openkb/permissions";
import {
  createObjectStorage,
  getObjectStorageConfig,
  StorageConfigError,
  type ObjectStorage
} from "@openkb/storage";

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
  score_threshold?: unknown;
  retrieval_model?: unknown;
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
  score_threshold?: unknown;
  retrieval_model?: unknown;
  filters?: unknown;
  context_mode?: unknown;
};

export type RetrievalSearchFilters = {
  tags: string[];
  metadataCondition: RetrievalMetadataCondition | null;
};

export type RetrievalMetadataCondition = {
  logicalOperator: "and" | "or";
  conditions: RetrievalMetadataConditionItem[];
};

export type RetrievalMetadataConditionItem = {
  name: string;
  operator: string;
  value?: unknown;
};

export type RetrievalModelSearchMethod =
  | "semantic_search"
  | "full_text_search"
  | "hybrid_search"
  | "keyword_search";

export type RetrievalModelOverride = {
  search_method?: RetrievalModelSearchMethod;
  top_k?: number;
  score_threshold_enabled?: boolean;
  score_threshold?: number;
  reranking_enable?: boolean;
  weights?: Record<string, unknown>;
};

export type NormalizedRetrievalSearchInput = {
  query: string;
  knowledgeBaseIds: string[];
  topK: number;
  requestTopK?: number;
  candidateLimit: number;
  filters: RetrievalSearchFilters;
  scoreThreshold?: number;
  retrievalModelOverride?: RetrievalModelOverride;
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
  metadata?: RetrievalSearchResponseMetadata;
  results: RetrievalSearchResult[];
};

export type RetrievalModeResolution = {
  requestedMode: RetrievalMode;
  effectiveMode: RetrievalMode;
  embeddingConfigured: boolean;
  rerankConfigured: boolean;
  strictEmbeddingRequired?: boolean;
};

export type RetrievalSearchResponseMetadata = {
  effective_retrieval_model: Record<string, unknown>;
  retrieval_mode: RetrievalMode;
  requested_retrieval_mode: RetrievalMode;
  score_source: "retrieval" | "rerank";
  score_threshold_applied: number | null;
  mixed_retrieval_model: boolean;
  hybrid_weights?: MilvusHybridWeights;
  rebuild_required_reason?: string;
};

export type RetrievalServiceOptions = {
  prisma?: PrismaClient;
  milvus?: OpenKBMilvus;
  permissions?: PermissionService;
  modelClient?: OpenKBModelClient;
  storage?: ObjectStorage;
  env?: NodeJS.ProcessEnv;
};

type ContextualCandidate = MilvusSearchChunkResult & {
  contextMode: RetrievalContextMode;
  resultContent: string;
  matchChunk: RetrievalChunkContext;
  parentChunk: RetrievalChunkContext | null;
};

type TrustedCandidateChunk = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  knowledge_base_id: string;
  version_id: string;
  index_role: string;
  source_chunk_id: string | null;
  parent_chunk_id: string | null;
  chunk_type: string;
  heading_path: string[];
  content_text: string;
  content_markdown: string;
  override_content_text: string | null;
  override_content_markdown: string | null;
  token_count: number | null;
  start_line: number | null;
  end_line: number | null;
  start_char: number | null;
  end_char: number | null;
  metadata: unknown;
};

type TrustedQaPair = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  knowledge_base_id: string;
  question: string;
  answer: string;
  source_chunk_id: string | null;
  source: string;
  status: string;
  metadata: unknown;
};

type TrustedSourceChunk = {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  version_id: string;
};

type TrustedAsset = {
  id: string;
  tenant_id: string;
  document_id: string | null;
  object_key: string;
  filename: string;
  mime_type: string;
  size_bytes: bigint;
  checksum_sha256: string | null;
};

type TrustedAssetBinding = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  document_id: string;
  version_id: string;
  chunk_id: string;
  asset_id: string | null;
  kind: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: bigint | null;
  external_url: string | null;
  status: string;
};

type TrustedCandidateContext = {
  chunk: TrustedCandidateChunk;
  metadata: Record<string, unknown>;
};

type RetrievalSearchPolicy = {
  mode: RetrievalModeResolution;
  retrievalModel: Record<string, unknown>;
  topK: number;
  candidateLimit: number;
  scoreThreshold?: number;
  hybridWeights?: MilvusHybridWeights;
  mixedKnowledgeBaseRetrievalModel: boolean;
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
  private milvus: OpenKBMilvus | null;
  private readonly permissions: PermissionService;
  private readonly modelClientOverride?: OpenKBModelClient;
  private readonly storageOverride?: ObjectStorage;
  private storage: ObjectStorage | null | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: RetrievalServiceOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.milvus = options.milvus ?? null;
    this.permissions = options.permissions ?? new PermissionService({ prisma: this.prisma });
    this.modelClientOverride = options.modelClient;
    this.storageOverride = options.storage;
    this.env = options.env ?? process.env;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async search(input: RetrievalSearchInput): Promise<RetrievalSearchResponse> {
    const normalized = normalizeRetrievalSearchInput(input);
    const userId = input.user.user.id;
    const tenantId = input.user.tenantId;
    const modelClient = await this.createModelClient();
    const policy = await this.resolveSearchPolicy(tenantId, modelClient, normalized);
    const mode = policy.mode;
    for (const knowledgeBaseId of normalized.knowledgeBaseIds) {
      await this.permissions.requireCanRead(userId, "knowledge_base", knowledgeBaseId);
    }

    const documentIds = await this.resolveTagFilteredDocumentIds(
      tenantId,
      normalized.knowledgeBaseIds,
      normalized.filters
    );
    if (documentIds && documentIds.length === 0) {
      const contextMode = await this.resolveContextMode(
        tenantId,
        normalized.knowledgeBaseIds,
        normalized.requestedContextMode
      );
      return this.toSearchResponse(normalized.query, policy, [], new Map(), contextMode);
    }

    const queryVector = await this.embedQueryIfNeeded(
      normalized.query,
      mode.effectiveMode,
      modelClient
    );

    const accessPrincipals = filterRetrievalAccessPrincipals(
      await this.permissions.getAccessPrincipals(userId, tenantId)
    );

    let candidates: MilvusSearchChunkResult[];
    try {
      candidates = await this.getMilvus().searchChunks({
        query: normalized.query,
        mode: toMilvusSearchMode(mode.effectiveMode),
        queryVector,
        hybridWeights: policy.hybridWeights,
        tenantId,
        accessPrincipals,
        knowledgeBaseIds: normalized.knowledgeBaseIds,
        documentIds,
        filters: toMilvusCandidateFilters(normalized.filters),
        limit: policy.candidateLimit
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
      policy.candidateLimit
    );
    const hydrated = await this.hydrateDerivedCandidateSources(allowed);
    const ranked = await this.applyRerank(normalized.query, hydrated, policy, modelClient);
    const postFiltered = await this.applyPostRetrievalFilters(
      ranked,
      normalized.filters,
      policy.scoreThreshold
    );
    const contextMode = await this.resolveContextMode(
      tenantId,
      normalized.knowledgeBaseIds,
      normalized.requestedContextMode
    );
    const contextual = (
      await this.expandResultContext(postFiltered, contextMode, policy.candidateLimit)
    ).slice(0, policy.topK);
    const paths = await this.resolveDocumentPaths(contextual);

    return this.toSearchResponse(normalized.query, policy, contextual, paths, contextMode);
  }

  async searchAppScope(input: RetrievalAppSearchInput): Promise<RetrievalSearchResponse> {
    const normalized = normalizeRetrievalAppSearchInput(input);
    const tenantId = input.app.tenantId;
    const modelClient = await this.createModelClient();
    const policy = await this.resolveSearchPolicy(tenantId, modelClient, normalized);
    const mode = policy.mode;
    const activeKnowledgeBaseIds = await this.resolveActiveAppKnowledgeBaseIds(
      tenantId,
      normalized.knowledgeBaseIds
    );

    if (activeKnowledgeBaseIds.length === 0) {
      return {
        query: normalized.query,
        top_k: policy.topK,
        metadata: {
          effective_retrieval_model: policy.retrievalModel,
          retrieval_mode: mode.effectiveMode,
          requested_retrieval_mode: mode.requestedMode,
          score_source: retrievalModeNeedsRerank(mode.effectiveMode) ? "rerank" : "retrieval",
          score_threshold_applied: policy.scoreThreshold ?? null,
          mixed_retrieval_model: policy.mixedKnowledgeBaseRetrievalModel,
          ...(policy.hybridWeights ? { hybrid_weights: policy.hybridWeights } : {})
        },
        results: []
      };
    }

    const documentIds = await this.resolveTagFilteredDocumentIds(
      tenantId,
      activeKnowledgeBaseIds,
      normalized.filters
    );
    if (documentIds && documentIds.length === 0) {
      const contextMode = await this.resolveContextMode(
        tenantId,
        activeKnowledgeBaseIds,
        normalized.requestedContextMode
      );
      return this.toSearchResponse(normalized.query, policy, [], new Map(), contextMode);
    }

    const queryVector = await this.embedQueryIfNeeded(
      normalized.query,
      mode.effectiveMode,
      modelClient
    );

    let candidates: MilvusSearchChunkResult[];
    try {
      candidates = await this.getMilvus().searchScopedChunks({
        query: normalized.query,
        mode: toMilvusSearchMode(mode.effectiveMode),
        queryVector,
        hybridWeights: policy.hybridWeights,
        tenantId,
        knowledgeBaseIds: activeKnowledgeBaseIds,
        documentIds,
        filters: toMilvusCandidateFilters(normalized.filters),
        limit: policy.candidateLimit
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
      policy.candidateLimit
    );
    const hydrated = await this.hydrateDerivedCandidateSources(allowed);
    const ranked = await this.applyRerank(normalized.query, hydrated, policy, modelClient);
    const postFiltered = await this.applyPostRetrievalFilters(
      ranked,
      normalized.filters,
      policy.scoreThreshold
    );
    const contextMode = await this.resolveContextMode(
      tenantId,
      activeKnowledgeBaseIds,
      normalized.requestedContextMode
    );
    const contextual = (
      await this.expandResultContext(postFiltered, contextMode, policy.candidateLimit)
    ).slice(0, policy.topK);
    const paths = await this.resolveDocumentPaths(contextual);
    return this.toSearchResponse(normalized.query, policy, contextual, paths, contextMode);
  }

  async resolveSearchMode(
    tenantId: string,
    modelClient: OpenKBModelClient | null = null,
    knowledgeBaseIds: string[] = []
  ): Promise<RetrievalModeResolution> {
    const effectiveModelClient = modelClient ?? (await this.createModelClient());
    const policy = await this.resolveSearchPolicy(tenantId, effectiveModelClient, {
      query: "",
      knowledgeBaseIds,
      topK: DEFAULT_SEARCH_TOP_K,
      candidateLimit: calculateCandidateLimit(DEFAULT_SEARCH_TOP_K),
      filters: { tags: [], metadataCondition: null }
    });
    return policy.mode;
  }

  private async resolveSearchPolicy(
    tenantId: string,
    modelClient: OpenKBModelClient,
    normalized: NormalizedRetrievalSearchInput
  ): Promise<RetrievalSearchPolicy> {
    const [setting, activeProfile, knowledgeBasePolicy] = await Promise.all([
      this.prisma.retrievalSetting.findFirst({
        where: { tenant_id: tenantId },
        select: { mode: true }
      }),
      this.prisma.milvusIndexProfile.findFirst({
        where: {
          alias: this.getMilvus().config.activeAlias,
          status: "active",
          OR: [{ tenant_id: tenantId }, { tenant_id: null }]
        },
        orderBy: { activated_at: "desc" }
      }),
      this.resolveKnowledgeBaseRetrievalPolicy(tenantId, normalized.knowledgeBaseIds)
    ]);
    const requestModel = normalized.retrievalModelOverride;
    const selectedModel = selectRetrievalModel({
      requestModel,
      knowledgeBaseModel: knowledgeBasePolicy.model,
      mixedKnowledgeBaseModel: knowledgeBasePolicy.mixed,
      storedMode: setting?.mode,
      envDefaultMode: this.env.OPENKB_RETRIEVAL_DEFAULT_MODE
    });
    const resolution = resolveEffectiveRetrievalMode({
      storedMode: selectedModel.mode,
      envDefaultMode: this.env.OPENKB_RETRIEVAL_DEFAULT_MODE,
      embeddingConfigured: modelClient.embeddingConfigured,
      rerankConfigured: modelClient.rerankConfigured,
      strictEmbeddingRequired: selectedModel.strictEmbeddingRequired
    });

    if (
      retrievalModeNeedsEmbedding(resolution.effectiveMode) &&
      !activeProfileSupportsDenseVector(activeProfile, {
        dim: modelClient.config.embedding.dim,
        model: modelClient.config.embedding.model,
        capabilities: modelClient.config.embedding.capabilities
      })
    ) {
      throw new RetrievalError(
        "SEARCH_INDEX_NOT_READY",
        "Dense retrieval is enabled, but the active Milvus index does not contain matching dense vectors. Rebuild the active index first.",
        503,
        {
          mode: resolution.effectiveMode,
          active_alias: this.getMilvus().config.activeAlias,
          required_embedding_dim: modelClient.config.embedding.dim,
          required_embedding_model: modelClient.config.embedding.model ?? null
        }
      );
    }

    const topK = normalized.requestTopK ?? selectedModel.topK ?? normalized.topK;
    const scoreThreshold = normalizeEffectiveScoreThreshold(
      normalized.scoreThreshold,
      selectedModel.scoreThreshold
    );
    const hybridWeights =
      toMilvusSearchMode(resolution.effectiveMode) === "hybrid"
        ? selectedModel.hybridWeights
        : undefined;

    return {
      mode: resolution,
      retrievalModel: selectedModel.retrievalModel,
      topK,
      candidateLimit: calculateCandidateLimit(topK),
      scoreThreshold,
      hybridWeights,
      mixedKnowledgeBaseRetrievalModel: knowledgeBasePolicy.mixed
    };
  }

  private async resolveKnowledgeBaseRetrievalPolicy(
    tenantId: string,
    knowledgeBaseIds: string[]
  ): Promise<{
    model: NormalizedKnowledgeBaseRetrievalModel | null;
    mixed: boolean;
  }> {
    if (knowledgeBaseIds.length === 0) {
      return { model: null, mixed: false };
    }

    const chunkSettingsDelegate = this.prisma.knowledgeBaseChunkSetting;
    if (!chunkSettingsDelegate || typeof chunkSettingsDelegate.findMany !== "function") {
      return { model: null, mixed: false };
    }

    const settings = await chunkSettingsDelegate.findMany({
      where: {
        tenant_id: tenantId,
        knowledge_base_id: { in: unique(knowledgeBaseIds) }
      },
      select: {
        indexing_technique: true,
        retrieval_model: true
      }
    });
    if (settings.length === 0) {
      return { model: null, mixed: false };
    }

    const models = settings.map((setting) => normalizeKnowledgeBaseRetrievalModel(setting));
    const signatures = unique(models.map((model) => model.signature));
    return {
      model: signatures.length === 1 ? models[0]! : null,
      mixed: signatures.length > 1
    };
  }

  private async createModelClient(): Promise<OpenKBModelClient> {
    if (this.modelClientOverride) {
      return this.modelClientOverride;
    }

    const settings = await this.prisma.modelSetting.findMany({
      where: { kind: { in: ["embedding", "rerank"] } }
    });
    return createOpenKBModelClient(
      getOpenKBModelClientConfig(this.env, settings.map(toStoredModelSetting))
    );
  }

  private getMilvus(): OpenKBMilvus {
    if (!this.milvus) {
      this.milvus = createOpenKBMilvus();
    }
    return this.milvus;
  }

  private getStorage(): ObjectStorage | null {
    if (this.storageOverride) {
      return this.storageOverride;
    }
    if (this.storage !== undefined) {
      return this.storage;
    }
    try {
      this.storage = createObjectStorage(getObjectStorageConfig(this.env));
    } catch (error) {
      if (error instanceof StorageConfigError) {
        this.storage = null;
      } else {
        throw error;
      }
    }
    return this.storage;
  }

  private toSearchResponse(
    query: string,
    policy: RetrievalSearchPolicy,
    allowed: ContextualCandidate[],
    paths: Map<string, string[]>,
    contextMode: RetrievalContextMode
  ): RetrievalSearchResponse {
    return {
      query,
      top_k: policy.topK,
      context_mode: contextMode,
      metadata: {
        effective_retrieval_model: policy.retrievalModel,
        retrieval_mode: policy.mode.effectiveMode,
        requested_retrieval_mode: policy.mode.requestedMode,
        score_source: retrievalModeNeedsRerank(policy.mode.effectiveMode) ? "rerank" : "retrieval",
        score_threshold_applied: policy.scoreThreshold ?? null,
        mixed_retrieval_model: policy.mixedKnowledgeBaseRetrievalModel,
        ...(policy.hybridWeights ? { hybrid_weights: policy.hybridWeights } : {})
      },
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

    const trustedCandidates = await this.resolveTrustedCandidateContext({
      tenantId,
      chunkIds: unique(sortedCandidates.map((candidate) => candidate.chunk_id))
    });
    const allowed: MilvusSearchChunkResult[] = [];
    const seenChunkIds = new Set<string>();

    for (const candidate of sortedCandidates) {
      if (!candidate.chunk_id || !candidate.document_id || seenChunkIds.has(candidate.chunk_id)) {
        continue;
      }
      const trusted = trustedCandidates.get(candidate.chunk_id);
      if (!trusted) {
        continue;
      }

      seenChunkIds.add(candidate.chunk_id);
      if (await this.permissions.canRead(userId, "document", trusted.chunk.document_id)) {
        allowed.push(toTrustedCandidate(candidate, trusted));
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
    const trustedCandidates = await this.resolveTrustedCandidateContext({
      tenantId,
      chunkIds: unique(sortedCandidates.map((candidate) => candidate.chunk_id)),
      knowledgeBaseIds
    });

    const allowed: MilvusSearchChunkResult[] = [];
    const seenChunkIds = new Set<string>();
    for (const candidate of sortedCandidates) {
      const trusted = trustedCandidates.get(candidate.chunk_id);
      if (
        seenChunkIds.has(candidate.chunk_id) ||
        !trusted ||
        !allowedKnowledgeBaseIds.has(trusted.chunk.knowledge_base_id)
      ) {
        continue;
      }

      seenChunkIds.add(candidate.chunk_id);
      allowed.push(toTrustedCandidate(candidate, trusted));
      if (allowed.length >= limit) {
        break;
      }
    }

    return allowed;
  }

  private async resolveTrustedCandidateContext(input: {
    tenantId: string;
    chunkIds: string[];
    knowledgeBaseIds?: string[];
  }): Promise<Map<string, TrustedCandidateContext>> {
    if (input.chunkIds.length === 0) {
      return new Map();
    }

    const chunks = (await this.prisma.documentChunk.findMany({
      where: {
        id: { in: input.chunkIds },
        tenant_id: input.tenantId,
        ...(input.knowledgeBaseIds ? { knowledge_base_id: { in: input.knowledgeBaseIds } } : {}),
        status: "active"
      },
      select: {
        id: true,
        tenant_id: true,
        workspace_id: true,
        document_id: true,
        knowledge_base_id: true,
        version_id: true,
        index_role: true,
        source_chunk_id: true,
        parent_chunk_id: true,
        chunk_type: true,
        heading_path: true,
        content_text: true,
        content_markdown: true,
        override_content_text: true,
        override_content_markdown: true,
        token_count: true,
        start_line: true,
        end_line: true,
        start_char: true,
        end_char: true,
        metadata: true
      }
    })) as TrustedCandidateChunk[];

    const qaPairIds = unique(
      chunks.flatMap((chunk) => {
        const metadata = toRecord(chunk.metadata);
        return getMetadataString(metadata, "hit_type") === "qa"
          ? [getMetadataString(metadata, "qa_pair_id")].filter((id): id is string => Boolean(id))
          : [];
      })
    );
    const qaPairs = qaPairIds.length
      ? ((await this.prisma.documentQaPair.findMany({
          where: {
            id: { in: qaPairIds },
            tenant_id: input.tenantId,
            status: "active",
            ...(input.knowledgeBaseIds ? { knowledge_base_id: { in: input.knowledgeBaseIds } } : {})
          },
          select: {
            id: true,
            tenant_id: true,
            workspace_id: true,
            document_id: true,
            knowledge_base_id: true,
            question: true,
            answer: true,
            source_chunk_id: true,
            source: true,
            status: true,
            metadata: true
          }
        })) as TrustedQaPair[])
      : [];

    const qaPairById = new Map(qaPairs.map((pair) => [pair.id, pair]));
    const assetIds = unique(
      chunks.flatMap((chunk) => {
        const metadata = toRecord(chunk.metadata);
        return isAssetHitType(getMetadataString(metadata, "hit_type"))
          ? [getMetadataString(metadata, "asset_id")].filter((id): id is string => Boolean(id))
          : [];
      })
    );
    const assetBindingIds = unique(
      chunks.flatMap((chunk) => {
        const metadata = toRecord(chunk.metadata);
        return isAssetHitType(getMetadataString(metadata, "hit_type"))
          ? [getMetadataString(metadata, "asset_binding_id")].filter((id): id is string =>
              Boolean(id)
            )
          : [];
      })
    );
    const assets = assetIds.length
      ? ((await this.prisma.documentAsset.findMany({
          where: {
            id: { in: assetIds },
            tenant_id: input.tenantId
          },
          select: {
            id: true,
            tenant_id: true,
            document_id: true,
            object_key: true,
            filename: true,
            mime_type: true,
            size_bytes: true,
            checksum_sha256: true
          }
        })) as TrustedAsset[])
      : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const assetBindings = assetBindingIds.length
      ? ((await this.prisma.documentAssetBinding.findMany({
          where: {
            id: { in: assetBindingIds },
            tenant_id: input.tenantId,
            status: "active",
            ...(input.knowledgeBaseIds ? { knowledge_base_id: { in: input.knowledgeBaseIds } } : {})
          },
          select: {
            id: true,
            tenant_id: true,
            workspace_id: true,
            knowledge_base_id: true,
            document_id: true,
            version_id: true,
            chunk_id: true,
            asset_id: true,
            kind: true,
            filename: true,
            mime_type: true,
            size_bytes: true,
            external_url: true,
            status: true
          }
        })) as TrustedAssetBinding[])
      : [];
    const assetBindingById = new Map(assetBindings.map((binding) => [binding.id, binding]));
    const previewUrlByAssetId = new Map<string, string | null>();
    const sourceChunkIds = unique([
      ...chunks.flatMap((chunk) => (chunk.source_chunk_id ? [chunk.source_chunk_id] : [])),
      ...qaPairs.flatMap((pair) => (pair.source_chunk_id ? [pair.source_chunk_id] : []))
    ]);
    const sourceChunks = sourceChunkIds.length
      ? ((await this.prisma.documentChunk.findMany({
          where: {
            id: { in: sourceChunkIds },
            tenant_id: input.tenantId,
            ...(input.knowledgeBaseIds
              ? { knowledge_base_id: { in: input.knowledgeBaseIds } }
              : {}),
            status: "active"
          },
          select: {
            id: true,
            document_id: true,
            knowledge_base_id: true,
            version_id: true
          }
        })) as TrustedSourceChunk[])
      : [];

    const documentIds = unique(chunks.map((chunk) => chunk.document_id));
    const knowledgeBaseIds = unique(chunks.map((chunk) => chunk.knowledge_base_id));
    const [documents, knowledgeBases] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          id: { in: documentIds },
          tenant_id: input.tenantId,
          ...(input.knowledgeBaseIds ? { knowledge_base_id: { in: input.knowledgeBaseIds } } : {}),
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
          id: { in: input.knowledgeBaseIds ?? knowledgeBaseIds },
          tenant_id: input.tenantId,
          status: "active"
        },
        select: { id: true }
      })
    ]);

    const documentById = new Map(documents.map((document) => [document.id, document]));
    const activeKnowledgeBaseIds = new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.id));
    const sourceChunkById = new Map(sourceChunks.map((chunk) => [chunk.id, chunk]));
    const trusted = new Map<string, TrustedCandidateContext>();

    for (const chunk of chunks) {
      const document = documentById.get(chunk.document_id);
      if (
        document?.status !== "published" ||
        document.current_version_id !== chunk.version_id ||
        document.knowledge_base_id !== chunk.knowledge_base_id ||
        !activeKnowledgeBaseIds.has(chunk.knowledge_base_id)
      ) {
        continue;
      }
      if (!isTrustedSourceChunkValid(chunk.source_chunk_id, sourceChunkById, chunk, document)) {
        continue;
      }

      const metadata = toTrustedChunkMetadata(chunk);
      const hitType = getMetadataString(metadata, "hit_type");
      if (hitType === "qa") {
        const pairId = getMetadataString(metadata, "qa_pair_id");
        const pair = pairId ? qaPairById.get(pairId) : undefined;
        if (
          !pair ||
          pair.status !== "active" ||
          pair.document_id !== chunk.document_id ||
          pair.knowledge_base_id !== chunk.knowledge_base_id ||
          pair.workspace_id !== chunk.workspace_id ||
          pair.tenant_id !== chunk.tenant_id ||
          !isTrustedSourceChunkValid(pair.source_chunk_id, sourceChunkById, chunk, document)
        ) {
          continue;
        }
        trusted.set(chunk.id, {
          chunk,
          metadata: toTrustedQaMetadata(metadata, pair)
        });
        continue;
      }
      if (isAssetHitType(hitType)) {
        const bindingId = getMetadataString(metadata, "asset_binding_id");
        const binding = bindingId ? assetBindingById.get(bindingId) : undefined;
        if (
          bindingId &&
          (!binding ||
            binding.status !== "active" ||
            binding.tenant_id !== chunk.tenant_id ||
            binding.workspace_id !== chunk.workspace_id ||
            binding.knowledge_base_id !== chunk.knowledge_base_id ||
            binding.document_id !== chunk.document_id ||
            binding.version_id !== chunk.version_id ||
            binding.chunk_id !== chunk.source_chunk_id)
        ) {
          continue;
        }
        const assetId = getMetadataString(metadata, "asset_id");
        if (assetId) {
          const asset = assetById.get(assetId);
          if (
            !asset ||
            asset.tenant_id !== chunk.tenant_id ||
            asset.document_id !== chunk.document_id ||
            (binding?.asset_id && binding.asset_id !== asset.id)
          ) {
            continue;
          }
          if (!previewUrlByAssetId.has(asset.id)) {
            const previewUrls = await this.createAssetPreviewUrls([asset]);
            previewUrlByAssetId.set(asset.id, previewUrls.get(asset.id) ?? null);
          }
          trusted.set(chunk.id, {
            chunk,
            metadata: toTrustedAssetMetadata(
              metadata,
              asset,
              previewUrlByAssetId.get(asset.id) ?? null,
              binding
            )
          });
          continue;
        }
        trusted.set(chunk.id, {
          chunk,
          metadata: toTrustedAssetMetadata(metadata, null, null, binding)
        });
        continue;
      }

      trusted.set(chunk.id, {
        chunk,
        metadata
      });
    }

    return trusted;
  }

  private async hydrateDerivedCandidateSources(
    candidates: MilvusSearchChunkResult[]
  ): Promise<MilvusSearchChunkResult[]> {
    const sourceIds = unique(
      candidates.flatMap((candidate) => {
        const metadata = toRecord(candidate.metadata);
        const hitType = getMetadataString(metadata, "hit_type");
        if (hitType !== "summary" && !isAssetHitType(hitType)) {
          return [];
        }
        const sourceChunkId =
          getMetadataString(metadata, "original_chunk_id") ??
          getMetadataString(metadata, "source_chunk_id");
        return sourceChunkId && sourceChunkId !== candidate.chunk_id ? [sourceChunkId] : [];
      })
    );
    const tenantIds = unique(candidates.map((candidate) => candidate.tenant_id));
    const sourceChunks = sourceIds.length
      ? await this.prisma.documentChunk.findMany({
          where: { id: { in: sourceIds }, tenant_id: { in: tenantIds }, status: "active" },
          select: {
            id: true,
            document_id: true,
            knowledge_base_id: true,
            version_id: true,
            chunk_type: true,
            heading_path: true,
            content_text: true,
            content_markdown: true,
            override_content_text: true,
            override_content_markdown: true,
            token_count: true,
            start_line: true,
            end_line: true,
            start_char: true,
            end_char: true
          }
        })
      : [];
    const sourceById = new Map(sourceChunks.map((chunk) => [chunk.id, chunk]));

    return candidates.map((candidate) => {
      const metadata = toRecord(candidate.metadata);
      const hitType = getMetadataString(metadata, "hit_type");
      if (hitType === "qa") {
        const answer = getMetadataString(metadata, "qa_answer");
        return {
          ...candidate,
          content_text: answer ?? candidate.content_text,
          content_markdown: answer ?? candidate.content_markdown,
          metadata: {
            ...metadata,
            hit_type: "qa",
            qa_answer: answer ?? null,
            original_chunk_id:
              getMetadataString(metadata, "original_chunk_id") ??
              getMetadataString(metadata, "source_chunk_id") ??
              null
          }
        };
      }
      if (hitType !== "summary") {
        if (!isAssetHitType(hitType)) {
          return candidate;
        }

        const sourceChunkId =
          getMetadataString(metadata, "original_chunk_id") ??
          getMetadataString(metadata, "source_chunk_id");
        const source = sourceChunkId ? sourceById.get(sourceChunkId) : undefined;
        if (!source) {
          return {
            ...candidate,
            metadata: {
              ...metadata,
              hit_type: hitType,
              asset_match_text: candidate.content_text,
              original_chunk_id: sourceChunkId ?? null
            }
          };
        }

        const contentText = source.override_content_text ?? source.content_text;
        const contentMarkdown = source.override_content_markdown ?? source.content_markdown;
        return {
          ...candidate,
          heading_path: source.heading_path,
          content_text: contentText,
          content_markdown: contentMarkdown,
          metadata: {
            ...metadata,
            hit_type: hitType,
            asset_match_text: candidate.content_text,
            asset_chunk_id: candidate.chunk_id,
            original_chunk_id: source.id,
            source_chunk_id: source.id,
            original_chunk: {
              chunk_id: source.id,
              chunk_type: source.chunk_type,
              heading_path: source.heading_path,
              token_count: source.token_count,
              start_line: source.start_line,
              end_line: source.end_line,
              start_char: source.start_char,
              end_char: source.end_char
            }
          }
        };
      }

      if (hitType !== "summary") {
        return candidate;
      }

      const sourceChunkId =
        getMetadataString(metadata, "original_chunk_id") ??
        getMetadataString(metadata, "source_chunk_id");
      const source = sourceChunkId ? sourceById.get(sourceChunkId) : undefined;
      if (!source) {
        return {
          ...candidate,
          metadata: {
            ...metadata,
            hit_type: "summary",
            summary_hit: true,
            summary_text: candidate.content_text,
            original_chunk_id: sourceChunkId ?? null
          }
        };
      }

      const contentText = source.override_content_text ?? source.content_text;
      const contentMarkdown = source.override_content_markdown ?? source.content_markdown;
      return {
        ...candidate,
        heading_path: source.heading_path,
        content_text: contentText,
        content_markdown: contentMarkdown,
        metadata: {
          ...metadata,
          hit_type: "summary",
          summary_hit: true,
          summary_text: candidate.content_text,
          summary_chunk_id: candidate.chunk_id,
          original_chunk_id: source.id,
          source_chunk_id: source.id,
          original_chunk: {
            chunk_id: source.id,
            chunk_type: source.chunk_type,
            heading_path: source.heading_path,
            token_count: source.token_count,
            start_line: source.start_line,
            end_line: source.end_line,
            start_char: source.start_char,
            end_char: source.end_char
          }
        }
      };
    });
  }

  private async createAssetPreviewUrls(
    assets: TrustedAsset[]
  ): Promise<Map<string, string | null>> {
    if (assets.length === 0) {
      return new Map();
    }
    const storage = this.getStorage();
    if (!storage) {
      return new Map(assets.map((asset) => [asset.id, null]));
    }

    const pairs = await Promise.all(
      assets.map(async (asset) => {
        try {
          return [
            asset.id,
            await storage.createPresignedGetUrl({ key: asset.object_key })
          ] as const;
        } catch {
          return [asset.id, null] as const;
        }
      })
    );
    return new Map(pairs);
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
      where: { id: { in: parentIds }, chunk_type: "parent", status: "active" }
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
      override_content_text?: string | null;
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

  private async applyPostRetrievalFilters(
    candidates: MilvusSearchChunkResult[],
    filters: RetrievalSearchFilters,
    scoreThreshold?: number
  ): Promise<MilvusSearchChunkResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    const enriched =
      filters.metadataCondition || filters.tags.length > 0
        ? await this.enrichWithDocumentMetadata(candidates)
        : candidates;

    return enriched.filter((candidate) => {
      if (scoreThreshold !== undefined && normalizedScore(candidate.score) < scoreThreshold) {
        return false;
      }
      if (filters.tags.length > 0 && !matchesTagsFilter(candidate.metadata, filters.tags)) {
        return false;
      }
      if (
        filters.metadataCondition &&
        !matchesMetadataCondition(candidate.metadata, filters.metadataCondition)
      ) {
        return false;
      }
      return true;
    });
  }

  private async enrichWithDocumentMetadata(
    candidates: MilvusSearchChunkResult[]
  ): Promise<MilvusSearchChunkResult[]> {
    const documentIds = unique(candidates.map((candidate) => candidate.document_id));
    if (documentIds.length === 0) {
      return candidates;
    }

    const metadataValueDelegate = this.prisma.documentMetadataValue;
    const metadataFieldDelegate = this.prisma.knowledgeBaseMetadataField;
    const canReadMetadataValues =
      metadataValueDelegate &&
      typeof metadataValueDelegate.findMany === "function" &&
      metadataFieldDelegate &&
      typeof metadataFieldDelegate.findMany === "function";

    const knowledgeBaseIds = unique(candidates.map((candidate) => candidate.knowledge_base_id));
    const [knowledgeBases, documents, fields, values] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: knowledgeBaseIds } },
        select: { id: true, title: true }
      }),
      this.prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: {
          id: true,
          title: true,
          slug: true,
          current_version_id: true,
          created_at: true,
          updated_at: true
        }
      }),
      canReadMetadataValues
        ? metadataFieldDelegate.findMany({
            where: { knowledge_base_id: { in: knowledgeBaseIds }, status: "active" },
            select: { id: true, name: true }
          })
        : Promise.resolve([]),
      canReadMetadataValues
        ? metadataValueDelegate.findMany({
            where: { document_id: { in: documentIds } },
            select: { document_id: true, field_id: true, value: true }
          })
        : Promise.resolve([])
    ]);
    const knowledgeBaseTitles = new Map(
      knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase.title])
    );
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const fieldNames = new Map(fields.map((field) => [field.id, field.name]));
    const metadataByDocumentId = new Map<string, Record<string, unknown>>();
    for (const value of values) {
      const fieldName = fieldNames.get(value.field_id);
      if (!fieldName) {
        continue;
      }
      const metadata = metadataByDocumentId.get(value.document_id) ?? {};
      metadata[fieldName] = value.value;
      metadataByDocumentId.set(value.document_id, metadata);
    }

    return candidates.map((candidate) => ({
      ...candidate,
      metadata: {
        ...candidate.metadata,
        document_name: documentById.get(candidate.document_id)?.title ?? candidate.title,
        document_title: documentById.get(candidate.document_id)?.title ?? candidate.title,
        document_slug: documentById.get(candidate.document_id)?.slug ?? null,
        dataset_name: knowledgeBaseTitles.get(candidate.knowledge_base_id) ?? null,
        knowledge_base_title: knowledgeBaseTitles.get(candidate.knowledge_base_id) ?? null,
        last_update_date: documentById.get(candidate.document_id)?.updated_at.toISOString() ?? null,
        upload_date: documentById.get(candidate.document_id)?.created_at.toISOString() ?? null,
        ...(metadataByDocumentId.get(candidate.document_id) ?? {})
      }
    }));
  }

  private async resolveTagFilteredDocumentIds(
    tenantId: string,
    knowledgeBaseIds: string[],
    filters: RetrievalSearchFilters
  ): Promise<string[] | undefined> {
    if (filters.tags.length === 0) {
      return undefined;
    }

    const metadataValueDelegate = this.prisma.documentMetadataValue;
    const metadataFieldDelegate = this.prisma.knowledgeBaseMetadataField;
    const canReadMetadataValues =
      metadataValueDelegate &&
      typeof metadataValueDelegate.findMany === "function" &&
      metadataFieldDelegate &&
      typeof metadataFieldDelegate.findMany === "function";
    if (!canReadMetadataValues) {
      return undefined;
    }

    const knowledgeBaseWhere =
      knowledgeBaseIds.length > 0 ? { knowledge_base_id: { in: knowledgeBaseIds } } : {};

    const fields = await metadataFieldDelegate.findMany({
      where: {
        tenant_id: tenantId,
        ...knowledgeBaseWhere,
        name: "tags",
        status: "active"
      },
      select: { id: true }
    });
    const fieldIds = unique(fields.map((field) => field.id));
    if (fieldIds.length === 0) {
      return [];
    }

    const values = await metadataValueDelegate.findMany({
      where: {
        tenant_id: tenantId,
        ...knowledgeBaseWhere,
        field_id: { in: fieldIds }
      },
      select: { document_id: true, value: true }
    });

    return unique(
      values
        .filter((value) => matchesTagsFilter({ tags: value.value }, filters.tags))
        .map((value) => value.document_id)
    );
  }

  private async embedQueryIfNeeded(
    query: string,
    mode: RetrievalMode,
    modelClient: OpenKBModelClient
  ): Promise<number[] | undefined> {
    if (!retrievalModeNeedsEmbedding(mode)) {
      return undefined;
    }

    try {
      return await modelClient.embedText(query);
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
    policy: RetrievalSearchPolicy,
    modelClient: OpenKBModelClient
  ): Promise<MilvusSearchChunkResult[]> {
    const annotated = candidates.map((candidate) =>
      annotateRetrievalMetadata(candidate, {
        mode: policy.mode.effectiveMode,
        rawScore: candidate.score,
        retrievalModel: policy.retrievalModel,
        mixedKnowledgeBaseRetrievalModel: policy.mixedKnowledgeBaseRetrievalModel,
        scoreThreshold: policy.scoreThreshold,
        hybridWeights: policy.hybridWeights
      })
    );

    if (!retrievalModeNeedsRerank(policy.mode.effectiveMode) || !modelClient.rerankConfigured) {
      return annotated;
    }

    let rerankScores: RerankDocumentScore[];
    try {
      rerankScores = await modelClient.rerankDocuments({
        query,
        documents: candidates.map((candidate) => candidate.content_text)
      });
    } catch {
      return annotated.map((candidate) =>
        annotateRetrievalMetadata(candidate, {
          mode: policy.mode.effectiveMode,
          rawScore: getRawScore(candidate),
          retrievalModel: policy.retrievalModel,
          mixedKnowledgeBaseRetrievalModel: policy.mixedKnowledgeBaseRetrievalModel,
          scoreThreshold: policy.scoreThreshold,
          hybridWeights: policy.hybridWeights,
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
            mode: policy.mode.effectiveMode,
            rawScore: getRawScore(candidate),
            retrievalModel: policy.retrievalModel,
            mixedKnowledgeBaseRetrievalModel: policy.mixedKnowledgeBaseRetrievalModel,
            scoreThreshold: policy.scoreThreshold,
            hybridWeights: policy.hybridWeights,
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
  strictEmbeddingRequired?: boolean;
}): RetrievalModeResolution {
  const fallback = input.embeddingConfigured ? "hybrid" : "bm25";
  const requestedMode = normalizeRetrievalMode(input.storedMode ?? input.envDefaultMode, fallback);
  let effectiveMode = requestedMode;

  if (!input.embeddingConfigured && retrievalModeNeedsEmbedding(effectiveMode)) {
    if (input.strictEmbeddingRequired) {
      throw new RetrievalError(
        "SEARCH_INDEX_NOT_READY",
        "This knowledge base requires semantic or hybrid retrieval, but no embedding model is configured.",
        503,
        { requested_mode: requestedMode, reason: "embedding_not_configured" }
      );
    }
    effectiveMode = "bm25";
  }

  if (!input.rerankConfigured && retrievalModeNeedsRerank(effectiveMode)) {
    effectiveMode = stripRerankMode(effectiveMode);
  }

  return {
    requestedMode,
    effectiveMode,
    embeddingConfigured: input.embeddingConfigured,
    rerankConfigured: input.rerankConfigured,
    strictEmbeddingRequired: input.strictEmbeddingRequired
  };
}

export function normalizeRetrievalMode(
  value: string | null | undefined,
  fallback: RetrievalMode = "bm25"
): RetrievalMode {
  return RETRIEVAL_MODES.includes(value as RetrievalMode) ? (value as RetrievalMode) : fallback;
}

export function modeFromKnowledgeBaseRetrievalSetting(setting: {
  indexing_technique?: string | null;
  retrieval_model?: unknown;
}): RetrievalMode {
  const retrievalModel = toRecord(setting.retrieval_model);
  const searchMethod = String(retrievalModel.search_method ?? "").trim();
  const rerankEnabled = retrievalModel.reranking_enable === true;

  if (searchMethod === "semantic_search") {
    return rerankEnabled ? "dense_rerank" : "dense";
  }
  if (searchMethod === "hybrid_search") {
    return rerankEnabled ? "hybrid_rerank" : "hybrid";
  }
  if (searchMethod === "full_text_search" || searchMethod === "keyword_search") {
    return "bm25";
  }

  return "bm25";
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
  expected: { dim: number; model?: string; capabilities?: unknown }
): boolean {
  return getDenseProfileCompatibility(profile, expected).compatible;
}

export function getDenseProfileCompatibility(
  profile: {
    vector_dim: number;
    embedding_function_name: string;
    function_metadata: unknown;
  } | null,
  expected: { dim: number; model?: string; capabilities?: unknown }
): { compatible: boolean; reason: string | null } {
  if (!profile) {
    return { compatible: false, reason: "no_active_profile" };
  }
  if (profile.vector_dim !== expected.dim) {
    return { compatible: false, reason: "embedding_dim_mismatch" };
  }
  const metadata = toRecord(profile.function_metadata);
  const model = typeof metadata.embedding_model === "string" ? metadata.embedding_model : null;
  if (metadata.dense_vector !== true) {
    return { compatible: false, reason: "dense_vector_missing" };
  }
  if (profile.embedding_function_name !== "openkb_direct_embedding") {
    return { compatible: false, reason: "embedding_function_mismatch" };
  }
  if (!expected.model || model !== expected.model) {
    return { compatible: false, reason: "embedding_model_mismatch" };
  }

  const expectedModalities = getInputModalities(expected.capabilities);
  const profileModalities = getInputModalities(metadata.embedding_capabilities);
  if (
    expectedModalities.some((modality) => modality !== "text") &&
    !expectedModalities.every((modality) => profileModalities.includes(modality))
  ) {
    return { compatible: false, reason: "embedding_modality_mismatch" };
  }

  return { compatible: true, reason: null };
}

function annotateRetrievalMetadata(
  candidate: MilvusSearchChunkResult,
  input: {
    mode: RetrievalMode;
    rawScore: number;
    retrievalModel?: Record<string, unknown>;
    mixedKnowledgeBaseRetrievalModel?: boolean;
    scoreThreshold?: number;
    hybridWeights?: MilvusHybridWeights;
    rerankScore?: number;
    rerankFailed?: boolean;
  }
): MilvusSearchChunkResult {
  const previous = toRecord(candidate.metadata.openkb_retrieval);
  const openkbRetrieval: Record<string, unknown> = {
    ...previous,
    mode: input.mode,
    raw_score: input.rawScore,
    score_source: input.rerankScore !== undefined ? "rerank" : "retrieval"
  };
  if (input.retrievalModel) {
    openkbRetrieval.retrieval_model = input.retrievalModel;
  }
  if (input.mixedKnowledgeBaseRetrievalModel !== undefined) {
    openkbRetrieval.mixed_retrieval_model = input.mixedKnowledgeBaseRetrievalModel;
  }
  if (input.scoreThreshold !== undefined) {
    openkbRetrieval.score_threshold_applied = input.scoreThreshold;
  }
  if (input.hybridWeights) {
    openkbRetrieval.hybrid_weights = input.hybridWeights;
  }
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
      retrieval_model: input.retrievalModel ?? candidate.metadata.retrieval_model,
      retrieval_mode: input.mode,
      score_source: input.rerankScore !== undefined ? "rerank" : "retrieval",
      mixed_retrieval_model: input.mixedKnowledgeBaseRetrievalModel ?? false,
      openkb_retrieval: openkbRetrieval
    }
  };
}

function getRawScore(candidate: MilvusSearchChunkResult): number {
  const retrievalMetadata = toRecord(candidate.metadata.openkb_retrieval);
  const rawScore = retrievalMetadata.raw_score;
  return typeof rawScore === "number" ? rawScore : candidate.score;
}

type NormalizedKnowledgeBaseRetrievalModel = {
  mode: RetrievalMode;
  retrievalModel: Record<string, unknown>;
  topK?: number;
  scoreThreshold?: number;
  hybridWeights?: MilvusHybridWeights;
  strictEmbeddingRequired: boolean;
  signature: string;
};

function normalizeKnowledgeBaseRetrievalModel(setting: {
  indexing_technique?: string | null;
  retrieval_model?: unknown;
}): NormalizedKnowledgeBaseRetrievalModel {
  const retrievalModel = normalizeRetrievalModelConfig(setting.retrieval_model);
  const mode = modeFromKnowledgeBaseRetrievalSetting(setting);
  const topK = retrievalModel.top_k;
  const scoreThreshold =
    retrievalModel.score_threshold_enabled === true ? retrievalModel.score_threshold : undefined;
  const hybridWeights = normalizeHybridWeights(retrievalModel.weights);
  const normalizedModel = {
    ...toRecord(setting.retrieval_model),
    search_method: retrievalModel.search_method ?? searchMethodFromRetrievalMode(mode),
    ...(topK !== undefined ? { top_k: topK } : {}),
    score_threshold_enabled: retrievalModel.score_threshold_enabled === true,
    score_threshold: retrievalModel.score_threshold ?? 0,
    reranking_enable: retrievalModel.reranking_enable === true,
    ...(hybridWeights ? { weights: hybridWeights } : {})
  };

  return {
    mode,
    retrievalModel: normalizedModel,
    topK,
    scoreThreshold,
    hybridWeights,
    strictEmbeddingRequired: retrievalModeNeedsEmbedding(mode),
    signature: JSON.stringify({
      mode,
      retrievalModel: normalizedModel,
      topK,
      scoreThreshold,
      hybridWeights
    })
  };
}

function selectRetrievalModel(input: {
  requestModel?: RetrievalModelOverride;
  knowledgeBaseModel: NormalizedKnowledgeBaseRetrievalModel | null;
  mixedKnowledgeBaseModel: boolean;
  storedMode?: string | null;
  envDefaultMode?: string | null;
}): Omit<NormalizedKnowledgeBaseRetrievalModel, "signature"> {
  if (input.requestModel) {
    const mode = modeFromRetrievalModelConfig(input.requestModel, input.storedMode);
    const topK = input.requestModel.top_k;
    const scoreThreshold =
      input.requestModel.score_threshold_enabled === true
        ? input.requestModel.score_threshold
        : undefined;
    const hybridWeights = normalizeHybridWeights(input.requestModel.weights);
    return {
      mode,
      retrievalModel: {
        ...input.requestModel,
        search_method: input.requestModel.search_method ?? searchMethodFromRetrievalMode(mode),
        ...(hybridWeights ? { weights: hybridWeights } : {})
      },
      topK,
      scoreThreshold,
      hybridWeights,
      strictEmbeddingRequired: retrievalModeNeedsEmbedding(mode)
    };
  }

  if (input.knowledgeBaseModel) {
    return input.knowledgeBaseModel;
  }

  const mode = normalizeRetrievalMode(input.storedMode ?? input.envDefaultMode, "bm25");
  return {
    mode,
    retrievalModel: { search_method: searchMethodFromRetrievalMode(mode) },
    strictEmbeddingRequired: false
  };
}

function normalizeRetrievalModelConfig(value: unknown): RetrievalModelOverride {
  const record = toRecord(value);
  const searchMethod = normalizeSearchMethod(record.search_method);
  return {
    ...(searchMethod ? { search_method: searchMethod } : {}),
    top_k: normalizeOptionalTopK(record.top_k),
    score_threshold_enabled: record.score_threshold_enabled === true,
    score_threshold: normalizeOptionalScoreThreshold(record.score_threshold),
    reranking_enable: record.reranking_enable === true,
    weights: toRecord(record.weights)
  };
}

function modeFromRetrievalModelConfig(
  model: RetrievalModelOverride,
  fallbackMode?: string | null
): RetrievalMode {
  const searchMethod = model.search_method;
  const rerankEnabled = model.reranking_enable === true;
  if (searchMethod === "semantic_search") {
    return rerankEnabled ? "dense_rerank" : "dense";
  }
  if (searchMethod === "hybrid_search") {
    return rerankEnabled ? "hybrid_rerank" : "hybrid";
  }
  if (searchMethod === "full_text_search" || searchMethod === "keyword_search") {
    return "bm25";
  }
  return normalizeRetrievalMode(fallbackMode, "bm25");
}

function normalizeSearchMethod(value: unknown): RetrievalModelSearchMethod | undefined {
  return value === "semantic_search" ||
    value === "full_text_search" ||
    value === "hybrid_search" ||
    value === "keyword_search"
    ? value
    : undefined;
}

function searchMethodFromRetrievalMode(mode: RetrievalMode): RetrievalModelSearchMethod {
  if (mode === "dense" || mode === "dense_rerank") {
    return "semantic_search";
  }
  if (mode === "hybrid" || mode === "hybrid_rerank") {
    return "hybrid_search";
  }
  return "full_text_search";
}

function normalizeOptionalTopK(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeTopK(value);
}

function normalizeOptionalScoreThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RetrievalError("INVALID_INPUT", "score_threshold must be between 0 and 1.", 400);
  }
  return value;
}

function normalizeEffectiveScoreThreshold(
  requestScoreThreshold: number | undefined,
  modelScoreThreshold: number | undefined
): number | undefined {
  return requestScoreThreshold ?? modelScoreThreshold;
}

function normalizeHybridWeights(value: unknown): MilvusHybridWeights | undefined {
  const record = toRecord(value);
  const keywordValue =
    record.keyword_weight ?? toRecord(record.keyword_setting).keyword_weight ?? record.keyword;
  const vectorValue =
    record.vector_weight ?? toRecord(record.vector_setting).vector_weight ?? record.vector;
  if (keywordValue === undefined && vectorValue === undefined) {
    return undefined;
  }
  const keywordWeight = normalizeWeight(keywordValue, "keyword_weight");
  const vectorWeight = normalizeWeight(vectorValue, "vector_weight");
  const total = keywordWeight + vectorWeight;
  if (total <= 0) {
    throw new RetrievalError("INVALID_INPUT", "Hybrid weights must be greater than zero.", 400);
  }
  return {
    keywordWeight: keywordWeight / total,
    vectorWeight: vectorWeight / total
  };
}

function normalizeWeight(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RetrievalError(
      "INVALID_INPUT",
      `${fieldName} must be a number between 0 and 1.`,
      400
    );
  }
  return value;
}

export function normalizeRetrievalSearchInput(
  input: RetrievalSearchInput
): NormalizedRetrievalSearchInput {
  const query = normalizeQuery(input.query);
  const knowledgeBaseIds = normalizeStringArray(input.knowledge_base_ids, "knowledge_base_ids");
  const requestTopK = normalizeOptionalTopK(input.top_k);
  const topK = requestTopK ?? DEFAULT_SEARCH_TOP_K;
  const filters = normalizeSearchFilters(input.filters);
  const scoreThreshold = normalizeOptionalScoreThreshold(input.score_threshold);
  const retrievalModelOverride =
    input.retrieval_model === undefined || input.retrieval_model === null
      ? undefined
      : normalizeRetrievalModelConfig(input.retrieval_model);

  return {
    query,
    knowledgeBaseIds,
    topK,
    requestTopK,
    candidateLimit: calculateCandidateLimit(topK),
    filters,
    scoreThreshold,
    retrievalModelOverride,
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
  const requestTopK = normalizeOptionalTopK(input.top_k);
  const topK = requestTopK ?? DEFAULT_SEARCH_TOP_K;
  const filters = normalizeSearchFilters(input.filters);
  const scoreThreshold = normalizeOptionalScoreThreshold(input.score_threshold);
  const retrievalModelOverride =
    input.retrieval_model === undefined || input.retrieval_model === null
      ? undefined
      : normalizeRetrievalModelConfig(input.retrieval_model);

  return {
    query,
    knowledgeBaseIds,
    topK,
    requestTopK,
    candidateLimit: calculateCandidateLimit(topK),
    filters,
    scoreThreshold,
    retrievalModelOverride,
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

function toStoredModelSetting(setting: {
  kind: string;
  provider: string;
  endpoint: string | null;
  model: string | null;
  enabled: boolean;
  timeout_ms: number | null;
  embedding_dim: number | null;
  embedding_batch_size: number | null;
  llm_temperature: number | null;
  llm_max_output_tokens: number | null;
  encrypted_api_key: string | null;
  api_key_last4: string | null;
  capabilities?: unknown;
  capabilities_detected_at?: Date | null;
}): StoredModelSetting {
  return {
    kind: setting.kind as StoredModelSetting["kind"],
    provider: setting.provider as StoredModelSetting["provider"],
    endpoint: setting.endpoint,
    model: setting.model,
    enabled: setting.enabled,
    timeout_ms: setting.timeout_ms,
    embedding_dim: setting.embedding_dim,
    embedding_batch_size: setting.embedding_batch_size,
    llm_temperature: setting.llm_temperature,
    llm_max_output_tokens: setting.llm_max_output_tokens,
    encrypted_api_key: setting.encrypted_api_key,
    api_key_last4: setting.api_key_last4,
    capabilities: normalizeModelCapabilities(setting.capabilities),
    capabilities_detected_at: setting.capabilities_detected_at
  };
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
    return { tags: [], metadataCondition: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", "filters must be an object.", 400);
  }

  const filters = value as Record<string, unknown>;
  const unknownKeys = Object.keys(filters).filter(
    (key) => key !== "tags" && key !== "metadata_condition" && key !== "metadataCondition"
  );
  if (unknownKeys.length > 0) {
    throw new RetrievalError("INVALID_INPUT", "Search filter is not supported.", 400, {
      unsupported_filters: unknownKeys
    });
  }

  return {
    tags: normalizeStringArray(filters.tags, "filters.tags"),
    metadataCondition: normalizeOptionalMetadataCondition(
      filters.metadata_condition ?? filters.metadataCondition
    )
  };
}

function toMilvusCandidateFilters(filters: RetrievalSearchFilters): RetrievalSearchFilters {
  return {
    ...filters,
    // Dify-style tags are document metadata in OpenKB. Keep tag filtering in the
    // PostgreSQL-backed post-filter so chunk technical metadata cannot become the
    // product truth for metadata_condition/tags parity.
    tags: []
  };
}

function matchesTagsFilter(metadata: Record<string, unknown>, tags: string[]): boolean {
  if (tags.length === 0) {
    return true;
  }
  const value = metadata.tags;
  const actualTags = Array.isArray(value)
    ? value.map((item) => String(item))
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  return tags.some((tag) => actualTags.includes(tag));
}

function normalizeOptionalMetadataCondition(value: unknown): RetrievalMetadataCondition | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", "filters.metadata_condition must be an object.", 400);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return null;
  }
  const logicalOperator = normalizeMetadataLogicalOperator(record.logical_operator);
  const rawConditions = record.conditions;
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) {
    return null;
  }
  return {
    logicalOperator,
    conditions: rawConditions.map(normalizeMetadataConditionItem)
  };
}

function normalizeMetadataLogicalOperator(value: unknown): "and" | "or" {
  if (value === undefined || value === null) {
    return "and";
  }
  if (value === "and" || value === "or") {
    return value;
  }
  throw new RetrievalError("INVALID_INPUT", "metadata_condition.logical_operator is invalid.", 400);
}

function normalizeMetadataConditionItem(value: unknown): RetrievalMetadataConditionItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RetrievalError("INVALID_INPUT", "metadata_condition condition is invalid.", 400);
  }
  const record = value as Record<string, unknown>;
  const name = textValue(record.name ?? record.field ?? record.key);
  const operator = textValue(record.comparison_operator ?? record.operator);
  if (!name || !operator) {
    throw new RetrievalError(
      "INVALID_INPUT",
      "metadata_condition condition name and comparison_operator are required.",
      400
    );
  }
  return {
    name,
    operator: normalizeMetadataOperator(operator),
    value: record.value
  };
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function trimResultContent(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 4000 ? `${compact.slice(0, 3997)}...` : compact;
}

function normalizedScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(Math.max(score, 0), 1);
}

function toTrustedCandidate(
  candidate: MilvusSearchChunkResult,
  trusted: TrustedCandidateContext
): MilvusSearchChunkResult {
  const chunk = trusted.chunk;
  return {
    ...candidate,
    tenant_id: chunk.tenant_id,
    workspace_id: chunk.workspace_id,
    knowledge_base_id: chunk.knowledge_base_id,
    document_id: chunk.document_id,
    version_id: chunk.version_id,
    heading_path: chunk.heading_path ?? candidate.heading_path,
    content_text: chunk.override_content_text ?? chunk.content_text ?? candidate.content_text,
    content_markdown:
      chunk.override_content_markdown ?? chunk.content_markdown ?? candidate.content_markdown,
    metadata: trusted.metadata
  };
}

function toTrustedChunkMetadata(chunk: TrustedCandidateChunk): Record<string, unknown> {
  const metadata = {
    ...toRecord(chunk.metadata),
    chunk_type: chunk.chunk_type,
    parent_chunk_id: chunk.parent_chunk_id,
    token_count: chunk.token_count,
    start_line: chunk.start_line,
    end_line: chunk.end_line,
    start_char: chunk.start_char,
    end_char: chunk.end_char
  };
  const hitType = getMetadataString(metadata, "hit_type");
  if (hitType === "summary") {
    return {
      ...metadata,
      hit_type: "summary",
      summary_hit: true,
      original_chunk_id: chunk.source_chunk_id ?? null,
      source_chunk_id: chunk.source_chunk_id ?? null
    };
  }
  if (isAssetHitType(hitType)) {
    return {
      ...metadata,
      hit_type: hitType,
      original_chunk_id: chunk.source_chunk_id ?? null,
      source_chunk_id: chunk.source_chunk_id ?? null
    };
  }
  return metadata;
}

function toTrustedQaMetadata(
  chunkMetadata: Record<string, unknown>,
  pair: TrustedQaPair
): Record<string, unknown> {
  return {
    ...chunkMetadata,
    hit_type: "qa",
    qa_pair_id: pair.id,
    qa_question: pair.question,
    qa_answer: pair.answer,
    qa_source: pair.source,
    qa_generated_mode: getMetadataString(toRecord(pair.metadata), "generated_mode") ?? null,
    qa_metadata: toRecord(pair.metadata),
    original_chunk_id: pair.source_chunk_id ?? null,
    source_chunk_id: pair.source_chunk_id ?? null
  };
}

function toTrustedAssetMetadata(
  chunkMetadata: Record<string, unknown>,
  asset: TrustedAsset | null,
  previewUrl: string | null,
  binding?: TrustedAssetBinding
): Record<string, unknown> {
  const hitType = isAssetHitType(getMetadataString(chunkMetadata, "hit_type"))
    ? getMetadataString(chunkMetadata, "hit_type")
    : "attachment";
  const filename =
    asset?.filename ?? binding?.filename ?? getMetadataString(chunkMetadata, "asset_filename");
  const mimeType =
    asset?.mime_type ?? binding?.mime_type ?? getMetadataString(chunkMetadata, "asset_mime_type");
  const sizeBytes =
    asset?.size_bytes.toString() ??
    binding?.size_bytes?.toString() ??
    chunkMetadata.asset_size_bytes ??
    null;
  const sourceUrl =
    previewUrl ??
    binding?.external_url ??
    getMetadataString(chunkMetadata, "asset_external_url") ??
    null;
  return {
    ...chunkMetadata,
    hit_type: hitType,
    doc_type: hitType === "image" ? "image" : "attachment",
    asset_id: asset?.id ?? getMetadataString(chunkMetadata, "asset_id"),
    asset_binding_id: binding?.id ?? getMetadataString(chunkMetadata, "asset_binding_id"),
    segment_attachment_id:
      binding?.id ??
      getMetadataString(chunkMetadata, "segment_attachment_id") ??
      getMetadataString(chunkMetadata, "asset_binding_id"),
    asset_filename: filename,
    asset_mime_type: mimeType,
    asset_size_bytes: sizeBytes,
    asset_checksum_sha256:
      asset?.checksum_sha256 ?? getMetadataString(chunkMetadata, "asset_checksum_sha256"),
    asset_preview_url: previewUrl,
    source_url: sourceUrl,
    attachment_info: {
      id:
        asset?.id ??
        getMetadataString(chunkMetadata, "asset_id") ??
        getMetadataString(chunkMetadata, "asset_external_url"),
      name: filename,
      extension: extensionFromFilename(filename),
      mime_type: mimeType,
      source_url: sourceUrl,
      size: sizeBytes
    },
    original_chunk_id: getMetadataString(chunkMetadata, "source_chunk_id") ?? null,
    source_chunk_id: getMetadataString(chunkMetadata, "source_chunk_id") ?? null
  };
}

function extensionFromFilename(filename: string | null): string | null {
  const extension = filename?.match(/(\.[^./\\]+)$/)?.[1];
  return extension ? extension.slice(0, 32) : null;
}

function isAssetHitType(value: string | null): value is "image" | "attachment" {
  return value === "image" || value === "attachment";
}

function isTrustedSourceChunkValid(
  sourceChunkId: string | null,
  sourceChunkById: Map<string, TrustedSourceChunk>,
  chunk: TrustedCandidateChunk,
  document: { current_version_id: string | null }
): boolean {
  if (!sourceChunkId) {
    return true;
  }
  const sourceChunk = sourceChunkById.get(sourceChunkId);
  return (
    sourceChunk?.document_id === chunk.document_id &&
    sourceChunk.knowledge_base_id === chunk.knowledge_base_id &&
    sourceChunk.version_id === document.current_version_id
  );
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getInputModalities(value: unknown): string[] {
  const record = toRecord(value);
  const modalities = record.input_modalities;
  if (!Array.isArray(modalities)) {
    return [];
  }
  return modalities
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase());
}

function toIsoString(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeMetadataOperator(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "\u2260") {
    return "!=";
  }
  if (normalized === "\u2265") {
    return ">=";
  }
  if (normalized === "\u2264") {
    return "<=";
  }
  return normalized;
}

function matchesMetadataCondition(
  metadata: Record<string, unknown>,
  condition: RetrievalMetadataCondition
): boolean {
  const results = condition.conditions.map((item) => matchesMetadataConditionItem(metadata, item));
  return condition.logicalOperator === "or" ? results.some(Boolean) : results.every(Boolean);
}

function matchesMetadataConditionItem(
  metadata: Record<string, unknown>,
  condition: RetrievalMetadataConditionItem
): boolean {
  const actual = getPathValue(metadata, condition.name);
  const expected = condition.value;
  switch (condition.operator) {
    case "contains":
      return containsValue(actual, expected);
    case "not contains":
      return !containsValue(actual, expected);
    case "start with":
      return typeof actual === "string" && actual.startsWith(String(expected ?? ""));
    case "end with":
      return typeof actual === "string" && actual.endsWith(String(expected ?? ""));
    case "is":
    case "=":
    case "==":
      return equalsValue(actual, expected);
    case "is not":
    case "!=":
      return !equalsValue(actual, expected);
    case "in":
      return inValue(actual, expected);
    case "not in":
      return !inValue(actual, expected);
    case "empty":
      return isEmpty(actual);
    case "not empty":
      return !isEmpty(actual);
    case ">":
    case "<":
    case ">=":
    case "<=":
      return compareValues(actual, expected, condition.operator);
    case "before":
      return compareDates(actual, expected, "<");
    case "after":
      return compareDates(actual, expected, ">");
    default:
      throw new RetrievalError(
        "INVALID_INPUT",
        "metadata_condition operator is not supported.",
        400
      );
  }
}

function getPathValue(metadata: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cursor, part) => {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return undefined;
    }
    return (cursor as Record<string, unknown>)[part];
  }, metadata);
}

function containsValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    return expectedValues.some((value) => actual.some((item) => equalsValue(item, value)));
  }
  if (typeof actual === "string") {
    return actual.includes(String(expected ?? ""));
  }
  return false;
}

function inValue(actual: unknown, expected: unknown): boolean {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(actual)) {
    return actual.some((item) => expectedValues.some((value) => equalsValue(item, value)));
  }
  return expectedValues.some((value) => equalsValue(actual, value));
}

function equalsValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date || expected instanceof Date) {
    return toTime(actual) === toTime(expected);
  }
  return String(actual) === String(expected);
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function compareValues(actual: unknown, expected: unknown, operator: ">" | "<" | ">=" | "<=") {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return compareNumbers(actualNumber, expectedNumber, operator);
  }
  return compareDates(actual, expected, operator);
}

function compareDates(actual: unknown, expected: unknown, operator: ">" | "<" | ">=" | "<=") {
  const actualTime = toTime(actual);
  const expectedTime = toTime(expected);
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime)) {
    return false;
  }
  return compareNumbers(actualTime, expectedTime, operator);
}

function compareNumbers(actual: number, expected: number, operator: ">" | "<" | ">=" | "<=") {
  switch (operator) {
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
  }
}

function toTime(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  }
  return Number.NaN;
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
  override_content_text?: string | null;
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
    content: trimResultContent(chunk.override_content_text ?? chunk.content_text),
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

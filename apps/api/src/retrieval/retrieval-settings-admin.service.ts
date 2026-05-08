import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  createOpenKBModelClient,
  getOpenKBModelClientConfig,
  type OpenKBModelClient,
  type StoredModelSetting
} from "@openkb/model-client";
import {
  activeProfileSupportsDenseVector,
  normalizeRetrievalMode,
  RETRIEVAL_MODES,
  resolveEffectiveRetrievalMode,
  retrievalModeNeedsEmbedding,
  retrievalModeNeedsRerank,
  type RetrievalMode
} from "@openkb/retrieval";
import { createCollectionName, getMilvusConfig } from "@openkb/milvus";

export type UpdateRetrievalSettingsInput = {
  mode?: string;
};

@Injectable()
export class RetrievalSettingsAdminService {
  private readonly prisma: PrismaClient;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getStatus(sessionToken: string | null) {
    const me = await this.requireAdmin(sessionToken);
    return this.buildStatus(me);
  }

  async updateSettings(sessionToken: string | null, input: UpdateRetrievalSettingsInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const mode = normalizeInputMode(input.mode);

    await this.prisma.retrievalSetting.upsert({
      where: { tenant_id: me.tenantId },
      create: {
        tenant_id: me.tenantId,
        mode,
        updated_by: me.user.id
      },
      update: {
        mode,
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });

    return this.buildStatus(me);
  }

  async probe(sessionToken: string | null) {
    await this.requireAdmin(sessionToken);
    const modelClient = await this.createModelClient();
    const [embedding, rerank] = await Promise.all([
      modelClient.probeEmbedding(),
      modelClient.probeRerank()
    ]);
    return { embedding, rerank };
  }

  private async buildStatus(me: AuthenticatedUser) {
    const milvusConfig = getMilvusConfig();
    const modelClient = await this.createModelClient();
    const [setting, activeProfile, latestRebuildJob] = await Promise.all([
      this.prisma.retrievalSetting.findFirst({
        where: { tenant_id: me.tenantId }
      }),
      this.prisma.milvusIndexProfile.findFirst({
        where: {
          alias: milvusConfig.activeAlias,
          status: "active",
          OR: [{ tenant_id: me.tenantId }, { tenant_id: null }]
        },
        orderBy: { activated_at: "desc" }
      }),
      this.prisma.indexRebuildJob.findFirst({
        where: {
          target_alias: milvusConfig.activeAlias,
          tenant_id: me.tenantId
        },
        orderBy: { started_at: "desc" }
      })
    ]);
    const denseReady = activeProfileSupportsDenseVector(activeProfile, {
      dim: modelClient.config.embedding.dim,
      model: modelClient.config.embedding.model
    });
    const resolution = resolveEffectiveRetrievalMode({
      storedMode: setting?.mode,
      envDefaultMode: process.env.OPENKB_RETRIEVAL_DEFAULT_MODE,
      embeddingConfigured: modelClient.embeddingConfigured,
      rerankConfigured: modelClient.rerankConfigured
    });
    const needsRebuild = modelClient.embeddingConfigured && !denseReady;

    return {
      mode: resolution.requestedMode,
      effective_mode: resolution.effectiveMode,
      supported_modes: RETRIEVAL_MODES,
      modes: RETRIEVAL_MODES.map((mode) =>
        toModeCapability(mode, {
          embeddingConfigured: modelClient.embeddingConfigured,
          rerankConfigured: modelClient.rerankConfigured,
          denseReady
        })
      ),
      embedding: {
        configured: modelClient.embeddingConfigured,
        model: modelClient.embeddingConfigured ? modelClient.config.embedding.model : null,
        dim: modelClient.config.embedding.dim,
        source: modelClient.config.embedding.source
      },
      rerank: {
        configured: modelClient.rerankConfigured,
        model: modelClient.rerankConfigured ? modelClient.config.rerank.model : null,
        source: modelClient.config.rerank.source
      },
      active_alias: milvusConfig.activeAlias,
      next_rebuild_collection: createCollectionName({
        prefix: milvusConfig.collectionPrefix,
        schemaVersion: milvusConfig.schemaVersion
      }),
      active_profile: activeProfile ? toMilvusIndexProfileDto(activeProfile) : null,
      latest_rebuild_job: latestRebuildJob ? toIndexRebuildJobDto(latestRebuildJob) : null,
      dense_index_ready: denseReady,
      needs_rebuild: needsRebuild
    };
  }

  private async requireAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private async createModelClient(): Promise<OpenKBModelClient> {
    const settings = await this.prisma.modelSetting.findMany({
      where: { kind: { in: ["embedding", "rerank"] } }
    });
    return createOpenKBModelClient(
      getOpenKBModelClientConfig(process.env, settings.map(toStoredModelSetting))
    );
  }
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
    api_key_last4: setting.api_key_last4
  };
}

function normalizeInputMode(value: string | undefined): RetrievalMode {
  const mode = normalizeRetrievalMode(value, "bm25");
  if (mode !== value) {
    throw new AuthError("INVALID_INPUT", "Unsupported retrieval mode.", 400);
  }
  return mode;
}

function toModeCapability(
  mode: RetrievalMode,
  input: {
    embeddingConfigured: boolean;
    rerankConfigured: boolean;
    denseReady: boolean;
  }
) {
  if (retrievalModeNeedsEmbedding(mode) && !input.embeddingConfigured) {
    return { mode, enabled: false, disabled_reason: "embedding_not_configured" };
  }
  if (retrievalModeNeedsEmbedding(mode) && !input.denseReady) {
    return { mode, enabled: false, disabled_reason: "index_rebuild_required" };
  }
  if (retrievalModeNeedsRerank(mode) && !input.rerankConfigured) {
    return { mode, enabled: false, disabled_reason: "rerank_not_configured" };
  }
  return { mode, enabled: true, disabled_reason: null };
}

function toMilvusIndexProfileDto(profile: {
  id: string;
  tenant_id: string | null;
  alias: string;
  collection_name: string;
  schema_version: string;
  vector_dim: number;
  embedding_function_name: string;
  bm25_function_name: string | null;
  rerank_function_name: string | null;
  status: string;
  function_metadata: Prisma.JsonValue;
  created_by: string;
  created_at: Date;
  activated_at: Date | null;
}) {
  return {
    id: profile.id,
    tenant_id: profile.tenant_id,
    alias: profile.alias,
    collection_name: profile.collection_name,
    schema_version: profile.schema_version,
    vector_dim: profile.vector_dim,
    embedding_function_name: profile.embedding_function_name,
    bm25_function_name: profile.bm25_function_name,
    rerank_function_name: profile.rerank_function_name,
    status: profile.status,
    function_metadata: profile.function_metadata,
    created_by: profile.created_by,
    created_at: profile.created_at.toISOString(),
    activated_at: profile.activated_at ? profile.activated_at.toISOString() : null
  };
}

function toIndexRebuildJobDto(job: {
  id: string;
  tenant_id: string | null;
  target_collection: string;
  target_alias: string;
  status: string;
  started_by: string;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
}) {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    target_collection: job.target_collection,
    target_alias: job.target_alias,
    status: job.status,
    started_by: job.started_by,
    started_at: job.started_at.toISOString(),
    finished_at: job.finished_at ? job.finished_at.toISOString() : null,
    error: job.error
  };
}

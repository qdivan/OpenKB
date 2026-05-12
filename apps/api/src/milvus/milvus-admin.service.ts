import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  getOpenKBModelClientConfig,
  isEmbeddingConfigured,
  isRerankConfigured,
  normalizeModelCapabilities,
  type StoredModelSetting
} from "@openkb/model-client";
import {
  assertMilvusName,
  createCollectionName,
  createOpenKBMilvus,
  getMilvusConfig,
  type OpenKBMilvus
} from "@openkb/milvus";
import { getDenseProfileCompatibility } from "@openkb/retrieval";

export type CreateRebuildJobInput = {
  target_collection?: string;
  target_alias?: string;
};

export type ListRebuildJobsInput = {
  status?: string;
  limit?: number;
  offset?: number;
};

export type SwitchAliasInput = {
  alias?: string;
  collection_name?: string;
};

@Injectable()
export class MilvusAdminService {
  private readonly prisma: PrismaClient;
  private milvus: OpenKBMilvus | null = null;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getStatus(sessionToken: string | null) {
    await this.requireAdmin(sessionToken);
    const milvus = this.getMilvus();
    const config = getMilvusConfig();
    const [health, activeProfile, alias, modelSettings] = await Promise.all([
      milvus.health(),
      this.prisma.milvusIndexProfile.findFirst({
        where: {
          alias: config.activeAlias,
          status: "active"
        },
        orderBy: { activated_at: "desc" }
      }),
      milvus.describeAlias(config.activeAlias).catch(() => null),
      this.prisma.modelSetting.findMany({
        where: { kind: { in: ["embedding", "rerank"] } }
      })
    ]);
    const modelConfig = getOpenKBModelClientConfig(
      process.env,
      modelSettings.map(toStoredModelSetting)
    );
    const denseCompatibility = getDenseProfileCompatibility(activeProfile, {
      dim: modelConfig.embedding.dim,
      model: modelConfig.embedding.model,
      capabilities: modelConfig.embedding.capabilities
    });

    return {
      health,
      active_alias: config.activeAlias,
      active_profile: activeProfile ? toMilvusIndexProfileDto(activeProfile) : null,
      alias,
      model: {
        embedding: {
          configured: isEmbeddingConfigured(modelConfig),
          model: modelConfig.embedding.model ?? null,
          dim: modelConfig.embedding.dim,
          source: modelConfig.embedding.source,
          capabilities: modelConfig.embedding.capabilities ?? normalizeModelCapabilities(null)
        },
        rerank: {
          configured: isRerankConfigured(modelConfig),
          model: modelConfig.rerank.model ?? null,
          source: modelConfig.rerank.source,
          capabilities: modelConfig.rerank.capabilities ?? normalizeModelCapabilities(null)
        },
        dense_profile_compatible: denseCompatibility.compatible,
        rebuild_required_reason: denseCompatibility.compatible ? null : denseCompatibility.reason
      }
    };
  }

  async listProfiles(sessionToken: string | null) {
    const me = await this.requireAdmin(sessionToken);
    const profiles = await this.prisma.milvusIndexProfile.findMany({
      where: profileTenantWhere(me),
      orderBy: { created_at: "desc" },
      take: 50
    });

    return profiles.map(toMilvusIndexProfileDto);
  }

  async createRebuildJob(sessionToken: string | null, input: CreateRebuildJobInput = {}) {
    const me = await this.requireSystemAdmin(sessionToken);
    const config = getMilvusConfig();
    const targetCollection =
      normalizeOptionalText(input.target_collection) ??
      createCollectionName({
        prefix: config.collectionPrefix,
        schemaVersion: config.schemaVersion
      });
    const targetAlias = normalizeOptionalText(input.target_alias) ?? config.activeAlias;

    assertMilvusName(targetCollection, "target_collection");
    assertMilvusName(targetAlias, "target_alias");

    const job = await this.prisma.indexRebuildJob.create({
      data: {
        tenant_id: me.tenantId,
        target_collection: targetCollection,
        target_alias: targetAlias,
        status: "pending",
        started_by: me.user.id,
        started_at: new Date()
      }
    });

    return toIndexRebuildJobDto(job);
  }

  async listRebuildJobs(sessionToken: string | null, input: ListRebuildJobsInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const where: Prisma.IndexRebuildJobWhereInput = {
      ...jobTenantWhere(me)
    };
    const status = normalizeOptionalText(input.status);
    if (status) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      this.prisma.indexRebuildJob.findMany({
        where,
        orderBy: { started_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.indexRebuildJob.count({ where })
    ]);

    return {
      items: items.map(toIndexRebuildJobDto),
      limit,
      offset,
      total
    };
  }

  async getRebuildJob(sessionToken: string | null, id: string) {
    const me = await this.requireAdmin(sessionToken);
    const job = await this.prisma.indexRebuildJob.findFirst({
      where: {
        id,
        ...jobTenantWhere(me)
      }
    });

    if (!job) {
      throw new AuthError("INVALID_INPUT", "Index rebuild job was not found.", 404);
    }

    return toIndexRebuildJobDto(job);
  }

  async switchAlias(sessionToken: string | null, input: SwitchAliasInput = {}) {
    const me = await this.requireSystemAdmin(sessionToken);
    const config = getMilvusConfig();
    const alias = normalizeOptionalText(input.alias) ?? config.activeAlias;
    const collectionName = normalizeOptionalText(input.collection_name);

    if (!collectionName) {
      throw new AuthError("INVALID_INPUT", "collection_name is required.", 400);
    }

    assertMilvusName(alias, "alias");
    assertMilvusName(collectionName, "collection_name");

    const profile = await this.prisma.milvusIndexProfile.findFirst({
      where: {
        collection_name: collectionName,
        alias,
        ...profileTenantWhere(me)
      }
    });

    if (!profile) {
      throw new AuthError("INVALID_INPUT", "Target index profile was not found.", 404);
    }

    await this.getMilvus().switchAlias(alias, collectionName);

    await this.prisma.$transaction([
      this.prisma.milvusIndexProfile.updateMany({
        where: {
          alias,
          status: "active",
          id: { not: profile.id },
          ...profileTenantWhere(me)
        },
        data: { status: "deprecated" }
      }),
      this.prisma.milvusIndexProfile.update({
        where: { id: profile.id },
        data: {
          status: "active",
          activated_at: new Date()
        }
      })
    ]);

    return {
      alias,
      collection: collectionName,
      profile_id: profile.id
    };
  }

  private async requireAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private async requireSystemAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "System admin role is required.", 403);
    }
    return me;
  }

  private getMilvus(): OpenKBMilvus {
    if (!this.milvus) {
      this.milvus = createOpenKBMilvus();
    }
    return this.milvus;
  }
}

function profileTenantWhere(me: AuthenticatedUser): Prisma.MilvusIndexProfileWhereInput {
  return me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId };
}

function jobTenantWhere(me: AuthenticatedUser): Prisma.IndexRebuildJobWhereInput {
  return me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId };
}

function normalizeOptionalText(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(Math.trunc(value), 0);
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
  capabilities: Prisma.JsonValue;
  capabilities_detected_at: Date | null;
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

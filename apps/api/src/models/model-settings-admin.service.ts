import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import { getMilvusConfig } from "@openkb/milvus";
import { getDenseProfileCompatibility } from "@openkb/retrieval";
import {
  createOpenKBModelClient,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_TIMEOUT_MS,
  DEFAULT_LANGUAGE_ENDPOINT,
  DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS,
  DEFAULT_LANGUAGE_TEMPERATURE,
  DEFAULT_LANGUAGE_TIMEOUT_MS,
  DEFAULT_RERANK_TIMEOUT_MS,
  encryptModelSecret,
  getModelSecretLast4,
  getOpenKBModelClientConfig,
  isEmbeddingConfigured,
  isLanguageConfigured,
  isModelProviderAllowedForKind,
  isRerankConfigured,
  normalizeModelProvider,
  normalizeModelCapabilities,
  MODEL_KINDS,
  MODEL_PROVIDERS,
  type ModelKind,
  type ModelCapabilities,
  type ModelProvider,
  type OpenKBModelClient,
  type OpenKBModelClientConfig,
  type StoredModelSetting
} from "@openkb/model-client";

export type UpdateModelSettingInput = {
  provider?: string;
  endpoint?: string | null;
  model?: string | null;
  enabled?: boolean;
  timeout_ms?: number | null;
  embedding_dim?: number | null;
  embedding_batch_size?: number | null;
  llm_temperature?: number | null;
  llm_max_output_tokens?: number | null;
  api_key?: string | null;
};

export type AdminModelSettingDto = {
  kind: ModelKind;
  provider: ModelProvider;
  source: "db" | "env" | "none";
  enabled: boolean;
  configured: boolean;
  endpoint: string | null;
  model: string | null;
  timeout_ms: number;
  embedding_dim: number | null;
  embedding_batch_size: number | null;
  llm_temperature: number | null;
  llm_max_output_tokens: number | null;
  has_secret: boolean;
  secret_source: "db" | "env" | "none";
  api_key_last4: string | null;
  capabilities: ModelCapabilities;
  capabilities_detected_at: string | null;
  capability_warnings: string[];
  db_configured: boolean;
  env_configured: boolean;
  updated_by: string | null;
  updated_at: string | null;
  index_rebuild_required?: boolean;
};

type ModelSettingRow = {
  id: string;
  tenant_id: string | null;
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
  updated_by: string;
  updated_at: Date;
};

@Injectable()
export class ModelSettingsAdminService {
  private readonly prisma: PrismaClient;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list(sessionToken: string | null): Promise<{ items: AdminModelSettingDto[] }> {
    const me = await this.requireSystemAdmin(sessionToken);
    const settings = await this.readSettings();
    return { items: await this.toDtos(me, settings) };
  }

  async update(
    sessionToken: string | null,
    kindInput: string,
    input: UpdateModelSettingInput = {}
  ): Promise<AdminModelSettingDto> {
    const me = await this.requireSystemAdmin(sessionToken);
    const kind = parseModelKind(kindInput);
    const existing = await this.prisma.modelSetting.findUnique({ where: { kind } });
    const normalized = normalizeUpdateInput(kind, input);
    const secretData = normalizeSecretUpdate(input);
    const resetCapabilities = shouldResetModelCapabilitiesForUpdate(
      kind,
      existing,
      normalized,
      Boolean(secretData)
    );

    const setting = await this.prisma.modelSetting.upsert({
      where: { kind },
      create: {
        tenant_id: null,
        kind,
        provider: normalized.provider,
        endpoint: normalized.endpoint,
        model: normalized.model,
        enabled: normalized.enabled,
        timeout_ms: normalized.timeout_ms,
        embedding_dim: normalized.embedding_dim,
        embedding_batch_size: normalized.embedding_batch_size,
        llm_temperature: normalized.llm_temperature,
        llm_max_output_tokens: normalized.llm_max_output_tokens,
        encrypted_api_key: secretData?.encrypted_api_key ?? null,
        api_key_last4: secretData?.api_key_last4 ?? null,
        updated_by: me.user.id
      },
      update: {
        provider: normalized.provider,
        endpoint: normalized.endpoint,
        model: normalized.model,
        enabled: normalized.enabled,
        timeout_ms: normalized.timeout_ms,
        embedding_dim: normalized.embedding_dim,
        embedding_batch_size: normalized.embedding_batch_size,
        llm_temperature: normalized.llm_temperature,
        llm_max_output_tokens: normalized.llm_max_output_tokens,
        ...(secretData ?? {}),
        ...(resetCapabilities ? { capabilities: {}, capabilities_detected_at: null } : {}),
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });

    await this.writeAudit(me, "admin.models.update", setting.id, {
      kind,
      provider: normalized.provider,
      enabled: normalized.enabled,
      endpoint_present: Boolean(normalized.endpoint),
      model: normalized.model,
      secret_updated: Boolean(secretData),
      previous_enabled: existing?.enabled ?? false
    });

    const dtos = await this.toDtos(me, [toModelSettingRow(setting)]);
    const dto = dtos.find((item) => item.kind === kind);
    if (!dto) {
      throw new AuthError("INVALID_INPUT", "Model setting was not found.", 404);
    }
    return dto;
  }

  async clearSecret(sessionToken: string | null, kindInput: string): Promise<AdminModelSettingDto> {
    const me = await this.requireSystemAdmin(sessionToken);
    const kind = parseModelKind(kindInput);
    const setting = await this.prisma.modelSetting.upsert({
      where: { kind },
      create: {
        tenant_id: null,
        kind,
        provider: defaultProvider(kind),
        endpoint: null,
        model: null,
        enabled: false,
        timeout_ms: defaultTimeout(kind),
        embedding_dim: kind === "embedding" ? DEFAULT_EMBEDDING_DIM : null,
        embedding_batch_size: kind === "embedding" ? DEFAULT_EMBEDDING_BATCH_SIZE : null,
        llm_temperature: kind === "language" ? DEFAULT_LANGUAGE_TEMPERATURE : null,
        llm_max_output_tokens: kind === "language" ? DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS : null,
        encrypted_api_key: null,
        api_key_last4: null,
        updated_by: me.user.id
      },
      update: {
        encrypted_api_key: null,
        api_key_last4: null,
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });

    await this.writeAudit(me, "admin.models.secret.clear", setting.id, { kind });
    const dtos = await this.toDtos(me, [toModelSettingRow(setting)]);
    const dto = dtos.find((item) => item.kind === kind);
    if (!dto) {
      throw new AuthError("INVALID_INPUT", "Model setting was not found.", 404);
    }
    return dto;
  }

  async probe(sessionToken: string | null, kindInput: string, input?: UpdateModelSettingInput) {
    await this.requireSystemAdmin(sessionToken);
    const kind = parseModelKind(kindInput);
    const settings = await this.prisma.modelSetting.findMany({
      where: { kind: { in: [...MODEL_KINDS] } }
    });
    const hasTransientInput = Boolean(input && Object.keys(input).length > 0);
    let client: OpenKBModelClient;
    try {
      const config = createProbeConfig(kind, input, settings.map(toModelSettingRow));
      client = createOpenKBModelClient(config);
    } catch (error) {
      return {
        configured: true,
        ok: false,
        error: error instanceof Error ? error.message : "Model configuration is not readable."
      };
    }

    const result =
      kind === "embedding"
        ? await client.probeEmbedding()
        : kind === "rerank"
          ? await client.probeRerank()
          : await client.probeLanguageModel();

    if (shouldPersistModelCapabilities(kind, hasTransientInput, result)) {
      await this.prisma.modelSetting.updateMany({
        where: { kind },
        data: {
          capabilities: result.capabilities as Prisma.InputJsonValue,
          capabilities_detected_at: new Date()
        }
      });
    }

    return result;
  }

  private async readSettings(): Promise<ModelSettingRow[]> {
    return (
      await this.prisma.modelSetting.findMany({
        where: { kind: { in: [...MODEL_KINDS] } }
      })
    ).map(toModelSettingRow);
  }

  private async toDtos(
    me: AuthenticatedUser,
    settings: ModelSettingRow[]
  ): Promise<AdminModelSettingDto[]> {
    const settingsByKind = new Map(settings.map((setting) => [setting.kind, setting]));
    const envConfig = getOpenKBModelClientConfig(process.env, []);
    const activeProfile = await this.prisma.milvusIndexProfile.findFirst({
      where: {
        alias: getMilvusConfig().activeAlias,
        status: "active",
        OR: [{ tenant_id: me.tenantId }, { tenant_id: null }]
      },
      orderBy: { activated_at: "desc" }
    });

    return MODEL_KINDS.map((kind) => {
      const setting = settingsByKind.get(kind);
      const provider = parseProvider(setting?.provider) ?? defaultProvider(kind);
      const envState = getEnvState(kind, envConfig);
      const source = setting?.enabled ? "db" : envState.configured ? "env" : "none";
      const dbSecret = Boolean(setting?.encrypted_api_key);
      const envSecret = getEnvSecretLast4(kind) !== null;
      const endpoint =
        source === "db"
          ? (normalizeNullableString(setting?.endpoint) ??
            (kind === "language" ? DEFAULT_LANGUAGE_ENDPOINT : null))
          : envState.endpoint;
      const model = source === "db" ? normalizeNullableString(setting?.model) : envState.model;
      const embeddingDim =
        kind === "embedding"
          ? source === "db"
            ? (setting?.embedding_dim ?? DEFAULT_EMBEDDING_DIM)
            : envConfig.embedding.dim
          : null;
      const embeddingBatchSize =
        kind === "embedding"
          ? source === "db"
            ? (setting?.embedding_batch_size ?? DEFAULT_EMBEDDING_BATCH_SIZE)
            : envConfig.embedding.batchSize
          : null;
      const timeoutMs =
        source === "db" ? (setting?.timeout_ms ?? defaultTimeout(kind)) : envState.timeout_ms;
      const configured = Boolean(endpoint && model);
      const capabilities =
        kind === "embedding"
          ? source === "db"
            ? normalizeModelCapabilities(setting?.capabilities, {
                dimensions: embeddingDim ?? DEFAULT_EMBEDDING_DIM,
                input_modalities: ["text"],
                supports_batch: true
              })
            : normalizeModelCapabilities(envConfig.embedding.capabilities, {
                dimensions: envConfig.embedding.dim,
                input_modalities: ["text"],
                supports_batch: true
              })
          : kind === "rerank"
            ? source === "db"
              ? normalizeModelCapabilities(setting?.capabilities, {
                  input_modalities: ["text"]
                })
              : normalizeModelCapabilities(envConfig.rerank.capabilities, {
                  input_modalities: ["text"]
                })
            : normalizeModelCapabilities(null);
      const denseCompatibility =
        kind === "embedding"
          ? getDenseProfileCompatibility(activeProfile, {
              dim: embeddingDim ?? DEFAULT_EMBEDDING_DIM,
              model: model ?? undefined,
              capabilities
            })
          : null;

      return {
        kind,
        provider,
        source,
        enabled: source === "db" ? Boolean(setting?.enabled) : envState.configured,
        configured,
        endpoint,
        model,
        timeout_ms: timeoutMs,
        embedding_dim: embeddingDim,
        embedding_batch_size: embeddingBatchSize,
        llm_temperature:
          kind === "language"
            ? source === "db"
              ? (setting?.llm_temperature ?? DEFAULT_LANGUAGE_TEMPERATURE)
              : envConfig.language.temperature
            : null,
        llm_max_output_tokens:
          kind === "language"
            ? source === "db"
              ? (setting?.llm_max_output_tokens ?? DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS)
              : envConfig.language.maxOutputTokens
            : null,
        has_secret: source === "db" ? dbSecret : envSecret,
        secret_source:
          source === "db" && dbSecret ? "db" : source === "env" && envSecret ? "env" : "none",
        api_key_last4: source === "db" ? (setting?.api_key_last4 ?? null) : getEnvSecretLast4(kind),
        capabilities,
        capabilities_detected_at:
          source === "db" && setting?.capabilities_detected_at
            ? setting.capabilities_detected_at.toISOString()
            : null,
        capability_warnings: [],
        db_configured: Boolean(setting),
        env_configured: envState.configured,
        updated_by: setting?.updated_by ?? null,
        updated_at: setting?.updated_at ? setting.updated_at.toISOString() : null,
        ...(kind === "embedding"
          ? {
              index_rebuild_required:
                configured && denseCompatibility ? !denseCompatibility.compatible : false
            }
          : {})
      };
    });
  }

  private async requireSystemAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "System admin role is required.", 403);
    }
    return me;
  }

  private async writeAudit(
    me: AuthenticatedUser,
    action: string,
    objectId: string,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: me.tenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: "model_setting",
        object_id: objectId,
        metadata
      }
    });
  }
}

function parseModelKind(value: string): ModelKind {
  if ((MODEL_KINDS as readonly string[]).includes(value)) {
    return value as ModelKind;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported model kind.", 400);
}

function parseProvider(value: string | undefined): ModelProvider | null {
  if (!value) {
    return null;
  }
  if (value === "openai") {
    return "openai_responses";
  }
  if ((MODEL_PROVIDERS as readonly string[]).includes(value)) {
    return value as ModelProvider;
  }
  return null;
}

function defaultProvider(kind: ModelKind): ModelProvider {
  return kind === "language" ? "openai_responses" : "openai_compatible";
}

function normalizeUpdateInput(kind: ModelKind, input: UpdateModelSettingInput) {
  const provider =
    input.provider === undefined
      ? defaultProvider(kind)
      : normalizeModelProvider(input.provider, kind);
  if (input.provider && !parseProvider(input.provider)) {
    throw new AuthError("INVALID_INPUT", "Unsupported model provider.", 400);
  }
  if (!isModelProviderAllowedForKind(provider, kind)) {
    throw new AuthError(
      "INVALID_INPUT",
      "Model provider is not supported for this model kind.",
      400
    );
  }

  return {
    provider,
    endpoint: normalizeNullableString(input.endpoint),
    model: normalizeNullableString(input.model),
    enabled: typeof input.enabled === "boolean" ? input.enabled : false,
    timeout_ms: normalizeInt(input.timeout_ms, defaultTimeout(kind), 1000, 600000),
    embedding_dim:
      kind === "embedding"
        ? normalizeInt(input.embedding_dim, DEFAULT_EMBEDDING_DIM, 1, 65536)
        : null,
    embedding_batch_size:
      kind === "embedding"
        ? normalizeInt(input.embedding_batch_size, DEFAULT_EMBEDDING_BATCH_SIZE, 1, 2048)
        : null,
    llm_temperature:
      kind === "language"
        ? normalizeFloat(input.llm_temperature, DEFAULT_LANGUAGE_TEMPERATURE, 0, 2)
        : null,
    llm_max_output_tokens:
      kind === "language"
        ? normalizeInt(input.llm_max_output_tokens, DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS, 1, 200000)
        : null
  };
}

export function shouldResetModelCapabilitiesForUpdate(
  kind: ModelKind,
  existing: {
    provider: string;
    endpoint: string | null;
    model: string | null;
    enabled: boolean;
    embedding_dim: number | null;
  } | null,
  normalized: ReturnType<typeof normalizeUpdateInput>,
  secretUpdated: boolean
): boolean {
  if (kind === "language" || !existing) {
    return false;
  }
  return (
    parseProvider(existing.provider) !== normalized.provider ||
    normalizeNullableString(existing.endpoint) !== normalized.endpoint ||
    normalizeNullableString(existing.model) !== normalized.model ||
    existing.enabled !== normalized.enabled ||
    (kind === "embedding" &&
      (existing.embedding_dim ?? DEFAULT_EMBEDDING_DIM) !== normalized.embedding_dim) ||
    secretUpdated
  );
}

export function shouldPersistModelCapabilities(
  kind: ModelKind,
  hasTransientInput: boolean,
  result: { ok?: boolean; capabilities?: unknown; capabilities_detected?: boolean }
): boolean {
  return (
    (kind === "embedding" || kind === "rerank") &&
    !hasTransientInput &&
    result.ok === true &&
    result.capabilities_detected === true &&
    result.capabilities !== undefined
  );
}

function normalizeSecretUpdate(input: UpdateModelSettingInput) {
  const secret = typeof input.api_key === "string" ? input.api_key.trim() : "";
  if (!secret) {
    return null;
  }
  return {
    encrypted_api_key: encryptModelSecret(secret),
    api_key_last4: getModelSecretLast4(secret)
  };
}

function createProbeConfig(
  kind: ModelKind,
  input: UpdateModelSettingInput | undefined,
  settings: ModelSettingRow[]
): OpenKBModelClientConfig {
  const hasTransientInput = Boolean(input && Object.keys(input).length > 0);
  if (!hasTransientInput) {
    return getOpenKBModelClientConfig(process.env, settings.map(toStoredModelSetting));
  }

  const existing = settings.find((setting) => setting.kind === kind);
  const otherSettings = settings.filter((setting) => setting.kind !== kind);
  const transientInput = input ?? {};
  const normalized = normalizeUpdateInput(kind, transientInput);
  const transientSecret =
    typeof transientInput.api_key === "string" ? transientInput.api_key.trim() : "";
  const effectiveSettings = [...otherSettings];

  if (normalized.enabled) {
    effectiveSettings.push({
      id: existing?.id ?? "transient-model-setting",
      tenant_id: existing?.tenant_id ?? null,
      kind,
      provider: normalized.provider,
      endpoint: normalized.endpoint,
      model: normalized.model,
      enabled: true,
      timeout_ms: normalized.timeout_ms,
      embedding_dim: normalized.embedding_dim,
      embedding_batch_size: normalized.embedding_batch_size,
      llm_temperature: normalized.llm_temperature,
      llm_max_output_tokens: normalized.llm_max_output_tokens,
      encrypted_api_key: existing?.encrypted_api_key ?? null,
      api_key_last4: existing?.api_key_last4 ?? null,
      capabilities: existing?.capabilities ?? {},
      capabilities_detected_at: existing?.capabilities_detected_at ?? null,
      updated_by: existing?.updated_by ?? "transient",
      updated_at: existing?.updated_at ?? new Date()
    });
  }

  const config = getOpenKBModelClientConfig(
    process.env,
    effectiveSettings.map(toStoredModelSetting)
  );
  if (transientSecret && normalized.enabled) {
    applyTransientApiKey(config, kind, transientSecret);
  }
  return config;
}

function applyTransientApiKey(
  config: OpenKBModelClientConfig,
  kind: ModelKind,
  apiKey: string
): void {
  if (kind === "embedding") {
    config.embedding.apiKey = apiKey;
  } else if (kind === "rerank") {
    config.rerank.apiKey = apiKey;
  } else {
    config.language.apiKey = apiKey;
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeInt(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AuthError("INVALID_INPUT", "Numeric model setting is out of range.", 400);
  }
  return value;
}

function normalizeFloat(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new AuthError("INVALID_INPUT", "Numeric model setting is out of range.", 400);
  }
  return value;
}

function defaultTimeout(kind: ModelKind): number {
  if (kind === "embedding") {
    return DEFAULT_EMBEDDING_TIMEOUT_MS;
  }
  if (kind === "rerank") {
    return DEFAULT_RERANK_TIMEOUT_MS;
  }
  return DEFAULT_LANGUAGE_TIMEOUT_MS;
}

function getEnvState(kind: ModelKind, config: ReturnType<typeof getOpenKBModelClientConfig>) {
  if (kind === "embedding") {
    return {
      configured: isEmbeddingConfigured(config),
      endpoint: config.embedding.endpoint ?? null,
      model: config.embedding.model ?? null,
      timeout_ms: config.embedding.timeoutMs
    };
  }
  if (kind === "rerank") {
    return {
      configured: isRerankConfigured(config),
      endpoint: config.rerank.endpoint ?? null,
      model: config.rerank.model ?? null,
      timeout_ms: config.rerank.timeoutMs
    };
  }
  return {
    configured: isLanguageConfigured(config),
    endpoint: config.language.endpoint ?? null,
    model: config.language.model ?? null,
    timeout_ms: config.language.timeoutMs
  };
}

function getEnvSecretLast4(kind: ModelKind): string | null {
  const value =
    kind === "embedding"
      ? process.env.OPENKB_EMBEDDING_API_KEY
      : kind === "rerank"
        ? process.env.OPENKB_RERANK_API_KEY
        : process.env.OPENKB_LLM_API_KEY;
  return value?.trim() ? getModelSecretLast4(value) : null;
}

function toModelSettingRow(setting: unknown): ModelSettingRow {
  return setting as ModelSettingRow;
}

function toStoredModelSetting(setting: unknown): StoredModelSetting {
  const row = setting as ModelSettingRow;
  return {
    kind: parseModelKind(row.kind),
    provider: parseProvider(row.provider) ?? defaultProvider(parseModelKind(row.kind)),
    endpoint: row.endpoint,
    model: row.model,
    enabled: row.enabled,
    timeout_ms: row.timeout_ms,
    embedding_dim: row.embedding_dim,
    embedding_batch_size: row.embedding_batch_size,
    llm_temperature: row.llm_temperature,
    llm_max_output_tokens: row.llm_max_output_tokens,
    encrypted_api_key: row.encrypted_api_key,
    api_key_last4: row.api_key_last4,
    capabilities: normalizeModelCapabilities(row.capabilities),
    capabilities_detected_at: row.capabilities_detected_at
  };
}

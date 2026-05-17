import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

export const MODEL_CLIENT_PACKAGE_NAME = "@openkb/model-client";
export const DEFAULT_EMBEDDING_DIM = 2048;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_RERANK_TIMEOUT_MS = 15_000;
export const DEFAULT_LANGUAGE_TIMEOUT_MS = 30_000;
export const DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS = 64;
export const DEFAULT_LANGUAGE_TEMPERATURE = 0;
export const DEFAULT_LANGUAGE_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_OPENAI_CHAT_COMPLETIONS_ENDPOINT =
  "https://api.openai.com/v1/chat/completions";
export const DEFAULT_ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const DEFAULT_DASHSCOPE_MULTIMODAL_EMBEDDING_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding";
export const DEFAULT_DASHSCOPE_TEXT_RERANK_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank";

export const MODEL_KINDS = ["embedding", "rerank", "language"] as const;
export const MODEL_PROVIDERS = [
  "openai_compatible",
  "dashscope",
  "openai_responses",
  "openai_chat_completions",
  "anthropic_messages"
] as const;
export const EMBEDDING_RERANK_MODEL_PROVIDERS = ["openai_compatible", "dashscope"] as const;
export const LANGUAGE_MODEL_PROVIDERS = [
  "openai_responses",
  "openai_chat_completions",
  "anthropic_messages"
] as const;

export type ModelKind = (typeof MODEL_KINDS)[number];
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export type ModelInputModality = "text" | "image" | "audio" | "video";

export type ModelCapabilities = {
  input_modalities: ModelInputModality[];
  dimensions: number | null;
  max_tokens: number | null;
  languages: string[];
  provider_model_type: string | null;
  supports_batch: boolean | null;
  raw_provider: Record<string, unknown>;
};

export type ModelClientErrorCode =
  | "INVALID_INPUT"
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_REQUEST_FAILED"
  | "MODEL_RESPONSE_INVALID"
  | "MODEL_SECRET_UNAVAILABLE"
  | "EMBEDDING_DIM_MISMATCH";

export class ModelClientError extends Error {
  constructor(
    public readonly code: ModelClientErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export type StoredModelSetting = {
  kind: ModelKind;
  provider: ModelProvider;
  endpoint: string | null;
  model: string | null;
  enabled: boolean;
  timeout_ms: number | null;
  embedding_dim: number | null;
  embedding_batch_size: number | null;
  llm_temperature: number | null;
  llm_max_output_tokens: number | null;
  encrypted_api_key: string | null;
  api_key_last4?: string | null;
  capabilities?: unknown;
  capabilities_detected_at?: Date | string | null;
};

export type EmbeddingRerankModelProvider = (typeof EMBEDDING_RERANK_MODEL_PROVIDERS)[number];

export type EmbeddingConfig = {
  provider: EmbeddingRerankModelProvider;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  source: "env" | "db" | "none";
  dim: number;
  batchSize: number;
  timeoutMs: number;
  capabilities?: ModelCapabilities;
};

export type RerankConfig = {
  provider: EmbeddingRerankModelProvider;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  source: "env" | "db" | "none";
  timeoutMs: number;
  capabilities?: ModelCapabilities;
};

export type LanguageConfig = {
  provider: (typeof LANGUAGE_MODEL_PROVIDERS)[number];
  endpoint?: string;
  model?: string;
  apiKey?: string;
  source: "env" | "db" | "none";
  timeoutMs: number;
  maxOutputTokens: number;
  temperature: number;
};

export type OpenKBModelClientConfig = {
  embedding: EmbeddingConfig;
  rerank: RerankConfig;
  language: LanguageConfig;
};

export type RerankDocumentScore = {
  index: number;
  relevance_score: number;
};

export type EmbeddingInput =
  | string
  | {
      text?: string;
      image?: string;
    };

export type ModelProbeResult = {
  configured: boolean;
  ok: boolean;
  model?: string;
  dim?: number;
  capabilities?: ModelCapabilities;
  capabilities_detected?: boolean;
  capability_warnings?: string[];
  latency_ms?: number;
  error?: string;
};

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type FetchLike = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<FetchResponseLike>;

export class OpenKBModelClient {
  constructor(
    public readonly config: OpenKBModelClientConfig = getOpenKBModelClientConfig(),
    private readonly fetchFn: FetchLike = defaultFetch
  ) {}

  get embeddingConfigured(): boolean {
    return isEmbeddingConfigured(this.config);
  }

  get rerankConfigured(): boolean {
    return isRerankConfigured(this.config);
  }

  get languageConfigured(): boolean {
    return isLanguageConfigured(this.config);
  }

  async embedText(text: string): Promise<number[]> {
    const embeddings = await this.embedTexts([text]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new ModelClientError("MODEL_RESPONSE_INVALID", "Embedding response is empty.");
    }
    return embedding;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!isEmbeddingConfigured(this.config)) {
      throw new ModelClientError("MODEL_NOT_CONFIGURED", "Embedding endpoint is not configured.");
    }
    if (texts.length === 0) {
      return [];
    }

    const batches = chunk(texts, this.config.embedding.batchSize);
    const embeddings: number[][] = [];
    for (const batch of batches) {
      embeddings.push(...(await this.requestEmbeddingBatch(batch)));
    }
    return embeddings;
  }

  async embedImages(
    images: Array<{
      dataUri: string;
      text?: string;
    }>
  ): Promise<number[][]> {
    if (!isEmbeddingConfigured(this.config)) {
      throw new ModelClientError("MODEL_NOT_CONFIGURED", "Embedding endpoint is not configured.");
    }
    if (images.length === 0) {
      return [];
    }
    const batches = chunk(images, this.config.embedding.batchSize);
    const embeddings: number[][] = [];
    for (const batch of batches) {
      embeddings.push(
        ...(await this.requestEmbeddingInputBatch(
          batch.map((image) => ({
            ...(image.text ? { text: image.text } : {}),
            image: image.dataUri
          }))
        ))
      );
    }
    return embeddings;
  }

  async rerankDocuments(input: {
    query: string;
    documents: string[];
  }): Promise<RerankDocumentScore[]> {
    if (!isRerankConfigured(this.config)) {
      throw new ModelClientError("MODEL_NOT_CONFIGURED", "Rerank endpoint is not configured.");
    }
    if (input.documents.length === 0) {
      return [];
    }

    const body =
      this.config.rerank.provider === "dashscope"
        ? await postJson(
            this.fetchFn,
            this.config.rerank.endpoint,
            {
              model: this.config.rerank.model,
              input: {
                query: { text: input.query },
                documents: input.documents.map((text) => ({ text }))
              },
              parameters: {
                return_documents: false,
                top_n: input.documents.length
              }
            },
            this.config.rerank.timeoutMs,
            this.config.rerank.apiKey
          )
        : await postJson(
            this.fetchFn,
            this.config.rerank.endpoint,
            {
              model: this.config.rerank.model,
              query: input.query,
              documents: input.documents
            },
            this.config.rerank.timeoutMs,
            this.config.rerank.apiKey
          );
    const results =
      this.config.rerank.provider === "dashscope"
        ? parseDashScopeRerankResults(body, input.documents.length)
        : parseRerankResults(body, input.documents.length);
    return results.sort((a, b) => b.relevance_score - a.relevance_score);
  }

  async probeEmbedding(sampleText = "OpenKB embedding probe"): Promise<ModelProbeResult> {
    if (!isEmbeddingConfigured(this.config)) {
      return { configured: false, ok: false, error: "Embedding endpoint is not configured." };
    }

    const startedAt = Date.now();
    const detected = await this.detectModelCapabilities("embedding");
    try {
      const embedding = await this.embedText(sampleText);
      return {
        configured: true,
        ok: true,
        model: this.config.embedding.model,
        dim: embedding.length,
        capabilities: mergeDetectedCapabilities(
          this.config.embedding.capabilities,
          detected.value,
          {
            dimensions: embedding.length,
            supports_batch: true,
            input_modalities: ["text"]
          }
        ),
        capabilities_detected: detected.detected,
        capability_warnings: detected.warnings,
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        model: this.config.embedding.model,
        capabilities: mergeDetectedCapabilities(
          this.config.embedding.capabilities,
          detected.value,
          {
            supports_batch: true,
            input_modalities: ["text"]
          }
        ),
        capabilities_detected: detected.detected,
        capability_warnings: detected.warnings,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Embedding probe failed."
      };
    }
  }

  async resolveEmbeddingCapabilities(): Promise<ModelCapabilities> {
    const detected = await this.detectModelCapabilities("embedding");
    return mergeDetectedCapabilities(this.config.embedding.capabilities, detected.value, {
      dimensions: this.config.embedding.dim,
      supports_batch: true,
      input_modalities: ["text"]
    });
  }

  async probeRerank(): Promise<ModelProbeResult> {
    if (!isRerankConfigured(this.config)) {
      return { configured: false, ok: false, error: "Rerank endpoint is not configured." };
    }

    const startedAt = Date.now();
    const detected = await this.detectModelCapabilities("rerank");
    try {
      await this.rerankDocuments({
        query: "OpenKB retrieval probe",
        documents: ["OpenKB retrieval probe", "unrelated text"]
      });
      return {
        configured: true,
        ok: true,
        model: this.config.rerank.model,
        capabilities: mergeDetectedCapabilities(this.config.rerank.capabilities, detected.value, {
          input_modalities: ["text"]
        }),
        capabilities_detected: detected.detected,
        capability_warnings: detected.warnings,
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        model: this.config.rerank.model,
        capabilities: mergeDetectedCapabilities(this.config.rerank.capabilities, detected.value, {
          input_modalities: ["text"]
        }),
        capabilities_detected: detected.detected,
        capability_warnings: detected.warnings,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Rerank probe failed."
      };
    }
  }

  async probeLanguageModel(sampleText = "Reply with OpenKB OK."): Promise<ModelProbeResult> {
    if (!isLanguageConfigured(this.config)) {
      return { configured: false, ok: false, error: "Language model is not configured." };
    }

    const startedAt = Date.now();
    try {
      const body = await this.requestLanguageProbe(sampleText);
      const payload = assertRecord(body, "Language model response");
      return {
        configured: true,
        ok: true,
        model: typeof payload.model === "string" ? payload.model : this.config.language.model,
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        model: this.config.language.model,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Language model probe failed."
      };
    }
  }

  async generateLanguageText(prompt: string): Promise<string> {
    if (!isLanguageConfigured(this.config)) {
      throw new ModelClientError("MODEL_NOT_CONFIGURED", "Language model is not configured.");
    }
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      throw new ModelClientError("INVALID_INPUT", "Language prompt is required.", 400);
    }
    const body = await this.requestLanguageProbe(normalizedPrompt);
    return parseLanguageTextResponse(body);
  }

  private async requestEmbeddingBatch(texts: string[]): Promise<number[][]> {
    return this.requestEmbeddingInputBatch(texts);
  }

  private async requestEmbeddingInputBatch(inputs: EmbeddingInput[]): Promise<number[][]> {
    const body =
      this.config.embedding.provider === "dashscope"
        ? await postJson(
            this.fetchFn,
            this.config.embedding.endpoint,
            {
              model: this.config.embedding.model,
              input: {
                contents: inputs.flatMap((input) => toDashScopeEmbeddingContents(input))
              },
              parameters: {
                dimension: this.config.embedding.dim
              }
            },
            this.config.embedding.timeoutMs,
            this.config.embedding.apiKey
          )
        : await postJson(
            this.fetchFn,
            this.config.embedding.endpoint,
            {
              model: this.config.embedding.model,
              input: inputs.map(toOpenAICompatibleEmbeddingInput)
            },
            this.config.embedding.timeoutMs,
            this.config.embedding.apiKey
          );
    return this.config.embedding.provider === "dashscope"
      ? parseDashScopeEmbeddingResponse(body, inputs.length, this.config.embedding.dim)
      : parseEmbeddingResponse(body, inputs.length, this.config.embedding.dim);
  }

  private async detectModelCapabilities(
    kind: "embedding" | "rerank"
  ): Promise<{ value: ModelCapabilities | null; detected: boolean; warnings: string[] }> {
    const config = kind === "embedding" ? this.config.embedding : this.config.rerank;
    if (config.provider === "dashscope") {
      return {
        value: getDashScopeModelCapabilities(kind, config.model, this.config.embedding.dim),
        detected: true,
        warnings: []
      };
    }
    const endpoint = getModelListEndpoint(config.endpoint);
    if (!endpoint || !config.model) {
      return { value: null, detected: false, warnings: [] };
    }
    try {
      const body = await getJson(
        this.fetchFn,
        endpoint,
        Math.min(config.timeoutMs, 3000),
        config.apiKey
      );
      const detected = parseOpenAICompatibleModelCapabilityDetection(body, config.model, kind);
      return {
        value: detected.capabilities,
        detected: detected.detected,
        warnings: detected.detected
          ? []
          : [`Model capability detection skipped: ${config.model} was not returned by /v1/models.`]
      };
    } catch (error) {
      return {
        value: null,
        detected: false,
        warnings: [
          error instanceof Error
            ? `Model capability detection skipped: ${error.message}`
            : "Model capability detection skipped."
        ]
      };
    }
  }

  private async requestLanguageProbe(sampleText: string): Promise<unknown> {
    const provider = this.config.language.provider;
    if (provider === "openai_chat_completions") {
      return postJson(
        this.fetchFn,
        this.config.language.endpoint,
        compactRecord({
          model: this.config.language.model,
          messages: [{ role: "user", content: sampleText }],
          max_tokens: this.config.language.maxOutputTokens,
          temperature: this.config.language.temperature
        }),
        this.config.language.timeoutMs,
        this.config.language.apiKey
      );
    }

    if (provider === "anthropic_messages") {
      return postJson(
        this.fetchFn,
        this.config.language.endpoint,
        compactRecord({
          model: this.config.language.model,
          max_tokens: this.config.language.maxOutputTokens,
          temperature: this.config.language.temperature,
          messages: [{ role: "user", content: sampleText }]
        }),
        this.config.language.timeoutMs,
        this.config.language.apiKey,
        {
          auth: "anthropic",
          headers: { "anthropic-version": "2023-06-01" }
        }
      );
    }

    return postJson(
      this.fetchFn,
      this.config.language.endpoint,
      compactRecord({
        model: this.config.language.model,
        input: sampleText,
        store: false,
        max_output_tokens: this.config.language.maxOutputTokens,
        temperature: this.config.language.temperature
      }),
      this.config.language.timeoutMs,
      this.config.language.apiKey
    );
  }
}

export function createOpenKBModelClient(
  config: OpenKBModelClientConfig = getOpenKBModelClientConfig()
): OpenKBModelClient {
  return new OpenKBModelClient(config);
}

export function getOpenKBModelClientConfig(
  env: NodeJS.ProcessEnv = process.env,
  storedSettings: StoredModelSetting[] = []
): OpenKBModelClientConfig {
  const settingByKind = new Map(storedSettings.map((setting) => [setting.kind, setting]));
  return {
    embedding: resolveEmbeddingConfig(env, settingByKind.get("embedding")),
    rerank: resolveRerankConfig(env, settingByKind.get("rerank")),
    language: resolveLanguageConfig(env, settingByKind.get("language"))
  };
}

export function isEmbeddingConfigured(config: OpenKBModelClientConfig): boolean {
  return Boolean(config.embedding.endpoint && config.embedding.model);
}

export function isRerankConfigured(config: OpenKBModelClientConfig): boolean {
  return Boolean(config.rerank.endpoint && config.rerank.model);
}

export function isLanguageConfigured(config: OpenKBModelClientConfig): boolean {
  return Boolean(config.language.endpoint && config.language.model);
}

export function encryptModelSecret(
  secret: string,
  encryptionKey = process.env.OPENKB_CONFIG_ENCRYPTION_KEY
): string {
  const normalized = secret.trim();
  if (!normalized) {
    throw new ModelClientError("MODEL_SECRET_UNAVAILABLE", "Model API key cannot be empty.");
  }

  const key = deriveEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join(":");
}

export function decryptModelSecret(
  encryptedSecret: string,
  encryptionKey = process.env.OPENKB_CONFIG_ENCRYPTION_KEY
): string {
  const key = deriveEncryptionKey(encryptionKey);
  const parts = encryptedSecret.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new ModelClientError("MODEL_SECRET_UNAVAILABLE", "Model API key ciphertext is invalid.");
  }

  try {
    const [, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string];
    const iv = fromBase64Url(ivPart);
    const tag = fromBase64Url(tagPart);
    const ciphertext = fromBase64Url(ciphertextPart);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new ModelClientError(
      "MODEL_SECRET_UNAVAILABLE",
      "Model API key cannot be decrypted with the current OPENKB_CONFIG_ENCRYPTION_KEY.",
      500
    );
  }
}

export function getModelSecretLast4(secret: string): string {
  const normalized = secret.trim();
  return normalized.slice(-4);
}

export function normalizeModelProvider(
  value: string | null | undefined,
  kind: ModelKind
): ModelProvider {
  const normalized = value?.trim();
  if (normalized === "openai") {
    return kind === "language" ? "openai_responses" : "openai_compatible";
  }
  if (normalized === "aliyun" || normalized === "aliyun_dashscope") {
    return "dashscope";
  }
  if ((MODEL_PROVIDERS as readonly string[]).includes(normalized ?? "")) {
    return normalized as ModelProvider;
  }
  return kind === "language" ? "openai_responses" : "openai_compatible";
}

export function isModelProviderAllowedForKind(provider: ModelProvider, kind: ModelKind): boolean {
  if (kind === "language") {
    return (LANGUAGE_MODEL_PROVIDERS as readonly string[]).includes(provider);
  }
  return (EMBEDDING_RERANK_MODEL_PROVIDERS as readonly string[]).includes(provider);
}

export function parseEmbeddingResponse(
  body: unknown,
  expectedCount: number,
  expectedDim: number
): number[][] {
  const payload = assertRecord(body, "Embedding response");
  if (!Array.isArray(payload.data)) {
    throw new ModelClientError("MODEL_RESPONSE_INVALID", "Embedding response data is invalid.");
  }

  const rows = payload.data.map((item, fallbackIndex) => {
    const row = assertRecord(item, "Embedding response item");
    const embedding = row.embedding;
    const index = typeof row.index === "number" ? row.index : fallbackIndex;
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
      throw new ModelClientError("MODEL_RESPONSE_INVALID", "Embedding response index is invalid.");
    }
    if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
      throw new ModelClientError("MODEL_RESPONSE_INVALID", "Embedding response vector is invalid.");
    }
    if (embedding.length !== expectedDim) {
      throw new ModelClientError(
        "EMBEDDING_DIM_MISMATCH",
        `Embedding dimension mismatch. Expected ${expectedDim}, got ${embedding.length}.`,
        400,
        {
          expected_dim: expectedDim,
          actual_dim: embedding.length
        }
      );
    }
    return {
      index,
      embedding: embedding as number[]
    };
  });

  if (rows.length !== expectedCount) {
    throw new ModelClientError(
      "MODEL_RESPONSE_INVALID",
      "Embedding response count does not match input count."
    );
  }

  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => row.embedding);
}

export function parseDashScopeEmbeddingResponse(
  body: unknown,
  expectedCount: number,
  expectedDim: number
): number[][] {
  const payload = assertRecord(body, "DashScope embedding response");
  const output = assertRecord(payload.output, "DashScope embedding response output");
  if (!Array.isArray(output.embeddings)) {
    throw new ModelClientError(
      "MODEL_RESPONSE_INVALID",
      "DashScope embedding response output.embeddings is invalid."
    );
  }

  const rows = output.embeddings.map((item, fallbackIndex) => {
    const row = assertRecord(item, "DashScope embedding response item");
    const embedding = row.embedding;
    const index = typeof row.index === "number" ? row.index : fallbackIndex;
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount) {
      throw new ModelClientError(
        "MODEL_RESPONSE_INVALID",
        "DashScope embedding response index is invalid."
      );
    }
    if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
      throw new ModelClientError(
        "MODEL_RESPONSE_INVALID",
        "DashScope embedding response vector is invalid."
      );
    }
    if (embedding.length !== expectedDim) {
      throw new ModelClientError(
        "EMBEDDING_DIM_MISMATCH",
        `Embedding dimension mismatch. Expected ${expectedDim}, got ${embedding.length}.`,
        400,
        {
          expected_dim: expectedDim,
          actual_dim: embedding.length
        }
      );
    }
    return {
      index,
      embedding: embedding as number[]
    };
  });

  if (rows.length !== expectedCount) {
    throw new ModelClientError(
      "MODEL_RESPONSE_INVALID",
      "DashScope embedding response count does not match input count."
    );
  }

  rows.sort((a, b) => a.index - b.index);
  return rows.map((row) => row.embedding);
}

export function parseRerankResults(body: unknown, documentCount: number): RerankDocumentScore[] {
  const payload = assertRecord(body, "Rerank response");
  if (!Array.isArray(payload.results)) {
    throw new ModelClientError("MODEL_RESPONSE_INVALID", "Rerank response results are invalid.");
  }

  return payload.results.map((item) => {
    const row = assertRecord(item, "Rerank response item");
    const index = row.index;
    const score = row.relevance_score ?? row.score;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= documentCount
    ) {
      throw new ModelClientError("MODEL_RESPONSE_INVALID", "Rerank response index is invalid.");
    }
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new ModelClientError("MODEL_RESPONSE_INVALID", "Rerank response score is invalid.");
    }
    return {
      index,
      relevance_score: score
    };
  });
}

export function parseDashScopeRerankResults(
  body: unknown,
  documentCount: number
): RerankDocumentScore[] {
  const payload = assertRecord(body, "DashScope rerank response");
  const output = assertRecord(payload.output, "DashScope rerank response output");
  if (!Array.isArray(output.results)) {
    throw new ModelClientError(
      "MODEL_RESPONSE_INVALID",
      "DashScope rerank response output.results is invalid."
    );
  }

  return output.results.map((item) => {
    const row = assertRecord(item, "DashScope rerank response item");
    const index = row.index;
    const score = row.relevance_score ?? row.score;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= documentCount
    ) {
      throw new ModelClientError(
        "MODEL_RESPONSE_INVALID",
        "DashScope rerank response index is invalid."
      );
    }
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new ModelClientError(
        "MODEL_RESPONSE_INVALID",
        "DashScope rerank response score is invalid."
      );
    }
    return {
      index,
      relevance_score: score
    };
  });
}

export function parseOpenAICompatibleModelCapabilities(
  body: unknown,
  model: string,
  kind: "embedding" | "rerank"
): ModelCapabilities {
  return parseOpenAICompatibleModelCapabilityDetection(body, model, kind).capabilities;
}

export function parseOpenAICompatibleModelCapabilityDetection(
  body: unknown,
  model: string,
  kind: "embedding" | "rerank"
): { capabilities: ModelCapabilities; detected: boolean } {
  const payload = assertRecord(body, "Model list response");
  const models = Array.isArray(payload.data) ? payload.data : [];
  const match = models
    .map((item) =>
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null
    )
    .find((item) => {
      if (!item) {
        return false;
      }
      return [item.id, item.model_name, item.model].some((value) => value === model);
    });

  if (!match) {
    return { capabilities: emptyCapabilities(kind), detected: false };
  }

  const nestedCapabilities = toRecord(match.capabilities);
  const inferredInputModalities = inferInputModalities(match, kind);
  const inputModalities =
    match.input_modalities ??
    match.modalities ??
    nestedCapabilities.input_modalities ??
    nestedCapabilities.modalities;
  const dimensions =
    firstPositiveNumber(match.dimensions, match.dimension, match.embedding_dim) ??
    firstPositiveNumber(
      nestedCapabilities.dimensions,
      nestedCapabilities.dimension,
      nestedCapabilities.embedding_dim
    );
  const maxTokens =
    firstPositiveNumber(match.max_tokens, match.context_length, match.max_input_tokens) ??
    firstPositiveNumber(
      nestedCapabilities.max_tokens,
      nestedCapabilities.context_length,
      nestedCapabilities.max_input_tokens
    );
  const languages =
    match.language ??
    match.languages ??
    nestedCapabilities.language ??
    nestedCapabilities.languages;
  const providerModelType =
    firstString(match.model_type, match.type) ??
    firstString(nestedCapabilities.model_type, nestedCapabilities.type, kind);
  const supportsBatch =
    typeof match.supports_batch === "boolean"
      ? match.supports_batch
      : typeof nestedCapabilities.supports_batch === "boolean"
        ? nestedCapabilities.supports_batch
        : kind === "embedding"
          ? true
          : null;

  return {
    capabilities: normalizeModelCapabilities({
      input_modalities: inputModalities ?? inferredInputModalities,
      dimensions,
      max_tokens: maxTokens,
      languages: normalizeStringArray(languages),
      provider_model_type: providerModelType,
      supports_batch: supportsBatch,
      raw_provider: compactRecord({
        id: firstString(match.id),
        owned_by: firstString(match.owned_by),
        model_name: firstString(match.model_name),
        model_family: firstString(match.model_family),
        model_type: providerModelType,
        type: firstString(match.type),
        dimensions,
        max_tokens: maxTokens,
        language: normalizeStringArray(languages),
        capabilities: Object.keys(nestedCapabilities).length > 0 ? nestedCapabilities : null
      })
    }),
    detected: true
  };
}

function resolveEmbeddingConfig(
  env: NodeJS.ProcessEnv,
  setting: StoredModelSetting | undefined
): EmbeddingConfig {
  if (setting?.enabled) {
    const provider = normalizeEmbeddingRerankProvider(setting.provider);
    return {
      provider,
      endpoint:
        emptyToUndefined(setting.endpoint ?? undefined) ?? defaultEmbeddingEndpoint(provider),
      model: emptyToUndefined(setting.model ?? undefined),
      apiKey: decryptSettingApiKey(setting, env),
      source: "db",
      dim: positiveNumber(setting.embedding_dim, DEFAULT_EMBEDDING_DIM),
      batchSize: positiveNumber(setting.embedding_batch_size, DEFAULT_EMBEDDING_BATCH_SIZE),
      timeoutMs: positiveNumber(setting.timeout_ms, DEFAULT_EMBEDDING_TIMEOUT_MS),
      capabilities: normalizeModelCapabilities(setting.capabilities, {
        dimensions: positiveNumber(setting.embedding_dim, DEFAULT_EMBEDDING_DIM),
        input_modalities: ["text"],
        supports_batch: true
      })
    };
  }

  const provider = normalizeEmbeddingRerankProvider(env.OPENKB_EMBEDDING_REQUEST_FORMAT);
  const envConfig: EmbeddingConfig = {
    provider,
    endpoint: emptyToUndefined(env.OPENKB_EMBEDDING_ENDPOINT) ?? defaultEmbeddingEndpoint(provider),
    model: emptyToUndefined(env.OPENKB_EMBEDDING_MODEL),
    apiKey: emptyToUndefined(env.OPENKB_EMBEDDING_API_KEY),
    source: "env",
    dim: parsePositiveInt(env.OPENKB_EMBEDDING_DIM, DEFAULT_EMBEDDING_DIM),
    batchSize: parsePositiveInt(env.OPENKB_EMBEDDING_BATCH_SIZE, DEFAULT_EMBEDDING_BATCH_SIZE),
    timeoutMs: parsePositiveInt(env.OPENKB_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS),
    capabilities: normalizeModelCapabilities(null, {
      dimensions: parsePositiveInt(env.OPENKB_EMBEDDING_DIM, DEFAULT_EMBEDDING_DIM),
      input_modalities: ["text"],
      supports_batch: true
    })
  };
  return isEmbeddingConfigConfigured(envConfig) ? envConfig : { ...envConfig, source: "none" };
}

function resolveRerankConfig(
  env: NodeJS.ProcessEnv,
  setting: StoredModelSetting | undefined
): RerankConfig {
  if (setting?.enabled) {
    const provider = normalizeEmbeddingRerankProvider(setting.provider);
    return {
      provider,
      endpoint: emptyToUndefined(setting.endpoint ?? undefined) ?? defaultRerankEndpoint(provider),
      model: emptyToUndefined(setting.model ?? undefined),
      apiKey: decryptSettingApiKey(setting, env),
      source: "db",
      timeoutMs: positiveNumber(setting.timeout_ms, DEFAULT_RERANK_TIMEOUT_MS),
      capabilities: normalizeModelCapabilities(setting.capabilities, {
        input_modalities: ["text"]
      })
    };
  }

  const provider = normalizeEmbeddingRerankProvider(env.OPENKB_RERANK_REQUEST_FORMAT);
  const envConfig: RerankConfig = {
    provider,
    endpoint: emptyToUndefined(env.OPENKB_RERANK_ENDPOINT) ?? defaultRerankEndpoint(provider),
    model: emptyToUndefined(env.OPENKB_RERANK_MODEL),
    apiKey: emptyToUndefined(env.OPENKB_RERANK_API_KEY),
    source: "env",
    timeoutMs: parsePositiveInt(env.OPENKB_RERANK_TIMEOUT_MS, DEFAULT_RERANK_TIMEOUT_MS),
    capabilities: normalizeModelCapabilities(null, {
      input_modalities: ["text"]
    })
  };
  return isRerankConfigConfigured(envConfig) ? envConfig : { ...envConfig, source: "none" };
}

function resolveLanguageConfig(
  env: NodeJS.ProcessEnv,
  setting: StoredModelSetting | undefined
): LanguageConfig {
  if (setting?.enabled) {
    const provider = normalizeLanguageProvider(setting.provider);
    return {
      provider,
      endpoint:
        emptyToUndefined(setting.endpoint ?? undefined) ?? defaultLanguageEndpoint(provider),
      model: emptyToUndefined(setting.model ?? undefined),
      apiKey: decryptSettingApiKey(setting, env),
      source: "db",
      timeoutMs: positiveNumber(setting.timeout_ms, DEFAULT_LANGUAGE_TIMEOUT_MS),
      maxOutputTokens: positiveNumber(
        setting.llm_max_output_tokens,
        DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS
      ),
      temperature: finiteNumber(setting.llm_temperature, DEFAULT_LANGUAGE_TEMPERATURE)
    };
  }

  const provider = normalizeLanguageProvider(env.OPENKB_LLM_REQUEST_FORMAT);
  const envConfig: LanguageConfig = {
    provider,
    endpoint: emptyToUndefined(env.OPENKB_LLM_ENDPOINT) ?? defaultLanguageEndpoint(provider),
    model: emptyToUndefined(env.OPENKB_LLM_MODEL),
    apiKey: emptyToUndefined(env.OPENKB_LLM_API_KEY),
    source: "env",
    timeoutMs: parsePositiveInt(env.OPENKB_LLM_TIMEOUT_MS, DEFAULT_LANGUAGE_TIMEOUT_MS),
    maxOutputTokens: parsePositiveInt(
      env.OPENKB_LLM_MAX_OUTPUT_TOKENS,
      DEFAULT_LANGUAGE_MAX_OUTPUT_TOKENS
    ),
    temperature: parseFloatNumber(env.OPENKB_LLM_TEMPERATURE, DEFAULT_LANGUAGE_TEMPERATURE)
  };
  return isLanguageConfigConfigured(envConfig) ? envConfig : { ...envConfig, source: "none" };
}

function decryptSettingApiKey(
  setting: StoredModelSetting,
  env: NodeJS.ProcessEnv
): string | undefined {
  return setting.encrypted_api_key
    ? decryptModelSecret(setting.encrypted_api_key, env.OPENKB_CONFIG_ENCRYPTION_KEY)
    : undefined;
}

function isEmbeddingConfigConfigured(config: EmbeddingConfig): boolean {
  return Boolean(config.endpoint && config.model);
}

function isRerankConfigConfigured(config: RerankConfig): boolean {
  return Boolean(config.endpoint && config.model);
}

function isLanguageConfigConfigured(config: LanguageConfig): boolean {
  return Boolean(config.endpoint && config.model);
}

async function postJson(
  fetchFn: FetchLike,
  endpoint: string | undefined,
  payload: Record<string, unknown>,
  timeoutMs: number,
  apiKey?: string,
  options: {
    auth?: "bearer" | "anthropic";
    headers?: Record<string, string>;
  } = {}
): Promise<unknown> {
  if (!endpoint) {
    throw new ModelClientError("MODEL_NOT_CONFIGURED", "Model endpoint is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(options.headers ?? {})
    };
    if (apiKey) {
      if (options.auth === "anthropic") {
        headers["x-api-key"] = apiKey;
      } else {
        headers.authorization = `Bearer ${apiKey}`;
      }
    }
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ModelClientError(
        "MODEL_REQUEST_FAILED",
        `Model endpoint returned HTTP ${response.status}.`,
        502,
        {
          status: response.status,
          body: await response.text().catch(() => "")
        }
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ModelClientError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Model request timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Model request failed.";
    throw new ModelClientError("MODEL_REQUEST_FAILED", message, 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(
  fetchFn: FetchLike,
  endpoint: string,
  timeoutMs: number,
  apiKey?: string
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const response = await fetchFn(endpoint, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ModelClientError(
        "MODEL_REQUEST_FAILED",
        `Model endpoint returned HTTP ${response.status}.`,
        502,
        {
          status: response.status,
          body: await response.text().catch(() => "")
        }
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ModelClientError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Model request timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Model request failed.";
    throw new ModelClientError("MODEL_REQUEST_FAILED", message, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function getModelListEndpoint(endpoint: string | undefined): string | null {
  if (!endpoint) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    const nextPathname = url.pathname
      .replace(/\/v1\/embeddings\/?$/i, "/v1/models")
      .replace(/\/v1\/rerank\/?$/i, "/v1/models")
      .replace(/\/v1\/responses\/?$/i, "/v1/models")
      .replace(/\/v1\/chat\/completions\/?$/i, "/v1/models");
    if (nextPathname === url.pathname) {
      return null;
    }
    url.pathname = nextPathname;
    return url.toString();
  } catch {
    return null;
  }
}

async function defaultFetch(
  url: string,
  init: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelClientError("MODEL_RESPONSE_INVALID", `${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseLanguageTextResponse(value: unknown): string {
  const payload = assertRecord(value, "Language model response");
  const outputText = firstString(payload.output_text, payload.text, payload.content);
  if (outputText) {
    return outputText;
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const record = toRecord(choice);
    const message = toRecord(record.message);
    const content = firstString(message.content, record.text);
    if (content) {
      return content;
    }
    const parts = Array.isArray(message.content) ? message.content : [];
    const text = parts
      .map((part) => firstString(toRecord(part).text))
      .filter(Boolean)
      .join("\n");
    if (text.trim()) {
      return text.trim();
    }
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const outputParts: string[] = [];
  for (const item of output) {
    const content = toRecord(item).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      const text = firstString(toRecord(part).text);
      if (text) {
        outputParts.push(text);
      }
    }
  }
  if (outputParts.join("\n").trim()) {
    return outputParts.join("\n").trim();
  }

  throw new ModelClientError("MODEL_RESPONSE_INVALID", "Language model response has no text.");
}

function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function deriveEncryptionKey(value: string | undefined): Buffer {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ModelClientError(
      "MODEL_SECRET_UNAVAILABLE",
      "OPENKB_CONFIG_ENCRYPTION_KEY is required to save or read model API keys.",
      500
    );
  }

  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to hashed passphrase support.
  }

  return createHash("sha256").update(normalized).digest();
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeModelCapabilities(
  value: unknown,
  fallback: Partial<ModelCapabilities> = {}
): ModelCapabilities {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    input_modalities: normalizeInputModalities(
      record.input_modalities ?? record.modalities,
      fallback.input_modalities ?? []
    ),
    dimensions:
      firstPositiveNumber(record.dimensions, record.dimension) ?? fallback.dimensions ?? null,
    max_tokens:
      firstPositiveNumber(record.max_tokens, record.max_input_tokens) ??
      fallback.max_tokens ??
      null,
    languages: normalizeStringArray(record.languages ?? record.language, fallback.languages ?? []),
    provider_model_type:
      firstString(record.provider_model_type, record.model_type) ??
      fallback.provider_model_type ??
      null,
    supports_batch:
      typeof record.supports_batch === "boolean"
        ? record.supports_batch
        : (fallback.supports_batch ?? null),
    raw_provider:
      typeof record.raw_provider === "object" &&
      record.raw_provider !== null &&
      !Array.isArray(record.raw_provider)
        ? compactRecord(record.raw_provider as Record<string, unknown>)
        : (fallback.raw_provider ?? {})
  };
}

function emptyCapabilities(kind: "embedding" | "rerank"): ModelCapabilities {
  return normalizeModelCapabilities(null, {
    input_modalities: ["text"],
    supports_batch: kind === "embedding" ? true : null,
    provider_model_type: kind
  });
}

function getDashScopeModelCapabilities(
  kind: "embedding" | "rerank",
  model: string | undefined,
  embeddingDim: number
): ModelCapabilities {
  return normalizeModelCapabilities(null, {
    input_modalities: kind === "embedding" ? ["text", "image"] : ["text"],
    dimensions: kind === "embedding" ? embeddingDim : null,
    languages: ["zh", "en"],
    provider_model_type: kind,
    supports_batch: kind === "embedding" ? true : null,
    raw_provider: compactRecord({
      provider: "dashscope",
      model,
      request_format: kind === "embedding" ? "multimodal-embedding" : "text-rerank"
    })
  });
}

function mergeDetectedCapabilities(
  base: ModelCapabilities | undefined,
  detected: ModelCapabilities | null,
  fallback: Partial<ModelCapabilities> = {}
): ModelCapabilities {
  if (!detected) {
    return normalizeModelCapabilities(base, fallback);
  }
  return normalizeModelCapabilities(
    {
      ...(base ?? {}),
      ...detected,
      raw_provider: {
        ...(base?.raw_provider ?? {}),
        ...detected.raw_provider
      }
    },
    fallback
  );
}

function toDashScopeEmbeddingContents(input: EmbeddingInput): Array<Record<string, string>> {
  if (typeof input === "string") {
    return [{ text: input }];
  }
  if (input.image) {
    return [{ image: input.image }];
  }
  return [{ text: input.text ?? "" }];
}

function toOpenAICompatibleEmbeddingInput(input: EmbeddingInput): unknown {
  if (typeof input === "string") {
    return input;
  }
  if (input.image) {
    return {
      ...(input.text ? { text: input.text } : {}),
      image: input.image
    };
  }
  return input.text ?? "";
}

function inferInputModalities(
  model: Record<string, unknown>,
  kind: "embedding" | "rerank"
): ModelInputModality[] {
  const explicit = normalizeInputModalities(model.input_modalities ?? model.modalities, []);
  if (explicit.length > 0) {
    return explicit;
  }
  const haystack = [model.id, model.model_name, model.model_family, model.model_type, model.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/\b(vl|vision|visual|image|multimodal|multi-modal)\b/.test(haystack)) {
    return ["text", "image"];
  }
  if (kind === "embedding" || kind === "rerank") {
    return ["text"];
  }
  return [];
}

function normalizeInputModalities(
  value: unknown,
  fallback: ModelInputModality[]
): ModelInputModality[] {
  const values = normalizeStringArray(value, fallback);
  const allowed = new Set<ModelInputModality>(["text", "image", "audio", "video"]);
  return unique(
    values
      .map((item) => item.toLowerCase())
      .filter((item): item is ModelInputModality => allowed.has(item as ModelInputModality))
  );
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return unique(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return fallback;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  );
}

function normalizeLanguageProvider(value: string | null | undefined): LanguageConfig["provider"] {
  const provider = normalizeModelProvider(value, "language");
  return isModelProviderAllowedForKind(provider, "language")
    ? (provider as LanguageConfig["provider"])
    : "openai_responses";
}

function normalizeEmbeddingRerankProvider(
  value: string | null | undefined
): EmbeddingRerankModelProvider {
  const provider = normalizeModelProvider(value, "embedding");
  return isModelProviderAllowedForKind(provider, "embedding")
    ? (provider as EmbeddingRerankModelProvider)
    : "openai_compatible";
}

function defaultEmbeddingEndpoint(provider: EmbeddingRerankModelProvider): string | undefined {
  return provider === "dashscope" ? DEFAULT_DASHSCOPE_MULTIMODAL_EMBEDDING_ENDPOINT : undefined;
}

function defaultRerankEndpoint(provider: EmbeddingRerankModelProvider): string | undefined {
  return provider === "dashscope" ? DEFAULT_DASHSCOPE_TEXT_RERANK_ENDPOINT : undefined;
}

function defaultLanguageEndpoint(provider: LanguageConfig["provider"]): string {
  if (provider === "openai_chat_completions") {
    return DEFAULT_OPENAI_CHAT_COMPLETIONS_ENDPOINT;
  }
  if (provider === "anthropic_messages") {
    return DEFAULT_ANTHROPIC_MESSAGES_ENDPOINT;
  }
  return DEFAULT_LANGUAGE_ENDPOINT;
}

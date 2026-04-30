export const MODEL_CLIENT_PACKAGE_NAME = "@openkb/model-client";
export const DEFAULT_EMBEDDING_DIM = 2048;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_RERANK_TIMEOUT_MS = 15_000;

export type ModelClientErrorCode =
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_REQUEST_FAILED"
  | "MODEL_RESPONSE_INVALID"
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

export type EmbeddingConfig = {
  endpoint?: string;
  model?: string;
  dim: number;
  batchSize: number;
  timeoutMs: number;
};

export type RerankConfig = {
  endpoint?: string;
  model?: string;
  timeoutMs: number;
};

export type OpenKBModelClientConfig = {
  embedding: EmbeddingConfig;
  rerank: RerankConfig;
};

export type RerankDocumentScore = {
  index: number;
  relevance_score: number;
};

export type ModelProbeResult = {
  configured: boolean;
  ok: boolean;
  model?: string;
  dim?: number;
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
    method: "POST";
    headers: Record<string, string>;
    body: string;
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

    const body = await postJson(
      this.fetchFn,
      this.config.rerank.endpoint,
      {
        model: this.config.rerank.model,
        query: input.query,
        documents: input.documents
      },
      this.config.rerank.timeoutMs
    );
    const results = parseRerankResults(body, input.documents.length);
    return results.sort((a, b) => b.relevance_score - a.relevance_score);
  }

  async probeEmbedding(sampleText = "OpenKB embedding probe"): Promise<ModelProbeResult> {
    if (!isEmbeddingConfigured(this.config)) {
      return { configured: false, ok: false, error: "Embedding endpoint is not configured." };
    }

    const startedAt = Date.now();
    try {
      const embedding = await this.embedText(sampleText);
      return {
        configured: true,
        ok: true,
        model: this.config.embedding.model,
        dim: embedding.length,
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        model: this.config.embedding.model,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Embedding probe failed."
      };
    }
  }

  async probeRerank(): Promise<ModelProbeResult> {
    if (!isRerankConfigured(this.config)) {
      return { configured: false, ok: false, error: "Rerank endpoint is not configured." };
    }

    const startedAt = Date.now();
    try {
      await this.rerankDocuments({
        query: "OpenKB retrieval probe",
        documents: ["OpenKB retrieval probe", "unrelated text"]
      });
      return {
        configured: true,
        ok: true,
        model: this.config.rerank.model,
        latency_ms: Date.now() - startedAt
      };
    } catch (error) {
      return {
        configured: true,
        ok: false,
        model: this.config.rerank.model,
        latency_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "Rerank probe failed."
      };
    }
  }

  private async requestEmbeddingBatch(texts: string[]): Promise<number[][]> {
    const body = await postJson(
      this.fetchFn,
      this.config.embedding.endpoint,
      {
        model: this.config.embedding.model,
        input: texts
      },
      this.config.embedding.timeoutMs
    );
    return parseEmbeddingResponse(body, texts.length, this.config.embedding.dim);
  }
}

export function createOpenKBModelClient(
  config: OpenKBModelClientConfig = getOpenKBModelClientConfig()
): OpenKBModelClient {
  return new OpenKBModelClient(config);
}

export function getOpenKBModelClientConfig(
  env: NodeJS.ProcessEnv = process.env
): OpenKBModelClientConfig {
  return {
    embedding: {
      endpoint: emptyToUndefined(env.OPENKB_EMBEDDING_ENDPOINT),
      model: emptyToUndefined(env.OPENKB_EMBEDDING_MODEL),
      dim: parsePositiveInt(env.OPENKB_EMBEDDING_DIM, DEFAULT_EMBEDDING_DIM),
      batchSize: parsePositiveInt(env.OPENKB_EMBEDDING_BATCH_SIZE, DEFAULT_EMBEDDING_BATCH_SIZE),
      timeoutMs: parsePositiveInt(env.OPENKB_EMBEDDING_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS)
    },
    rerank: {
      endpoint: emptyToUndefined(env.OPENKB_RERANK_ENDPOINT),
      model: emptyToUndefined(env.OPENKB_RERANK_MODEL),
      timeoutMs: parsePositiveInt(env.OPENKB_RERANK_TIMEOUT_MS, DEFAULT_RERANK_TIMEOUT_MS)
    }
  };
}

export function isEmbeddingConfigured(config: OpenKBModelClientConfig): boolean {
  return Boolean(config.embedding.endpoint && config.embedding.model);
}

export function isRerankConfigured(config: OpenKBModelClientConfig): boolean {
  return Boolean(config.rerank.endpoint && config.rerank.model);
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

async function postJson(
  fetchFn: FetchLike,
  endpoint: string | undefined,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  if (!endpoint) {
    throw new ModelClientError("MODEL_NOT_CONFIGURED", "Model endpoint is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

async function defaultFetch(
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
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

function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

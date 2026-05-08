import { describe, expect, it } from "vitest";

import {
  decryptModelSecret,
  encryptModelSecret,
  getOpenKBModelClientConfig,
  getModelSecretLast4,
  isModelProviderAllowedForKind,
  normalizeModelProvider,
  OpenKBModelClient,
  parseEmbeddingResponse,
  parseRerankResults
} from "./index";

describe("@openkb/model-client", () => {
  it("parses OpenAI-compatible embeddings and validates dimension", () => {
    expect(
      parseEmbeddingResponse(
        {
          data: [
            { index: 1, embedding: [0.3, 0.4] },
            { index: 0, embedding: [0.1, 0.2] }
          ]
        },
        2,
        2
      )
    ).toEqual([
      [0.1, 0.2],
      [0.3, 0.4]
    ]);

    expect(() => parseEmbeddingResponse({ data: [{ index: 0, embedding: [0.1] }] }, 1, 2)).toThrow(
      "dimension mismatch"
    );
  });

  it("parses and sorts rerank results", () => {
    const results = parseRerankResults(
      {
        results: [
          { index: 1, relevance_score: 0.8 },
          { index: 0, relevance_score: 0.2 }
        ]
      },
      2
    ).sort((a, b) => b.relevance_score - a.relevance_score);

    expect(results).toEqual([
      { index: 1, relevance_score: 0.8 },
      { index: 0, relevance_score: 0.2 }
    ]);
  });

  it("reads endpoint/model settings from environment without secrets", () => {
    const config = getOpenKBModelClientConfig({
      OPENKB_EMBEDDING_ENDPOINT: "http://model/v1/embeddings",
      OPENKB_EMBEDDING_MODEL: "qwen3-vl-embedding-2b",
      OPENKB_EMBEDDING_DIM: "2048",
      OPENKB_RERANK_ENDPOINT: "http://model/v1/rerank",
      OPENKB_RERANK_MODEL: "qwen3-vl-reranker-2b",
      OPENKB_LLM_MODEL: "gpt-4.1-mini"
    });

    expect(config.embedding).toMatchObject({
      endpoint: "http://model/v1/embeddings",
      model: "qwen3-vl-embedding-2b",
      dim: 2048,
      source: "env"
    });
    expect(config.language).toMatchObject({
      provider: "openai_responses",
      endpoint: "https://api.openai.com/v1/responses",
      model: "gpt-4.1-mini",
      source: "env"
    });
    expect(JSON.stringify(config).toLowerCase()).not.toContain("api_key");
  });

  it("prefers enabled DB model settings over environment settings", () => {
    const encrypted = encryptModelSecret(
      "sk-db-secret",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    const config = getOpenKBModelClientConfig(
      {
        OPENKB_CONFIG_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        OPENKB_EMBEDDING_ENDPOINT: "http://env/v1/embeddings",
        OPENKB_EMBEDDING_MODEL: "env-model"
      },
      [
        {
          kind: "embedding",
          provider: "openai_compatible",
          endpoint: "http://db/v1/embeddings",
          model: "db-model",
          enabled: true,
          timeout_ms: 1234,
          embedding_dim: 3,
          embedding_batch_size: 7,
          llm_temperature: null,
          llm_max_output_tokens: null,
          encrypted_api_key: encrypted
        }
      ]
    );

    expect(config.embedding).toMatchObject({
      endpoint: "http://db/v1/embeddings",
      model: "db-model",
      dim: 3,
      batchSize: 7,
      timeoutMs: 1234,
      source: "db"
    });
    expect(config.embedding.apiKey).toBe("sk-db-secret");
  });

  it("falls back to environment settings when a DB setting is disabled", () => {
    const config = getOpenKBModelClientConfig(
      {
        OPENKB_EMBEDDING_ENDPOINT: "http://env/v1/embeddings",
        OPENKB_EMBEDDING_MODEL: "env-model"
      },
      [
        {
          kind: "embedding",
          provider: "openai_compatible",
          endpoint: "http://db/v1/embeddings",
          model: "db-model",
          enabled: false,
          timeout_ms: null,
          embedding_dim: null,
          embedding_batch_size: null,
          llm_temperature: null,
          llm_max_output_tokens: null,
          encrypted_api_key: null
        }
      ]
    );

    expect(config.embedding).toMatchObject({
      endpoint: "http://env/v1/embeddings",
      model: "env-model",
      source: "env"
    });
  });

  it("encrypts and decrypts model secrets without exposing plaintext in ciphertext", () => {
    const key = "test-encryption-key-for-openkb-model-settings";
    const encrypted = encryptModelSecret("sk-test-abcdef", key);

    expect(encrypted).not.toContain("sk-test-abcdef");
    expect(decryptModelSecret(encrypted, key)).toBe("sk-test-abcdef");
    expect(getModelSecretLast4("sk-test-abcdef")).toBe("cdef");
    expect(() => decryptModelSecret(encrypted, "wrong-key")).toThrow("cannot be decrypted");
  });

  it("calls embedding, rerank, and language endpoints with compatible payloads", async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }> = [];
    const client = new OpenKBModelClient(
      {
        embedding: {
          provider: "openai_compatible",
          endpoint: "http://model/v1/embeddings",
          model: "embedding-model",
          apiKey: "embedding-key",
          source: "db",
          dim: 2,
          batchSize: 2,
          timeoutMs: 1000
        },
        rerank: {
          provider: "openai_compatible",
          endpoint: "http://model/v1/rerank",
          model: "rerank-model",
          source: "env",
          timeoutMs: 1000
        },
        language: {
          provider: "openai_responses",
          endpoint: "http://model/v1/responses",
          model: "language-model",
          apiKey: "language-key",
          source: "db",
          timeoutMs: 1000,
          maxOutputTokens: 20,
          temperature: 0
        }
      },
      async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>,
          headers: init.headers
        });
        const isEmbedding = url.includes("embeddings");
        const isLanguage = url.includes("responses");
        return {
          ok: true,
          status: 200,
          json: async () =>
            isEmbedding
              ? {
                  data: [
                    { index: 0, embedding: [0.1, 0.2] },
                    { index: 1, embedding: [0.3, 0.4] }
                  ]
                }
              : isLanguage
                ? { id: "resp_1", model: "language-model" }
                : {
                    results: [
                      { index: 1, relevance_score: 0.9 },
                      { index: 0, relevance_score: 0.1 }
                    ]
                  },
          text: async () => ""
        };
      }
    );

    await expect(client.embedTexts(["a", "b"])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4]
    ]);
    await expect(client.rerankDocuments({ query: "q", documents: ["a", "b"] })).resolves.toEqual([
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.1 }
    ]);
    await expect(client.probeLanguageModel("hello")).resolves.toMatchObject({
      configured: true,
      ok: true,
      model: "language-model"
    });
    expect(calls.map((call) => call.body.model)).toEqual([
      "embedding-model",
      "rerank-model",
      "language-model"
    ]);
    expect(calls[0]?.headers.authorization).toBe("Bearer embedding-key");
    expect(calls[2]?.headers.authorization).toBe("Bearer language-key");
    expect(calls[2]?.body).toMatchObject({
      input: "hello",
      store: false,
      max_output_tokens: 20
    });
  });

  it("normalizes legacy providers and validates kind/provider combinations", () => {
    expect(normalizeModelProvider("openai", "language")).toBe("openai_responses");
    expect(normalizeModelProvider("openai", "embedding")).toBe("openai_compatible");
    expect(isModelProviderAllowedForKind("openai_compatible", "embedding")).toBe(true);
    expect(isModelProviderAllowedForKind("openai_responses", "embedding")).toBe(false);
    expect(isModelProviderAllowedForKind("openai_chat_completions", "language")).toBe(true);
    expect(isModelProviderAllowedForKind("anthropic_messages", "language")).toBe(true);
  });

  it("calls OpenAI Chat Completions and Anthropic Messages probe formats", async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }> = [];

    for (const provider of ["openai_chat_completions", "anthropic_messages"] as const) {
      const client = new OpenKBModelClient(
        {
          embedding: {
            provider: "openai_compatible",
            source: "none",
            dim: 2,
            batchSize: 1,
            timeoutMs: 1000
          },
          rerank: {
            provider: "openai_compatible",
            source: "none",
            timeoutMs: 1000
          },
          language: {
            provider,
            endpoint:
              provider === "anthropic_messages"
                ? "https://api.anthropic.com/v1/messages"
                : "https://api.openai.com/v1/chat/completions",
            model: "language-model",
            apiKey: `${provider}-key`,
            source: "db",
            timeoutMs: 1000,
            maxOutputTokens: 24,
            temperature: 0.2
          }
        },
        async (url, init) => {
          calls.push({
            url,
            body: JSON.parse(init.body) as Record<string, unknown>,
            headers: init.headers
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ model: "language-model" }),
            text: async () => ""
          };
        }
      );

      await expect(client.probeLanguageModel("hello")).resolves.toMatchObject({
        configured: true,
        ok: true
      });
    }

    expect(calls[0]?.body).toMatchObject({
      model: "language-model",
      max_tokens: 24,
      temperature: 0.2
    });
    expect(calls[0]?.body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(calls[0]?.headers.authorization).toBe("Bearer openai_chat_completions-key");

    expect(calls[1]?.body).toMatchObject({
      model: "language-model",
      max_tokens: 24,
      temperature: 0.2
    });
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(calls[1]?.headers["x-api-key"]).toBe("anthropic_messages-key");
    expect(calls[1]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  getOpenKBModelClientConfig,
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
      OPENKB_RERANK_MODEL: "qwen3-vl-reranker-2b"
    });

    expect(config.embedding).toMatchObject({
      endpoint: "http://model/v1/embeddings",
      model: "qwen3-vl-embedding-2b",
      dim: 2048
    });
    expect(JSON.stringify(config).toLowerCase()).not.toContain("api_key");
  });

  it("calls embedding and rerank endpoints with compatible payloads", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const client = new OpenKBModelClient(
      {
        embedding: {
          endpoint: "http://model/v1/embeddings",
          model: "embedding-model",
          dim: 2,
          batchSize: 2,
          timeoutMs: 1000
        },
        rerank: {
          endpoint: "http://model/v1/rerank",
          model: "rerank-model",
          timeoutMs: 1000
        }
      },
      async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
        const isEmbedding = url.includes("embeddings");
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
    expect(calls.map((call) => call.body.model)).toEqual(["embedding-model", "rerank-model"]);
  });
});

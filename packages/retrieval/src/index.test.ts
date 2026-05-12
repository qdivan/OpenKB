import { describe, expect, it } from "vitest";

import {
  activeProfileSupportsDenseVector,
  calculateCandidateLimit,
  filterRetrievalAccessPrincipals,
  normalizeRetrievalAppSearchInput,
  normalizeRetrievalSearchInput,
  resolveEffectiveRetrievalMode,
  RetrievalError,
  RetrievalService
} from "./index";

const user = {
  user: { id: "user_1" },
  tenantId: "tenant_1"
};

describe("@openkb/retrieval input helpers", () => {
  it("normalizes top_k and candidate limits", () => {
    expect(
      normalizeRetrievalSearchInput({
        user,
        query: "  MCP 接入  ",
        top_k: 50
      })
    ).toMatchObject({
      query: "MCP 接入",
      topK: 20,
      candidateLimit: 100,
      filters: { tags: [] }
    });
    expect(
      normalizeRetrievalSearchInput({
        user,
        query: "docs",
        context_mode: "parent_child"
      })
    ).toMatchObject({
      requestedContextMode: "parent_child"
    });
    expect(() =>
      normalizeRetrievalSearchInput({ user, query: "docs", context_mode: "invalid" })
    ).toThrow("context_mode");

    expect(calculateCandidateLimit(1)).toBe(20);
    expect(calculateCandidateLimit(10)).toBe(50);
    expect(calculateCandidateLimit(20)).toBe(100);
  });

  it("accepts tags filters and rejects invalid or unsupported filters", () => {
    expect(
      normalizeRetrievalSearchInput({
        user,
        query: "docs",
        filters: { tags: ["mcp", "mcp", "rag"] }
      })
    ).toMatchObject({
      filters: { tags: ["mcp", "rag"] }
    });

    expect(() => normalizeRetrievalSearchInput({ user, query: "" })).toThrow(RetrievalError);
    expect(() => normalizeRetrievalSearchInput({ user, query: "docs", top_k: 1.5 })).toThrow(
      "top_k"
    );
    expect(() =>
      normalizeRetrievalSearchInput({ user, query: "docs", filters: { status: "published" } })
    ).toThrow("not supported");
    expect(() =>
      normalizeRetrievalSearchInput({ user, query: "docs", filters: { tags: ["mcp", ""] } })
    ).toThrow("filters.tags");
  });

  it("filters admin-only principals before Milvus prefiltering", () => {
    expect(
      filterRetrievalAccessPrincipals([
        "user:u1",
        "tenant:t1:system_admin",
        "tenant:t1:tenant_admin",
        "tenant:t1:member",
        "workspace:w1:member"
      ])
    ).toEqual(["user:u1", "tenant:t1:member", "workspace:w1:member"]);
  });

  it("normalizes app-scoped retrieval input without a user context", () => {
    expect(
      normalizeRetrievalAppSearchInput({
        app: {
          tenantId: "tenant_1",
          knowledgeBaseIds: ["kb_1", "kb_1"]
        },
        query: " Dify retrieval ",
        top_k: 3
      })
    ).toMatchObject({
      query: "Dify retrieval",
      knowledgeBaseIds: ["kb_1"],
      topK: 3,
      candidateLimit: 20
    });

    expect(() =>
      normalizeRetrievalAppSearchInput({
        app: { tenantId: "tenant_1", knowledgeBaseIds: [] },
        query: "Dify"
      })
    ).toThrow("app.knowledgeBaseIds");
  });

  it("resolves retrieval modes from env, DB and model availability", () => {
    expect(
      resolveEffectiveRetrievalMode({
        embeddingConfigured: false,
        rerankConfigured: false,
        envDefaultMode: "hybrid"
      })
    ).toMatchObject({ requestedMode: "hybrid", effectiveMode: "bm25" });

    expect(
      resolveEffectiveRetrievalMode({
        embeddingConfigured: true,
        rerankConfigured: false,
        storedMode: "hybrid_rerank"
      })
    ).toMatchObject({ requestedMode: "hybrid_rerank", effectiveMode: "hybrid" });

    expect(
      resolveEffectiveRetrievalMode({
        embeddingConfigured: true,
        rerankConfigured: true
      })
    ).toMatchObject({ requestedMode: "hybrid", effectiveMode: "hybrid" });
  });

  it("requires an active dense profile with matching dim and model", () => {
    expect(
      activeProfileSupportsDenseVector(
        {
          vector_dim: 2048,
          embedding_function_name: "openkb_direct_embedding",
          function_metadata: {
            dense_vector: true,
            embedding_model: "qwen3-vl-embedding-2b",
            embedding_capabilities: {
              input_modalities: ["text", "image"],
              dimensions: 2048
            }
          }
        },
        {
          dim: 2048,
          model: "qwen3-vl-embedding-2b",
          capabilities: { input_modalities: ["text", "image"] }
        }
      )
    ).toBe(true);

    expect(
      activeProfileSupportsDenseVector(
        {
          vector_dim: 1024,
          embedding_function_name: "openkb_direct_embedding",
          function_metadata: {
            dense_vector: true,
            embedding_model: "qwen3-vl-embedding-2b"
          }
        },
        { dim: 2048, model: "qwen3-vl-embedding-2b" }
      )
    ).toBe(false);

    expect(
      activeProfileSupportsDenseVector(
        {
          vector_dim: 2048,
          embedding_function_name: "openkb_direct_embedding",
          function_metadata: {
            dense_vector: true,
            embedding_model: "qwen3-vl-embedding-2b",
            embedding_capabilities: { input_modalities: ["text"] }
          }
        },
        {
          dim: 2048,
          model: "qwen3-vl-embedding-2b",
          capabilities: { input_modalities: ["text", "image"] }
        }
      )
    ).toBe(false);
  });

  it("reranks only after final document permission filtering", async () => {
    const rerankedDocuments: string[][] = [];
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "hybrid_rerank" }) },
      milvusIndexProfile: {
        findFirst: async () => ({
          vector_dim: 2,
          embedding_function_name: "openkb_direct_embedding",
          function_metadata: { dense_vector: true, embedding_model: "embedding-model" }
        })
      },
      knowledgeBaseChunkSetting: {
        findFirst: async () => null
      },
      documentChunk: {
        findMany: async () => [
          {
            id: "chunk_allowed",
            tenant_id: "tenant_1",
            document_id: "doc_allowed",
            knowledge_base_id: "kb_1",
            version_id: "version_1"
          },
          {
            id: "chunk_denied",
            tenant_id: "tenant_1",
            document_id: "doc_denied",
            knowledge_base_id: "kb_1",
            version_id: "version_1"
          }
        ]
      },
      knowledgeBase: {
        findMany: async () => [{ id: "kb_1", title: "KB" }]
      },
      document: {
        findMany: async () => [
          {
            id: "doc_allowed",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Allowed",
            current_version_id: "version_1",
            status: "published"
          }
        ]
      },
      $disconnect: async () => undefined
    };
    const milvus = {
      config: { activeAlias: "openkb_chunks_active" },
      searchChunks: async () => [
        makeCandidate("chunk_allowed", "doc_allowed", "allowed text", 0.7),
        makeCandidate("chunk_denied", "doc_denied", "secret text", 0.9)
      ]
    };
    const permissions = {
      requireCanRead: async () => undefined,
      getAccessPrincipals: async () => ["user:u1"],
      canRead: async (_userId: string, _objectType: string, objectId: string) =>
        objectId === "doc_allowed"
    };
    const modelClient = {
      embeddingConfigured: true,
      rerankConfigured: true,
      config: {
        embedding: { dim: 2, model: "embedding-model" },
        rerank: { model: "rerank-model" }
      },
      embedText: async () => [0.1, 0.2],
      rerankDocuments: async (input: { documents: string[] }) => {
        rerankedDocuments.push(input.documents);
        return [{ index: 0, relevance_score: 0.99 }];
      }
    };
    const service = new RetrievalService({
      prisma: prisma as never,
      milvus: milvus as never,
      permissions: permissions as never,
      modelClient: modelClient as never,
      env: {}
    });

    const response = await service.search({
      user,
      query: "allowed",
      knowledge_base_ids: ["kb_1"],
      top_k: 2
    });

    expect(rerankedDocuments).toEqual([["allowed text"]]);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.metadata.openkb_retrieval).toMatchObject({
      mode: "hybrid_rerank",
      raw_score: 0.7,
      rerank_score: 0.99
    });
  });

  it("expands authorized child matches to parent context after filtering", async () => {
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: { findFirst: async () => null },
      knowledgeBaseChunkSetting: { findFirst: async () => null },
      documentChunk: {
        findMany: async (args: { where?: { chunk_type?: string } }) =>
          args.where?.chunk_type === "parent"
            ? [
                {
                  id: "parent_1",
                  chunk_type: "parent",
                  heading_path: ["Guide"],
                  content_text: "Parent paragraph context",
                  token_count: 4,
                  start_line: 1,
                  end_line: 5,
                  start_char: 0,
                  end_char: 40
                }
              ]
            : [
                {
                  id: "child_1",
                  tenant_id: "tenant_1",
                  document_id: "doc_1",
                  knowledge_base_id: "kb_1",
                  version_id: "version_1"
                }
              ]
      },
      knowledgeBase: {
        findMany: async () => [{ id: "kb_1", title: "KB" }]
      },
      document: {
        findMany: async () => [
          {
            id: "doc_1",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Guide",
            current_version_id: "version_1",
            status: "published"
          }
        ]
      },
      $disconnect: async () => undefined
    };
    const service = new RetrievalService({
      prisma: prisma as never,
      milvus: {
        config: { activeAlias: "openkb_chunks_active" },
        searchChunks: async () => [
          makeCandidate("child_1", "doc_1", "child match", 0.8, {
            parent_chunk_id: "parent_1"
          })
        ]
      } as never,
      permissions: {
        requireCanRead: async () => undefined,
        getAccessPrincipals: async () => ["user:u1"],
        canRead: async () => true
      } as never,
      modelClient: {
        embeddingConfigured: false,
        rerankConfigured: false,
        config: { embedding: { dim: 2048 }, rerank: {} }
      } as never,
      env: {}
    });

    const response = await service.search({
      user,
      query: "guide",
      knowledge_base_ids: ["kb_1"],
      context_mode: "parent_child"
    });

    expect(response.context_mode).toBe("parent_child");
    expect(response.results[0]).toMatchObject({
      chunk_id: "child_1",
      content: "Parent paragraph context",
      match_chunk: { chunk_id: "child_1", content: "child match" },
      parent_chunk: { chunk_id: "parent_1", content: "Parent paragraph context" }
    });
  });
});

function makeCandidate(
  chunkId: string,
  documentId: string,
  content: string,
  score: number,
  metadata: Record<string, unknown> = {}
) {
  return {
    id: chunkId,
    chunk_id: chunkId,
    tenant_id: "tenant_1",
    workspace_id: "workspace_1",
    knowledge_base_id: "kb_1",
    document_id: documentId,
    version_id: "version_1",
    title: content,
    heading_path: [],
    content_text: content,
    content_markdown: content,
    metadata,
    updated_at: 0,
    score
  };
}

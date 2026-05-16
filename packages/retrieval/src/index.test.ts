import { describe, expect, it } from "vitest";

import {
  activeProfileSupportsDenseVector,
  calculateCandidateLimit,
  filterRetrievalAccessPrincipals,
  modeFromKnowledgeBaseRetrievalSetting,
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
        filters: {
          tags: ["mcp", "mcp", "rag"],
          metadata_condition: {
            logical_operator: "or",
            conditions: [{ name: "source", comparison_operator: "is", value: "file_upload" }]
          }
        }
      })
    ).toMatchObject({
      filters: {
        tags: ["mcp", "rag"],
        metadataCondition: {
          logicalOperator: "or",
          conditions: [{ name: "source", operator: "is", value: "file_upload" }]
        }
      }
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

    expect(() =>
      resolveEffectiveRetrievalMode({
        embeddingConfigured: false,
        rerankConfigured: false,
        storedMode: "hybrid",
        strictEmbeddingRequired: true
      })
    ).toThrow("embedding model is configured");
  });

  it("maps Dify retrieval_model settings to OpenKB retrieval modes", () => {
    expect(
      modeFromKnowledgeBaseRetrievalSetting({
        indexing_technique: "economy",
        retrieval_model: { search_method: "keyword_search" }
      })
    ).toBe("bm25");
    expect(
      modeFromKnowledgeBaseRetrievalSetting({
        indexing_technique: "high_quality",
        retrieval_model: { search_method: "semantic_search", reranking_enable: true }
      })
    ).toBe("dense_rerank");
    expect(
      modeFromKnowledgeBaseRetrievalSetting({
        indexing_technique: "high_quality",
        retrieval_model: { search_method: "hybrid_search", reranking_enable: true }
      })
    ).toBe("hybrid_rerank");
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

  it("hydrates summary hits from PostgreSQL source chunks instead of Milvus metadata", async () => {
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: { findFirst: async () => null },
      knowledgeBaseChunkSetting: { findFirst: async () => null },
      documentQaPair: { findMany: async () => [] },
      documentChunk: {
        findMany: async (args: { where?: { id?: { in?: string[] } }; select?: object }) => {
          const ids = args.where?.id?.in ?? [];
          if (ids.includes("summary_1")) {
            return [
              {
                id: "summary_1",
                tenant_id: "tenant_1",
                workspace_id: "workspace_1",
                document_id: "doc_1",
                knowledge_base_id: "kb_1",
                version_id: "version_1",
                index_role: "summary",
                source_chunk_id: "source_good",
                parent_chunk_id: null,
                chunk_type: "general",
                heading_path: [],
                content_text: "Summary text",
                content_markdown: "Summary text",
                override_content_text: null,
                override_content_markdown: null,
                token_count: 2,
                start_line: null,
                end_line: null,
                start_char: null,
                end_char: null,
                metadata: {
                  hit_type: "summary",
                  original_chunk_id: "source_good"
                }
              }
            ];
          }
          if (ids.includes("source_good")) {
            const isHydrationRead = Boolean(args.select && "content_text" in args.select);
            return [
              {
                id: "source_good",
                document_id: "doc_1",
                knowledge_base_id: "kb_1",
                version_id: "version_1",
                ...(isHydrationRead
                  ? {
                      chunk_type: "general",
                      heading_path: ["Trusted"],
                      content_text: "Trusted source body",
                      content_markdown: "Trusted source body",
                      override_content_text: null,
                      override_content_markdown: null,
                      token_count: 3,
                      start_line: 1,
                      end_line: 1,
                      start_char: 0,
                      end_char: 19
                    }
                  : {})
              }
            ];
          }
          return [];
        }
      },
      knowledgeBase: { findMany: async () => [{ id: "kb_1", title: "KB" }] },
      document: {
        findMany: async () => [
          {
            id: "doc_1",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Doc",
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
          makeCandidate("summary_1", "doc_1", "Summary text", 0.8, {
            hit_type: "summary",
            original_chunk_id: "source_bad",
            source_chunk_id: "source_bad"
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
      query: "summary",
      knowledge_base_ids: ["kb_1"]
    });

    expect(response.results[0]).toMatchObject({
      chunk_id: "summary_1",
      content: "Trusted source body",
      metadata: {
        hit_type: "summary",
        original_chunk_id: "source_good",
        source_chunk_id: "source_good"
      }
    });
  });

  it("filters QA hits when the PostgreSQL QA source chunk is no longer active", async () => {
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: { findFirst: async () => null },
      knowledgeBaseChunkSetting: { findFirst: async () => null },
      documentQaPair: {
        findMany: async () => [
          {
            id: "qa_1",
            tenant_id: "tenant_1",
            workspace_id: "workspace_1",
            document_id: "doc_1",
            knowledge_base_id: "kb_1",
            question: "Who leads Shu?",
            answer: "Liu Bei.",
            source_chunk_id: "disabled_source",
            source: "manual",
            status: "active",
            metadata: {}
          }
        ]
      },
      documentChunk: {
        findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
          const ids = args.where?.id?.in ?? [];
          if (ids.includes("qa_chunk")) {
            return [
              {
                id: "qa_chunk",
                tenant_id: "tenant_1",
                workspace_id: "workspace_1",
                document_id: "doc_1",
                knowledge_base_id: "kb_1",
                version_id: "version_1",
                index_role: "content",
                source_chunk_id: null,
                parent_chunk_id: null,
                chunk_type: "general",
                heading_path: [],
                content_text: "Who leads Shu?",
                content_markdown: "Who leads Shu?",
                override_content_text: null,
                override_content_markdown: null,
                token_count: 3,
                start_line: null,
                end_line: null,
                start_char: null,
                end_char: null,
                metadata: {
                  hit_type: "qa",
                  qa_pair_id: "qa_1"
                }
              }
            ];
          }
          return [];
        }
      },
      knowledgeBase: { findMany: async () => [{ id: "kb_1", title: "KB" }] },
      document: {
        findMany: async () => [
          {
            id: "doc_1",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Doc",
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
          makeCandidate("qa_chunk", "doc_1", "Who leads Shu?", 0.8, {
            hit_type: "qa",
            qa_pair_id: "qa_1",
            qa_answer: "Stale Milvus answer",
            source_chunk_id: "disabled_source"
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

    await expect(
      service.search({
        user,
        query: "qa",
        knowledge_base_ids: ["kb_1"]
      })
    ).resolves.toMatchObject({ results: [] });
  });

  it("uses document metadata tags to pre-scope Milvus candidates and post-filter results", async () => {
    const searchCalls: unknown[] = [];
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: { findFirst: async () => null },
      knowledgeBaseChunkSetting: { findFirst: async () => null },
      documentQaPair: { findMany: async () => [] },
      documentChunk: {
        findMany: async () => [
          {
            id: "chunk_1",
            tenant_id: "tenant_1",
            workspace_id: "workspace_1",
            document_id: "doc_1",
            knowledge_base_id: "kb_1",
            version_id: "version_1",
            index_role: "content",
            source_chunk_id: null,
            parent_chunk_id: null,
            chunk_type: "general",
            heading_path: [],
            content_text: "Dify tags should come from document metadata.",
            content_markdown: "Dify tags should come from document metadata.",
            override_content_text: null,
            override_content_markdown: null,
            token_count: 6,
            start_line: 1,
            end_line: 1,
            start_char: 0,
            end_char: 43,
            metadata: {}
          }
        ]
      },
      knowledgeBase: { findMany: async () => [{ id: "kb_1", title: "KB" }] },
      document: {
        findMany: async () => [
          {
            id: "doc_1",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Tagged document",
            slug: "tagged-document",
            current_version_id: "version_1",
            status: "published",
            created_at: new Date("2026-05-01T00:00:00.000Z"),
            updated_at: new Date("2026-05-02T00:00:00.000Z")
          }
        ]
      },
      knowledgeBaseMetadataField: {
        findMany: async () => [{ id: "field_tags", name: "tags" }]
      },
      documentMetadataValue: {
        findMany: async () => [
          { document_id: "doc_1", field_id: "field_tags", value: ["dify", "parity"] }
        ]
      },
      $disconnect: async () => undefined
    };
    const service = new RetrievalService({
      prisma: prisma as never,
      milvus: {
        config: { activeAlias: "openkb_chunks_active" },
        searchChunks: async (input: unknown) => {
          searchCalls.push(input);
          return [makeCandidate("chunk_1", "doc_1", "Dify tags should come from metadata.", 0.8)];
        }
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
      query: "tags",
      knowledge_base_ids: ["kb_1"],
      filters: { tags: ["dify"] }
    });

    expect(searchCalls[0]).toMatchObject({ documentIds: ["doc_1"], filters: { tags: [] } });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.metadata).toMatchObject({ tags: ["dify", "parity"] });
  });

  it("short-circuits tag-filtered search when no document metadata matches", async () => {
    const searchCalls: unknown[] = [];
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: { findFirst: async () => null },
      knowledgeBaseChunkSetting: { findFirst: async () => null },
      knowledgeBaseMetadataField: {
        findMany: async () => [{ id: "field_tags", name: "tags" }]
      },
      documentMetadataValue: {
        findMany: async () => [{ document_id: "doc_1", field_id: "field_tags", value: ["other"] }]
      },
      $disconnect: async () => undefined
    };
    const service = new RetrievalService({
      prisma: prisma as never,
      milvus: {
        config: { activeAlias: "openkb_chunks_active" },
        searchChunks: async (input: unknown) => {
          searchCalls.push(input);
          return [makeCandidate("chunk_1", "doc_1", "Should not be called.", 0.9)];
        }
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
      query: "tags",
      knowledge_base_ids: ["kb_1"],
      filters: { tags: ["dify"] }
    });

    expect(searchCalls).toHaveLength(0);
    expect(response.results).toEqual([]);
  });

  it("injects a single KB retrieval_model top_k, score threshold and hybrid weights", async () => {
    const searchCalls: unknown[] = [];
    const prisma = {
      retrievalSetting: { findFirst: async () => ({ mode: "bm25" }) },
      milvusIndexProfile: {
        findFirst: async () => ({
          vector_dim: 2,
          embedding_function_name: "openkb_direct_embedding",
          function_metadata: { dense_vector: true, embedding_model: "embedding-model" }
        })
      },
      knowledgeBaseChunkSetting: {
        findMany: async () => [
          {
            indexing_technique: "high_quality",
            retrieval_model: {
              search_method: "hybrid_search",
              top_k: 3,
              score_threshold_enabled: true,
              score_threshold: 0.8,
              weights: {
                keyword_setting: { keyword_weight: 0.3 },
                vector_setting: { vector_weight: 0.7 }
              }
            }
          }
        ],
        findFirst: async () => null
      },
      documentChunk: {
        findMany: async () => [
          {
            id: "chunk_high",
            tenant_id: "tenant_1",
            document_id: "doc_high",
            knowledge_base_id: "kb_1",
            version_id: "version_1"
          },
          {
            id: "chunk_low",
            tenant_id: "tenant_1",
            document_id: "doc_low",
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
            id: "doc_high",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "High",
            current_version_id: "version_1",
            status: "published"
          },
          {
            id: "doc_low",
            parent_id: null,
            knowledge_base_id: "kb_1",
            title: "Low",
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
        searchChunks: async (input: unknown) => {
          searchCalls.push(input);
          return [
            makeCandidate("chunk_high", "doc_high", "high score", 0.9),
            makeCandidate("chunk_low", "doc_low", "low score", 0.7)
          ];
        }
      } as never,
      permissions: {
        requireCanRead: async () => undefined,
        getAccessPrincipals: async () => ["user:u1"],
        canRead: async () => true
      } as never,
      modelClient: {
        embeddingConfigured: true,
        rerankConfigured: false,
        config: {
          embedding: { dim: 2, model: "embedding-model" },
          rerank: {}
        },
        embedText: async () => [0.1, 0.2]
      } as never,
      env: {}
    });

    const response = await service.search({
      user,
      query: "hybrid",
      knowledge_base_ids: ["kb_1"]
    });

    expect(searchCalls[0]).toMatchObject({
      mode: "hybrid",
      hybridWeights: { keywordWeight: 0.3, vectorWeight: 0.7 },
      limit: 20
    });
    expect(response.top_k).toBe(3);
    expect(response.metadata).toMatchObject({
      retrieval_mode: "hybrid",
      score_threshold_applied: 0.8,
      hybrid_weights: { keywordWeight: 0.3, vectorWeight: 0.7 }
    });
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.chunk_id).toBe("chunk_high");
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
                  workspace_id: "workspace_1",
                  document_id: "doc_1",
                  knowledge_base_id: "kb_1",
                  version_id: "version_1",
                  index_role: "content",
                  source_chunk_id: null,
                  parent_chunk_id: "parent_1",
                  chunk_type: "child",
                  heading_path: ["Guide"],
                  content_text: "child match",
                  content_markdown: "child match",
                  override_content_text: null,
                  override_content_markdown: null,
                  token_count: 2,
                  start_line: null,
                  end_line: null,
                  start_char: null,
                  end_char: null,
                  metadata: { parent_chunk_id: "parent_1", chunk_type: "child" }
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

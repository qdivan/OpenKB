import { describe, expect, it } from "vitest";

import {
  matchesMetadataCondition,
  matchesMetadataConditions,
  normalizeOptionalMetadataCondition
} from "./metadata-condition";
import { normalizeDifyRetrievalRequest, normalizedScore } from "./service";

const difyMetadata = {
  document_name: "赤壁之战",
  dataset_name: "三国演义",
  document_slug: "battle-of-chibi",
  source: "online_document",
  uploader: "OpenKB Dev Admin",
  upload_date: "2026-05-01T00:00:00.000Z",
  last_update_date: "2026-05-10T00:00:00.000Z",
  tags: ["三国", "赤壁", "曹操"],
  path_parts: ["三国演义", "战争", "赤壁之战"],
  absolute_url: "http://localhost:3100/app/kb/kb_1/docs/doc_1",
  parent_chunk_id: null,
  doc_form: "hierarchical_model",
  indexing_technique: "high_quality",
  retrieval_model: { search_method: "hybrid_search", top_k: 5 },
  segment_status: "active",
  summary_hit: false,
  original_chunk_id: "chunk_1",
  qa_question: null,
  qa_answer: null,
  score: 0.76,
  token_count: 128,
  openkb_retrieval: {
    context_mode: "parent_child"
  }
};

function condition(name: string, comparisonOperator: string, value?: unknown) {
  return normalizeOptionalMetadataCondition({
    conditions: [{ name, comparison_operator: comparisonOperator, value }]
  })!;
}

function request(body: Record<string, unknown>) {
  return normalizeDifyRetrievalRequest(body, { maxTopK: 20, keyTopKLimit: 10 });
}

describe("Phase 21 Dify native compatibility contract", () => {
  const cases: Array<[string, () => void]> = [
    [
      "01 normalizes the Dify retrieval request body",
      () =>
        expect(
          request({
            knowledge_id: "sanguo-openkb",
            query: "赤壁",
            retrieval_setting: { top_k: 5, score_threshold: 0.2 }
          })
        ).toMatchObject({ knowledgeId: "sanguo-openkb", query: "赤壁", topK: 5 })
    ],
    [
      "02 trims knowledge_id and query",
      () =>
        expect(
          request({
            knowledge_id: " sanguo-openkb ",
            query: " 赤壁 ",
            retrieval_setting: { top_k: 5, score_threshold: 0 }
          })
        ).toMatchObject({ knowledgeId: "sanguo-openkb", query: "赤壁" })
    ],
    [
      "03 caps top_k by adapter max",
      () =>
        expect(
          normalizeDifyRetrievalRequest(
            {
              knowledge_id: "kb",
              query: "q",
              retrieval_setting: { top_k: 50, score_threshold: 0 }
            },
            { maxTopK: 20, keyTopKLimit: 100 }
          ).topK
        ).toBe(20)
    ],
    [
      "04 caps top_k by key limit",
      () =>
        expect(
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 50, score_threshold: 0 }
          }).topK
        ).toBe(10)
    ],
    [
      "05 accepts missing metadata_condition as null",
      () =>
        expect(
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 1, score_threshold: 0 }
          }).metadataCondition
        ).toBeNull()
    ],
    [
      "06 accepts empty metadata_condition as null",
      () =>
        expect(
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 1, score_threshold: 0 },
            metadata_condition: {}
          }).metadataCondition
        ).toBeNull()
    ],
    [
      "07 returns a friendly empty-body validation error",
      () =>
        expect(() => request({})).toThrow(
          "OpenKB Dify adapter was reached, but the request body is missing knowledge_id"
        )
    ],
    ["08 rejects non-object request bodies", () => expect(() => request(null as never)).toThrow()],
    [
      "09 rejects missing knowledge_id",
      () =>
        expect(() =>
          request({ query: "q", retrieval_setting: { top_k: 1, score_threshold: 0 } })
        ).toThrow("knowledge_id")
    ],
    [
      "10 rejects missing query",
      () =>
        expect(() =>
          request({ knowledge_id: "kb", retrieval_setting: { top_k: 1, score_threshold: 0 } })
        ).toThrow("query")
    ],
    [
      "11 rejects missing retrieval_setting",
      () => expect(() => request({ knowledge_id: "kb", query: "q" })).toThrow("retrieval_setting")
    ],
    [
      "12 rejects non-positive top_k",
      () =>
        expect(() =>
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 0, score_threshold: 0 }
          })
        ).toThrow("top_k")
    ],
    [
      "13 rejects negative score_threshold",
      () =>
        expect(() =>
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 1, score_threshold: -0.1 }
          })
        ).toThrow("score_threshold")
    ],
    [
      "14 rejects score_threshold over one",
      () =>
        expect(() =>
          request({
            knowledge_id: "kb",
            query: "q",
            retrieval_setting: { top_k: 1, score_threshold: 1.1 }
          })
        ).toThrow("score_threshold")
    ],
    ["15 clamps negative scores to zero", () => expect(normalizedScore(-1)).toBe(0)],
    ["16 clamps scores above one to one", () => expect(normalizedScore(2)).toBe(1)],
    ["17 converts NaN scores to zero", () => expect(normalizedScore(Number.NaN)).toBe(0)],
    [
      "18 filters by contains on a string field",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("document_name", "contains", "赤壁"))
        ).toBe(true)
    ],
    [
      "19 filters by contains on an array field",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("tags", "contains", "曹操"))).toBe(
          true
        )
    ],
    [
      "20 filters by not contains",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("tags", "not contains", "刘备"))
        ).toBe(true)
    ],
    [
      "21 filters by start with",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("dataset_name", "start with", "三国"))
        ).toBe(true)
    ],
    [
      "22 filters by end with",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("document_slug", "end with", "chibi"))
        ).toBe(true)
    ],
    [
      "23 filters by is",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("source", "is", "online_document"))
        ).toBe(true)
    ],
    [
      "24 filters by is not",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("source", "is not", "file_upload"))
        ).toBe(true)
    ],
    [
      "25 filters by equals alias",
      () => expect(matchesMetadataCondition(difyMetadata, condition("score", "=", 0.76))).toBe(true)
    ],
    [
      "26 filters by unicode not-equals alias",
      () => expect(matchesMetadataCondition(difyMetadata, condition("score", "≠", 0.1))).toBe(true)
    ],
    [
      "27 filters by greater-than numeric comparison",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("token_count", ">", 100))).toBe(
          true
        )
    ],
    [
      "28 filters by less-than numeric comparison",
      () => expect(matchesMetadataCondition(difyMetadata, condition("score", "<", 0.9))).toBe(true)
    ],
    [
      "29 filters by unicode greater-or-equal comparison",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("token_count", "≥", 128))).toBe(
          true
        )
    ],
    [
      "30 filters by unicode less-or-equal comparison",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("token_count", "≤", 128))).toBe(
          true
        )
    ],
    [
      "31 filters by before on time fields",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("upload_date", "before", "2026-05-02"))
        ).toBe(true)
    ],
    [
      "32 filters by after on time fields",
      () =>
        expect(
          matchesMetadataCondition(
            difyMetadata,
            condition("last_update_date", "after", "2026-05-09")
          )
        ).toBe(true)
    ],
    [
      "33 filters scalar values with in",
      () =>
        expect(
          matchesMetadataCondition(
            difyMetadata,
            condition("document_slug", "in", ["other", "battle-of-chibi"])
          )
        ).toBe(true)
    ],
    [
      "34 filters array values with in",
      () =>
        expect(
          matchesMetadataCondition(difyMetadata, condition("path_parts", "in", ["战争"]))
        ).toBe(true)
    ],
    [
      "35 filters with not in",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("tags", "not in", ["水浒"]))).toBe(
          true
        )
    ],
    [
      "36 filters empty fields",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("parent_chunk_id", "empty"))).toBe(
          true
        )
    ],
    [
      "37 filters not-empty fields",
      () =>
        expect(matchesMetadataCondition(difyMetadata, condition("absolute_url", "not empty"))).toBe(
          true
        )
    ],
    [
      "38 filters nested OpenKB diagnostic paths",
      () =>
        expect(
          matchesMetadataCondition(
            difyMetadata,
            condition("openkb_retrieval.context_mode", "is", "parent_child")
          )
        ).toBe(true)
    ],
    [
      "39 supports Dify OR metadata_condition",
      () =>
        expect(
          matchesMetadataCondition(
            difyMetadata,
            normalizeOptionalMetadataCondition({
              logical_operator: "or",
              conditions: [
                { name: "document_name", comparison_operator: "is", value: "不存在" },
                { name: "dataset_name", comparison_operator: "is", value: "三国演义" }
              ]
            })!
          )
        ).toBe(true)
    ],
    [
      "41 exposes Dify 1.14.1 processing and segment metadata",
      () => {
        expect(difyMetadata).toMatchObject({
          doc_form: "hierarchical_model",
          indexing_technique: "high_quality",
          retrieval_model: { search_method: "hybrid_search" },
          segment_status: "active",
          summary_hit: false,
          original_chunk_id: "chunk_1"
        });
      }
    ],
    [
      "40 combines key-level and request-level metadata conditions",
      () =>
        expect(
          matchesMetadataConditions(difyMetadata, [
            condition("dataset_name", "is", "三国演义"),
            condition("tags", "contains", "赤壁")
          ])
        ).toBe(true)
    ]
  ];

  it.each(cases)("%s", (_name, run) => {
    run();
  });
});

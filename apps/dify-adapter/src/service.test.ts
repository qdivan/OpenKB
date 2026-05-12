import { describe, expect, it } from "vitest";

import { normalizeDifyRetrievalRequest, normalizedScore } from "./service";

describe("Dify retrieval request helpers", () => {
  it("normalizes request shape, top_k limits and score thresholds", () => {
    expect(
      normalizeDifyRetrievalRequest(
        {
          knowledge_id: "kb_ext",
          query: " OpenKB ",
          retrieval_setting: {
            top_k: 50,
            score_threshold: 0.5
          },
          metadata_condition: {
            conditions: [{ name: "tags", comparison_operator: "contains", value: "dify" }]
          }
        },
        { maxTopK: 20, keyTopKLimit: 7 }
      )
    ).toMatchObject({
      knowledgeId: "kb_ext",
      query: "OpenKB",
      topK: 7,
      scoreThreshold: 0.5
    });
  });

  it("rejects invalid request bodies and clamps scores", () => {
    expect(() => normalizeDifyRetrievalRequest({}, { maxTopK: 20, keyTopKLimit: 20 })).toThrow(
      "OpenKB Dify adapter was reached"
    );
    expect(() =>
      normalizeDifyRetrievalRequest(
        {
          knowledge_id: "kb_ext",
          query: "OpenKB",
          retrieval_setting: { top_k: 1, score_threshold: 1.5 }
        },
        { maxTopK: 20, keyTopKLimit: 20 }
      )
    ).toThrow("score_threshold");
    expect(normalizedScore(-1)).toBe(0);
    expect(normalizedScore(0.6)).toBe(0.6);
    expect(normalizedScore(5)).toBe(1);
  });
});

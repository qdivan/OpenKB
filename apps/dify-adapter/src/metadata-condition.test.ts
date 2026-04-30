import { describe, expect, it } from "vitest";

import {
  matchesMetadataCondition,
  matchesMetadataConditions,
  normalizeOptionalMetadataCondition
} from "./metadata-condition";

const metadata = {
  tags: ["mcp", "dify"],
  title: "OpenKB Dify Adapter",
  score: 7,
  created_at: "2026-04-30T00:00:00.000Z",
  nested: {
    owner: "platform"
  }
};

describe("Dify metadata_condition helpers", () => {
  it("supports string, array, numeric and date operators", () => {
    const condition = normalizeOptionalMetadataCondition({
      logical_operator: "and",
      conditions: [
        { name: "tags", comparison_operator: "contains", value: "dify" },
        { name: "title", comparison_operator: "start with", value: "OpenKB" },
        { name: "score", comparison_operator: ">=", value: 7 },
        { name: "created_at", comparison_operator: "after", value: "2026-04-29T00:00:00.000Z" },
        { name: "nested.owner", comparison_operator: "is", value: "platform" }
      ]
    });

    expect(condition).not.toBeNull();
    expect(matchesMetadataCondition(metadata, condition!)).toBe(true);
  });

  it("supports or, in, not in, empty and not empty", () => {
    const orCondition = normalizeOptionalMetadataCondition({
      logical_operator: "or",
      conditions: [
        { name: "tags", comparison_operator: "in", value: ["missing", "mcp"] },
        { name: "empty_value", comparison_operator: "not empty" }
      ]
    });
    const emptyCondition = normalizeOptionalMetadataCondition({
      conditions: [{ name: "empty_value", comparison_operator: "empty" }]
    });
    const notInCondition = normalizeOptionalMetadataCondition({
      conditions: [{ name: "tags", comparison_operator: "not in", value: ["other"] }]
    });

    expect(matchesMetadataCondition(metadata, orCondition!)).toBe(true);
    expect(matchesMetadataConditions(metadata, [emptyCondition, notInCondition])).toBe(true);
  });

  it("rejects invalid metadata conditions", () => {
    expect(() =>
      normalizeOptionalMetadataCondition({
        logical_operator: "xor",
        conditions: []
      })
    ).toThrow("logical_operator");
    expect(() =>
      normalizeOptionalMetadataCondition({
        conditions: [{ name: "tags" }]
      })
    ).toThrow("comparison_operator");
  });
});

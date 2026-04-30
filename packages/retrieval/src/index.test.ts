import { describe, expect, it } from "vitest";

import {
  calculateCandidateLimit,
  filterRetrievalAccessPrincipals,
  normalizeRetrievalSearchInput,
  RetrievalError
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
});

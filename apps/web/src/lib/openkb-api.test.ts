import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, apiFetch, isUnauthorized, searchKnowledge } from "./openkb-api";

describe("OpenKB API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends credentialed JSON requests to the API origin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/workspaces", { method: "POST", body: JSON.stringify({ name: "Docs" }) })
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/workspaces",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json" })
      })
    );
  });

  it("keeps API error bodies available to callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "VERSION_CONFLICT" }), { status: 409 })
      )
    );

    await expect(apiFetch("/api/documents/doc_1")).rejects.toMatchObject({
      status: 409,
      body: { error: "VERSION_CONFLICT" }
    });
  });

  it("recognizes unauthorized errors", () => {
    expect(isUnauthorized(new ApiRequestError(401, { error: "UNAUTHORIZED" }))).toBe(true);
    expect(isUnauthorized(new ApiRequestError(403, { error: "FORBIDDEN" }))).toBe(false);
  });

  it("posts search requests with JSON and credentials", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ query: "MCP", top_k: 10, results: [] }))
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchKnowledge({ query: "MCP", knowledge_base_ids: ["kb_1"] })).resolves.toEqual({
      query: "MCP",
      top_k: 10,
      results: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/search",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ query: "MCP", knowledge_base_ids: ["kb_1"] })
      })
    );
  });
});

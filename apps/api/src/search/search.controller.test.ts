import { AuthError, AuthService } from "@openkb/auth";
import { RetrievalError, RetrievalService } from "@openkb/retrieval";
import { describe, expect, it, vi } from "vitest";

import { SearchController } from "./search.controller";

function reply() {
  return {
    statusCode: 200,
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    header() {
      return this;
    }
  };
}

describe("SearchController", () => {
  it("passes the authenticated session user into retrieval search", async () => {
    const auth = {
      cookieName: () => "openkb_session",
      getMe: vi.fn(async () => ({
        user: { id: "user_1", email: "dev@example.com", displayName: "Dev", status: "active" },
        tenantId: "tenant_1",
        roles: ["member"]
      }))
    } as unknown as AuthService;
    const retrieval = {
      search: vi.fn(async () => ({ query: "MCP", top_k: 10, results: [] }))
    } as unknown as RetrievalService;
    const controller = new SearchController(auth, retrieval);

    await expect(
      controller.search(
        { query: "MCP", knowledge_base_ids: ["kb_1"], top_k: 10 },
        { headers: { cookie: "openkb_session=session_1" } } as never,
        reply() as never
      )
    ).resolves.toEqual({ query: "MCP", top_k: 10, results: [] });
    expect(auth.getMe).toHaveBeenCalledWith("session_1");
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "MCP",
        knowledge_base_ids: ["kb_1"],
        top_k: 10
      })
    );
  });

  it("maps auth and retrieval errors to JSON", async () => {
    const auth = {
      cookieName: () => "openkb_session",
      getMe: vi.fn(async () => {
        throw new AuthError("AUTHENTICATION_REQUIRED", "Authentication is required.", 401);
      })
    } as unknown as AuthService;
    const controller = new SearchController(auth, {} as RetrievalService);
    const res = reply();

    await expect(
      controller.search({ query: "MCP" }, { headers: { cookie: "" } } as never, res as never)
    ).resolves.toEqual({
      error: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required."
    });
    expect(res.statusCode).toBe(401);

    const retrieval = {
      search: vi.fn(async () => {
        throw new RetrievalError("SEARCH_INDEX_NOT_READY", "Search index is not ready.", 503);
      })
    } as unknown as RetrievalService;
    const okAuth = {
      cookieName: () => "openkb_session",
      getMe: vi.fn(async () => ({
        user: { id: "user_1", email: "dev@example.com", displayName: "Dev", status: "active" },
        tenantId: "tenant_1",
        roles: ["member"]
      }))
    } as unknown as AuthService;
    const controllerWithRetrievalError = new SearchController(okAuth, retrieval);
    const errorRes = reply();

    await expect(
      controllerWithRetrievalError.search(
        { query: "MCP" },
        { headers: { cookie: "openkb_session=session_1" } } as never,
        errorRes as never
      )
    ).resolves.toEqual({
      error: "SEARCH_INDEX_NOT_READY",
      message: "Search index is not ready."
    });
    expect(errorRes.statusCode).toBe(503);
  });
});

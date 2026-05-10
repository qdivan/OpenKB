import { describe, expect, it } from "vitest";

import { isCsrfAllowed, isRateLimited } from "./security";

describe("API security helpers", () => {
  it("rate limits after the configured maximum within the window", () => {
    const rule = { keyPrefix: "test", max: 2, windowMs: 1000 };

    expect(isRateLimited(rule, "127.0.0.1", 1000)).toBe(false);
    expect(isRateLimited(rule, "127.0.0.1", 1100)).toBe(false);
    expect(isRateLimited(rule, "127.0.0.1", 1200)).toBe(true);
    expect(isRateLimited(rule, "127.0.0.1", 2100)).toBe(false);
  });

  it("requires matching CSRF tokens for cookie-auth mutations", () => {
    const request = {
      method: "POST",
      headers: {
        cookie: "openkb_session=s1; openkb_csrf=t1",
        "x-openkb-csrf": "t1"
      }
    };

    expect(isCsrfAllowed(request as never, "/api/workspaces", {})).toBe(true);
    expect(
      isCsrfAllowed(
        { ...request, headers: { ...request.headers, "x-openkb-csrf": "bad" } } as never,
        "/api/workspaces",
        {}
      )
    ).toBe(false);
  });

  it("does not require CSRF for bearer-token integrations", () => {
    expect(
      isCsrfAllowed(
        { method: "POST", headers: { authorization: "Bearer dify_test" } } as never,
        "/api/admin/dify/api-keys",
        {}
      )
    ).toBe(true);
  });
});

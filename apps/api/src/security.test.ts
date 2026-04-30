import { describe, expect, it } from "vitest";

import { isRateLimited } from "./security";

describe("API security helpers", () => {
  it("rate limits after the configured maximum within the window", () => {
    const rule = { keyPrefix: "test", max: 2, windowMs: 1000 };

    expect(isRateLimited(rule, "127.0.0.1", 1000)).toBe(false);
    expect(isRateLimited(rule, "127.0.0.1", 1100)).toBe(false);
    expect(isRateLimited(rule, "127.0.0.1", 1200)).toBe(true);
    expect(isRateLimited(rule, "127.0.0.1", 2100)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { extractBearerToken, hashToken } from "./auth";

describe("Dify auth helpers", () => {
  it("extracts Bearer API keys and hashes tokens", () => {
    expect(extractBearerToken("Bearer dify_secret")).toBe("dify_secret");
    expect(extractBearerToken("Basic nope")).toBeNull();
    expect(hashToken("dify_secret")).toHaveLength(64);
    expect(hashToken("dify_secret")).toBe(hashToken("dify_secret"));
  });
});

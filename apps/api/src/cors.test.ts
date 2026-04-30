import { describe, expect, it } from "vitest";

import { createCorsOptions } from "./cors";

describe("createCorsOptions", () => {
  it("allows local web origins with credentials", () => {
    const options = createCorsOptions();
    const origin = options.origin;
    expect(options.credentials).toBe(true);

    if (typeof origin !== "function") {
      throw new Error("Expected dynamic CORS origin callback.");
    }

    origin("http://localhost:3001", (error, allowed) => {
      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });
  });

  it("rejects unknown origins", () => {
    const origin = createCorsOptions().origin;
    if (typeof origin !== "function") {
      throw new Error("Expected dynamic CORS origin callback.");
    }

    origin("https://example.com", (error, allowed) => {
      expect(error).toBeInstanceOf(Error);
      expect(allowed).toBe(false);
    });
  });

  it("does not allow local origins by default in production", () => {
    const origin = createCorsOptions({
      NODE_ENV: "production",
      WEB_BASE_URL: "https://kb-test.example.com"
    }).origin;
    if (typeof origin !== "function") {
      throw new Error("Expected dynamic CORS origin callback.");
    }

    origin("http://localhost:3000", (error, allowed) => {
      expect(error).toBeInstanceOf(Error);
      expect(allowed).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";

import { authApiUrl } from "./auth-api";

describe("auth API helpers", () => {
  it("builds URLs with the default API origin", () => {
    expect(authApiUrl("/api/auth/login")).toBe("http://localhost:4000/api/auth/login");
  });
});

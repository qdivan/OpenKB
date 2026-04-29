import { describe, expect, it } from "vitest";

import { AuthError, getCookieValue } from "./service";

describe("@openkb/auth helpers", () => {
  it("parses session cookies", () => {
    expect(getCookieValue("a=1; openkb_session=abc%201; b=2")).toBe("abc 1");
  });

  it("exposes structured auth errors", () => {
    const error = new AuthError("INVALID_INPUT", "Nope", 400);

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.statusCode).toBe(400);
  });
});

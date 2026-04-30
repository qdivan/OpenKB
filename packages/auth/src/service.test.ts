import { describe, expect, it } from "vitest";

import { AuthError, AuthService, getCookieValue } from "./service";

describe("@openkb/auth helpers", () => {
  const prisma = {} as never;

  it("parses session cookies", () => {
    expect(getCookieValue("a=1; openkb_session=abc%201; b=2")).toBe("abc 1");
  });

  it("exposes structured auth errors", () => {
    const error = new AuthError("INVALID_INPUT", "Nope", 400);

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.statusCode).toBe(400);
  });

  it("does not mark cookies secure for local HTTP base URLs", () => {
    const auth = new AuthService({
      prisma,
      env: {
        NODE_ENV: "production",
        WEB_BASE_URL: "http://localhost:3000"
      }
    });

    expect(auth.createCookie("session", new Date("2030-01-01T00:00:00.000Z"))).not.toContain(
      "Secure"
    );
  });

  it("marks cookies secure for HTTPS base URLs", () => {
    const auth = new AuthService({
      prisma,
      env: {
        NODE_ENV: "production",
        WEB_BASE_URL: "https://openkb.example.com"
      }
    });

    expect(auth.createCookie("session", new Date("2030-01-01T00:00:00.000Z"))).toContain("Secure");
  });
});

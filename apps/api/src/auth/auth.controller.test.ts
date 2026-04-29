import { NestFactory } from "@nestjs/core";
import { AuthError, AuthService } from "@openkb/auth";
import { describe, expect, it, vi } from "vitest";

import { AppModule } from "../app.module";
import { AdminController } from "./admin.controller";
import { AuthController } from "./auth.controller";

function reply() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    header(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    }
  };
}

describe("AuthController", () => {
  it("receives AuthService through Nest dependency injection", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public";

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

    try {
      const controller = app.get(AuthController);
      expect((controller as unknown as { auth?: AuthService }).auth).toBeInstanceOf(AuthService);
    } finally {
      await app.close();
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it("sets a httpOnly session cookie on login", async () => {
    const auth = {
      login: vi.fn(async () => ({
        sessionToken: "session-token",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        me: { user: { email: "user@example.com" } }
      })),
      createCookie: vi.fn(() => "openkb_session=session-token; HttpOnly; SameSite=Lax")
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const res = reply();

    await expect(
      controller.login({ email: "user@example.com", password: "password-123" }, res as never)
    ).resolves.toMatchObject({ user: { email: "user@example.com" } });
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("maps auth errors to JSON", async () => {
    const auth = {
      register: vi.fn(async () => {
        throw new AuthError("REGISTRATION_DISABLED", "Registration is disabled.", 403);
      })
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const res = reply();

    await expect(
      controller.register({ email: "user@example.com", password: "password-123" }, res as never)
    ).resolves.toEqual({
      error: "REGISTRATION_DISABLED",
      message: "Registration is disabled."
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("AdminController", () => {
  it("requires an admin-capable session through the service", async () => {
    const auth = {
      cookieName: () => "openkb_session",
      listUsers: vi.fn(async () => {
        throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
      })
    } as unknown as AuthService;
    const controller = new AdminController(auth);
    const res = reply();

    await expect(
      controller.users(
        undefined,
        { headers: { cookie: "openkb_session=abc" } } as never,
        res as never
      )
    ).resolves.toEqual({
      error: "ADMIN_REQUIRED",
      message: "Admin role is required."
    });
    expect(auth.listUsers).toHaveBeenCalledWith("abc", undefined);
    expect(res.statusCode).toBe(403);
  });
});

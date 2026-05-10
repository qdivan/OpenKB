import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import { getMcpServerConfig } from "./config";
import { McpOAuthService } from "./oauth";

describe("MCP OAuth metadata", () => {
  it("publishes authorization server metadata for auth code with PKCE", () => {
    const oauth = new McpOAuthService({
      prisma: {} as never,
      auth: {} as never,
      env: {
        MCP_SERVER_BASE_URL: "https://mcp.example.com",
        MCP_OAUTH_ISSUER: "https://mcp.example.com"
      }
    });

    expect(oauth.getAuthorizationServerMetadata()).toMatchObject({
      issuer: "https://mcp.example.com",
      authorization_endpoint: "https://mcp.example.com/oauth/authorize",
      token_endpoint: "https://mcp.example.com/oauth/token",
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"]
    });
  });

  it("requires an explicit OAuth signing secret in production", () => {
    expect(() =>
      getMcpServerConfig({
        NODE_ENV: "production",
        MCP_SERVER_BASE_URL: "https://mcp.example.com"
      })
    ).toThrow(/MCP_OAUTH_SIGNING_SECRET/);

    expect(
      getMcpServerConfig({
        NODE_ENV: "development",
        MCP_SERVER_BASE_URL: "https://mcp.example.com"
      }).signingSecret
    ).toBe("openkb-dev-mcp-oauth-signing-secret");
  });

  it("does not let system admins consent to an OAuth client from another tenant", async () => {
    const oauth = new McpOAuthService({
      prisma: {
        mcpOauthClient: {
          findUnique: async () => ({
            id: "client-id",
            tenant_id: "tenant-b",
            client_id: "client-a",
            client_name: "Client A",
            redirect_uris: ["https://client.example.com/callback"],
            allowed_scopes: ["kb:read"],
            status: "active"
          })
        }
      } as never,
      auth: {
        getMe: async () => ({
          tenantId: "tenant-a",
          roles: ["system_admin"],
          user: { id: "user-id", email: "admin@example.com" }
        })
      } as never,
      env: {
        MCP_SERVER_BASE_URL: "https://mcp.example.com",
        MCP_OAUTH_ISSUER: "https://mcp.example.com"
      }
    });

    const url = new URL(
      "https://mcp.example.com/oauth/authorize?response_type=code&client_id=client-a&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&code_challenge=challenge&code_challenge_method=S256&scope=kb%3Aread"
    );

    await expect(oauth.authorizeGet(url, "openkb_session=session-token")).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("consumes an authorization code only once", async () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    const code = "okb_code_test";
    const verifier = "verifier";
    let consumedAt: Date | null = null;
    const refreshTokens: unknown[] = [];
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
      mcpOauthClient: {
        findUnique: async () => ({
          id: "client-id",
          tenant_id: "tenant-id",
          client_id: "client-public",
          redirect_uris: ["https://client.example.com/callback"],
          allowed_scopes: ["kb:read"],
          status: "active"
        })
      },
      mcpOauthAuthorizationCode: {
        findFirst: async () =>
          consumedAt
            ? null
            : {
                id: "code-id",
                tenant_id: "tenant-id",
                grant_id: "grant-id",
                code_hash: sha256(code),
                code_challenge: pkceChallenge(verifier),
                redirect_uri: "https://client.example.com/callback",
                scopes: ["kb:read"],
                expires_at: new Date(now.getTime() + 60_000),
                consumed_at: null
              },
        updateMany: async ({ data }: { data: { consumed_at: Date } }) => {
          if (consumedAt) {
            return { count: 0 };
          }
          consumedAt = data.consumed_at;
          return { count: 1 };
        }
      },
      mcpOauthGrant: {
        findUnique: async () => ({
          id: "grant-id",
          tenant_id: "tenant-id",
          user_id: "user-id",
          client_id: "client-id",
          scopes: ["kb:read"],
          status: "active",
          revoked_at: null
        })
      },
      mcpOauthRefreshToken: {
        create: async ({ data }: { data: unknown }) => {
          refreshTokens.push(data);
          return data;
        }
      }
    };
    const oauth = new McpOAuthService({
      prisma: prisma as never,
      auth: {} as never,
      env: {
        MCP_SERVER_BASE_URL: "https://mcp.example.com",
        MCP_OAUTH_SIGNING_SECRET: "test-signing-secret"
      },
      now: () => now
    });
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "client-public",
      code,
      redirect_uri: "https://client.example.com/callback",
      code_verifier: verifier
    }).toString();

    await expect(oauth.token(body)).resolves.toMatchObject({ status: 200 });
    await expect(oauth.token(body)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(refreshTokens).toHaveLength(1);
  });

  it("rotates a refresh token only once", async () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    const refreshToken = "okb_refresh_test";
    let revokedAt: Date | null = null;
    const refreshTokens: unknown[] = [];
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
      mcpOauthRefreshToken: {
        findFirst: async () =>
          revokedAt
            ? null
            : {
                id: "refresh-id",
                tenant_id: "tenant-id",
                grant_id: "grant-id",
                token_hash: sha256(refreshToken),
                expires_at: new Date(now.getTime() + 60_000),
                revoked_at: null
              },
        updateMany: async ({ data }: { data: { revoked_at: Date } }) => {
          if (revokedAt) {
            return { count: 0 };
          }
          revokedAt = data.revoked_at;
          return { count: 1 };
        },
        create: async ({ data }: { data: unknown }) => {
          refreshTokens.push(data);
          return data;
        }
      },
      mcpOauthGrant: {
        findUnique: async () => ({
          id: "grant-id",
          tenant_id: "tenant-id",
          user_id: "user-id",
          client_id: "client-id",
          scopes: ["kb:read"],
          status: "active",
          revoked_at: null
        })
      },
      mcpOauthClient: {
        findUnique: async () => ({
          id: "client-id",
          client_id: "client-public",
          status: "active"
        })
      }
    };
    const oauth = new McpOAuthService({
      prisma: prisma as never,
      auth: {} as never,
      env: {
        MCP_SERVER_BASE_URL: "https://mcp.example.com",
        MCP_OAUTH_SIGNING_SECRET: "test-signing-secret"
      },
      now: () => now
    });
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "client-public",
      refresh_token: refreshToken
    }).toString();

    await expect(oauth.token(body)).resolves.toMatchObject({ status: 200 });
    await expect(oauth.token(body)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(refreshTokens).toHaveLength(1);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

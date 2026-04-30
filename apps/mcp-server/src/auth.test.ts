import { describe, expect, it } from "vitest";

import { assertAllowedScopes, getMcpServerConfig, parseScopes } from "./config";
import { hashToken } from "./auth";
import { getProtectedResourceMetadata } from "./server";

describe("MCP auth helpers", () => {
  it("hashes PATs without preserving the raw token", () => {
    const token = "kbpat_test-token";
    const hash = hashToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it("normalizes supported scopes and rejects unknown scopes", () => {
    expect(parseScopes("kb:read,kb:search,doc:read")).toEqual(["kb:read", "kb:search", "doc:read"]);
    expect(() => assertAllowedScopes(["kb:write"])).toThrow(/Unsupported MCP scopes/);
  });

  it("exposes protected resource metadata without enabling full OAuth", () => {
    const metadata = getProtectedResourceMetadata({
      MCP_SERVER_BASE_URL: "http://localhost:4100/",
      MCP_PAT_PREFIX: "kbpat_"
    });

    expect(getMcpServerConfig({}).maxTopK).toBe(20);
    expect(metadata).toMatchObject({
      resource: "http://localhost:4100/mcp",
      bearer_methods_supported: ["header"],
      scopes_supported: ["kb:read", "kb:search", "doc:read"],
      openkb_auth: {
        oauth_status: "not_configured_in_phase_9"
      }
    });
  });
});

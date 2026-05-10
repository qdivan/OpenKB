export const MCP_PAT_PREFIX = "kbpat_";
export const MCP_DEFAULT_SCOPES = ["kb:read", "kb:search", "doc:read"] as const;
export const MCP_WRITE_SCOPES = ["profile:read", "kb:write", "doc:write", "toc:write"] as const;
export const MCP_ALLOWED_SCOPES = [...MCP_DEFAULT_SCOPES, ...MCP_WRITE_SCOPES] as const;
export const MCP_DEFAULT_TOP_K = 5;
export const MCP_DEFAULT_LIMIT = 50;
export const MCP_MAX_LIMIT = 100;

export type McpScope = (typeof MCP_ALLOWED_SCOPES)[number];

export type McpServerConfig = {
  baseUrl: string;
  issuer: string;
  patPrefix: string;
  defaultScopes: McpScope[];
  maxTopK: number;
  maxDocumentChars: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  signingSecret: string;
};

export function getMcpServerConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return {
    baseUrl: trimTrailingSlash(env.MCP_SERVER_BASE_URL || "http://localhost:4100"),
    issuer: trimTrailingSlash(
      env.MCP_OAUTH_ISSUER || env.MCP_SERVER_BASE_URL || "http://localhost:4100"
    ),
    patPrefix: env.MCP_PAT_PREFIX || MCP_PAT_PREFIX,
    defaultScopes: parseScopes(env.MCP_DEFAULT_SCOPES),
    maxTopK: parsePositiveInt(env.MCP_MAX_TOP_K, 20),
    maxDocumentChars: parsePositiveInt(env.MCP_MAX_DOCUMENT_CHARS, 60_000),
    accessTokenTtlSeconds: parsePositiveInt(env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, 900),
    refreshTokenTtlDays: parsePositiveInt(env.MCP_OAUTH_REFRESH_TOKEN_TTL_DAYS, 30),
    signingSecret: resolveSigningSecret(env)
  };
}

export function parseScopes(value: string | undefined): McpScope[] {
  if (!value?.trim()) {
    return [...MCP_DEFAULT_SCOPES];
  }

  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return assertAllowedScopes(scopes);
}

export function assertAllowedScopes(scopes: string[]): McpScope[] {
  const invalid = scopes.filter((scope) => !MCP_ALLOWED_SCOPES.includes(scope as McpScope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported MCP scopes: ${invalid.join(", ")}`);
  }

  return [...new Set(scopes)] as McpScope[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveSigningSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.MCP_OAUTH_SIGNING_SECRET || env.OPENKB_CONFIG_ENCRYPTION_KEY;
  if (configured) {
    return configured;
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "MCP_OAUTH_SIGNING_SECRET or OPENKB_CONFIG_ENCRYPTION_KEY is required in production."
    );
  }
  return "openkb-dev-mcp-oauth-signing-secret";
}

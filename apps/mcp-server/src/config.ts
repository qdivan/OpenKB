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
  patPrefix: string;
  defaultScopes: McpScope[];
  maxTopK: number;
  maxDocumentChars: number;
};

export function getMcpServerConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return {
    baseUrl: trimTrailingSlash(env.MCP_SERVER_BASE_URL || "http://localhost:4100"),
    patPrefix: env.MCP_PAT_PREFIX || MCP_PAT_PREFIX,
    defaultScopes: parseScopes(env.MCP_DEFAULT_SCOPES),
    maxTopK: parsePositiveInt(env.MCP_MAX_TOP_K, 20),
    maxDocumentChars: parsePositiveInt(env.MCP_MAX_DOCUMENT_CHARS, 60_000)
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

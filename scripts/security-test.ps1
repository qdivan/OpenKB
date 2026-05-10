$ErrorActionPreference = "Stop"
pnpm test apps/api/src/security.test.ts apps/mcp-server/src/auth.test.ts apps/mcp-server/src/oauth.test.ts packages/email/src/index.test.ts

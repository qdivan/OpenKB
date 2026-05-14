$ErrorActionPreference = "Stop"
. .\scripts\test-postgres-env.ps1

function Invoke-Step {
  param(
    [scriptblock]$Command,
    [string]$Name
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE."
  }
}

try {
  Set-OpenKBTestPostgresEnv
  Set-OpenKBTestMilvusEnv
  Invoke-Step { pnpm db:test:up } "db:test:up"
  Invoke-Step { pnpm milvus:test:up } "milvus:test:up"
  $env:MILVUS_ACTIVE_ALIAS = "openkb_chunks_active"
  $env:MILVUS_COLLECTION_PREFIX = "openkb_chunks"
  $env:MILVUS_ENABLE_BM25 = "true"
  $env:MILVUS_ENABLE_TEXT_EMBEDDING = "false"
  $env:MILVUS_ENABLE_RERANK = "false"
  $env:MCP_SERVER_BASE_URL = "http://localhost:4100"
  $env:MCP_PAT_PREFIX = "kbpat_"
  $env:MCP_DEFAULT_SCOPES = "kb:read,kb:search,doc:read"
  $env:MCP_MAX_TOP_K = "20"
  $env:MCP_MAX_DOCUMENT_CHARS = "60000"
  Invoke-Step { pnpm db:migrate } "db:migrate"
  Invoke-Step { pnpm dev:seed } "dev:seed"
  Invoke-Step { pnpm --filter @openkb/db build } "db build"
  Invoke-Step { pnpm --filter @openkb/editor build } "editor build"
  Invoke-Step { pnpm --filter @openkb/permissions build } "permissions build"
  Invoke-Step { pnpm --filter @openkb/milvus build } "milvus build"
  Invoke-Step { pnpm --filter @openkb/retrieval build } "retrieval build"
  Invoke-Step { pnpm --filter @openkb/index-worker build } "index-worker build"
  Invoke-Step { pnpm --filter @openkb/mcp-server build } "mcp-server build"
  Invoke-Step { pnpm --filter @openkb/index-worker index:test } "index-worker index:test"
  Invoke-Step { pnpm --filter @openkb/mcp-server mcp:test } "mcp-server integration test"
} finally {
  pnpm milvus:test:down
  pnpm db:test:down
}

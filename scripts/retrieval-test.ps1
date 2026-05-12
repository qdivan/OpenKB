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
  Invoke-Step { pnpm db:test:up } "db:test:up"
  Invoke-Step { pnpm milvus:test:up } "milvus:test:up"
  $milvusPort = if ($env:OPENKB_MILVUS_TEST_PORT) { $env:OPENKB_MILVUS_TEST_PORT } else { "59530" }
  $env:MILVUS_URI = "localhost:$milvusPort"
  $env:MILVUS_ACTIVE_ALIAS = "openkb_chunks_active"
  $env:MILVUS_COLLECTION_PREFIX = "openkb_chunks"
  $env:MILVUS_ENABLE_BM25 = "true"
  $env:MILVUS_ENABLE_TEXT_EMBEDDING = "false"
  $env:MILVUS_ENABLE_RERANK = "false"
  Invoke-Step { pnpm db:migrate } "db:migrate"
  Invoke-Step { pnpm dev:seed } "dev:seed"
  Invoke-Step { pnpm --filter @openkb/db build } "db build"
  Invoke-Step { pnpm --filter @openkb/auth build } "auth build"
  Invoke-Step { pnpm --filter @openkb/permissions build } "permissions build"
  Invoke-Step { pnpm --filter @openkb/milvus build } "milvus build"
  Invoke-Step { pnpm --filter @openkb/retrieval build } "retrieval build"
  Invoke-Step { pnpm --filter @openkb/index-worker build } "index-worker build"
  Invoke-Step { pnpm --filter @openkb/api build } "api build"
  Invoke-Step { pnpm --filter @openkb/milvus test } "milvus unit test"
  Invoke-Step { pnpm --filter @openkb/retrieval test } "retrieval unit test"
  Invoke-Step { pnpm --filter @openkb/index-worker index:test } "index-worker index:test"
  Invoke-Step { pnpm --filter @openkb/retrieval retrieval:test } "retrieval integration test"
  Invoke-Step { pnpm --filter @openkb/api retrieval:test } "search API integration test"
} finally {
  pnpm milvus:test:down
  pnpm db:test:down
}

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "openkb-local-env.ps1")

Write-Host "Starting OpenKB index worker with local single environment"
Write-Host "Using database: $(Format-OpenKBSafeDatabaseUrl $env:DATABASE_URL)"
Write-Host "Using Redis: $env:REDIS_URL"
Write-Host "Using Milvus: $env:MILVUS_URI"
Write-Host "Using embedding: $env:OPENKB_EMBEDDING_MODEL at $env:OPENKB_EMBEDDING_ENDPOINT"
Write-Host "Using image vector mode: $env:OPENKB_IMAGE_VECTOR_MODE"
Write-Host "Using rerank: $env:OPENKB_RERANK_MODEL at $env:OPENKB_RERANK_ENDPOINT"

pnpm --filter @openkb/index-worker index:worker

$ErrorActionPreference = "Stop"

$env:PORT = "4101"
. (Join-Path $PSScriptRoot "openkb-local-env.ps1")

Write-Host "Starting OpenKB API on http://localhost:4101"
Write-Host "Allowed web origins: $env:CORS_ORIGINS"
Write-Host "Using database: $(Format-OpenKBSafeDatabaseUrl $env:DATABASE_URL)"
Write-Host "Using Redis: $env:REDIS_URL"
Write-Host "Using Milvus: $env:MILVUS_URI"
Write-Host "Using embedding: $env:OPENKB_EMBEDDING_MODEL at $env:OPENKB_EMBEDDING_ENDPOINT"
Write-Host "Using rerank: $env:OPENKB_RERANK_MODEL at $env:OPENKB_RERANK_ENDPOINT"
if (-not $env:OPENKB_LLM_MODEL) {
  Write-Host "LLM model is not configured in this shell. Set OPENKB_LLM_* or create .codex-runtime/openkb-local-models.ps1."
} else {
  Write-Host "Using LLM: $env:OPENKB_LLM_MODEL"
  if (-not $env:OPENKB_LLM_API_KEY) {
    Write-Host "LLM API key is not configured in this shell; set OPENKB_LLM_API_KEY before probing or using LLM features."
  }
}

pnpm --filter @openkb/api dev

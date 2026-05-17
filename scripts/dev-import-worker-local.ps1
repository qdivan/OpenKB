$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "openkb-local-env.ps1")

Write-Host "Starting OpenKB import worker with local single environment"
Write-Host "Using database: $(Format-OpenKBSafeDatabaseUrl $env:DATABASE_URL)"
Write-Host "Using Redis: $env:REDIS_URL"
Write-Host "Using object storage: $env:S3_ENDPOINT / $env:S3_BUCKET"

pnpm --filter @openkb/import-worker import:watch

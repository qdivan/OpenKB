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
  $objectStoragePort = if ($env:OPENKB_MINIO_TEST_PORT) { $env:OPENKB_MINIO_TEST_PORT } else { "59000" }
  Invoke-Step { pnpm db:test:up } "db:test:up"
  Invoke-Step { pnpm object-storage:test:up } "object-storage:test:up"
  $env:S3_ENDPOINT = "http://localhost:$objectStoragePort"
  $env:S3_REGION = "us-east-1"
  $env:S3_BUCKET = "openkb-assets"
  $env:S3_ACCESS_KEY_ID = "openkb"
  $env:S3_SECRET_ACCESS_KEY = "openkb-secret"
  $env:S3_FORCE_PATH_STYLE = "true"
  $env:S3_PRESIGN_TTL_SECONDS = "900"
  Invoke-Step { pnpm db:migrate } "db:migrate"
  Invoke-Step { pnpm --filter @openkb/db build } "db build"
  Invoke-Step { pnpm --filter @openkb/storage build } "storage build"
  Invoke-Step { pnpm --filter @openkb/markdown build } "markdown build"
  Invoke-Step { pnpm --filter @openkb/import-worker build } "import-worker build"
  Invoke-Step { pnpm --filter @openkb/storage test } "storage test"
  Invoke-Step { pnpm --filter @openkb/markdown test } "markdown test"
  Invoke-Step { pnpm --filter @openkb/import-worker import:test } "import-worker import:test"
  Invoke-Step { pnpm --filter @openkb/api import:test } "api import:test"
} finally {
  pnpm object-storage:test:down
  pnpm db:test:down
}

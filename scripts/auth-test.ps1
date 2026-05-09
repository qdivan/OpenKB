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
  Invoke-Step { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-test-up.ps1 } "db-test-up"
  Invoke-Step { pnpm db:migrate } "db:migrate"
  Invoke-Step { pnpm --filter @openkb/auth auth:test } "auth:test"
} finally {
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-test-down.ps1
}

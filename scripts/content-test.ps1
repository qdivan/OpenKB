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
  Invoke-Step { pnpm db:migrate } "db:migrate"
  Invoke-Step { pnpm --filter @openkb/db build } "db build"
  Invoke-Step { pnpm --filter @openkb/email build } "email build"
  Invoke-Step { pnpm --filter @openkb/auth build } "auth build"
  Invoke-Step { pnpm --filter @openkb/permissions build } "permissions build"
  Invoke-Step { pnpm --filter @openkb/api content:test } "api content:test"
} finally {
  pnpm db:test:down
}

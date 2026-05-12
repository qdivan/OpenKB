$ErrorActionPreference = "Stop"

$env:PORT = "4101"
$env:APP_BASE_URL = "http://localhost:3100"
$env:WEB_BASE_URL = "http://localhost:3100"
$env:CORS_ORIGINS = "http://localhost:3100,http://127.0.0.1:3100,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"

function Format-SafeDatabaseUrl {
  param([string]$DatabaseUrl)

  if (-not $DatabaseUrl) {
    return "not configured"
  }

  try {
    $uri = [System.Uri]$DatabaseUrl
    $builder = [System.UriBuilder]::new($uri)
    if ($builder.UserName -or $builder.Password) {
      $builder.UserName = "***"
      $builder.Password = "***"
    }
    return $builder.Uri.ToString()
  } catch {
    return "custom database URL configured"
  }
}

if (-not $env:DATABASE_URL) {
  $postgresPort = if ($env:OPENKB_TEST_POSTGRES_PORT) { $env:OPENKB_TEST_POSTGRES_PORT } else { "55432" }
  $postgresUser = "openkb"
  $postgresPassword = "openkb"
  $env:DATABASE_URL = `
    "postgresql://" + `
    $postgresUser + `
    ":" + `
    $postgresPassword + `
    "@localhost:" + `
    $postgresPort + `
    "/openkb_test?schema=public"
}

Write-Host "Starting OpenKB API on http://localhost:4101"
Write-Host "Allowed web origins: $env:CORS_ORIGINS"
Write-Host "Using database: $(Format-SafeDatabaseUrl $env:DATABASE_URL)"

pnpm --filter @openkb/api dev

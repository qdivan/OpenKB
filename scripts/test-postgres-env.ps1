$ErrorActionPreference = "Stop"

function Test-OpenKBPortAvailable {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return -not $listeners
}

function Find-OpenKBTestPostgresPort {
  $configuredPort = $env:OPENKB_TEST_POSTGRES_PORT
  if (-not [string]::IsNullOrWhiteSpace($configuredPort)) {
    return [int]$configuredPort
  }

  foreach ($candidate in 55432..55442) {
    if (Test-OpenKBPortAvailable -Port $candidate) {
      return $candidate
    }
  }

  throw "No free OpenKB test Postgres port found in 55432..55442."
}

function Set-OpenKBTestPostgresEnv {
  $port = Find-OpenKBTestPostgresPort
  $env:OPENKB_TEST_POSTGRES_PORT = "$port"
  $env:DATABASE_URL = "postgresql://openkb:openkb@localhost:$port/openkb_test?schema=public"
  Write-Host "Using OpenKB test Postgres port $port."
}

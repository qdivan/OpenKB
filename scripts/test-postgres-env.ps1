$ErrorActionPreference = "Stop"

function Test-OpenKBPortAvailable {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listeners) {
    return $false
  }

  $wslPorts = wsl sh -lc "docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ':$Port->'" 2>$null
  if ($LASTEXITCODE -eq 0) {
    return $false
  }

  return $true
}

function Get-OpenKBTestPostgresHost {
  $configuredHost = $env:OPENKB_TEST_POSTGRES_HOST
  if (-not [string]::IsNullOrWhiteSpace($configuredHost)) {
    return $configuredHost
  }

  $wslIpOutput = wsl hostname -I 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($wslIpOutput)) {
    $firstIp = ($wslIpOutput -split "\s+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($firstIp)) {
      return $firstIp.Trim()
    }
  }

  return "localhost"
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

function Find-OpenKBFreePort {
  param(
    [int]$Start,
    [int]$End,
    [string]$ConfiguredPort,
    [string]$Name
  )

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPort)) {
    return [int]$ConfiguredPort
  }

  foreach ($candidate in $Start..$End) {
    if (Test-OpenKBPortAvailable -Port $candidate) {
      return $candidate
    }
  }

  throw "No free OpenKB test $Name port found in $Start..$End."
}

function Set-OpenKBTestPostgresEnv {
  $port = Find-OpenKBTestPostgresPort
  $hostName = Get-OpenKBTestPostgresHost
  $env:OPENKB_TEST_POSTGRES_PORT = "$port"
  $env:DATABASE_URL = "postgresql://openkb:openkb@${hostName}:$port/openkb_test?schema=public"
  Write-Host "Using OpenKB test Postgres at ${hostName}:$port."
}

function Set-OpenKBTestMilvusEnv {
  $milvusPort = Find-OpenKBFreePort -Start 59530 -End 59550 -ConfiguredPort $env:OPENKB_MILVUS_TEST_PORT -Name "Milvus"
  $healthPort = Find-OpenKBFreePort -Start 59091 -End 59110 -ConfiguredPort $env:OPENKB_MILVUS_TEST_HEALTH_PORT -Name "Milvus health"
  $hostName = if (-not [string]::IsNullOrWhiteSpace($env:OPENKB_MILVUS_TEST_HOST)) {
    $env:OPENKB_MILVUS_TEST_HOST
  } else {
    Get-OpenKBTestPostgresHost
  }

  $env:OPENKB_MILVUS_TEST_PORT = "$milvusPort"
  $env:OPENKB_MILVUS_TEST_HEALTH_PORT = "$healthPort"
  $env:MILVUS_URI = "${hostName}:$milvusPort"
  Write-Host "Using OpenKB test Milvus at ${hostName}:$milvusPort, health port $healthPort."
}

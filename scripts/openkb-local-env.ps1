$ErrorActionPreference = "Stop"

function Set-OpenKBDefaultEnv {
  param(
    [string]$Name,
    [string]$Value
  )
  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  }
}

function Format-OpenKBSafeDatabaseUrl {
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

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$localModelEnv = Join-Path $repoRoot ".codex-runtime/openkb-local-models.ps1"
if (Test-Path -LiteralPath $localModelEnv) {
  . $localModelEnv
}

Set-OpenKBDefaultEnv "APP_BASE_URL" "http://localhost:3100"
Set-OpenKBDefaultEnv "WEB_BASE_URL" "http://localhost:3100"
Set-OpenKBDefaultEnv "CORS_ORIGINS" "http://localhost:3100,http://127.0.0.1:3100,http://localhost:3202,http://127.0.0.1:3202,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"

$localStack = if ($env:OPENKB_LOCAL_STACK) { $env:OPENKB_LOCAL_STACK.Trim().ToLowerInvariant() } else { "compose" }
if ($localStack -ne "compose" -and $localStack -ne "test") {
  throw "OPENKB_LOCAL_STACK must be 'compose' or 'test'."
}

$defaultRedisPort = if ($localStack -eq "test") { "56379" } else { "6379" }
$defaultS3Port = if ($localStack -eq "test") { "59000" } else { "9000" }
$defaultMilvusPort = if ($localStack -eq "test") { "19531" } else { "19530" }

Set-OpenKBDefaultEnv "REDIS_URL" "redis://localhost:$defaultRedisPort"
Set-OpenKBDefaultEnv "S3_ENDPOINT" "http://localhost:$defaultS3Port"
Set-OpenKBDefaultEnv "S3_REGION" "us-east-1"
Set-OpenKBDefaultEnv "S3_BUCKET" "openkb-assets"
Set-OpenKBDefaultEnv "S3_ACCESS_KEY_ID" "openkb"
Set-OpenKBDefaultEnv "S3_SECRET_ACCESS_KEY" "openkb-secret"
Set-OpenKBDefaultEnv "S3_FORCE_PATH_STYLE" "true"
Set-OpenKBDefaultEnv "MILVUS_URI" "localhost:$defaultMilvusPort"
Set-OpenKBDefaultEnv "OPENKB_RETRIEVAL_DEFAULT_MODE" "hybrid"
Set-OpenKBDefaultEnv "OPENKB_EMBEDDING_REQUEST_FORMAT" "openai_compatible"
Set-OpenKBDefaultEnv "OPENKB_EMBEDDING_ENDPOINT" "http://localhost:18761/v1/embeddings"
Set-OpenKBDefaultEnv "OPENKB_EMBEDDING_MODEL" "qwen3-vl-embedding"
Set-OpenKBDefaultEnv "OPENKB_EMBEDDING_DIM" "768"
Set-OpenKBDefaultEnv "OPENKB_RERANK_REQUEST_FORMAT" "openai_compatible"
Set-OpenKBDefaultEnv "OPENKB_RERANK_ENDPOINT" "http://localhost:18761/v1/rerank"
Set-OpenKBDefaultEnv "OPENKB_RERANK_MODEL" "qwen3-vl-rerank"
Set-OpenKBDefaultEnv "OPENKB_IMAGE_VECTOR_MODE" "auto"
Set-OpenKBDefaultEnv "OPENKB_IMAGE_EMBED_MAX_BYTES" "10485760"

function Test-OpenKBTcpPort {
  param(
    [string]$HostName,
    [int]$Port
  )

  $client = [Net.Sockets.TcpClient]::new()
  try {
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(1000)) {
      return $false
    }
    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Resolve-OpenKBPostgresHost {
  param([int]$Port)

  if (Test-OpenKBTcpPort "localhost" $Port) {
    return "localhost"
  }

  try {
    $wslIp = ((& wsl.exe bash -lc "hostname -I") -split "\s+" | Where-Object { $_ } | Select-Object -First 1)
    if ($wslIp -and (Test-OpenKBTcpPort $wslIp $Port)) {
      return $wslIp
    }
  } catch {
    # Keep the localhost default if WSL is unavailable in this shell.
  }

  return "localhost"
}

function Assert-OpenKBLocalPort {
  param(
    [string]$Label,
    [string]$HostName,
    [int]$Port
  )

  if ($env:OPENKB_SKIP_LOCAL_DEPENDENCY_CHECK -and @("1", "true", "yes", "on") -contains $env:OPENKB_SKIP_LOCAL_DEPENDENCY_CHECK.Trim().ToLowerInvariant()) {
    return
  }
  if ($HostName -ne "localhost" -and $HostName -ne "127.0.0.1" -and $HostName -ne "::1") {
    return
  }
  if (-not (Test-OpenKBTcpPort $HostName $Port)) {
    throw "$Label is not reachable at ${HostName}:$Port. Start the $localStack local stack first, set OPENKB_LOCAL_STACK=test for test-stack ports, override the relevant env var, or set OPENKB_SKIP_LOCAL_DEPENDENCY_CHECK=1."
  }
}

if (-not $env:DATABASE_URL) {
  $postgresPort = if ($env:OPENKB_TEST_POSTGRES_PORT) {
    $env:OPENKB_TEST_POSTGRES_PORT
  } elseif ($localStack -eq "test") {
    "55432"
  } else {
    "5432"
  }
  $postgresHost = Resolve-OpenKBPostgresHost ([int]$postgresPort)
  $env:DATABASE_URL = "postgresql://openkb:openkb@${postgresHost}:$postgresPort/openkb?schema=public"
}

try {
  $databaseUri = [System.Uri]$env:DATABASE_URL
  Assert-OpenKBLocalPort "PostgreSQL" $databaseUri.Host $databaseUri.Port
} catch {
  if ($_.Exception.Message -like "PostgreSQL is not reachable*") {
    throw
  }
}

try {
  $redisUri = [System.Uri]$env:REDIS_URL
  Assert-OpenKBLocalPort "Redis" $redisUri.Host $redisUri.Port
} catch {
  if ($_.Exception.Message -like "Redis is not reachable*") {
    throw
  }
}

try {
  $s3Uri = [System.Uri]$env:S3_ENDPOINT
  Assert-OpenKBLocalPort "Object storage" $s3Uri.Host $s3Uri.Port
} catch {
  if ($_.Exception.Message -like "Object storage is not reachable*") {
    throw
  }
}

if ($env:MILVUS_URI -match "^(?<host>[^:]+):(?<port>\d+)$") {
  Assert-OpenKBLocalPort "Milvus" $Matches.host ([int]$Matches.port)
}

Write-Host "Using local dependency stack: $localStack"

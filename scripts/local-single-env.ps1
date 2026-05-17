param(
  [string]$DifyDockerDir = "",
  [string]$ProxyEnvPath = ".codex-runtime/dify-qwen3vl-proxy.env",
  [int]$ProxyHostPort = 18761,
  [switch]$SkipDify,
  [switch]$SkipOpenKBInfra,
  [switch]$SkipProxy
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$proxyScript = Join-Path $repoRoot "scripts/qwen3vl-proxy.py"
$proxyEnv = Join-Path $repoRoot $ProxyEnvPath

function Convert-ToWslPath {
  param([string]$Path)
  $resolved = (Resolve-Path -LiteralPath $Path).Path.Replace("\", "/")
  $converted = & wsl.exe wslpath -a $resolved
  if ($LASTEXITCODE -ne 0) {
    throw "wslpath failed for $Path"
  }
  return $converted.Trim()
}

function Quote-Bash {
  param([string]$Value)
  return "'" + $Value.Replace("'", "'\''") + "'"
}

function Invoke-WslBash {
  param([string]$Command)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Command))
  & wsl.exe bash -lc "printf '%s' '$encoded' | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) {
    throw "WSL command failed: $Command"
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$Attempts = 30
  )
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "Health check failed: $Url"
}

$repoRootWsl = Convert-ToWslPath $repoRoot
$proxyScriptWsl = Convert-ToWslPath $proxyScript

if (-not $DifyDockerDir) {
  $wslUser = (& wsl.exe bash -lc 'printf "%s" "${USER:-$(whoami)}"').Trim()
  if (-not $wslUser) {
    $wslUser = "ubuntu"
  }
  $DifyDockerDir = "/home/$wslUser/dify/docker"
}

Write-Host "OpenKB local single environment"
Write-Host "Repo: $repoRoot"

Write-Host "Stopping non-target Compose projects without deleting volumes..."
$stopNonTarget = @'
set -euo pipefail
if [ -f /mnt/d/projects_codex/skillhub/compose.release.yml ]; then
  docker compose -p skillhub -f /mnt/d/projects_codex/skillhub/compose.release.yml down --remove-orphans || true
fi
if [ -f /mnt/d/projects_codex/skillhub/compose.docs-verify.override.yml ]; then
  docker compose -p skillhub-docs-verify \
    -f /mnt/d/projects_codex/skillhub/compose.release.yml \
    -f /mnt/d/projects_codex/skillhub/compose.docs-verify.override.yml \
    down --remove-orphans || true
fi
'@
Invoke-WslBash $stopNonTarget

if (-not $SkipDify) {
  Write-Host "Starting target Dify Compose project..."
  $difyCommand = @"
set -euo pipefail
cd $(Quote-Bash $DifyDockerDir)
if [ -f docker-compose.openkb-milvus.override.yaml ]; then
  docker compose -f docker-compose.yaml -f docker-compose.openkb-milvus.override.yaml up -d
else
  docker compose -f docker-compose.yaml up -d
fi
"@
  Invoke-WslBash $difyCommand
}

if (-not $SkipOpenKBInfra) {
  Write-Host "Starting OpenKB infrastructure only..."
  $openkbInfraCommand = @"
set -euo pipefail
cd $(Quote-Bash $repoRootWsl)
if [ -f .env ]; then
  ENV_ARGS="--env-file .env"
else
  ENV_ARGS=""
fi
POSTGRES_PORT=55432 \
REDIS_PORT=56379 \
MINIO_PORT=59000 \
MINIO_CONSOLE_PORT=59001 \
MILVUS_PORT=19531 \
MILVUS_HEALTH_PORT=59091 \
docker compose `$ENV_ARGS -f deploy/docker-compose/compose.yml up -d \
  postgres redis minio-assets milvus-etcd milvus-minio milvus-standalone
"@
  Invoke-WslBash $openkbInfraCommand
}

if (-not $SkipProxy) {
  if (-not (Test-Path -LiteralPath $proxyEnv)) {
    throw "Proxy env file not found: $proxyEnv. Create it locally with DASHSCOPE_API_KEY and model settings."
  }
  $proxyEnvWsl = Convert-ToWslPath $proxyEnv
  Write-Host "Starting shared qwen3-vl proxy on http://localhost:$ProxyHostPort..."
  $proxyCommand = @"
set -euo pipefail
docker network inspect docker_default >/dev/null 2>&1 || docker network create docker_default >/dev/null
docker rm -f openkb-qwen3vl-proxy >/dev/null 2>&1 || true
docker run -d \
  --name openkb-qwen3vl-proxy \
  --restart unless-stopped \
  --network docker_default \
  -p 127.0.0.1:${ProxyHostPort}:8761 \
  --env-file $(Quote-Bash $proxyEnvWsl) \
  -v $(Quote-Bash "${proxyScriptWsl}:/app/proxy.py:ro") \
  python:3.12-slim \
  python /app/proxy.py
"@
  Invoke-WslBash $proxyCommand
  Wait-HttpOk "http://localhost:$ProxyHostPort/health"
}

if (-not $SkipDify) {
  Write-Host "Syncing Dify default DeepSeek model metadata for OpenKB local source mode..."
  try {
    & (Join-Path $PSScriptRoot "sync-dify-llm-local.ps1")
  } catch {
    Write-Warning "Could not sync Dify LLM metadata automatically: $($_.Exception.Message)"
  }
}

Write-Host "Checking exposed target endpoints..."
if (-not $SkipDify) {
  Wait-HttpOk "http://localhost:18080" 20
}
if (-not $SkipProxy) {
  Wait-HttpOk "http://localhost:$ProxyHostPort/health" 10
}

Write-Host ""
Write-Host "Docker Compose projects:"
Invoke-WslBash "docker compose ls"

Write-Host ""
Write-Host "OpenKB source development commands:"
Write-Host "  .\scripts\dev-api-local.ps1"
Write-Host "  .\scripts\dev-web-local.ps1"
Write-Host "  .\scripts\dev-import-worker-local.ps1"
Write-Host "  .\scripts\dev-index-worker-local.ps1"
Write-Host ""
Write-Host "OpenKB API will use qwen3-vl proxy at http://localhost:$ProxyHostPort when scripts/dev-api-local.ps1 is used."

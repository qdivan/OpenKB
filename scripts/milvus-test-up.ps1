$ErrorActionPreference = "Stop"

$pidDir = Join-Path (Resolve-Path ".") ".turbo"
$pidFile = Join-Path $pidDir "openkb-wsl-keepalive.pid"
$milvusPort = if ($env:OPENKB_MILVUS_TEST_PORT) { $env:OPENKB_MILVUS_TEST_PORT } else { "59530" }
$healthPort = if ($env:OPENKB_MILVUS_TEST_HEALTH_PORT) { $env:OPENKB_MILVUS_TEST_HEALTH_PORT } else { "59091" }

New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

$existingPid = if (Test-Path $pidFile) { Get-Content $pidFile -ErrorAction SilentlyContinue } else { $null }
$keepalive = if ($existingPid) { Get-Process -Id $existingPid -ErrorAction SilentlyContinue } else { $null }

if (-not $keepalive) {
  $process = Start-Process `
    -FilePath "wsl.exe" `
    -ArgumentList 'sh -lc "while true; do sleep 3600; done"' `
    -WindowStyle Hidden `
    -PassThru
  Set-Content -Path $pidFile -Value $process.Id
}

wsl sh -lc "mkdir -p /tmp/openkb-docker-config && printf '{}' > /tmp/openkb-docker-config/config.json && PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config OPENKB_MILVUS_TEST_PORT=$milvusPort OPENKB_MILVUS_TEST_HEALTH_PORT=$healthPort docker compose -f deploy/docker-compose/milvus.test.yml up -d"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to start openkb-milvus-test."
}

for ($i = 0; $i -lt 180; $i++) {
  wsl sh -lc "python3 - <<'PY'
import urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:$healthPort/healthz', timeout=1) as response:
        raise SystemExit(0 if response.status < 500 else 1)
except Exception:
    raise SystemExit(1)
PY"

  if ($LASTEXITCODE -eq 0) {
    Write-Host "openkb-milvus-test is healthy."
    exit 0
  }

  Start-Sleep -Seconds 1
}

wsl sh -lc "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config docker ps -a --filter name=openkb-milvus"
throw "openkb-milvus-test did not become healthy in time."

$ErrorActionPreference = "Stop"

$pidDir = Join-Path (Resolve-Path ".") ".turbo"
$pidFile = Join-Path $pidDir "openkb-wsl-keepalive.pid"

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

wsl sh -lc "mkdir -p /tmp/openkb-docker-config && printf '{}' > /tmp/openkb-docker-config/config.json && PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config docker compose -f deploy/docker-compose/minio.test.yml up -d"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to start openkb-minio-test."
}

for ($i = 0; $i -lt 60; $i++) {
  $status = wsl sh -lc "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config docker inspect -f '{{.State.Health.Status}}' openkb-minio-test 2>/dev/null"

  if ($LASTEXITCODE -eq 0 -and $status -eq "healthy") {
    Write-Host "openkb-minio-test is healthy."
    exit 0
  }

  Start-Sleep -Seconds 1
}

wsl sh -lc "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin DOCKER_CONFIG=/tmp/openkb-docker-config docker ps -a --filter name=openkb-minio-test"
throw "openkb-minio-test did not become healthy in time."

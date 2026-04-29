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

wsl docker compose -f deploy/docker-compose/postgres.test.yml up -d

for ($i = 0; $i -lt 60; $i++) {
  $status = wsl docker inspect -f "{{.State.Health.Status}}" openkb-postgres-test 2>$null

  if ($LASTEXITCODE -eq 0 -and $status -eq "healthy") {
    Write-Host "openkb-postgres-test is healthy."
    exit 0
  }

  Start-Sleep -Seconds 1
}

wsl docker ps -a --filter name=openkb-postgres-test
throw "openkb-postgres-test did not become healthy in time."

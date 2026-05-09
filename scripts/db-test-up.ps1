$ErrorActionPreference = "Stop"
. .\scripts\test-postgres-env.ps1

Set-OpenKBTestPostgresEnv

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

wsl env OPENKB_TEST_POSTGRES_PORT=$env:OPENKB_TEST_POSTGRES_PORT docker compose -f deploy/docker-compose/postgres.test.yml up -d
if ($LASTEXITCODE -ne 0) {
  throw "Unable to start openkb-postgres-test. Check whether localhost:$env:OPENKB_TEST_POSTGRES_PORT is already in use."
}

for ($i = 0; $i -lt 60; $i++) {
  $status = wsl docker inspect -f "{{.State.Health.Status}}" openkb-postgres-test 2>$null

  if ($LASTEXITCODE -eq 0 -and $status -eq "healthy") {
    Write-Host "openkb-postgres-test is healthy."
    $databaseExists = wsl docker exec openkb-postgres-test psql -U openkb -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='openkb_test';"
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to inspect openkb_test database."
    }

    if ($databaseExists.Trim() -ne "1") {
      Write-Host "Creating missing openkb_test database."
      wsl docker exec openkb-postgres-test createdb -U openkb openkb_test
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to create openkb_test database."
      }
    }
    exit 0
  }

  Start-Sleep -Seconds 1
}

wsl docker ps -a --filter name=openkb-postgres-test
throw "openkb-postgres-test did not become healthy in time."

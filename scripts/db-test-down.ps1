$ErrorActionPreference = "Stop"

wsl docker compose -f deploy/docker-compose/postgres.test.yml down -v

$pidFile = Join-Path (Resolve-Path ".") ".turbo\openkb-wsl-keepalive.pid"

if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  $keepalive = if ($existingPid) { Get-Process -Id $existingPid -ErrorAction SilentlyContinue } else { $null }

  if ($keepalive) {
    Stop-Process -Id $keepalive.Id -Force
  }

  Remove-Item -LiteralPath $pidFile -Force
}

param(
  [string]$OutputDir = $env:OPENKB_BACKUP_DIR
)

if (-not $OutputDir) { $OutputDir = Join-Path (Get-Location) "backups" }
if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDir "openkb-postgres-$stamp.sql"
pg_dump $env:DATABASE_URL --format=plain --no-owner --no-privileges --file $target
Write-Host "PostgreSQL backup written to $target"

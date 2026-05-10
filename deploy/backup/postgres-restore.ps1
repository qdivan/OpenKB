param(
  [Parameter(Mandatory = $true)][string]$DumpPath
)

if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required." }
if (-not (Test-Path $DumpPath)) { throw "Dump file not found: $DumpPath" }
psql $env:DATABASE_URL --file $DumpPath
Write-Host "PostgreSQL restore completed from $DumpPath"

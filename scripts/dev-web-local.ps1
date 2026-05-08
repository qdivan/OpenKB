$ErrorActionPreference = "Stop"

$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:4101"
$env:APP_BASE_URL = "http://localhost:3100"
$env:WEB_BASE_URL = "http://localhost:3100"

Write-Host "Starting OpenKB Web on http://localhost:3100"
Write-Host "Using API base URL: $env:NEXT_PUBLIC_API_BASE_URL"

pnpm --filter @openkb/web exec next dev --port 3100

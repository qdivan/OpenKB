$ErrorActionPreference = "Stop"

$env:PORT = "4101"
$env:APP_BASE_URL = "http://localhost:3100"
$env:WEB_BASE_URL = "http://localhost:3100"
$env:CORS_ORIGINS = "http://localhost:3100,http://127.0.0.1:3100,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"

Write-Host "Starting OpenKB API on http://localhost:4101"
Write-Host "Allowed web origins: $env:CORS_ORIGINS"

pnpm --filter @openkb/api dev

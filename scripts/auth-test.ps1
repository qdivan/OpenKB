$ErrorActionPreference = "Stop"

try {
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-test-up.ps1
  $env:DATABASE_URL = "postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
  pnpm db:migrate
  pnpm --filter @openkb/auth auth:test
} finally {
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db-test-down.ps1
}

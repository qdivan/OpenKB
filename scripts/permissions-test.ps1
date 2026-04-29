$ErrorActionPreference = "Stop"

try {
  pnpm db:test:up
  $env:DATABASE_URL = "postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public"
  pnpm db:migrate
  pnpm --filter @openkb/db build
  pnpm --filter @openkb/permissions permissions:test
} finally {
  pnpm db:test:down
}

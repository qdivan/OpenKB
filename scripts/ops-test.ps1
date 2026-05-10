$ErrorActionPreference = "Stop"
pnpm test packages/email/src/index.test.ts
if (Get-Command helm -ErrorAction SilentlyContinue) {
  helm template openkb deploy/helm/openkb | Out-Null
  Write-Host "Helm template rendered."
} else {
  Write-Host "helm not found; skipping Helm template render."
}

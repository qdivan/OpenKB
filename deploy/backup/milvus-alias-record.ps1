param(
  [string]$OutputDir = $env:OPENKB_BACKUP_DIR
)

if (-not $OutputDir) { $OutputDir = Join-Path (Get-Location) "backups" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDir "openkb-milvus-alias-$stamp.json"
@{
  uri = $env:MILVUS_URI
  activeAlias = $env:MILVUS_ACTIVE_ALIAS
  collectionPrefix = $env:MILVUS_COLLECTION_PREFIX
  recordedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Encoding UTF8 $target
Write-Host "Milvus alias record written to $target"

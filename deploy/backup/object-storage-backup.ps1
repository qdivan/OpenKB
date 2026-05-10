param(
  [string]$OutputDir = $env:OPENKB_BACKUP_DIR
)

if (-not $OutputDir) { $OutputDir = Join-Path (Get-Location) "backups" }
if (-not $env:S3_BUCKET) { throw "S3_BUCKET is required." }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$target = Join-Path $OutputDir "openkb-s3-$($env:S3_BUCKET)"
aws s3 sync "s3://$($env:S3_BUCKET)" $target --endpoint-url $env:S3_ENDPOINT
Write-Host "Object storage backup synced to $target"

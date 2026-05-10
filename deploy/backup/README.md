# OpenKB Backup and Restore

Phase 20 adds production-oriented backup entrypoints. These scripts are intentionally small wrappers so operators can plug them into their own scheduler or Kubernetes CronJob.

## Back up

```powershell
powershell -File deploy/backup/postgres-backup.ps1
powershell -File deploy/backup/object-storage-backup.ps1
powershell -File deploy/backup/milvus-alias-record.ps1
```

## Restore

```powershell
powershell -File deploy/backup/postgres-restore.ps1 -DumpPath .\backups\openkb.sql
```

Required environment:

- `DATABASE_URL`
- `OPENKB_BACKUP_DIR`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `MILVUS_URI`

Secrets must be supplied through the runtime environment or Kubernetes Secrets. Do not commit backup credentials.

# Docker Compose

This directory currently contains local integration-test compose files:

- `postgres.test.yml` for PostgreSQL.
- `minio.test.yml` for S3-compatible object storage.
- `milvus.test.yml` for Milvus standalone plus its etcd/MinIO dependencies.

The host does not need Docker installed. Use Docker from WSL2 Ubuntu through the root scripts such as `pnpm db:test:up`, `pnpm object-storage:test:up`, and `pnpm milvus:test:up`.

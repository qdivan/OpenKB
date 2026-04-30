# Docker Compose

This directory currently contains local integration-test compose files:

- `postgres.test.yml` for PostgreSQL.
- `minio.test.yml` for S3-compatible object storage.
- `milvus.test.yml` for Milvus standalone plus its etcd/MinIO dependencies.

The host does not need Docker installed. Use Docker from WSL2 Ubuntu through the root scripts such as `pnpm db:test:up`, `pnpm object-storage:test:up`, and `pnpm milvus:test:up`.

## CPU-only local defaults

The local test compose files are intentionally CPU-only. Milvus tests use BM25/text-only by default through:

```text
MILVUS_ENABLE_BM25=true
MILVUS_ENABLE_TEXT_EMBEDDING=false
MILVUS_ENABLE_RERANK=false
```

Do not enable TEXTEMBEDDING, RERANK, MinerU GPU workers, Qwen Embedding TEI, or Qwen Reranker vLLM on machines without NVIDIA GPU support. Optional model services must be deployed explicitly and are not started by OpenKB integration-test scripts.

OpenKB test scripts only manage the OpenKB test compose projects in this directory. They must not stop or prune unrelated Docker containers such as local Dify or SkillHub stacks.

Implement Milvus indexing foundation using Milvus Server 2.6+ native Functions.

Scope:
- packages/milvus
- create collection schema with:
  - id VARCHAR primary key
  - chunk_id VARCHAR regular field
  - tenant_id
  - workspace_id
  - knowledge_base_id
  - document_id
  - version_id
  - content_text VARCHAR
  - content_markdown VARCHAR
  - metadata JSON
  - access_principals ARRAY<VARCHAR>
  - dense vector field
  - sparse/BM25 field if supported by Milvus Function
- In v0.x set both id and chunk_id to string(document_chunks.id).
- Add TEXTEMBEDDING Function for compatible provider, preferably TEI for Qwen embeddings.
- Add BM25 Function for sparse retrieval where supported.
- Add RERANK/Model Ranker configuration where supported.
- Use active collection alias: openkb_chunks_active.
- Implement rebuild job:
  - read current document chunks from PostgreSQL
  - insert raw chunk text and metadata into new Milvus collection
  - let Milvus generate embeddings
  - load collection
  - health check
  - switch alias

Rules:
- Do not use chunk_id as Milvus primary key.
- Do not call embedding API from OpenKB directly.
- Do not store embedding/rerank API key in OpenKB database.
- Do not implement embedding/rerank fallback provider secrets in OpenKB DB.
- Do not allow knowledge base owner to configure models.
- Only admin can trigger global reindex.
- PostgreSQL final permission check remains mandatory after Milvus retrieval.

ALTER TABLE document_chunks
  ADD COLUMN index_role text NOT NULL DEFAULT 'content',
  ADD COLUMN source_chunk_id uuid NULL REFERENCES document_chunks(id) ON DELETE SET NULL;

ALTER TABLE document_chunks
  ADD CONSTRAINT document_chunks_index_role_check
    CHECK (index_role IN ('content', 'summary'));

CREATE INDEX document_chunks_index_role_idx ON document_chunks(index_role);
CREATE INDEX document_chunks_source_chunk_id_idx ON document_chunks(source_chunk_id);

ALTER TABLE document_qa_pairs
  ADD COLUMN source_chunk_id uuid NULL REFERENCES document_chunks(id) ON DELETE SET NULL;

CREATE INDEX document_qa_pairs_source_chunk_id_idx ON document_qa_pairs(source_chunk_id);

CREATE TABLE document_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL,
  document_id uuid NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_summaries_document_unique UNIQUE (document_id),
  CONSTRAINT document_summaries_status_check CHECK (status IN ('active', 'disabled', 'deleted'))
);

CREATE INDEX document_summaries_tenant_idx ON document_summaries(tenant_id);
CREATE INDEX document_summaries_workspace_idx ON document_summaries(workspace_id);
CREATE INDEX document_summaries_kb_idx ON document_summaries(knowledge_base_id);
CREATE INDEX document_summaries_document_idx ON document_summaries(document_id);
CREATE INDEX document_summaries_status_idx ON document_summaries(status);

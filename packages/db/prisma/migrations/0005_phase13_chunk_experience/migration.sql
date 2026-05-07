CREATE TABLE knowledge_base_chunk_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid UNIQUE NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'parent_child' CHECK (mode IN ('general', 'parent_child')),
  parent_mode text NOT NULL DEFAULT 'paragraph' CHECK (parent_mode IN ('paragraph', 'full_doc')),
  parent_delimiter text NOT NULL DEFAULT E'\n\n',
  child_delimiter text NOT NULL DEFAULT E'\n\n',
  parent_max_characters int NOT NULL DEFAULT 4000 CHECK (parent_max_characters BETWEEN 200 AND 65535),
  child_max_characters int NOT NULL DEFAULT 900 CHECK (child_max_characters BETWEEN 100 AND 65535),
  child_overlap_characters int NOT NULL DEFAULT 120 CHECK (child_overlap_characters >= 0),
  revision int NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (child_overlap_characters < child_max_characters)
);

CREATE INDEX knowledge_base_chunk_settings_tenant_id_idx
  ON knowledge_base_chunk_settings(tenant_id);
CREATE INDEX knowledge_base_chunk_settings_workspace_id_idx
  ON knowledge_base_chunk_settings(workspace_id);

ALTER TABLE document_chunks
  ADD COLUMN chunk_type text NOT NULL DEFAULT 'general',
  ADD COLUMN parent_chunk_id uuid NULL REFERENCES document_chunks(id) ON DELETE SET NULL,
  ADD COLUMN settings_revision int NOT NULL DEFAULT 1,
  ADD COLUMN start_line int NULL,
  ADD COLUMN end_line int NULL,
  ADD COLUMN start_char int NULL,
  ADD COLUMN end_char int NULL,
  ADD COLUMN parent_ordinal int NULL,
  ADD COLUMN child_ordinal int NULL,
  ADD CONSTRAINT document_chunks_chunk_type_check CHECK (chunk_type IN ('general', 'parent', 'child')),
  ADD CONSTRAINT document_chunks_settings_revision_check CHECK (settings_revision > 0);

UPDATE document_chunks
SET
  start_line = NULLIF((metadata->>'start_line')::int, 0),
  end_line = NULLIF((metadata->>'end_line')::int, 0)
WHERE metadata ? 'start_line' OR metadata ? 'end_line';

CREATE INDEX document_chunks_parent_chunk_id_idx ON document_chunks(parent_chunk_id);
CREATE INDEX document_chunks_chunk_type_idx ON document_chunks(chunk_type);

CREATE TABLE chunk_rebuild_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  settings_revision int NOT NULL CHECK (settings_revision > 0),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL
);

CREATE INDEX chunk_rebuild_jobs_tenant_id_idx ON chunk_rebuild_jobs(tenant_id);
CREATE INDEX chunk_rebuild_jobs_workspace_id_idx ON chunk_rebuild_jobs(workspace_id);
CREATE INDEX chunk_rebuild_jobs_knowledge_base_id_idx ON chunk_rebuild_jobs(knowledge_base_id);
CREATE INDEX chunk_rebuild_jobs_status_idx ON chunk_rebuild_jobs(status);

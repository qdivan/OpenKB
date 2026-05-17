ALTER TABLE document_chunks
  DROP CONSTRAINT IF EXISTS document_chunks_index_role_check;

ALTER TABLE document_chunks
  ADD CONSTRAINT document_chunks_index_role_check
    CHECK (index_role IN ('content', 'summary', 'asset_image', 'asset_attachment'));

CREATE TABLE document_asset_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  asset_id uuid NULL REFERENCES document_assets(id) ON DELETE CASCADE,
  kind text NOT NULL,
  alt_text text NULL,
  caption text NULL,
  filename text NULL,
  mime_type text NULL,
  size_bytes bigint NULL,
  checksum_sha256 text NULL,
  raw_url text NOT NULL,
  external_url text NULL,
  start_line int NULL,
  end_line int NULL,
  start_char int NULL,
  end_char int NULL,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_asset_bindings_kind_check
    CHECK (kind IN ('image', 'attachment', 'external_image')),
  CONSTRAINT document_asset_bindings_status_check
    CHECK (status IN ('active', 'disabled', 'deleted')),
  CONSTRAINT document_asset_bindings_asset_or_external_check
    CHECK (
      (asset_id IS NOT NULL AND external_url IS NULL)
      OR (asset_id IS NULL AND external_url IS NOT NULL)
    )
);

CREATE INDEX document_asset_bindings_tenant_id_idx ON document_asset_bindings(tenant_id);
CREATE INDEX document_asset_bindings_workspace_id_idx ON document_asset_bindings(workspace_id);
CREATE INDEX document_asset_bindings_knowledge_base_id_idx ON document_asset_bindings(knowledge_base_id);
CREATE INDEX document_asset_bindings_document_id_idx ON document_asset_bindings(document_id);
CREATE INDEX document_asset_bindings_version_id_idx ON document_asset_bindings(version_id);
CREATE INDEX document_asset_bindings_chunk_id_idx ON document_asset_bindings(chunk_id);
CREATE INDEX document_asset_bindings_asset_id_idx ON document_asset_bindings(asset_id);
CREATE INDEX document_asset_bindings_kind_idx ON document_asset_bindings(kind);
CREATE INDEX document_asset_bindings_status_idx ON document_asset_bindings(status);

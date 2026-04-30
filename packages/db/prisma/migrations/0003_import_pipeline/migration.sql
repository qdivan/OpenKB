ALTER TABLE document_assets
  ADD COLUMN filename text,
  ADD COLUMN checksum_sha256 text NULL,
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'openkb-assets',
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';

UPDATE document_assets
SET filename = object_key
WHERE filename IS NULL;

ALTER TABLE document_assets
  ALTER COLUMN filename SET NOT NULL;

CREATE INDEX document_assets_checksum_sha256_idx ON document_assets(checksum_sha256);

ALTER TABLE import_jobs
  ADD COLUMN parent_id uuid NULL REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN title text NULL,
  ADD COLUMN document_id uuid NULL REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN output_version_id uuid NULL REFERENCES document_versions(id) ON DELETE SET NULL,
  ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN finished_at timestamptz NULL;

CREATE INDEX import_jobs_status_idx ON import_jobs(status);
CREATE INDEX import_jobs_document_id_idx ON import_jobs(document_id);

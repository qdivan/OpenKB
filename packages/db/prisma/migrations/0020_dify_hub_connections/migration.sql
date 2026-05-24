CREATE TABLE dify_hub_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  dify_base_url text NOT NULL,
  encrypted_service_api_token text NOT NULL,
  service_api_token_last4 text,
  status text NOT NULL DEFAULT 'active',
  last_probe_status text,
  last_probe_error text,
  last_probe_at timestamptz,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dify_hub_connections_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT dify_hub_connections_base_url_check CHECK (length(btrim(dify_base_url)) > 0)
);

CREATE INDEX dify_hub_connections_tenant_idx ON dify_hub_connections(tenant_id);

ALTER TABLE dify_knowledge_mappings
  ADD COLUMN dify_dataset_id text,
  ADD COLUMN dify_dataset_name text,
  ADD COLUMN dify_external_api_id text,
  ADD COLUMN dify_external_api_name text,
  ADD COLUMN dify_endpoint text,
  ADD COLUMN last_metadata_synced_at timestamptz,
  ADD COLUMN last_sync_status text,
  ADD COLUMN last_sync_error text;

CREATE INDEX dify_knowledge_mappings_dataset_idx
  ON dify_knowledge_mappings(tenant_id, dify_dataset_id);

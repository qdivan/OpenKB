CREATE TABLE retrieval_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (
    mode IN ('bm25', 'dense', 'dense_rerank', 'hybrid', 'hybrid_rerank')
  ),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE UNIQUE INDEX retrieval_settings_single_instance_default_idx
  ON retrieval_settings ((1))
  WHERE tenant_id IS NULL;

CREATE INDEX retrieval_settings_tenant_id_idx ON retrieval_settings(tenant_id);

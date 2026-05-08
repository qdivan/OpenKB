CREATE TABLE model_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  kind text NOT NULL,
  provider text NOT NULL DEFAULT 'openai_compatible',
  endpoint text NULL,
  model text NULL,
  enabled boolean NOT NULL DEFAULT false,
  timeout_ms integer NULL,
  embedding_dim integer NULL,
  embedding_batch_size integer NULL,
  llm_temperature double precision NULL,
  llm_max_output_tokens integer NULL,
  encrypted_api_key text NULL,
  api_key_last4 text NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_settings_kind_unique UNIQUE (kind),
  CONSTRAINT model_settings_instance_only_check CHECK (tenant_id IS NULL),
  CONSTRAINT model_settings_kind_check CHECK (kind IN ('embedding', 'rerank', 'language')),
  CONSTRAINT model_settings_provider_check CHECK (provider IN ('openai', 'openai_compatible')),
  CONSTRAINT model_settings_timeout_check CHECK (
    timeout_ms IS NULL OR (timeout_ms >= 1000 AND timeout_ms <= 600000)
  ),
  CONSTRAINT model_settings_embedding_dim_check CHECK (
    embedding_dim IS NULL OR (embedding_dim > 0 AND embedding_dim <= 65536)
  ),
  CONSTRAINT model_settings_embedding_batch_size_check CHECK (
    embedding_batch_size IS NULL OR (embedding_batch_size > 0 AND embedding_batch_size <= 2048)
  ),
  CONSTRAINT model_settings_llm_temperature_check CHECK (
    llm_temperature IS NULL OR (llm_temperature >= 0 AND llm_temperature <= 2)
  ),
  CONSTRAINT model_settings_llm_max_output_tokens_check CHECK (
    llm_max_output_tokens IS NULL OR (llm_max_output_tokens > 0 AND llm_max_output_tokens <= 200000)
  ),
  CONSTRAINT model_settings_api_key_last4_check CHECK (
    api_key_last4 IS NULL OR char_length(api_key_last4) <= 8
  )
);

CREATE INDEX model_settings_tenant_id_idx ON model_settings(tenant_id);

ALTER TABLE dify_api_keys
  ADD COLUMN encrypted_key text NULL,
  ADD COLUMN api_key_last4 text NULL;

ALTER TABLE dify_api_keys
  ADD CONSTRAINT dify_api_keys_api_key_last4_check
  CHECK (api_key_last4 IS NULL OR char_length(api_key_last4) <= 8);

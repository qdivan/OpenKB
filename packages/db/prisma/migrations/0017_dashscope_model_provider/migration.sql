ALTER TABLE model_settings
  DROP CONSTRAINT IF EXISTS model_settings_provider_kind_check;

ALTER TABLE model_settings
  DROP CONSTRAINT IF EXISTS model_settings_provider_check;

ALTER TABLE model_settings
  ADD CONSTRAINT model_settings_provider_check
  CHECK (provider IN (
    'openai_compatible',
    'dashscope',
    'openai_responses',
    'openai_chat_completions',
    'anthropic_messages'
  ));

ALTER TABLE model_settings
  ADD CONSTRAINT model_settings_provider_kind_check
  CHECK (
    (
      kind IN ('embedding', 'rerank')
      AND provider IN ('openai_compatible', 'dashscope')
    )
    OR
    (
      kind = 'language'
      AND provider IN ('openai_responses', 'openai_chat_completions', 'anthropic_messages')
    )
  );

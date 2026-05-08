ALTER TABLE model_settings
  DROP CONSTRAINT IF EXISTS model_settings_provider_check;

UPDATE model_settings
SET provider = 'openai_responses'
WHERE kind = 'language' AND provider = 'openai';

UPDATE model_settings
SET provider = 'openai_compatible'
WHERE kind IN ('embedding', 'rerank') AND provider = 'openai';

ALTER TABLE model_settings
  ADD CONSTRAINT model_settings_provider_check
  CHECK (provider IN (
    'openai_compatible',
    'openai_responses',
    'openai_chat_completions',
    'anthropic_messages'
  ));

ALTER TABLE model_settings
  ADD CONSTRAINT model_settings_provider_kind_check
  CHECK (
    (kind IN ('embedding', 'rerank') AND provider = 'openai_compatible')
    OR
    (
      kind = 'language'
      AND provider IN ('openai_responses', 'openai_chat_completions', 'anthropic_messages')
    )
  );

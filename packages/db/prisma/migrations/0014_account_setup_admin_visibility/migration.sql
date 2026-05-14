ALTER TABLE auth_tokens
  DROP CONSTRAINT IF EXISTS auth_tokens_purpose_check;

ALTER TABLE auth_tokens
  ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('email_verification', 'password_reset', 'account_setup'));

ALTER TABLE auth_email_outbox
  DROP CONSTRAINT IF EXISTS auth_email_outbox_template_check;

ALTER TABLE auth_email_outbox
  ADD CONSTRAINT auth_email_outbox_template_check
  CHECK (template IN ('email_verification', 'password_reset', 'account_setup'));

ALTER TABLE collaborators
  DROP CONSTRAINT IF EXISTS collaborators_source_check;

ALTER TABLE collaborators
  ADD CONSTRAINT collaborators_source_check
  CHECK (source IN ('direct', 'invitation', 'system', 'transfer', 'admin_takeover'));

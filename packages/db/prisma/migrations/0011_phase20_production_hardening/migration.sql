CREATE TABLE smtp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'instance',
  enabled boolean NOT NULL DEFAULT false,
  host text NULL,
  port integer NULL,
  secure boolean NOT NULL DEFAULT true,
  username text NULL,
  from_email text NULL,
  reply_to text NULL,
  encrypted_password text NULL,
  password_last4 text NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smtp_settings_scope_unique UNIQUE (scope),
  CONSTRAINT smtp_settings_instance_scope_check CHECK (scope = 'instance'),
  CONSTRAINT smtp_settings_port_check CHECK (port IS NULL OR (port > 0 AND port <= 65535)),
  CONSTRAINT smtp_settings_password_last4_check
    CHECK (password_last4 IS NULL OR char_length(password_last4) <= 8)
);

ALTER TABLE auth_email_outbox
  ADD COLUMN IF NOT EXISTS error text NULL,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NULL;

ALTER TABLE mcp_oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS code_challenge text NULL,
  ADD COLUMN IF NOT EXISTS code_challenge_method text NULL,
  ADD COLUMN IF NOT EXISTS resource text NULL;


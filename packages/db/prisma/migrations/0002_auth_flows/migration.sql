CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_tenant_id_idx ON auth_sessions(tenant_id);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_tenant_id_idx ON auth_tokens(tenant_id);
CREATE INDEX auth_tokens_user_id_idx ON auth_tokens(user_id);
CREATE INDEX auth_tokens_purpose_idx ON auth_tokens(purpose);

CREATE TABLE auth_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  template text NOT NULL CHECK (template IN ('email_verification', 'password_reset')),
  subject text NOT NULL,
  link_url text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_email_outbox_tenant_id_idx ON auth_email_outbox(tenant_id);
CREATE INDEX auth_email_outbox_user_id_idx ON auth_email_outbox(user_id);
CREATE INDEX auth_email_outbox_to_email_idx ON auth_email_outbox(to_email);

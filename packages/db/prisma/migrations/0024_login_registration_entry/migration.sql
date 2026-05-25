ALTER TABLE auth_settings
  ADD COLUMN IF NOT EXISTS login_registration_enabled boolean NOT NULL DEFAULT true;

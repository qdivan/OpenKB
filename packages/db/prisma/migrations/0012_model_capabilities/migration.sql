ALTER TABLE model_settings
  ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN capabilities_detected_at timestamptz NULL;

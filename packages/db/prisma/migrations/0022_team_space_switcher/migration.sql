ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS avatar_color TEXT,
  ADD COLUMN IF NOT EXISTS avatar_initials TEXT;

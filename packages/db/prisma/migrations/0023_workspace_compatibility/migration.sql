UPDATE workspaces
SET
  kind = 'team',
  personal_owner_user_id = NULL,
  avatar_color = COALESCE(avatar_color, '#0284C7'),
  avatar_initials = COALESCE(avatar_initials, 'DW'),
  updated_at = now()
WHERE slug = 'default-workspace';

UPDATE workspaces
SET
  avatar_color = COALESCE(avatar_color, '#059669'),
  avatar_initials = COALESCE(
    avatar_initials,
    NULLIF(upper(left(regexp_replace(name, '[^[:alnum:]]', '', 'g'), 2)), ''),
    'SP'
  )
WHERE avatar_color IS NULL OR avatar_initials IS NULL;

CREATE TABLE import_tool_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL,
  endpoint text NULL,
  command text NULL,
  timeout_ms integer NULL,
  max_file_mb integer NULL,
  encrypted_api_key text NULL,
  api_key_last4 text NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_tool_settings_tool_key_check
    CHECK (tool_key IN ('markitdown', 'mineru', 'pandoc', 'tesseract_ocr')),
  CONSTRAINT import_tool_settings_mode_check
    CHECK (mode IN ('local_cli', 'http_api')),
  CONSTRAINT import_tool_settings_timeout_check
    CHECK (timeout_ms IS NULL OR timeout_ms BETWEEN 1000 AND 600000),
  CONSTRAINT import_tool_settings_max_file_mb_check
    CHECK (max_file_mb IS NULL OR max_file_mb BETWEEN 1 AND 2048),
  CONSTRAINT import_tool_settings_api_key_last4_check
    CHECK (api_key_last4 IS NULL OR char_length(api_key_last4) <= 8),
  CONSTRAINT import_tool_settings_options_object_check
    CHECK (jsonb_typeof(options) = 'object')
);

CREATE TABLE import_format_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  primary_tool text NOT NULL,
  fallback_tools text[] NOT NULL DEFAULT '{}',
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_format_routes_format_check
    CHECK (format IN ('pdf', 'docx', 'pptx', 'xlsx', 'image')),
  CONSTRAINT import_format_routes_primary_tool_check
    CHECK (primary_tool IN ('markitdown', 'mineru', 'pandoc', 'tesseract_ocr')),
  CONSTRAINT import_format_routes_fallback_tools_check
    CHECK (fallback_tools <@ ARRAY['markitdown', 'mineru', 'pandoc', 'tesseract_ocr']::text[])
);

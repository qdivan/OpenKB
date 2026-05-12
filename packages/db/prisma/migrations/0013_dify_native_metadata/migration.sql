CREATE TABLE knowledge_base_metadata_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_base_metadata_fields_type_check CHECK (type IN ('string', 'number', 'time')),
  CONSTRAINT knowledge_base_metadata_fields_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT knowledge_base_metadata_fields_name_check CHECK (
    length(btrim(name)) > 0
    AND position('.' IN name) = 0
    AND lower(name) NOT LIKE 'openkb_%'
  ),
  CONSTRAINT knowledge_base_metadata_fields_unique_name UNIQUE (knowledge_base_id, name)
);

CREATE INDEX knowledge_base_metadata_fields_tenant_idx ON knowledge_base_metadata_fields(tenant_id);
CREATE INDEX knowledge_base_metadata_fields_workspace_idx ON knowledge_base_metadata_fields(workspace_id);
CREATE INDEX knowledge_base_metadata_fields_kb_idx ON knowledge_base_metadata_fields(knowledge_base_id);

CREATE TABLE document_metadata_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES knowledge_base_metadata_fields(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_metadata_values_unique_field UNIQUE (document_id, field_id)
);

CREATE INDEX document_metadata_values_tenant_idx ON document_metadata_values(tenant_id);
CREATE INDEX document_metadata_values_workspace_idx ON document_metadata_values(workspace_id);
CREATE INDEX document_metadata_values_kb_idx ON document_metadata_values(knowledge_base_id);
CREATE INDEX document_metadata_values_field_idx ON document_metadata_values(field_id);

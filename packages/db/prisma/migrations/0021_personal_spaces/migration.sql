ALTER TABLE workspaces
  ADD COLUMN kind text NOT NULL DEFAULT 'team',
  ADD COLUMN personal_owner_user_id uuid REFERENCES users(id);

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('personal', 'team')),
  ADD CONSTRAINT workspaces_personal_owner_check CHECK (
    (kind = 'personal' AND personal_owner_user_id IS NOT NULL)
    OR (kind = 'team' AND personal_owner_user_id IS NULL)
  );

CREATE UNIQUE INDEX workspaces_personal_owner_unique_idx
  ON workspaces(tenant_id, personal_owner_user_id)
  WHERE kind = 'personal' AND personal_owner_user_id IS NOT NULL;

CREATE INDEX workspaces_kind_idx ON workspaces(kind);
CREATE INDEX workspaces_personal_owner_idx ON workspaces(personal_owner_user_id);

CREATE TABLE document_user_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  activity_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_user_activities_type_check CHECK (activity_type IN ('view')),
  CONSTRAINT document_user_activities_count_check CHECK (activity_count >= 1)
);

CREATE UNIQUE INDEX document_user_activities_unique_idx
  ON document_user_activities(tenant_id, user_id, document_id, activity_type);

CREATE INDEX document_user_activities_tenant_idx ON document_user_activities(tenant_id);
CREATE INDEX document_user_activities_user_idx ON document_user_activities(user_id);
CREATE INDEX document_user_activities_workspace_idx ON document_user_activities(workspace_id);
CREATE INDEX document_user_activities_kb_idx ON document_user_activities(knowledge_base_id);
CREATE INDEX document_user_activities_document_idx ON document_user_activities(document_id);
CREATE INDEX document_user_activities_type_last_idx
  ON document_user_activities(activity_type, last_activity_at);

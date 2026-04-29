Implement Phase 1 database schema and auth foundations.

Scope:
- users
- tenants
- tenant_memberships
- auth_settings
- workspaces
- workspace_members
- groups
- group_members
- knowledge_bases
- documents
- document_versions
- collaborators
- invitations
- share_links
- document_assets
- import_jobs
- document_chunks
- audit_logs
- milvus_index_profiles
- index_rebuild_jobs
- mcp_oauth_clients
- mcp_oauth_grants
- mcp_oauth_authorization_codes
- mcp_oauth_refresh_tokens
- mcp_personal_access_tokens
- dify_api_keys
- dify_knowledge_mappings

Rules:
- Follow docs/05-permission-spec.zh-CN.md.
- Follow docs/07-data-model.zh-CN.md exactly for role constraints.
- Do not add LDAP/OpenFGA/Casbin/OPA.
- Do not add model config per knowledge base.
- Do not store embedding/rerank API keys in OpenKB DB.
- Use PostgreSQL as permission truth.
- Workspace roles are owner/admin/member/guest and live in workspace_members.
- Content collaborator roles are owner/manager/editor/viewer and live in collaborators.
- share_links.permission must be constrained to view only.

Deliver:
- Migration files.
- Type-safe database models.
- Basic seed script for first admin user.
- Minimal tests for constraints.

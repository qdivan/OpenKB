Implement the Yuque-style permission service.

Scope:
- canReadDocument
- canEditDocument
- canManageDocument
- canManageKnowledgeBase
- canInviteCollaborator
- canCreateShareLink
- resolveEffectiveRole
- resolveWorkspaceRole
- resolveReadablePrincipalsForMilvus

Rules:
- Match docs/05-permission-spec.zh-CN.md.
- Workspace roles are owner/admin/member/guest and are stored in workspace_members.
- Content roles are owner/manager/editor/viewer and are stored in collaborators.
- Workspace invitations write workspace_members and can grant admin/member/guest only.
- Knowledge base/document invitations write collaborators and can grant manager/editor/viewer only.
- Ordinary invitations do not grant owner.
- Support workspace, knowledge base, folder, document inheritance.
- Support direct collaborators, invitation acceptance, share links.
- No explicit deny in v0.1.
- No LDAP/OpenFGA/Casbin.

Add unit tests covering:
- workspace member can access workspace-visible knowledge base
- workspace guest cannot access workspace-visible knowledge base unless directly invited
- workspace admin does not automatically read private knowledge base
- private knowledge base only collaborators can access
- document custom permission overrides inheritance
- removed collaborator loses access
- workspace invitation role constraints
- content invitation role constraints
- MCP search principals only include current user's allowed scopes

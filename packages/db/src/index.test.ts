import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_PURPOSES,
  CONTENT_INVITATION_ROLES,
  CONTENT_ROLES,
  classifyWorkspaceForMigration,
  databaseStatus,
  DOCUMENT_QA_PAIR_SOURCES,
  DOCUMENT_PROCESSING_STATUSES,
  DOCUMENT_SEGMENT_STATUSES,
  formatWorkspaceMigrationReportMarkdown,
  KNOWLEDGE_BASE_DOC_FORMS,
  KNOWLEDGE_BASE_INDEXING_TECHNIQUES,
  KNOWLEDGE_BASE_PROCESS_RULE_MODES,
  SHARE_LINK_PERMISSION,
  WORKSPACE_INVITATION_ROLES,
  WORKSPACE_ROLES
} from "./index";

describe("@openkb/db public constants", () => {
  it("keeps v0.3.3 role boundaries explicit", () => {
    expect(databaseStatus.migrationsImplemented).toBe(true);
    expect(WORKSPACE_ROLES).toEqual(["owner", "admin", "member", "guest"]);
    expect(CONTENT_ROLES).toEqual(["owner", "manager", "editor", "viewer"]);
    expect(AUTH_TOKEN_PURPOSES).toEqual(["email_verification", "password_reset", "account_setup"]);
    expect(WORKSPACE_INVITATION_ROLES).toEqual(["admin", "member", "guest"]);
    expect(CONTENT_INVITATION_ROLES).toEqual(["manager", "editor", "viewer"]);
    expect(SHARE_LINK_PERMISSION).toBe("view");
    expect(KNOWLEDGE_BASE_DOC_FORMS).toEqual(["text_model", "hierarchical_model", "qa_model"]);
    expect(KNOWLEDGE_BASE_INDEXING_TECHNIQUES).toEqual(["economy", "high_quality"]);
    expect(KNOWLEDGE_BASE_PROCESS_RULE_MODES).toEqual(["automatic", "custom", "hierarchical"]);
    expect(DOCUMENT_PROCESSING_STATUSES).toEqual([
      "current",
      "needs_reprocess",
      "processing",
      "failed"
    ]);
    expect(DOCUMENT_SEGMENT_STATUSES).toEqual(["active", "disabled", "deleted"]);
    expect(DOCUMENT_QA_PAIR_SOURCES).toEqual(["manual", "csv", "llm", "mock"]);
  });

  it("classifies workspace migration candidates without reading document content", () => {
    const personal = classifyWorkspaceForMigration(
      workspaceFixture({
        name: "Alice Notes",
        slug: "alice-notes",
        member_counts: { owner: 1, admin: 0, member: 0, guest: 0, total: 1 },
        owner_user_ids: ["user-1"],
        created_by: "user-1",
        knowledge_base_counts: { private: 2, workspace: 0, public: 0, demo_named: 0, total: 2 }
      })
    );
    const team = classifyWorkspaceForMigration(
      workspaceFixture({
        name: "Default Workspace",
        slug: "default-workspace",
        member_counts: { owner: 1, admin: 1, member: 1, guest: 0, total: 3 },
        knowledge_base_counts: { private: 0, workspace: 1, public: 0, demo_named: 1, total: 1 }
      })
    );
    const review = classifyWorkspaceForMigration(
      workspaceFixture({
        name: "Orphaned Space",
        slug: "orphaned-space",
        created_by_exists: false,
        member_counts: { owner: 0, admin: 0, member: 0, guest: 0, total: 0 }
      })
    );

    expect(personal.suggested_kind).toBe("personal_candidate");
    expect(personal.confidence).toBe("high");
    expect(team.suggested_kind).toBe("team_candidate");
    expect(team.is_default_workspace).toBe(true);
    expect(review.suggested_kind).toBe("needs_review");
    expect(review.reasons).toContain("workspace has no members");
  });

  it("renders a migration report summary without secret or body fields", () => {
    const rendered = formatWorkspaceMigrationReportMarkdown({
      generated_at: "2026-05-24T00:00:00.000Z",
      summary: { total: 1, team_candidate: 1, personal_candidate: 0, needs_review: 0 },
      workspaces: [
        classifyWorkspaceForMigration(
          workspaceFixture({
            name: "OpenKB Demo",
            slug: "default-workspace",
            member_counts: { owner: 1, admin: 1, member: 0, guest: 0, total: 2 },
            knowledge_base_counts: { private: 0, workspace: 1, public: 0, demo_named: 1, total: 1 }
          })
        )
      ]
    });

    expect(rendered).toContain("OpenKB Workspace Migration Report");
    expect(rendered).toContain("team_candidate");
    expect(rendered).not.toContain("markdown");
    expect(rendered).not.toContain("token");
    expect(rendered).not.toContain("encrypted");
  });
});

function workspaceFixture(
  patch: Partial<Parameters<typeof classifyWorkspaceForMigration>[0]>
): Parameters<typeof classifyWorkspaceForMigration>[0] {
  return {
    id: "workspace-1",
    tenant_id: "tenant-1",
    name: "Workspace",
    slug: "workspace",
    kind: "team",
    personal_owner_user_id: null,
    created_by: "user-1",
    member_counts: { owner: 1, admin: 0, member: 0, guest: 0, total: 1 },
    owner_user_ids: ["user-1"],
    created_by_exists: true,
    knowledge_base_counts: { private: 0, workspace: 0, public: 0, demo_named: 0, total: 0 },
    document_counts: { page: 0, folder: 0, total: 0 },
    owner_has_other_personal_workspace: false,
    ...patch
  };
}

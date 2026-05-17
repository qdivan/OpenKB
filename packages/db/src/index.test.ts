import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_PURPOSES,
  CONTENT_INVITATION_ROLES,
  CONTENT_ROLES,
  databaseStatus,
  DOCUMENT_QA_PAIR_SOURCES,
  DOCUMENT_PROCESSING_STATUSES,
  DOCUMENT_SEGMENT_STATUSES,
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
});

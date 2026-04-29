import { describe, expect, it } from "vitest";

import {
  AUTH_TOKEN_PURPOSES,
  CONTENT_INVITATION_ROLES,
  CONTENT_ROLES,
  databaseStatus,
  SHARE_LINK_PERMISSION,
  WORKSPACE_INVITATION_ROLES,
  WORKSPACE_ROLES
} from "./index";

describe("@openkb/db public constants", () => {
  it("keeps v0.3.3 role boundaries explicit", () => {
    expect(databaseStatus.migrationsImplemented).toBe(true);
    expect(WORKSPACE_ROLES).toEqual(["owner", "admin", "member", "guest"]);
    expect(CONTENT_ROLES).toEqual(["owner", "manager", "editor", "viewer"]);
    expect(AUTH_TOKEN_PURPOSES).toEqual(["email_verification", "password_reset"]);
    expect(WORKSPACE_INVITATION_ROLES).toEqual(["admin", "member", "guest"]);
    expect(CONTENT_INVITATION_ROLES).toEqual(["manager", "editor", "viewer"]);
    expect(SHARE_LINK_PERMISSION).toBe("view");
  });
});

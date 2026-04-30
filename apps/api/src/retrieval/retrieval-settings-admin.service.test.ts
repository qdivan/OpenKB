import { AuthService } from "@openkb/auth";
import { describe, expect, it } from "vitest";

import { RetrievalSettingsAdminService } from "./retrieval-settings-admin.service";

describe("RetrievalSettingsAdminService", () => {
  it("blocks non-admin sessions before retrieval settings operations", async () => {
    process.env.DATABASE_URL ??=
      "postgresql://openkb:openkb@localhost:55432/openkb_test?schema=public";
    const auth = {
      getMe: async () => ({
        user: {
          id: "user-id",
          email: "member@example.com",
          displayName: "Member",
          status: "active",
          emailVerifiedAt: null
        },
        tenantId: "tenant-id",
        roles: ["member"]
      })
    } as unknown as AuthService;
    const service = new RetrievalSettingsAdminService(auth);

    await expect(service.getStatus("session")).rejects.toMatchObject({
      code: "ADMIN_REQUIRED",
      statusCode: 403
    });

    await service.disconnect();
  });
});

import { AuthService } from "@openkb/auth";
import { describe, expect, it } from "vitest";

import { MilvusAdminService } from "./milvus-admin.service";

describe("MilvusAdminService", () => {
  it("blocks non-admin sessions before Milvus or profile operations", async () => {
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
    const service = new MilvusAdminService(auth);

    await expect(service.listProfiles("session")).rejects.toMatchObject({
      code: "ADMIN_REQUIRED",
      statusCode: 403
    });

    await service.disconnect();
  });
});

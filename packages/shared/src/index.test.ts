import { describe, expect, it } from "vitest";

import { createServiceHealth, OPENKB_PHASE, OPENKB_PROJECT_NAME } from "./index";

describe("@openkb/shared", () => {
  it("creates a stable scaffold health payload", () => {
    const health = createServiceHealth("smoke");

    expect(OPENKB_PROJECT_NAME).toBe("OpenKB");
    expect(OPENKB_PHASE).toBe("phase-17-admin-ops");
    expect(health.status).toBe("ok");
    expect(health.service).toBe("smoke");
  });
});

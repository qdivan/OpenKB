import { describe, expect, it } from "vitest";

import { getApiHealth } from "./health";

describe("@openkb/api health", () => {
  it("returns a scaffold health payload", () => {
    expect(getApiHealth()).toMatchObject({
      status: "ok",
      service: "openkb-api",
      phase: "phase-31-workspace-compatibility"
    });
  });
});

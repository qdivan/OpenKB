import { describe, expect, it } from "vitest";

import { getIndexWorkerHealth } from "./health";

describe("@openkb/index-worker health", () => {
  it("returns a scaffold health payload", () => {
    expect(getIndexWorkerHealth()).toMatchObject({
      status: "ok",
      service: "openkb-index-worker"
    });
  });
});

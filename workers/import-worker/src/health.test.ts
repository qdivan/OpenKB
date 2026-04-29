import { describe, expect, it } from "vitest";

import { getImportWorkerHealth } from "./health";

describe("@openkb/import-worker health", () => {
  it("returns a scaffold health payload", () => {
    expect(getImportWorkerHealth()).toMatchObject({
      status: "ok",
      service: "openkb-import-worker"
    });
  });
});

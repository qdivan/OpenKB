import { describe, expect, it } from "vitest";

import { getDifyAdapterHealth } from "./health";

describe("@openkb/dify-adapter health", () => {
  it("returns a scaffold health payload", () => {
    expect(getDifyAdapterHealth()).toMatchObject({
      status: "ok",
      service: "openkb-dify-adapter"
    });
  });
});

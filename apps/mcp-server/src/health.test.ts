import { describe, expect, it } from "vitest";

import { getMcpHealth } from "./health";

describe("@openkb/mcp-server health", () => {
  it("returns a scaffold health payload", () => {
    expect(getMcpHealth()).toMatchObject({
      status: "ok",
      service: "openkb-mcp-server"
    });
  });
});

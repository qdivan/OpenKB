import { createServiceHealth } from "@openkb/shared";

export function getMcpHealth() {
  return createServiceHealth("openkb-mcp-server");
}

import { createServiceHealth } from "@openkb/shared";

export function getDifyAdapterHealth() {
  return createServiceHealth("openkb-dify-adapter");
}

import { createServiceHealth } from "@openkb/shared";

export function getIndexWorkerHealth() {
  return createServiceHealth("openkb-index-worker");
}

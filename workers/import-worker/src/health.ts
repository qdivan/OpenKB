import { createServiceHealth } from "@openkb/shared";

export function getImportWorkerHealth() {
  return createServiceHealth("openkb-import-worker");
}

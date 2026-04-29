import { createServiceHealth } from "@openkb/shared";

export function getApiHealth() {
  return createServiceHealth("openkb-api");
}

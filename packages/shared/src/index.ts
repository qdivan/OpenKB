export const OPENKB_PROJECT_NAME = "OpenKB";
export const OPENKB_VERSION = "0.3.3";
export const OPENKB_PHASE = "phase-11-deployment-closure";

export type ServiceHealth = {
  status: "ok";
  service: string;
  version: string;
  phase: string;
  timestamp: string;
};

export function createServiceHealth(service: string): ServiceHealth {
  return {
    status: "ok",
    service,
    version: OPENKB_VERSION,
    phase: OPENKB_PHASE,
    timestamp: new Date().toISOString()
  };
}

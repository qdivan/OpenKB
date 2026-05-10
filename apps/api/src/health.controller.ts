import { Controller, Get, Header } from "@nestjs/common";

import { getApiHealth } from "./health";

@Controller()
export class HealthController {
  @Get("health")
  getHealth() {
    return getApiHealth();
  }

  @Get("metrics")
  @Header("content-type", "text/plain; charset=utf-8")
  getMetrics() {
    const lines = [
      "# HELP openkb_api_info OpenKB API service info.",
      "# TYPE openkb_api_info gauge",
      'openkb_api_info{service="openkb-api"} 1',
      "# HELP openkb_api_uptime_seconds OpenKB API process uptime.",
      "# TYPE openkb_api_uptime_seconds gauge",
      `openkb_api_uptime_seconds ${Math.floor(process.uptime())}`
    ];
    return lines.join("\n") + "\n";
  }
}

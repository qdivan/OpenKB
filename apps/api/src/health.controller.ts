import { Controller, Get } from "@nestjs/common";

import { getApiHealth } from "./health";

@Controller()
export class HealthController {
  @Get("health")
  getHealth() {
    return getApiHealth();
  }
}

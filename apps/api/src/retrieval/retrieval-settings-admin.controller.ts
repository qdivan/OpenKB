import { Body, Controller, Get, Inject, Put, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import { RetrievalSettingsAdminService } from "./retrieval-settings-admin.service";

@Controller("api/admin/retrieval-settings")
export class RetrievalSettingsAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RetrievalSettingsAdminService)
    private readonly retrievalSettings: RetrievalSettingsAdminService
  ) {}

  @Get()
  async status(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.retrievalSettings.getStatus(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put()
  async update(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.retrievalSettings.updateSettings(
        getSessionToken(request, this.auth),
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("probe")
  async probe(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.retrievalSettings.probe(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

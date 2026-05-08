import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import {
  ModelSettingsAdminService,
  type UpdateModelSettingInput
} from "./model-settings-admin.service";

@Controller("api/admin/models")
export class ModelSettingsAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ModelSettingsAdminService)
    private readonly modelSettings: ModelSettingsAdminService
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.modelSettings.list(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":kind")
  async update(
    @Param("kind") kind: string,
    @Body() body: UpdateModelSettingInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.modelSettings.update(getSessionToken(request, this.auth), kind, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":kind/probe")
  async probe(
    @Param("kind") kind: string,
    @Body() body: UpdateModelSettingInput = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.modelSettings.probe(getSessionToken(request, this.auth), kind, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete(":kind/secret")
  async clearSecret(
    @Param("kind") kind: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.modelSettings.clearSecret(getSessionToken(request, this.auth), kind);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

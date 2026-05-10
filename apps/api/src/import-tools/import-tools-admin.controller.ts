import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import {
  ImportToolsAdminService,
  type UpdateImportFormatRouteInput,
  type UpdateImportToolSettingInput
} from "./import-tools-admin.service";

@Controller("api/admin/import-tools")
export class ImportToolsAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ImportToolsAdminService)
    private readonly importTools: ImportToolsAdminService
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.importTools.list(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":toolKey")
  async updateTool(
    @Param("toolKey") toolKey: string,
    @Body() body: UpdateImportToolSettingInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.importTools.updateTool(getSessionToken(request, this.auth), toolKey, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":toolKey/probe")
  async probe(
    @Param("toolKey") toolKey: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.importTools.probe(getSessionToken(request, this.auth), toolKey);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete(":toolKey/secret")
  async clearSecret(
    @Param("toolKey") toolKey: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.importTools.clearSecret(getSessionToken(request, this.auth), toolKey);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("routes/:format")
  async updateRoute(
    @Param("format") format: string,
    @Body() body: UpdateImportFormatRouteInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.importTools.updateRoute(getSessionToken(request, this.auth), format, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

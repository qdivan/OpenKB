import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ImportService } from "./import.service";
import { getSessionToken } from "./session";

@Controller("api/assets")
export class AssetController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ImportService) private readonly imports: ImportService
  ) {}

  @Get(":id/url")
  async url(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.imports.createPresignedAssetUrl(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

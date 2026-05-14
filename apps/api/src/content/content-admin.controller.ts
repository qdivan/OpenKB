import { Body, Controller, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api/admin/content-access")
export class ContentAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Post(":objectType/:id/takeover")
  async takeover(
    @Param("objectType") objectType: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.takeoverContentAccess(
        getSessionToken(request, this.auth),
        objectType,
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

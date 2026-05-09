import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError, setCookie } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api")
export class ShareController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Get("objects/:objectType/:objectId/share-links")
  async listShareLinks(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.listShareLinks(
        getSessionToken(request, this.auth),
        objectType,
        objectId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("objects/:objectType/:objectId/share-links")
  async createShareLink(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.createShareLink(
        getSessionToken(request, this.auth),
        objectType,
        objectId,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("share/:token")
  async getShare(
    @Param("token") token: string,
    @Query("document_id") documentId: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.getShare(
        token,
        getSessionToken(request, this.auth),
        request.headers.cookie,
        documentId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("share/:token/verify-password")
  async verifySharePassword(
    @Param("token") token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      const result = await this.content.verifySharePassword(
        token,
        (body as { password?: string } | null)?.password ?? ""
      );
      setCookie(reply, result.cookie);
      return { ok: true };
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("share-links/:id/revoke")
  async revokeShareLink(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.revokeShareLink(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("share-links/:id/reset")
  async resetShareLink(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.resetShareLink(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

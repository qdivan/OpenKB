import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { AuthService, getCookieValue, type UpdateAuthSettingsInput } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "./http";

@Controller("api/admin")
export class AdminController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("users")
  async users(
    @Query("status") status: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.listUsers(this.getSessionToken(request), status);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("users/:id/activate")
  async activateUser(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.activateUser(this.getSessionToken(request), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("users/:id/suspend")
  async suspendUser(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.suspendUser(this.getSessionToken(request), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("auth-settings")
  async getAuthSettings(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.getAuthSettings(this.getSessionToken(request));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("auth-settings")
  async updateAuthSettings(
    @Body() body: UpdateAuthSettingsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.updateAuthSettings(this.getSessionToken(request), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  private getSessionToken(request: FastifyRequest): string {
    return getCookieValue(request.headers.cookie, this.auth.cookieName()) ?? "";
  }
}

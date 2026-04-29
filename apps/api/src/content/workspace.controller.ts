import { Body, Controller, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api/workspaces")
export class WorkspaceController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Get()
  async list(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return await this.content.listWorkspaces(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.createWorkspace(getSessionToken(request, this.auth), body as never);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id")
  async get(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.getWorkspace(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.updateWorkspace(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

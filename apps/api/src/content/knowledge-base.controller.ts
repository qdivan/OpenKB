import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api/knowledge-bases")
export class KnowledgeBaseController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Get()
  async list(
    @Query("workspace_id") workspaceId: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.listKnowledgeBases(
        getSessionToken(request, this.auth),
        workspaceId
      );
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
      return await this.content.createKnowledgeBase(
        getSessionToken(request, this.auth),
        body as never
      );
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
      return await this.content.getKnowledgeBase(getSessionToken(request, this.auth), id);
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
      return await this.content.updateKnowledgeBase(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/tree")
  async tree(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.getKnowledgeBaseTree(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

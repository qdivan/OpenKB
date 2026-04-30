import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ImportService } from "./import.service";
import { getSessionToken } from "./session";

@Controller("api/import-jobs")
export class ImportJobController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ImportService) private readonly imports: ImportService
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.imports.createImportJob(getSessionToken(request, this.auth), body as never);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get()
  async list(
    @Query("knowledge_base_id") knowledgeBaseId: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.imports.listImportJobs(
        getSessionToken(request, this.auth),
        knowledgeBaseId
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
  ): Promise<unknown> {
    try {
      return await this.imports.getImportJob(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

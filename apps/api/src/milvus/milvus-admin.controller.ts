import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import { MilvusAdminService } from "./milvus-admin.service";

@Controller("api/admin/milvus")
export class MilvusAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MilvusAdminService) private readonly milvusAdmin: MilvusAdminService
  ) {}

  @Get("status")
  async status(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.getStatus(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("index-profiles")
  async profiles(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.listProfiles(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("rebuild-jobs")
  async createRebuildJob(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.createRebuildJob(
        getSessionToken(request, this.auth),
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("rebuild-jobs")
  async listRebuildJobs(
    @Query() query: { status?: string; limit?: string; offset?: string } = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.listRebuildJobs(getSessionToken(request, this.auth), {
        status: query.status,
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("rebuild-jobs/:id")
  async getRebuildJob(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.getRebuildJob(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("aliases/switch")
  async switchAlias(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.milvusAdmin.switchAlias(getSessionToken(request, this.auth), body as never);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

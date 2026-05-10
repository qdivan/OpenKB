import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import {
  ProductionAdminService,
  type TestEmailInput,
  type UpdateSmtpSettingsInput
} from "./production-admin.service";

type ListQuery = {
  limit?: string;
  offset?: string;
};

@Controller("api/admin")
export class ProductionAdminController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProductionAdminService) private readonly production: ProductionAdminService
  ) {}

  @Get("email/settings")
  async getEmailSettings(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.getEmailSettings(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("email/settings")
  async updateEmailSettings(
    @Body() body: UpdateSmtpSettingsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.updateEmailSettings(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("email/probe")
  async probeEmail(
    @Body() body: UpdateSmtpSettingsInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.probeEmail(getSessionToken(request, this.auth), body ?? {});
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("email/test-send")
  async sendTestEmail(
    @Body() body: TestEmailInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.sendTestEmail(getSessionToken(request, this.auth), body ?? {});
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("email/outbox")
  async listOutbox(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.listOutbox(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("email/outbox/:id/retry")
  async retryOutbox(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.retryOutbox(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("ops/health")
  async getOpsHealth(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.getOpsHealth(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("security/secrets")
  async listSecrets(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.listSecrets(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("security/rotate/:kind")
  async rotateSecret(
    @Param("kind") kind: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.production.rotateSecret(getSessionToken(request, this.auth), kind);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

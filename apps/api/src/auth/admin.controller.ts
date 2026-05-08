import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res
} from "@nestjs/common";
import {
  AuthService,
  getCookieValue,
  type CreateAdminUserInput,
  type UpdateAdminUserInput,
  type UpdateAuthSettingsInput
} from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "./http";

type ListUsersQuery = {
  status?: string;
  role?: string;
  query?: string;
  limit?: string;
  offset?: string;
};

type TenantRoleBody = {
  role?: string;
};

type AuditLogsQuery = {
  action?: string;
  object_type?: string;
  actor_user_id?: string;
  limit?: string;
  offset?: string;
};

@Controller("api/admin")
export class AdminController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("users")
  async users(
    @Query() query: ListUsersQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.listUsers(this.getSessionToken(request), {
        status: query.status,
        role: query.role,
        query: query.query,
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("users")
  async createUser(
    @Body() body: CreateAdminUserInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.createAdminUser(this.getSessionToken(request), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Patch("users/:id")
  async updateUser(
    @Param("id") id: string,
    @Body() body: UpdateAdminUserInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.updateAdminUser(this.getSessionToken(request), id, body);
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

  @Post("users/:id/delete")
  async deleteUser(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.softDeleteUser(this.getSessionToken(request), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("users/:id/password-reset")
  async createPasswordReset(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.createAdminPasswordReset(this.getSessionToken(request), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("users/:id/tenant-role")
  async setTenantRole(
    @Param("id") id: string,
    @Body() body: TenantRoleBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.setTenantRole(this.getSessionToken(request), id, body.role ?? "");
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("users/:id/revoke-sessions")
  async revokeSessions(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.revokeUserSessions(this.getSessionToken(request), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("audit-logs")
  async auditLogs(
    @Query() query: AuditLogsQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.listAuditLogs(this.getSessionToken(request), {
        action: query.action,
        object_type: query.object_type,
        actor_user_id: query.actor_user_id,
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
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

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

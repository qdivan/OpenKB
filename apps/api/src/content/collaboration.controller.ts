import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api")
export class CollaborationController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Get("objects/:objectType/:objectId/collaborators")
  async listCollaborators(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.listCollaborators(
        getSessionToken(request, this.auth),
        objectType,
        objectId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("workspaces/:id/members")
  async listWorkspaceMembers(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.listWorkspaceMembers(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("workspace-members/:id")
  async updateWorkspaceMember(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.updateWorkspaceMember(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete("workspace-members/:id")
  async deleteWorkspaceMember(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.deleteWorkspaceMember(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("objects/:objectType/:objectId/collaborators")
  async createCollaborator(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.createCollaborator(
        getSessionToken(request, this.auth),
        objectType,
        objectId,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("collaborators/:id")
  async updateCollaborator(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.updateCollaborator(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete("collaborators/:id")
  async deleteCollaborator(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.deleteCollaborator(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("objects/:objectType/:objectId/invitations")
  async createInvitation(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.createInvitation(
        getSessionToken(request, this.auth),
        objectType,
        objectId,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("objects/:objectType/:objectId/invitations")
  async listInvitations(
    @Param("objectType") objectType: string,
    @Param("objectId") objectId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.listInvitations(
        getSessionToken(request, this.auth),
        objectType,
        objectId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("invitations/:token")
  async getInvitation(
    @Param("token") token: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.getInvitationByToken(token);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("invitations/:token/accept")
  async acceptInvitation(
    @Param("token") token: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.acceptInvitation(getSessionToken(request, this.auth), token);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("invitations/:id/revoke")
  async revokeInvitation(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.revokeInvitation(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("invitations/:id/approve")
  async approveInvitation(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.content.approveInvitation(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

import {
  Body,
  Controller,
  Delete,
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
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";
import {
  AdminOpsService,
  type CreateDifyHubDatasetInput,
  type CreateDifyApiKeyInput,
  type CreateMcpOauthClientInput,
  type CreateMcpPatInput,
  type ImportDifyHubDatasetInput,
  type SyncDifyHubMetadataInput,
  type UpdateDifyApiKeyInput,
  type UpdateMcpOauthClientInput,
  type UpsertDifyHubConnectionInput,
  type UpsertDifyMappingInput
} from "./admin-ops.service";

type ListQuery = {
  limit?: string;
  offset?: string;
};

@Controller("api/admin")
export class AdminOpsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AdminOpsService) private readonly adminOps: AdminOpsService
  ) {}

  @Get("dify/setup")
  async getDifySetup(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.adminOps.getDifySetupSummary(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("dify/filterable-metadata")
  async getDifyFilterableMetadata(
    @Query("knowledge_base_id") knowledgeBaseId: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.adminOps.getDifyFilterableMetadata(getSessionToken(request, this.auth), {
        knowledge_base_id: knowledgeBaseId
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("dify/hub/connection")
  async getDifyHubConnection(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.getDifyHubConnection(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put("dify/hub/connection")
  async upsertDifyHubConnection(
    @Body() body: UpsertDifyHubConnectionInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.upsertDifyHubConnection(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/hub/probe")
  async probeDifyHubConnection(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.probeDifyHubConnection(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("dify/hub/datasets")
  async listDifyHubDatasets(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listDifyHubDatasets(getSessionToken(request, this.auth));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/hub/datasets/import")
  async importDifyHubDataset(
    @Body() body: ImportDifyHubDatasetInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.importDifyHubDataset(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/hub/datasets")
  async createDifyHubDataset(
    @Body() body: CreateDifyHubDatasetInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.createDifyHubDataset(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete("dify/hub/datasets/:difyDatasetId")
  async deleteDifyHubDataset(
    @Param("difyDatasetId") difyDatasetId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.deleteDifyHubDataset(
        getSessionToken(request, this.auth),
        difyDatasetId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/hub/metadata-sync")
  async syncDifyHubMetadata(
    @Body() body: SyncDifyHubMetadataInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.syncDifyHubMetadata(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("dify/api-keys")
  async listDifyApiKeys(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listDifyApiKeys(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/api-keys")
  async createDifyApiKey(
    @Body() body: CreateDifyApiKeyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.createDifyApiKey(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Patch("dify/api-keys/:id")
  async updateDifyApiKey(
    @Param("id") id: string,
    @Body() body: UpdateDifyApiKeyInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.updateDifyApiKey(getSessionToken(request, this.auth), id, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/api-keys/:id/reveal")
  async revealDifyApiKey(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.revealDifyApiKey(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/api-keys/:id/rotate")
  async rotateDifyApiKey(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.rotateDifyApiKey(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/api-keys/:id/revoke")
  async revokeDifyApiKey(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.revokeDifyApiKey(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("dify/mappings")
  async listDifyMappings(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listDifyMappings(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("dify/mappings")
  async upsertDifyMapping(
    @Body() body: UpsertDifyMappingInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.upsertDifyMapping(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Patch("dify/mappings/:id")
  async updateDifyMapping(
    @Param("id") id: string,
    @Body() body: UpsertDifyMappingInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.updateDifyMapping(getSessionToken(request, this.auth), id, body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("mcp/pats")
  async listMcpPats(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listMcpPats(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("mcp/pats")
  async createMcpPat(
    @Body() body: CreateMcpPatInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.createMcpPat(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("mcp/pats/:id/revoke")
  async revokeMcpPat(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.revokeMcpPat(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("mcp/oauth-clients")
  async listMcpOauthClients(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listMcpOauthClients(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("mcp/oauth-clients")
  async createMcpOauthClient(
    @Body() body: CreateMcpOauthClientInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.createMcpOauthClient(getSessionToken(request, this.auth), body);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Patch("mcp/oauth-clients/:id")
  async updateMcpOauthClient(
    @Param("id") id: string,
    @Body() body: UpdateMcpOauthClientInput,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.updateMcpOauthClient(
        getSessionToken(request, this.auth),
        id,
        body
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("mcp/oauth-grants")
  async listMcpOauthGrants(
    @Query() query: ListQuery = {},
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.listMcpOauthGrants(getSessionToken(request, this.auth), {
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset)
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("mcp/oauth-grants/:id/revoke")
  async revokeMcpOauthGrant(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.adminOps.revokeMcpOauthGrant(getSessionToken(request, this.auth), id);
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

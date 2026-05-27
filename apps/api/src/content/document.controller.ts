import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentService } from "./content.service";
import { getSessionToken } from "./session";

@Controller("api/documents")
export class DocumentController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ContentService) private readonly content: ContentService
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.createDocument(getSessionToken(request, this.auth), body as never);
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
      return await this.content.getDocument(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/versions")
  async versions(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.listDocumentVersions(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/metadata")
  async metadata(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.getDocumentMetadata(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":id/metadata")
  async updateMetadata(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.updateDocumentMetadata(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/processing")
  async processing(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.getDocumentProcessing(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":id/processing")
  async updateProcessing(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.updateDocumentProcessing(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/reprocess")
  async reprocess(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.reprocessDocument(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/qa")
  async qaPairs(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.listQaPairs(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/qa")
  async createQaPair(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.createQaPair(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":id/qa/:qaId")
  async updateQaPair(
    @Param("id") id: string,
    @Param("qaId") qaId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.updateQaPair(
        getSessionToken(request, this.auth),
        id,
        qaId,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/qa/import")
  async importQaPairs(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.importQaPairs(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/qa/generate")
  async generateQaPairs(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.generateQaPairs(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/summaries")
  async summaries(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.listDocumentSummaries(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/summaries")
  async generateSummary(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.generateSegmentSummary(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Put(":id/chunks/:chunkId")
  async updateSegment(
    @Param("id") id: string,
    @Param("chunkId") chunkId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.updateDocumentSegment(
        getSessionToken(request, this.auth),
        id,
        chunkId,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get(":id/versions/:versionId")
  async version(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.getDocumentVersion(
        getSessionToken(request, this.auth),
        id,
        versionId
      );
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
  ): Promise<unknown> {
    try {
      return await this.content.updateDocument(
        getSessionToken(request, this.auth),
        id,
        body as never
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/publish")
  async publish(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.publishDocument(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/unpublish")
  async unpublish(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.unpublishDocument(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/index-refresh")
  async refreshIndex(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.refreshDocumentIndex(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post(":id/restore/:versionId")
  async restore(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.restoreDocumentVersion(
        getSessionToken(request, this.auth),
        id,
        versionId
      );
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Delete(":id")
  async delete(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      return await this.content.deleteDocument(getSessionToken(request, this.auth), id);
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

import { Controller, Inject, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { ContentError } from "./errors";
import { ImportService } from "./import.service";
import { getSessionToken } from "./session";

@Controller("api/uploads")
export class UploadController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ImportService) private readonly imports: ImportService
  ) {}

  @Post()
  async upload(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      const file = await (
        request as FastifyRequest & { file: () => Promise<MultipartFile> }
      ).file();
      if (!file) {
        throw new ContentError("INVALID_INPUT", "file is required.", 400);
      }
      const fields = file.fields as Record<string, { value?: unknown }>;
      const knowledgeBaseId = readMultipartField(fields, "knowledge_base_id");
      const parentId = readMultipartField(fields, "parent_id", false);

      return await this.imports.upload(getSessionToken(request, this.auth), {
        filename: file.filename,
        mimeType: file.mimetype,
        body: await file.toBuffer(),
        knowledgeBaseId,
        parentId
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

function readMultipartField(
  fields: Record<string, { value?: unknown }>,
  key: string,
  required = true
): string {
  const value = fields[key]?.value;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!required) {
    return "";
  }
  throw new ContentError("INVALID_INPUT", `${key} is required.`, 400);
}

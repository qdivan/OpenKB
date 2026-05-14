import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import { RetrievalService } from "@openkb/retrieval";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError } from "../auth/http";
import { getSessionToken } from "../content/session";

@Controller("api/search")
export class SearchController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RetrievalService) private readonly retrieval: RetrievalService
  ) {}

  @Post()
  @HttpCode(200)
  async search(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    try {
      const user = await this.auth.getMe(getSessionToken(request, this.auth));
      const input =
        typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      return await this.retrieval.search({
        user,
        query: input.query,
        knowledge_base_ids: input.knowledge_base_ids,
        top_k: input.top_k,
        score_threshold: input.score_threshold,
        retrieval_model: input.retrieval_model,
        filters: input.filters,
        context_mode: input.context_mode
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }
}

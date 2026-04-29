import { AuthService, getCookieValue } from "@openkb/auth";
import type { FastifyRequest } from "fastify";

export function getSessionToken(request: FastifyRequest, auth: AuthService): string | null {
  return getCookieValue(request.headers.cookie, auth.cookieName());
}

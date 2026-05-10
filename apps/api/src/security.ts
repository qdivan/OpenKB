import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  keyPrefix: string;
  max: number;
  windowMs: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

const AUTH_RATE_LIMIT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/confirm"
]);

const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-email",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/confirm",
  "/api/search"
]);

export function registerApiSecurity(app: NestFastifyApplication, env = process.env): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const generalRule = {
    keyPrefix: "api",
    max: parsePositiveInt(env.API_RATE_LIMIT_MAX, 600),
    windowMs: parsePositiveInt(env.API_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000
  };
  const authRule = {
    keyPrefix: "auth",
    max: parsePositiveInt(env.AUTH_RATE_LIMIT_MAX, 20),
    windowMs: parsePositiveInt(env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 300) * 1000
  };
  const trustProxyHeaders = parseBoolean(env.TRUST_PROXY_HEADERS, false);

  fastify.addHook("onRequest", async (request, reply) => {
    setSecurityHeaders(reply);
    ensureCsrfCookie(request, reply, env);

    if (request.method === "OPTIONS" || request.url === "/health") {
      return;
    }

    const ip = getClientIp(request, trustProxyHeaders);
    const path = stripQuery(request.url);

    if (isRateLimited(generalRule, ip, Date.now())) {
      sendRateLimitResponse(reply, generalRule);
      return;
    }

    if (AUTH_RATE_LIMIT_PATHS.has(path) && isRateLimited(authRule, ip, Date.now())) {
      sendRateLimitResponse(reply, authRule);
      return;
    }

    if (!isCsrfAllowed(request, path, env)) {
      reply.code(403).send({
        error: "CSRF_REQUIRED",
        message: "A valid CSRF token is required."
      });
    }
  });
}

function setSecurityHeaders(reply: FastifyReply): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(name, value);
  }
}

function sendRateLimitResponse(reply: FastifyReply, rule: RateLimitRule): void {
  reply
    .code(429)
    .header("retry-after", Math.ceil(rule.windowMs / 1000).toString())
    .send({
      error: "RATE_LIMITED",
      message: "Too many requests. Please retry later."
    });
}

function ensureCsrfCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  env: NodeJS.ProcessEnv
): void {
  const name = csrfCookieName(env);
  if (getCookieValue(request.headers.cookie, name)) {
    return;
  }
  const secure = shouldUseSecureCookie(env);
  reply.header(
    "set-cookie",
    `${name}=${randomBytes(24).toString("base64url")}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

export function isCsrfAllowed(
  request: FastifyRequest,
  path: string,
  env: NodeJS.ProcessEnv
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return true;
  }
  if (CSRF_EXEMPT_PATHS.has(path) || path.startsWith("/api/share/")) {
    return true;
  }
  if (getFirstHeader(request.headers.authorization)?.toLowerCase().startsWith("bearer ")) {
    return true;
  }

  const sessionCookie = getCookieValue(
    request.headers.cookie,
    env.AUTH_COOKIE_NAME || "openkb_session"
  );
  if (!sessionCookie) {
    return true;
  }

  const cookieToken = getCookieValue(request.headers.cookie, csrfCookieName(env));
  const headerToken = getFirstHeader(request.headers["x-openkb-csrf"]);
  return safeEqual(cookieToken, headerToken);
}

function csrfCookieName(env: NodeJS.ProcessEnv): string {
  return env.OPENKB_CSRF_COOKIE_NAME || "openkb_csrf";
}

function shouldUseSecureCookie(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.APP_BASE_URL || "";
  return baseUrl.startsWith("https://") || parseBoolean(env.COOKIE_SECURE, false);
}

function safeEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function isRateLimited(rule: RateLimitRule, identity: string, now: number): boolean {
  pruneExpiredBuckets(now);
  const key = `${rule.keyPrefix}:${identity}`;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + rule.windowMs
    });
    return false;
  }

  bucket.count += 1;
  return bucket.count > rule.max;
}

function pruneExpiredBuckets(now: number): void {
  if (rateLimitBuckets.size < 10_000) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getClientIp(request: FastifyRequest, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const forwardedFor = getFirstHeader(request.headers["x-forwarded-for"]);
    if (forwardedFor) {
      return forwardedFor.split(",")[0]?.trim() || request.ip;
    }
  }

  return request.ip || request.socket.remoteAddress || "unknown";
}

function stripQuery(url: string): string {
  return url.split("?")[0] || "/";
}

function getFirstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

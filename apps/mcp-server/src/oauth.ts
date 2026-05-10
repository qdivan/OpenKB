import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { URLSearchParams } from "node:url";

import { AuthService } from "@openkb/auth";
import { createDatabaseClient, Prisma, type PrismaClient } from "@openkb/db";

import {
  MCP_ALLOWED_SCOPES,
  assertAllowedScopes,
  getMcpServerConfig,
  type McpScope,
  type McpServerConfig
} from "./config";
import { OpenKBMcpError } from "./errors";

type OAuthDbClient = PrismaClient | Prisma.TransactionClient;

export type OAuthHttpResult = {
  status: number;
  headers?: Record<string, string>;
  body: string | Record<string, unknown>;
};

export type OAuthAccessClaims = {
  userId: string;
  tenantId: string;
  scopes: McpScope[];
  clientId: string;
  grantId: string;
};

export class McpOAuthService {
  private readonly prisma: PrismaClient;
  private readonly auth: AuthService;
  private readonly config: McpServerConfig;
  private readonly now: () => Date;

  constructor(
    options: {
      prisma?: PrismaClient;
      auth?: AuthService;
      env?: NodeJS.ProcessEnv;
      now?: () => Date;
    } = {}
  ) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.auth = options.auth ?? new AuthService();
    this.config = getMcpServerConfig(options.env);
    this.now = options.now ?? (() => new Date());
  }

  getAuthorizationServerMetadata() {
    return {
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.baseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.baseUrl}/oauth/token`,
      revocation_endpoint: `${this.config.baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: MCP_ALLOWED_SCOPES
    };
  }

  getProtectedAuthorizationMetadata() {
    return {
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.baseUrl}/oauth/authorize`,
      token_endpoint: `${this.config.baseUrl}/oauth/token`,
      revocation_endpoint: `${this.config.baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: MCP_ALLOWED_SCOPES
    };
  }

  async authorizeGet(url: URL, cookieHeader: string | undefined): Promise<OAuthHttpResult> {
    const request = parseAuthorizeRequest(url.searchParams);
    const client = await this.validateClient(request.clientId, request.redirectUri, request.scopes);
    const sessionToken = getCookieValue(
      cookieHeader,
      process.env.AUTH_COOKIE_NAME || "openkb_session"
    );
    if (!sessionToken) {
      return html(401, loginRequiredHtml());
    }
    const me = await this.auth.getMe(sessionToken);
    if (client.tenant_id !== me.tenantId) {
      throw new OpenKBMcpError("FORBIDDEN", "OAuth client is not available in this tenant.", 403);
    }
    return html(200, consentHtml(request, client.client_name, me.user.email));
  }

  async authorizePost(body: string, cookieHeader: string | undefined): Promise<OAuthHttpResult> {
    const params = new URLSearchParams(body);
    const request = parseAuthorizeRequest(params);
    const approved = params.get("approve") === "1";
    if (!approved) {
      return redirectWithParams(request.redirectUri, {
        error: "access_denied",
        state: request.state ?? undefined
      });
    }
    const client = await this.validateClient(request.clientId, request.redirectUri, request.scopes);
    const sessionToken = getCookieValue(
      cookieHeader,
      process.env.AUTH_COOKIE_NAME || "openkb_session"
    );
    if (!sessionToken) {
      return html(401, loginRequiredHtml());
    }
    const me = await this.auth.getMe(sessionToken);
    if (client.tenant_id !== me.tenantId) {
      throw new OpenKBMcpError("FORBIDDEN", "OAuth client is not available in this tenant.", 403);
    }

    const now = this.now();
    const code = randomToken("okb_code_");
    const grant = await this.prisma.mcpOauthGrant.create({
      data: {
        tenant_id: client.tenant_id,
        user_id: me.user.id,
        client_id: client.id,
        scopes: request.scopes,
        status: "active",
        expires_at: new Date(now.getTime() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
        created_at: now
      }
    });
    await this.prisma.mcpOauthAuthorizationCode.create({
      data: {
        tenant_id: client.tenant_id,
        grant_id: grant.id,
        code_hash: hashToken(code),
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        resource: request.resource,
        redirect_uri: request.redirectUri,
        scopes: request.scopes,
        expires_at: new Date(now.getTime() + 10 * 60 * 1000),
        created_at: now
      }
    });
    await this.writeAudit(me.user.id, client.tenant_id, "mcp.oauth.authorize", grant.id, {
      client_id: client.client_id,
      scopes: request.scopes
    });
    return redirectWithParams(request.redirectUri, {
      code,
      state: request.state ?? undefined
    });
  }

  async token(body: string): Promise<OAuthHttpResult> {
    const params = new URLSearchParams(body);
    const grantType = params.get("grant_type");
    if (grantType === "authorization_code") {
      return { status: 200, body: await this.exchangeAuthorizationCode(params) };
    }
    if (grantType === "refresh_token") {
      return { status: 200, body: await this.exchangeRefreshToken(params) };
    }
    throw new OpenKBMcpError("INVALID_INPUT", "Unsupported OAuth grant_type.", 400);
  }

  async revoke(body: string): Promise<OAuthHttpResult> {
    const params = new URLSearchParams(body);
    const token = params.get("token");
    if (token) {
      await this.prisma.mcpOauthRefreshToken.updateMany({
        where: { token_hash: hashToken(token), revoked_at: null },
        data: { revoked_at: this.now() }
      });
    }
    return { status: 200, body: { ok: true } };
  }

  async verifyAccessToken(token: string): Promise<OAuthAccessClaims> {
    const payload = verifyJwt(token, this.config.signingSecret);
    if (payload.typ !== "access" || payload.aud !== `${this.config.baseUrl}/mcp`) {
      throw new OpenKBMcpError(
        "AUTHENTICATION_REQUIRED",
        "OAuth access token audience is invalid.",
        401
      );
    }
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(this.now().getTime() / 1000)) {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth access token is expired.", 401);
    }
    const grant = await this.prisma.mcpOauthGrant.findUnique({
      where: { id: String(payload.gid) }
    });
    if (!grant || grant.status !== "active" || grant.revoked_at) {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth grant is not active.", 401);
    }
    const user = await this.prisma.user.findUnique({ where: { id: grant.user_id } });
    if (!user || user.status !== "active") {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth token user is not active.", 401);
    }
    return {
      userId: grant.user_id,
      tenantId: grant.tenant_id,
      scopes: assertAllowedScopes(grant.scopes),
      clientId: String(payload.client_id),
      grantId: grant.id
    };
  }

  private async exchangeAuthorizationCode(params: URLSearchParams) {
    const clientId = requireParam(params, "client_id");
    const code = requireParam(params, "code");
    const redirectUri = requireParam(params, "redirect_uri");
    const verifier = requireParam(params, "code_verifier");
    return this.prisma.$transaction(async (tx) => {
      const now = this.now();
      const client = await tx.mcpOauthClient.findUnique({ where: { client_id: clientId } });
      if (!client || client.status !== "active" || !client.redirect_uris.includes(redirectUri)) {
        throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth client is invalid.", 401);
      }
      const codeRow = await tx.mcpOauthAuthorizationCode.findFirst({
        where: {
          code_hash: hashToken(code),
          redirect_uri: redirectUri,
          consumed_at: null
        }
      });
      if (!codeRow || codeRow.expires_at <= now) {
        throw new OpenKBMcpError(
          "AUTHENTICATION_REQUIRED",
          "OAuth code is invalid or expired.",
          401
        );
      }
      const grant = await tx.mcpOauthGrant.findUnique({ where: { id: codeRow.grant_id } });
      if (!grant || grant.client_id !== client.id || grant.status !== "active") {
        throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth grant is invalid.", 401);
      }
      if (!verifyPkce(verifier, codeRow.code_challenge ?? "")) {
        throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth PKCE verification failed.", 401);
      }
      const consumed = await tx.mcpOauthAuthorizationCode.updateMany({
        where: { id: codeRow.id, consumed_at: null },
        data: { consumed_at: now }
      });
      if (consumed.count !== 1) {
        throw new OpenKBMcpError(
          "AUTHENTICATION_REQUIRED",
          "OAuth code is invalid or expired.",
          401
        );
      }
      return this.issueTokenPair(
        tx,
        grant.id,
        client.client_id,
        grant.user_id,
        grant.tenant_id,
        assertAllowedScopes(codeRow.scopes)
      );
    });
  }

  private async exchangeRefreshToken(params: URLSearchParams) {
    const clientId = requireParam(params, "client_id");
    const refreshToken = requireParam(params, "refresh_token");
    return this.prisma.$transaction(async (tx) => {
      const now = this.now();
      const tokenRow = await tx.mcpOauthRefreshToken.findFirst({
        where: { token_hash: hashToken(refreshToken), revoked_at: null }
      });
      if (!tokenRow || tokenRow.expires_at <= now) {
        throw new OpenKBMcpError(
          "AUTHENTICATION_REQUIRED",
          "OAuth refresh token is invalid or expired.",
          401
        );
      }
      const grant = await tx.mcpOauthGrant.findUnique({ where: { id: tokenRow.grant_id } });
      if (!grant || grant.status !== "active" || grant.revoked_at) {
        throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth grant is invalid.", 401);
      }
      const client = await tx.mcpOauthClient.findUnique({ where: { id: grant.client_id } });
      if (!client || client.client_id !== clientId || client.status !== "active") {
        throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth client is invalid.", 401);
      }
      const revoked = await tx.mcpOauthRefreshToken.updateMany({
        where: { id: tokenRow.id, revoked_at: null },
        data: { revoked_at: now }
      });
      if (revoked.count !== 1) {
        throw new OpenKBMcpError(
          "AUTHENTICATION_REQUIRED",
          "OAuth refresh token is invalid or expired.",
          401
        );
      }
      return this.issueTokenPair(
        tx,
        grant.id,
        client.client_id,
        grant.user_id,
        grant.tenant_id,
        assertAllowedScopes(grant.scopes)
      );
    });
  }

  private async issueTokenPair(
    db: OAuthDbClient,
    grantId: string,
    clientId: string,
    userId: string,
    tenantId: string,
    scopes: McpScope[]
  ) {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const refreshToken = randomToken("okb_refresh_");
    await db.mcpOauthRefreshToken.create({
      data: {
        tenant_id: tenantId,
        grant_id: grantId,
        token_hash: hashToken(refreshToken),
        expires_at: new Date(
          this.now().getTime() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
        ),
        created_at: this.now()
      }
    });
    return {
      token_type: "Bearer",
      access_token: signJwt(
        {
          iss: this.config.issuer,
          aud: `${this.config.baseUrl}/mcp`,
          typ: "access",
          sub: userId,
          tid: tenantId,
          gid: grantId,
          client_id: clientId,
          scope: scopes.join(" "),
          iat: nowSeconds,
          exp: nowSeconds + this.config.accessTokenTtlSeconds
        },
        this.config.signingSecret
      ),
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" ")
    };
  }

  private async validateClient(clientId: string, redirectUri: string, scopes: McpScope[]) {
    const client = await this.prisma.mcpOauthClient.findUnique({ where: { client_id: clientId } });
    if (!client || client.status !== "active") {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth client is invalid.", 401);
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      throw new OpenKBMcpError("INVALID_INPUT", "OAuth redirect_uri is not registered.", 400);
    }
    const allowed = assertAllowedScopes(
      client.allowed_scopes.length ? client.allowed_scopes : scopes
    );
    const forbidden = scopes.filter((scope) => !allowed.includes(scope));
    if (forbidden.length > 0) {
      throw new OpenKBMcpError(
        "FORBIDDEN",
        `OAuth scopes are not allowed: ${forbidden.join(", ")}`,
        403
      );
    }
    return client;
  }

  private async writeAudit(
    userId: string,
    tenantId: string,
    action: string,
    grantId: string,
    metadata: Record<string, unknown>
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: tenantId,
        actor_user_id: userId,
        actor_type: "user",
        action,
        object_type: "mcp_oauth_grant",
        object_id: grantId,
        metadata: metadata as Prisma.InputJsonObject
      }
    });
  }
}

function parseAuthorizeRequest(params: URLSearchParams) {
  const responseType = requireParam(params, "response_type");
  if (responseType !== "code") {
    throw new OpenKBMcpError("INVALID_INPUT", "Only response_type=code is supported.", 400);
  }
  const method = params.get("code_challenge_method") ?? "S256";
  if (method !== "S256") {
    throw new OpenKBMcpError("INVALID_INPUT", "Only PKCE S256 is supported.", 400);
  }
  const scopes = assertAllowedScopes(
    (params.get("scope") || "kb:read kb:search doc:read").split(/\s+/).filter(Boolean)
  );
  return {
    clientId: requireParam(params, "client_id"),
    redirectUri: requireParam(params, "redirect_uri"),
    codeChallenge: requireParam(params, "code_challenge"),
    scopes,
    state: params.get("state"),
    resource: params.get("resource") || undefined
  };
}

function consentHtml(
  request: ReturnType<typeof parseAuthorizeRequest>,
  clientName: string,
  email: string
): string {
  const hidden = (
    [
      ["response_type", "code"],
      ["client_id", request.clientId],
      ["redirect_uri", request.redirectUri],
      ["code_challenge", request.codeChallenge],
      ["code_challenge_method", "S256"],
      ["scope", request.scopes.join(" ")],
      ["state", request.state ?? ""],
      ["resource", request.resource ?? ""],
      ["approve", "1"]
    ] satisfies Array<[string, string]>
  )
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
    )
    .join("");
  return `<!doctype html><html><body style="font-family:system-ui;margin:40px;max-width:620px"><h1>Authorize OpenKB MCP</h1><p><strong>${escapeHtml(clientName)}</strong> wants to access OpenKB as ${escapeHtml(email)}.</p><p>Scopes: ${escapeHtml(request.scopes.join(", "))}</p><form method="post">${hidden}<button style="padding:8px 14px">Authorize</button></form></body></html>`;
}

function loginRequiredHtml(): string {
  return `<!doctype html><html><body style="font-family:system-ui;margin:40px"><h1>Login required</h1><p>Please log in to OpenKB in this browser, then retry the MCP authorization request.</p></body></html>`;
}

function html(status: number, body: string): OAuthHttpResult {
  return { status, headers: { "content-type": "text/html; charset=utf-8" }, body };
}

function redirectWithParams(
  redirectUri: string,
  params: Record<string, string | undefined>
): OAuthHttpResult {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return { status: 302, headers: { location: url.toString() }, body: "" };
}

function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) {
    throw new OpenKBMcpError("INVALID_INPUT", `${name} is required.`, 400);
  }
  return value;
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const expected = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(expected, challenge);
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth access token is invalid.", 401);
  }
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  if (!safeEqual(expected, signature)) {
    throw new OpenKBMcpError(
      "AUTHENTICATION_REQUIRED",
      "OAuth access token signature is invalid.",
      401
    );
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "OAuth access token is invalid.", 401);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function safeEqual(a: string, b: string): boolean {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

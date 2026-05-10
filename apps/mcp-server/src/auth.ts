import { createHash, randomBytes } from "node:crypto";

import { createDatabaseClient, type PrismaClient } from "@openkb/db";

import {
  assertAllowedScopes,
  getMcpServerConfig,
  type McpScope,
  type McpServerConfig
} from "./config";
import { OpenKBMcpError } from "./errors";
import { McpOAuthService } from "./oauth";

export type McpAuthContext = {
  userId: string;
  tenantId: string;
  scopes: McpScope[];
  clientId: string;
  patId?: string;
  oauthGrantId?: string;
};

export type CreateMcpPatInput = {
  userEmail: string;
  name: string;
  scopes?: string[];
  expiresDays?: number | null;
};

export type CreateMcpPatResult = {
  token: string;
  id: string;
  userId: string;
  tenantId: string;
  name: string;
  scopes: McpScope[];
  expiresAt: string | null;
};

export class McpAuthService {
  private readonly prisma: PrismaClient;
  private readonly config: McpServerConfig;
  private readonly oauth: McpOAuthService;
  private readonly now: () => Date;

  constructor(options: { prisma?: PrismaClient; env?: NodeJS.ProcessEnv; now?: () => Date } = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.config = getMcpServerConfig(options.env);
    this.oauth = new McpOAuthService({ prisma: this.prisma, env: options.env, now: options.now });
    this.now = options.now ?? (() => new Date());
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async authenticateAuthorizationHeader(
    authorizationHeader: string | string[] | undefined
  ): Promise<McpAuthContext> {
    const bearer = extractBearerToken(authorizationHeader);
    if (!bearer) {
      throw new OpenKBMcpError(
        "AUTHENTICATION_REQUIRED",
        "Authorization: Bearer token is required.",
        401
      );
    }

    if (!bearer.startsWith(this.config.patPrefix)) {
      const oauth = await this.oauth.verifyAccessToken(bearer);
      return {
        userId: oauth.userId,
        tenantId: oauth.tenantId,
        scopes: oauth.scopes,
        clientId: oauth.clientId,
        oauthGrantId: oauth.grantId
      };
    }

    const tokenHash = hashToken(bearer);
    const pat = await this.prisma.mcpPersonalAccessToken.findFirst({
      where: {
        token_hash: tokenHash
      }
    });

    const now = this.now();
    if (
      !pat ||
      pat.status !== "active" ||
      pat.revoked_at ||
      (pat.expires_at && pat.expires_at <= now)
    ) {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "MCP token is invalid or expired.", 401);
    }

    const user = await this.prisma.user.findUnique({ where: { id: pat.user_id } });
    if (!user || user.status !== "active") {
      throw new OpenKBMcpError("AUTHENTICATION_REQUIRED", "MCP token user is not active.", 401);
    }

    const scopes = assertAllowedScopes(pat.scopes);
    await this.prisma.mcpPersonalAccessToken.update({
      where: { id: pat.id },
      data: {
        last_used_at: now
      }
    });

    return {
      userId: pat.user_id,
      tenantId: pat.tenant_id,
      scopes,
      clientId: `pat:${pat.id}`,
      patId: pat.id
    };
  }

  requireScope(context: McpAuthContext, scope: McpScope): void {
    if (!context.scopes.includes(scope)) {
      throw new OpenKBMcpError("FORBIDDEN", `MCP scope ${scope} is required.`, 403);
    }
  }

  async createPersonalAccessToken(input: CreateMcpPatInput): Promise<CreateMcpPatResult> {
    const email = requireText(input.userEmail, "MCP_PAT_USER_EMAIL").toLowerCase();
    const name = requireText(input.name, "MCP_PAT_NAME");
    const scopes = input.scopes ? assertAllowedScopes(input.scopes) : this.config.defaultScopes;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Active user was not found.", 404);
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: "asc" }
    });
    if (!membership) {
      throw new OpenKBMcpError("INVALID_INPUT", "User has no tenant membership.", 400);
    }

    const rawToken = `${this.config.patPrefix}${randomBytes(32).toString("base64url")}`;
    const expiresAt =
      input.expiresDays && input.expiresDays > 0
        ? new Date(this.now().getTime() + input.expiresDays * 24 * 60 * 60 * 1000)
        : null;

    const pat = await this.prisma.mcpPersonalAccessToken.create({
      data: {
        tenant_id: membership.tenant_id,
        user_id: user.id,
        name,
        token_hash: hashToken(rawToken),
        scopes,
        status: "active",
        expires_at: expiresAt,
        created_at: this.now()
      }
    });

    return {
      token: rawToken,
      id: pat.id,
      userId: user.id,
      tenantId: membership.tenant_id,
      name: pat.name,
      scopes,
      expiresAt: expiresAt ? expiresAt.toISOString() : null
    };
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function requireText(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return normalized;
}

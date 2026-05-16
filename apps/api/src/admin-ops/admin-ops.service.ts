import { randomBytes, createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import { decryptModelSecret, encryptModelSecret, getModelSecretLast4 } from "@openkb/model-client";

type ListInput = {
  limit?: number;
  offset?: number;
};

export type CreateDifyApiKeyInput = {
  name?: string;
  knowledge_id?: string;
  knowledge_base_id?: string;
  allowed_knowledge_base_ids?: string[];
  retrieval_top_k_limit?: number;
  expires_at?: string | null;
};

export type UpdateDifyApiKeyInput = {
  name?: string;
  status?: string;
  allowed_knowledge_base_ids?: string[];
  allowed_metadata_filters?: Prisma.InputJsonValue;
  retrieval_top_k_limit?: number;
  expires_at?: string | null;
};

export type UpsertDifyMappingInput = {
  dify_knowledge_id?: string;
  knowledge_base_id?: string;
  status?: string;
};

export type CreateMcpPatInput = {
  user_email?: string;
  name?: string;
  scopes?: string[];
  expires_at?: string | null;
};

export type CreateMcpOauthClientInput = {
  client_id?: string;
  client_name?: string;
  redirect_uris?: string[];
  allowed_scopes?: string[];
  status?: string;
};

export type UpdateMcpOauthClientInput = {
  client_name?: string;
  redirect_uris?: string[];
  allowed_scopes?: string[];
  status?: string;
};

const DEFAULT_DIFY_MAX_TOP_K = 20;
const DIFY_API_KEY_PREFIX = "dify_";
const MCP_PAT_PREFIX = "kbpat_";
const MCP_ALLOWED_SCOPES = [
  "kb:read",
  "kb:search",
  "doc:read",
  "profile:read",
  "kb:write",
  "doc:write",
  "toc:write"
] as const;

const DIFY_BUILT_IN_FILTERABLE_FIELDS = [
  {
    name: "document_name",
    type: "string",
    source: "dify_built_in",
    description: "Document title. OpenKB maps this to documents.title."
  },
  {
    name: "uploader",
    type: "string",
    source: "dify_built_in",
    description: "OpenKB document creator display name or email."
  },
  {
    name: "upload_date",
    type: "time",
    source: "dify_built_in",
    description: "OpenKB document created_at."
  },
  {
    name: "last_update_date",
    type: "time",
    source: "dify_built_in",
    description: "OpenKB document updated_at."
  },
  {
    name: "source",
    type: "string",
    source: "dify_built_in",
    description: "online_document or file_upload derived from the current version source."
  }
] as const;

const DIFY_OPENKB_FILTERABLE_FIELDS = [
  {
    name: "knowledge_base_title",
    type: "string",
    source: "openkb",
    description: "OpenKB knowledge base title."
  },
  {
    name: "document_title",
    type: "string",
    source: "openkb",
    description: "OpenKB document title."
  },
  {
    name: "document_slug",
    type: "string",
    source: "openkb",
    description: "OpenKB document slug."
  },
  {
    name: "tags",
    type: "string[]",
    source: "document_metadata",
    description:
      "Optional Dify-style tags stored as document metadata and mirrored in retrieval metadata."
  },
  {
    name: "openkb_retrieval.context_mode",
    type: "string",
    source: "openkb_technical",
    description: "Retrieval context mode such as parent_child."
  },
  {
    name: "chunk_type",
    type: "string",
    source: "openkb_technical",
    description: "OpenKB chunk type: general, parent, or child."
  },
  {
    name: "token_count",
    type: "number",
    source: "openkb_technical",
    description: "Chunk token estimate."
  }
] as const;

@Injectable()
export class AdminOpsService {
  private readonly prisma: PrismaClient;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getDifySetupSummary(sessionToken: string | null) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const [keys, mappings] = await Promise.all([
      this.prisma.difyApiKey.findMany({ where, orderBy: { created_at: "desc" }, take: 20 }),
      this.prisma.difyKnowledgeMapping.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: 50
      })
    ]);
    const knowledgeBaseIds = unique([
      ...mappings.map((mapping) => mapping.knowledge_base_id),
      ...keys.flatMap((key) => key.allowed_knowledge_base_ids)
    ]);
    const knowledgeBases = knowledgeBaseIds.length
      ? await this.prisma.knowledgeBase.findMany({
          where: { id: { in: knowledgeBaseIds } },
          select: { id: true, title: true, slug: true, tenant_id: true, workspace_id: true }
        })
      : [];
    const byId = new Map(knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase]));
    const endpointBaseUrl = normalizeEndpointBaseUrl(
      process.env.DIFY_ADAPTER_PUBLIC_URL ||
        process.env.DIFY_ADAPTER_BASE_URL ||
        process.env.OPENKB_DIFY_ADAPTER_BASE_URL ||
        "http://localhost:4200"
    );
    return {
      endpoint_base_url: endpointBaseUrl,
      retrieval_path: "/retrieval",
      endpoint_for_dify_ui: endpointBaseUrl,
      endpoint_note:
        "Dify External Knowledge UI stores the base URL and appends /retrieval automatically.",
      mappings: mappings.map((mapping) => ({
        ...toDifyMappingDto(mapping),
        knowledge_base_title: byId.get(mapping.knowledge_base_id)?.title ?? null,
        knowledge_base_slug: byId.get(mapping.knowledge_base_id)?.slug ?? null
      })),
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        status: key.status,
        api_key_last4: key.api_key_last4,
        retrieval_top_k_limit: key.retrieval_top_k_limit,
        allowed_knowledge_bases: key.allowed_knowledge_base_ids.map((id) => ({
          id,
          title: byId.get(id)?.title ?? null,
          slug: byId.get(id)?.slug ?? null
        }))
      })),
      test_request: {
        method: "POST",
        path: "/retrieval",
        body: {
          knowledge_id: mappings[0]?.dify_knowledge_id ?? "<external_knowledge_id>",
          query: "赤壁之战",
          retrieval_setting: { top_k: 5, score_threshold: 0 },
          metadata_condition: null
        }
      }
    };
  }

  async getDifyFilterableMetadata(
    sessionToken: string | null,
    input: { knowledge_base_id?: string } = {}
  ) {
    const me = await this.requireAdmin(sessionToken);
    let customFields: Array<{ name: string; type: string; source: string; description: string }> =
      [];
    if (input.knowledge_base_id) {
      await this.resolveKnowledgeBaseScope(me, [input.knowledge_base_id]);
      customFields = await this.loadDifyDocumentMetadataFields({
        knowledgeBaseIds: [input.knowledge_base_id]
      });
    } else {
      const mappingKnowledgeBaseIds = await this.prisma.difyKnowledgeMapping
        .findMany({
          where: { status: "active", ...this.tenantWhere(me) },
          select: { knowledge_base_id: true }
        })
        .then((mappings) => mappings.map((mapping) => mapping.knowledge_base_id));
      const keyKnowledgeBaseIds = await this.prisma.difyApiKey
        .findMany({
          where: { status: "active", ...this.tenantWhere(me) },
          select: { allowed_knowledge_base_ids: true }
        })
        .then((keys) => keys.flatMap((key) => key.allowed_knowledge_base_ids));
      const knowledgeBaseIds = unique([...mappingKnowledgeBaseIds, ...keyKnowledgeBaseIds]);
      customFields = knowledgeBaseIds.length
        ? await this.loadDifyDocumentMetadataFields({ knowledgeBaseIds })
        : [];
    }

    return {
      fields: [
        ...DIFY_BUILT_IN_FILTERABLE_FIELDS,
        ...customFields,
        ...DIFY_OPENKB_FILTERABLE_FIELDS
      ],
      note: "Dify metadata_condition is evaluated by OpenKB against returned metadata. Document metadata is the Dify-native layer; openkb_* fields are technical diagnostics."
    };
  }

  private async loadDifyDocumentMetadataFields(input: { knowledgeBaseIds: string[] }) {
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: { id: { in: input.knowledgeBaseIds } },
      select: { id: true, title: true }
    });
    const knowledgeBaseTitles = new Map(
      knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase.title])
    );
    const fields = await this.prisma.knowledgeBaseMetadataField.findMany({
      where: { knowledge_base_id: { in: input.knowledgeBaseIds }, status: "active" },
      orderBy: [{ knowledge_base_id: "asc" }, { sort_order: "asc" }, { created_at: "asc" }]
    });
    return fields.map((field) => ({
      name: field.name,
      type: field.type,
      source: "document_metadata",
      description: `OpenKB document metadata value from ${knowledgeBaseTitles.get(field.knowledge_base_id) ?? "a mapped knowledge base"}; preferred for Dify metadata_condition.`
    }));
  }

  async listDifyApiKeys(sessionToken: string | null, input: ListInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.difyApiKey.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.difyApiKey.count({ where })
    ]);

    return {
      items: items.map(toDifyApiKeyDto),
      limit,
      offset,
      total
    };
  }

  async createDifyApiKey(sessionToken: string | null, input: CreateDifyApiKeyInput) {
    const me = await this.requireAdmin(sessionToken);
    const name = requireText(input.name, "name");
    const knowledgeId = requireText(input.knowledge_id, "knowledge_id");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const allowedKnowledgeBaseIds = normalizeUuidList(
      input.allowed_knowledge_base_ids?.length
        ? input.allowed_knowledge_base_ids
        : [knowledgeBaseId]
    );
    const topKLimit = normalizeTopK(input.retrieval_top_k_limit);
    const expiresAt = parseNullableDate(input.expires_at);

    const targetScope = await this.resolveKnowledgeBaseScope(me, [
      ...new Set([knowledgeBaseId, ...allowedKnowledgeBaseIds])
    ]);

    const rawKey = `${process.env.DIFY_API_KEY_PREFIX || DIFY_API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const encryptedKey = encryptModelSecret(rawKey);
    const now = new Date();
    const apiKey = await this.prisma.$transaction(async (tx) => {
      const created = await tx.difyApiKey.create({
        data: {
          tenant_id: targetScope.tenantId,
          name,
          key_hash: hashToken(rawKey),
          encrypted_key: encryptedKey,
          api_key_last4: getModelSecretLast4(rawKey),
          status: "active",
          allowed_knowledge_base_ids: allowedKnowledgeBaseIds,
          allowed_metadata_filters: {},
          retrieval_top_k_limit: topKLimit,
          expires_at: expiresAt,
          created_by: me.user.id,
          created_at: now,
          updated_at: now
        }
      });
      await tx.difyKnowledgeMapping.upsert({
        where: {
          tenant_id_dify_knowledge_id: {
            tenant_id: created.tenant_id,
            dify_knowledge_id: knowledgeId
          }
        },
        create: {
          tenant_id: created.tenant_id,
          dify_knowledge_id: knowledgeId,
          knowledge_base_id: knowledgeBaseId,
          status: "active",
          created_by: me.user.id,
          created_at: now,
          updated_at: now
        },
        update: {
          knowledge_base_id: knowledgeBaseId,
          status: "active",
          created_by: me.user.id,
          updated_at: now
        }
      });
      await this.writeAudit(
        tx,
        me,
        "admin.dify.api_key.create",
        "dify_api_key",
        created.id,
        {
          knowledge_id: knowledgeId,
          knowledge_base_id: knowledgeBaseId,
          allowed_knowledge_base_ids: allowedKnowledgeBaseIds,
          raw_key_returned: true
        },
        created.tenant_id
      );
      return created;
    });

    return {
      item: toDifyApiKeyDto(apiKey),
      api_key: rawKey
    };
  }

  async updateDifyApiKey(sessionToken: string | null, id: string, input: UpdateDifyApiKeyInput) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.getDifyApiKeyInScope(me, id);
    const data: Prisma.DifyApiKeyUpdateInput = {};
    if (input.name !== undefined) {
      data.name = requireText(input.name, "name");
    }
    if (input.status !== undefined) {
      data.status = normalizeKeyStatus(input.status);
    }
    if (input.allowed_knowledge_base_ids !== undefined) {
      const ids = normalizeUuidList(input.allowed_knowledge_base_ids);
      await this.resolveKnowledgeBaseScope(me, ids, current.tenant_id);
      data.allowed_knowledge_base_ids = ids;
    }
    if (input.allowed_metadata_filters !== undefined) {
      data.allowed_metadata_filters = normalizeJsonObject(input.allowed_metadata_filters);
    }
    if (input.retrieval_top_k_limit !== undefined) {
      data.retrieval_top_k_limit = normalizeTopK(input.retrieval_top_k_limit);
    }
    if (input.expires_at !== undefined) {
      data.expires_at = parseNullableDate(input.expires_at);
    }
    data.updated_at = new Date();

    const updated = await this.prisma.difyApiKey.update({
      where: { id: current.id },
      data
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.dify.api_key.update",
      "dify_api_key",
      id,
      {
        fields: Object.keys(data).filter((field) => field !== "updated_at")
      },
      current.tenant_id
    );
    return toDifyApiKeyDto(updated);
  }

  async revealDifyApiKey(sessionToken: string | null, id: string) {
    const me = await this.requireAdmin(sessionToken);
    const key = await this.getDifyApiKeyInScope(me, id);
    if (!key.encrypted_key) {
      throw new AuthError(
        "SECRET_NOT_AVAILABLE",
        "This Dify API key was created before encrypted reveal support. Rotate it first.",
        400
      );
    }
    const rawKey = decryptModelSecret(key.encrypted_key);
    await this.writeAudit(
      this.prisma,
      me,
      "admin.dify.api_key.reveal",
      "dify_api_key",
      id,
      {
        key_last4: key.api_key_last4
      },
      key.tenant_id
    );
    return {
      item: toDifyApiKeyDto(key),
      api_key: rawKey
    };
  }

  async rotateDifyApiKey(sessionToken: string | null, id: string) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.getDifyApiKeyInScope(me, id);
    const rawKey = `${process.env.DIFY_API_KEY_PREFIX || DIFY_API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const updated = await this.prisma.difyApiKey.update({
      where: { id: current.id },
      data: {
        key_hash: hashToken(rawKey),
        encrypted_key: encryptModelSecret(rawKey),
        api_key_last4: getModelSecretLast4(rawKey),
        status: "active",
        updated_at: new Date()
      }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.dify.api_key.rotate",
      "dify_api_key",
      id,
      {
        raw_key_returned: true
      },
      current.tenant_id
    );
    return {
      item: toDifyApiKeyDto(updated),
      api_key: rawKey
    };
  }

  async revokeDifyApiKey(sessionToken: string | null, id: string) {
    return this.updateDifyApiKey(sessionToken, id, { status: "revoked" });
  }

  async listDifyMappings(sessionToken: string | null, input: ListInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const limit = normalizeLimit(input.limit, 100);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.difyKnowledgeMapping.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.difyKnowledgeMapping.count({ where })
    ]);
    return { items: items.map(toDifyMappingDto), limit, offset, total };
  }

  async upsertDifyMapping(sessionToken: string | null, input: UpsertDifyMappingInput) {
    const me = await this.requireAdmin(sessionToken);
    const knowledgeId = requireText(input.dify_knowledge_id, "dify_knowledge_id");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const targetScope = await this.resolveKnowledgeBaseScope(me, [knowledgeBaseId]);
    const status = normalizeMappingStatus(input.status ?? "active");
    const now = new Date();
    const tenantId = targetScope.tenantId;
    const mapping = await this.prisma.difyKnowledgeMapping.upsert({
      where: {
        tenant_id_dify_knowledge_id: {
          tenant_id: tenantId,
          dify_knowledge_id: knowledgeId
        }
      },
      create: {
        tenant_id: tenantId,
        dify_knowledge_id: knowledgeId,
        knowledge_base_id: knowledgeBaseId,
        status,
        created_by: me.user.id,
        created_at: now,
        updated_at: now
      },
      update: {
        knowledge_base_id: knowledgeBaseId,
        status,
        created_by: me.user.id,
        updated_at: now
      }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.dify.mapping.upsert",
      "dify_mapping",
      mapping.id,
      {
        dify_knowledge_id: knowledgeId,
        knowledge_base_id: knowledgeBaseId,
        status
      },
      mapping.tenant_id
    );
    return toDifyMappingDto(mapping);
  }

  async updateDifyMapping(sessionToken: string | null, id: string, input: UpsertDifyMappingInput) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.prisma.difyKnowledgeMapping.findFirst({
      where: { id, ...this.tenantWhere(me) }
    });
    if (!current) {
      throw new AuthError("OBJECT_NOT_FOUND", "Dify knowledge mapping was not found.", 404);
    }
    const data: Prisma.DifyKnowledgeMappingUpdateInput = { updated_at: new Date() };
    if (input.dify_knowledge_id !== undefined) {
      data.dify_knowledge_id = requireText(input.dify_knowledge_id, "dify_knowledge_id");
    }
    if (input.knowledge_base_id !== undefined) {
      const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
      await this.resolveKnowledgeBaseScope(me, [knowledgeBaseId], current.tenant_id);
      data.knowledge_base_id = knowledgeBaseId;
    }
    if (input.status !== undefined) {
      data.status = normalizeMappingStatus(input.status);
    }
    const mapping = await this.prisma.difyKnowledgeMapping.update({ where: { id }, data });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.dify.mapping.update",
      "dify_mapping",
      id,
      {
        fields: Object.keys(data).filter((field) => field !== "updated_at")
      },
      current.tenant_id
    );
    return toDifyMappingDto(mapping);
  }

  async listMcpPats(sessionToken: string | null, input: ListInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.mcpPersonalAccessToken.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.mcpPersonalAccessToken.count({ where })
    ]);
    const userMap = await this.loadUsersById(items.map((item) => item.user_id));
    return {
      items: items.map((item) => toMcpPatDto(item, userMap.get(item.user_id) ?? null)),
      limit,
      offset,
      total
    };
  }

  async createMcpPat(sessionToken: string | null, input: CreateMcpPatInput) {
    const me = await this.requireAdmin(sessionToken);
    const email = requireText(input.user_email, "user_email").toLowerCase();
    const name = requireText(input.name, "name");
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      throw new AuthError("OBJECT_NOT_FOUND", "Active MCP PAT user was not found.", 404);
    }
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        user_id: user.id,
        ...(me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId })
      },
      orderBy: { created_at: "asc" }
    });
    if (!membership) {
      throw new AuthError("OBJECT_NOT_FOUND", "User is not a member of this tenant.", 404);
    }
    const scopes = normalizeMcpScopes(input.scopes);
    const expiresAt = parseNullableDate(input.expires_at);
    const rawToken = `${process.env.MCP_PAT_PREFIX || MCP_PAT_PREFIX}${randomBytes(32).toString("base64url")}`;
    const pat = await this.prisma.mcpPersonalAccessToken.create({
      data: {
        tenant_id: membership.tenant_id,
        user_id: user.id,
        name,
        token_hash: hashToken(rawToken),
        scopes,
        status: "active",
        expires_at: expiresAt,
        created_at: new Date()
      }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.mcp.pat.create",
      "mcp_pat",
      pat.id,
      {
        user_id: user.id,
        scopes,
        raw_token_returned: true
      },
      pat.tenant_id
    );
    return {
      item: toMcpPatDto(pat, user),
      token: rawToken
    };
  }

  async revokeMcpPat(sessionToken: string | null, id: string) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.prisma.mcpPersonalAccessToken.findFirst({
      where: { id, ...this.tenantWhere(me) }
    });
    if (!current) {
      throw new AuthError("OBJECT_NOT_FOUND", "MCP PAT was not found.", 404);
    }
    const updated = await this.prisma.mcpPersonalAccessToken.update({
      where: { id },
      data: { status: "revoked", revoked_at: new Date() }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.mcp.pat.revoke",
      "mcp_pat",
      id,
      {},
      current.tenant_id
    );
    return toMcpPatDto(updated, await this.getPublicUser(updated.user_id));
  }

  async listMcpOauthClients(sessionToken: string | null, input: ListInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.mcpOauthClient.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.mcpOauthClient.count({ where })
    ]);
    return { items: items.map(toMcpOauthClientDto), limit, offset, total };
  }

  async createMcpOauthClient(sessionToken: string | null, input: CreateMcpOauthClientInput) {
    const me = await this.requireAdmin(sessionToken);
    const clientName = requireText(input.client_name, "client_name");
    const clientId = input.client_id?.trim() || `openkb_${randomBytes(12).toString("hex")}`;
    const status = normalizeKeyStatus(input.status ?? "active");
    const allowedScopes = normalizeMcpScopes(input.allowed_scopes);
    const client = await this.prisma.mcpOauthClient.create({
      data: {
        tenant_id: this.writeTenantId(me),
        client_id: clientId,
        client_name: clientName,
        redirect_uris: normalizeStringList(input.redirect_uris),
        allowed_scopes: allowedScopes,
        status,
        created_by: me.user.id,
        created_at: new Date()
      }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.mcp.oauth_client.create",
      "mcp_oauth_client",
      client.id,
      {
        client_id: client.client_id,
        allowed_scopes: allowedScopes
      },
      client.tenant_id
    );
    return toMcpOauthClientDto(client);
  }

  async updateMcpOauthClient(
    sessionToken: string | null,
    id: string,
    input: UpdateMcpOauthClientInput
  ) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.prisma.mcpOauthClient.findFirst({
      where: { id, ...this.tenantWhere(me) }
    });
    if (!current) {
      throw new AuthError("OBJECT_NOT_FOUND", "MCP OAuth client was not found.", 404);
    }
    const data: Prisma.McpOauthClientUpdateInput = { updated_at: new Date() };
    if (input.client_name !== undefined) {
      data.client_name = requireText(input.client_name, "client_name");
    }
    if (input.redirect_uris !== undefined) {
      data.redirect_uris = normalizeStringList(input.redirect_uris);
    }
    if (input.allowed_scopes !== undefined) {
      data.allowed_scopes = normalizeMcpScopes(input.allowed_scopes);
    }
    if (input.status !== undefined) {
      data.status = normalizeKeyStatus(input.status);
    }
    const client = await this.prisma.mcpOauthClient.update({ where: { id }, data });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.mcp.oauth_client.update",
      "mcp_oauth_client",
      id,
      {
        fields: Object.keys(data).filter((field) => field !== "updated_at")
      },
      current.tenant_id
    );
    return toMcpOauthClientDto(client);
  }

  async listMcpOauthGrants(sessionToken: string | null, input: ListInput = {}) {
    const me = await this.requireAdmin(sessionToken);
    const where = this.tenantWhere(me);
    const limit = normalizeLimit(input.limit, 50);
    const offset = normalizeOffset(input.offset);
    const [items, total] = await Promise.all([
      this.prisma.mcpOauthGrant.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset
      }),
      this.prisma.mcpOauthGrant.count({ where })
    ]);
    const userMap = await this.loadUsersById(items.map((item) => item.user_id));
    return {
      items: items.map((item) => toMcpOauthGrantDto(item, userMap.get(item.user_id) ?? null)),
      limit,
      offset,
      total
    };
  }

  async revokeMcpOauthGrant(sessionToken: string | null, id: string) {
    const me = await this.requireAdmin(sessionToken);
    const current = await this.prisma.mcpOauthGrant.findFirst({
      where: { id, ...this.tenantWhere(me) }
    });
    if (!current) {
      throw new AuthError("OBJECT_NOT_FOUND", "MCP OAuth grant was not found.", 404);
    }
    const grant = await this.prisma.mcpOauthGrant.update({
      where: { id },
      data: { status: "revoked", revoked_at: new Date() }
    });
    await this.writeAudit(
      this.prisma,
      me,
      "admin.mcp.oauth_grant.revoke",
      "mcp_oauth_grant",
      id,
      {},
      current.tenant_id
    );
    return toMcpOauthGrantDto(grant, await this.getPublicUser(grant.user_id));
  }

  private async requireAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin") && !me.roles.includes("tenant_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "Admin role is required.", 403);
    }
    return me;
  }

  private tenantWhere(me: AuthenticatedUser) {
    return me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId };
  }

  private writeTenantId(me: AuthenticatedUser) {
    return me.tenantId;
  }

  private async getDifyApiKeyInScope(me: AuthenticatedUser, id: string) {
    const key = await this.prisma.difyApiKey.findFirst({
      where: { id, ...this.tenantWhere(me) }
    });
    if (!key) {
      throw new AuthError("OBJECT_NOT_FOUND", "Dify API key was not found.", 404);
    }
    return key;
  }

  private async resolveKnowledgeBaseScope(
    me: AuthenticatedUser,
    ids: string[],
    expectedTenantId?: string
  ): Promise<{ tenantId: string }> {
    if (ids.length === 0) {
      throw new AuthError("INVALID_INPUT", "At least one knowledge base is required.", 400);
    }
    const uniqueIds = [...new Set(ids)];
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        id: { in: uniqueIds },
        status: "active",
        ...(me.roles.includes("system_admin") ? {} : { tenant_id: me.tenantId })
      },
      select: { id: true, tenant_id: true }
    });
    if (knowledgeBases.length !== uniqueIds.length) {
      throw new AuthError("OBJECT_NOT_FOUND", "One or more knowledge bases were not found.", 404);
    }
    const tenantIds = [...new Set(knowledgeBases.map((knowledgeBase) => knowledgeBase.tenant_id))];
    if (tenantIds.length !== 1) {
      throw new AuthError(
        "INVALID_INPUT",
        "All Dify knowledge bases must belong to the same tenant.",
        400
      );
    }
    const tenantId = tenantIds[0] as string;
    if (expectedTenantId && tenantId !== expectedTenantId) {
      throw new AuthError(
        "INVALID_INPUT",
        "Knowledge bases must belong to the target Dify object tenant.",
        400
      );
    }
    return { tenantId };
  }

  private async loadUsersById(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, email: true, display_name: true, status: true }
    });
    return new Map(users.map((user) => [user.id, toPublicUser(user)]));
  }

  private async getPublicUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, display_name: true, status: true }
    });
    return user ? toPublicUser(user) : null;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient | PrismaClient,
    me: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string,
    metadata: Prisma.InputJsonObject,
    tenantId?: string | null
  ) {
    const auditTenantId = tenantId ?? me.tenantId;
    const auditMetadata: Prisma.InputJsonObject =
      auditTenantId && auditTenantId !== me.tenantId
        ? { ...metadata, actor_tenant_id: me.tenantId }
        : metadata;
    await tx.auditLog.create({
      data: {
        tenant_id: auditTenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata: auditMetadata,
        created_at: new Date()
      }
    });
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEndpointBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireText(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new AuthError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return normalized;
}

function normalizeUuidList(value: string[] | undefined): string[] {
  const ids = [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new AuthError("INVALID_INPUT", "At least one knowledge base is required.", 400);
  }
  return ids;
}

function normalizeStringList(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
}

function normalizeMcpScopes(value: string[] | undefined): string[] {
  const scopes = normalizeStringList(value?.length ? value : ["kb:read", "kb:search", "doc:read"]);
  const invalid = scopes.filter((scope) => !MCP_ALLOWED_SCOPES.includes(scope as never));
  if (invalid.length > 0) {
    throw new AuthError("INVALID_INPUT", `Unsupported MCP scopes: ${invalid.join(", ")}`, 400);
  }
  return scopes;
}

function normalizeTopK(value: number | undefined): number {
  const max = Number.parseInt(process.env.DIFY_MAX_TOP_K ?? "", 10) || DEFAULT_DIFY_MAX_TOP_K;
  if (value === undefined || value === null) {
    return max;
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new AuthError("INVALID_INPUT", "retrieval_top_k_limit must be between 1 and 100.", 400);
  }
  return Math.min(value, max);
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(Math.trunc(value), 0);
}

function parseNullableDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuthError("INVALID_INPUT", "Date value is invalid.", 400);
  }
  return date;
}

function normalizeKeyStatus(value: string): string {
  if (value === "active" || value === "disabled" || value === "revoked") {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported status.", 400);
}

function normalizeMappingStatus(value: string): string {
  if (value === "active" || value === "disabled") {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported mapping status.", 400);
}

function normalizeJsonObject(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "JSON value must be an object.", 400);
}

function toDifyApiKeyDto(key: {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  allowed_knowledge_base_ids: string[];
  allowed_metadata_filters: Prisma.JsonValue;
  retrieval_top_k_limit: number;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  encrypted_key?: string | null;
  api_key_last4?: string | null;
}) {
  return {
    id: key.id,
    tenant_id: key.tenant_id,
    name: key.name,
    status: key.status,
    allowed_knowledge_base_ids: key.allowed_knowledge_base_ids,
    allowed_metadata_filters: key.allowed_metadata_filters,
    retrieval_top_k_limit: key.retrieval_top_k_limit,
    expires_at: key.expires_at ? key.expires_at.toISOString() : null,
    last_used_at: key.last_used_at ? key.last_used_at.toISOString() : null,
    created_by: key.created_by,
    created_at: key.created_at.toISOString(),
    updated_at: key.updated_at.toISOString(),
    api_key_last4: key.api_key_last4 ?? null,
    can_reveal: Boolean(key.encrypted_key)
  };
}

function toDifyMappingDto(mapping: {
  id: string;
  tenant_id: string;
  dify_knowledge_id: string;
  knowledge_base_id: string;
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: mapping.id,
    tenant_id: mapping.tenant_id,
    dify_knowledge_id: mapping.dify_knowledge_id,
    knowledge_base_id: mapping.knowledge_base_id,
    status: mapping.status,
    created_by: mapping.created_by,
    created_at: mapping.created_at.toISOString(),
    updated_at: mapping.updated_at.toISOString()
  };
}

function toPublicUser(user: { id: string; email: string; display_name: string; status: string }) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    status: user.status
  };
}

function toMcpPatDto(
  pat: {
    id: string;
    tenant_id: string;
    user_id: string;
    name: string;
    scopes: string[];
    status: string;
    expires_at: Date | null;
    last_used_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  },
  user: ReturnType<typeof toPublicUser> | null
) {
  return {
    id: pat.id,
    tenant_id: pat.tenant_id,
    user_id: pat.user_id,
    user,
    name: pat.name,
    scopes: pat.scopes,
    status: pat.status,
    expires_at: pat.expires_at ? pat.expires_at.toISOString() : null,
    last_used_at: pat.last_used_at ? pat.last_used_at.toISOString() : null,
    revoked_at: pat.revoked_at ? pat.revoked_at.toISOString() : null,
    created_at: pat.created_at.toISOString()
  };
}

function toMcpOauthClientDto(client: {
  id: string;
  tenant_id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: client.id,
    tenant_id: client.tenant_id,
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    allowed_scopes: client.allowed_scopes,
    status: client.status,
    created_by: client.created_by,
    created_at: client.created_at.toISOString(),
    updated_at: client.updated_at.toISOString()
  };
}

function toMcpOauthGrantDto(
  grant: {
    id: string;
    tenant_id: string;
    user_id: string;
    client_id: string;
    scopes: string[];
    status: string;
    expires_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
  },
  user: ReturnType<typeof toPublicUser> | null
) {
  return {
    id: grant.id,
    tenant_id: grant.tenant_id,
    user_id: grant.user_id,
    user,
    client_id: grant.client_id,
    scopes: grant.scopes,
    status: grant.status,
    expires_at: grant.expires_at ? grant.expires_at.toISOString() : null,
    revoked_at: grant.revoked_at ? grant.revoked_at.toISOString() : null,
    created_at: grant.created_at.toISOString()
  };
}

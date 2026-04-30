import { extractMarkdownOutline } from "@openkb/editor";
import { Prisma, createDatabaseClient, type PrismaClient } from "@openkb/db";
import { PermissionService } from "@openkb/permissions";
import { RetrievalService } from "@openkb/retrieval";

import { MCP_DEFAULT_LIMIT, MCP_DEFAULT_TOP_K, MCP_MAX_LIMIT, getMcpServerConfig } from "./config";
import { type McpAuthContext, McpAuthService } from "./auth";
import { OpenKBMcpError } from "./errors";

export type McpRequestMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export type McpServicesOptions = {
  prisma?: PrismaClient;
  permissions?: PermissionService;
  retrieval?: RetrievalService;
  auth?: McpAuthService;
  env?: NodeJS.ProcessEnv;
};

export class McpContentService {
  private readonly prisma: PrismaClient;
  private readonly permissions: PermissionService;
  private readonly retrieval: RetrievalService;
  private readonly auth: McpAuthService;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: McpServicesOptions = {}) {
    this.prisma = options.prisma ?? createDatabaseClient();
    this.permissions = options.permissions ?? new PermissionService({ prisma: this.prisma });
    this.retrieval =
      options.retrieval ??
      new RetrievalService({ prisma: this.prisma, permissions: this.permissions });
    this.auth = options.auth ?? new McpAuthService({ prisma: this.prisma, env: options.env });
    this.env = options.env ?? process.env;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async search(
    context: McpAuthContext,
    input: {
      query: unknown;
      knowledge_base_ids?: unknown;
      top_k?: unknown;
      filters?: unknown;
    },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:search");
    const config = getMcpServerConfig(this.env);
    const topK = normalizeTopK(input.top_k, config.maxTopK);
    const response = await this.retrieval.search({
      user: toRetrievalUserContext(context),
      query: input.query,
      knowledge_base_ids: input.knowledge_base_ids,
      top_k: topK,
      filters: input.filters
    });

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.search",
      query: response.query,
      documentIdsReturned: response.results.map((result) => result.document_id)
    });

    return response;
  }

  async listWorkspaces(
    context: McpAuthContext,
    input: { limit?: unknown } = {},
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:read");
    const limit = normalizeLimit(input.limit);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        tenant_id: context.tenantId,
        user_id: context.userId
      },
      orderBy: { created_at: "asc" },
      take: limit
    });
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: memberships.map((membership) => membership.workspace_id) } },
      orderBy: { created_at: "asc" }
    });
    const roleByWorkspace = new Map(
      memberships.map((membership) => [membership.workspace_id, membership.role])
    );
    const result = {
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: roleByWorkspace.get(workspace.id) ?? null,
        created_at: workspace.created_at.toISOString(),
        updated_at: workspace.updated_at.toISOString()
      }))
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.list_workspaces",
      documentIdsReturned: []
    });
    return result;
  }

  async listKnowledgeBases(
    context: McpAuthContext,
    input: { workspace_id?: unknown; limit?: unknown } = {},
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:read");
    const limit = normalizeLimit(input.limit);
    const workspaceId = optionalText(input.workspace_id, "workspace_id");
    if (workspaceId) {
      await this.permissions.requireCanRead(context.userId, "workspace", workspaceId);
    }

    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        tenant_id: context.tenantId,
        status: "active",
        ...(workspaceId ? { workspace_id: workspaceId } : {})
      },
      orderBy: { created_at: "asc" },
      take: limit
    });

    const readable = [];
    for (const knowledgeBase of knowledgeBases) {
      if (await this.permissions.canRead(context.userId, "knowledge_base", knowledgeBase.id)) {
        readable.push({
          id: knowledgeBase.id,
          workspace_id: knowledgeBase.workspace_id,
          title: knowledgeBase.title,
          slug: knowledgeBase.slug,
          visibility: knowledgeBase.visibility,
          status: knowledgeBase.status,
          created_at: knowledgeBase.created_at.toISOString(),
          updated_at: knowledgeBase.updated_at.toISOString()
        });
      }
    }

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.list_knowledge_bases",
      documentIdsReturned: []
    });
    return { knowledge_bases: readable };
  }

  async listDocuments(
    context: McpAuthContext,
    input: { knowledge_base_id?: unknown; parent_id?: unknown; limit?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:read");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const parentId = optionalText(input.parent_id, "parent_id");
    const limit = normalizeLimit(input.limit);
    await this.permissions.requireCanRead(context.userId, "knowledge_base", knowledgeBaseId);

    const documents = await this.prisma.document.findMany({
      where: {
        knowledge_base_id: knowledgeBaseId,
        status: { not: "deleted" },
        ...(parentId !== undefined ? { parent_id: parentId } : {})
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
      take: limit
    });

    const readable = [];
    for (const document of documents) {
      if (await this.permissions.canRead(context.userId, "document", document.id)) {
        readable.push(toDocumentMetadata(document));
      }
    }

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.list_documents",
      documentIdsReturned: readable.map((document) => document.id)
    });
    return { documents: readable };
  }

  async getDocument(
    context: McpAuthContext,
    input: { document_id?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:read");
    const documentId = requireText(input.document_id, "document_id");
    const { document, version } = await this.resolveReadableDocument(context, documentId);
    const result = {
      document: toDocumentMetadata(document),
      current_version: version
        ? {
            id: version.id,
            version_no: version.version_no,
            markdown_hash: version.markdown_hash,
            source_type: version.source_type,
            source_file_id: version.source_file_id,
            created_by: version.created_by,
            created_at: version.created_at.toISOString()
          }
        : null
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_document",
      documentIdsReturned: [document.id]
    });
    return result;
  }

  async getDocumentMarkdown(
    context: McpAuthContext,
    input: { document_id?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:read");
    const documentId = requireText(input.document_id, "document_id");
    const { document, version } = await this.resolveReadableDocument(context, documentId);
    const markdown = version?.markdown ?? "";
    const maxChars = getMcpServerConfig(this.env).maxDocumentChars;
    const truncated = markdown.length > maxChars;
    const result = {
      document: toDocumentMetadata(document),
      markdown: truncated ? markdown.slice(0, maxChars) : markdown,
      truncated,
      max_chars: maxChars
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_document_markdown",
      documentIdsReturned: [document.id]
    });
    return result;
  }

  async getToc(
    context: McpAuthContext,
    input: { document_id?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:read");
    const documentId = requireText(input.document_id, "document_id");
    const { document, version } = await this.resolveReadableDocument(context, documentId);
    const result = {
      document: toDocumentMetadata(document),
      outline: extractMarkdownOutline(version?.markdown ?? "")
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_toc",
      documentIdsReturned: [document.id]
    });
    return result;
  }

  async readResource(context: McpAuthContext, uri: string, meta: McpRequestMeta = {}) {
    const parsed = parseKbResourceUri(uri);
    let payload: unknown;
    let documentIdsReturned: string[] = [];

    if (parsed.type === "workspace") {
      this.auth.requireScope(context, "kb:read");
      await this.permissions.requireCanRead(context.userId, "workspace", parsed.id);
      const workspace = await this.prisma.workspace.findUnique({ where: { id: parsed.id } });
      if (!workspace) {
        throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
      }
      payload = {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          created_at: workspace.created_at.toISOString(),
          updated_at: workspace.updated_at.toISOString()
        }
      };
    } else if (parsed.type === "knowledge_base") {
      this.auth.requireScope(context, "kb:read");
      await this.permissions.requireCanRead(context.userId, "knowledge_base", parsed.id);
      const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
        where: { id: parsed.id }
      });
      if (!knowledgeBase) {
        throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
      }
      payload = {
        knowledge_base: {
          id: knowledgeBase.id,
          workspace_id: knowledgeBase.workspace_id,
          title: knowledgeBase.title,
          slug: knowledgeBase.slug,
          visibility: knowledgeBase.visibility,
          status: knowledgeBase.status,
          created_at: knowledgeBase.created_at.toISOString(),
          updated_at: knowledgeBase.updated_at.toISOString()
        }
      };
    } else if (parsed.type === "document") {
      this.auth.requireScope(context, "doc:read");
      const { document, version } = await this.resolveReadableDocument(context, parsed.id);
      const metadata = toDocumentMetadata(document);
      if (parsed.variant === "markdown") {
        const markdown = version?.markdown ?? "";
        const maxChars = getMcpServerConfig(this.env).maxDocumentChars;
        payload = {
          document: metadata,
          markdown: markdown.length > maxChars ? markdown.slice(0, maxChars) : markdown,
          truncated: markdown.length > maxChars,
          max_chars: maxChars
        };
      } else if (parsed.variant === "toc") {
        payload = {
          document: metadata,
          outline: extractMarkdownOutline(version?.markdown ?? "")
        };
      } else {
        payload = {
          document: metadata,
          current_version: version
            ? {
                id: version.id,
                version_no: version.version_no,
                markdown_hash: version.markdown_hash,
                source_type: version.source_type,
                source_file_id: version.source_file_id,
                created_by: version.created_by,
                created_at: version.created_at.toISOString()
              }
            : null
        };
      }
      documentIdsReturned = [parsed.id];
    } else {
      throw new OpenKBMcpError("INVALID_INPUT", "Resource URI is invalid.", 400);
    }

    await this.audit(context, "mcp.resource.read", {
      meta,
      resourceUri: uri,
      documentIdsReturned
    });

    return payload;
  }

  private async resolveReadableDocument(context: McpAuthContext, documentId: string) {
    await this.permissions.requireCanRead(context.userId, "document", documentId);
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.status === "deleted") {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    const version = document.current_version_id
      ? await this.prisma.documentVersion.findUnique({ where: { id: document.current_version_id } })
      : null;
    return { document, version };
  }

  private async audit(
    context: McpAuthContext,
    action: "mcp.tool.call" | "mcp.resource.read",
    input: {
      meta: McpRequestMeta;
      toolName?: string;
      resourceUri?: string;
      query?: string;
      documentIdsReturned: string[];
    }
  ) {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: context.tenantId,
        actor_user_id: context.userId,
        actor_type: "user",
        action,
        object_type: input.toolName ? "mcp_tool" : "mcp_resource",
        object_id: null,
        metadata: removeUndefined({
          client_id: context.clientId,
          pat_id: context.patId,
          tool_name: input.toolName,
          resource_uri: input.resourceUri,
          query: input.query,
          document_ids_returned: input.documentIdsReturned,
          scopes: context.scopes
        }),
        ip: input.meta.ip ?? null,
        user_agent: input.meta.userAgent ?? null,
        created_at: new Date()
      }
    });
  }
}

function removeUndefined(input: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Prisma.InputJsonObject;
}

export function jsonText(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function toRetrievalUserContext(context: McpAuthContext) {
  return {
    user: {
      id: context.userId
    },
    tenantId: context.tenantId,
    roles: []
  };
}

function normalizeTopK(value: unknown, maxTopK: number): number {
  if (value === undefined || value === null) {
    return MCP_DEFAULT_TOP_K;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new OpenKBMcpError("INVALID_INPUT", "top_k must be a positive integer.", 400);
  }
  return Math.min(value, maxTopK);
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return MCP_DEFAULT_LIMIT;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new OpenKBMcpError("INVALID_INPUT", "limit must be a positive integer.", 400);
  }
  return Math.min(value, MCP_MAX_LIMIT);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} must be a string.`, 400);
  }
  return value.trim();
}

function parseKbResourceUri(
  uri: string
):
  | { type: "workspace"; id: string }
  | { type: "knowledge_base"; id: string }
  | { type: "document"; id: string; variant?: "markdown" | "toc" } {
  const workspace = /^kb:\/\/workspace\/([^/]+)$/.exec(uri);
  if (workspace?.[1]) {
    return { type: "workspace", id: decodeURIComponent(workspace[1]) };
  }
  const knowledgeBase = /^kb:\/\/knowledge-base\/([^/]+)$/.exec(uri);
  if (knowledgeBase?.[1]) {
    return { type: "knowledge_base", id: decodeURIComponent(knowledgeBase[1]) };
  }
  const document = /^kb:\/\/document\/([^/]+)(?:\/(markdown|toc))?$/.exec(uri);
  if (document?.[1]) {
    return {
      type: "document",
      id: decodeURIComponent(document[1]),
      variant: document[2] as "markdown" | "toc" | undefined
    };
  }
  throw new OpenKBMcpError("INVALID_INPUT", "Resource URI is invalid.", 400);
}

function toDocumentMetadata(document: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  knowledge_base_id: string;
  parent_id: string | null;
  type: string;
  title: string;
  slug: string;
  status: string;
  permission_mode: string;
  visibility: string | null;
  current_version_id: string | null;
  sort_order: number;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: document.id,
    tenant_id: document.tenant_id,
    workspace_id: document.workspace_id,
    knowledge_base_id: document.knowledge_base_id,
    parent_id: document.parent_id,
    type: document.type,
    title: document.title,
    slug: document.slug,
    status: document.status,
    permission_mode: document.permission_mode,
    visibility: document.visibility,
    current_version_id: document.current_version_id,
    sort_order: document.sort_order,
    created_by: document.created_by,
    updated_by: document.updated_by,
    created_at: document.created_at.toISOString(),
    updated_at: document.updated_at.toISOString()
  };
}

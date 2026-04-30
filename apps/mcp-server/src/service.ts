import { createHash } from "node:crypto";

import {
  extractMarkdownOutline,
  normalizeMarkdownSource,
  validateMarkdownSource
} from "@openkb/editor";
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

  async getCurrentUser(context: McpAuthContext, meta: McpRequestMeta = {}) {
    this.auth.requireScope(context, "profile:read");
    const [user, tenant] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: context.userId } }),
      this.prisma.tenant.findUnique({ where: { id: context.tenantId } })
    ]);
    if (!user || !tenant) {
      throw new OpenKBMcpError(
        "OBJECT_NOT_FOUND",
        "Current MCP user or tenant was not found.",
        404
      );
    }

    const result = {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        status: user.status
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug
      },
      client_id: context.clientId,
      scopes: context.scopes
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_current_user",
      documentIdsReturned: []
    });
    return result;
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

  async getKnowledgeBase(
    context: McpAuthContext,
    input: { knowledge_base_id?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:read");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const knowledgeBase = await this.resolveReadableKnowledgeBase(context, knowledgeBaseId);
    const result = { knowledge_base: toKnowledgeBaseMetadata(knowledgeBase) };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_knowledge_base",
      objectType: "knowledge_base",
      objectId: knowledgeBase.id,
      documentIdsReturned: []
    });
    return result;
  }

  async createKnowledgeBase(
    context: McpAuthContext,
    input: {
      workspace_id?: unknown;
      title?: unknown;
      slug?: unknown;
      visibility?: unknown;
    },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:write");
    const workspaceId = requireText(input.workspace_id, "workspace_id");
    await this.resolveManagedWorkspace(context, workspaceId);

    const title = requireText(input.title, "title");
    const slug = normalizeSlug(optionalText(input.slug, "slug") ?? title);
    const visibility = normalizeVisibility(input.visibility ?? "private");
    const now = new Date();

    const knowledgeBase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeBase.create({
        data: {
          tenant_id: context.tenantId,
          workspace_id: workspaceId,
          title,
          slug,
          visibility,
          status: "active",
          created_by: context.userId,
          created_at: now,
          updated_at: now
        }
      });
      await tx.collaborator.create({
        data: {
          tenant_id: context.tenantId,
          object_type: "knowledge_base",
          object_id: created.id,
          subject_type: "user",
          subject_id: context.userId,
          role: "owner",
          source: "system",
          created_by: context.userId,
          created_at: now
        }
      });
      return created;
    });

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.create_knowledge_base",
      objectType: "knowledge_base",
      objectId: knowledgeBase.id,
      documentIdsReturned: []
    });
    return { knowledge_base: toKnowledgeBaseMetadata(knowledgeBase) };
  }

  async updateKnowledgeBase(
    context: McpAuthContext,
    input: {
      knowledge_base_id?: unknown;
      title?: unknown;
      slug?: unknown;
      visibility?: unknown;
      status?: unknown;
    },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:write");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    await this.resolveManagedKnowledgeBase(context, knowledgeBaseId);

    const knowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: {
        ...(input.title !== undefined ? { title: requireText(input.title, "title") } : {}),
        ...(input.slug !== undefined
          ? { slug: normalizeSlug(requireText(input.slug, "slug")) }
          : {}),
        ...(input.visibility !== undefined
          ? { visibility: normalizeVisibility(input.visibility) }
          : {}),
        ...(input.status !== undefined
          ? { status: normalizeKnowledgeBaseStatus(input.status) }
          : {}),
        updated_at: new Date()
      }
    });

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.update_knowledge_base",
      objectType: "knowledge_base",
      objectId: knowledgeBase.id,
      documentIdsReturned: []
    });
    return { knowledge_base: toKnowledgeBaseMetadata(knowledgeBase) };
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

  async createDocument(
    context: McpAuthContext,
    input: {
      knowledge_base_id?: unknown;
      parent_id?: unknown;
      type?: unknown;
      title?: unknown;
      slug?: unknown;
      markdown?: unknown;
      sort_order?: unknown;
    },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:write");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const parentId = optionalNullableText(input.parent_id, "parent_id") ?? null;
    const knowledgeBase = await this.resolveReadableKnowledgeBase(context, knowledgeBaseId);
    if (parentId) {
      await this.permissions.requireCanEdit(context.userId, "document", parentId);
      await this.assertValidParentDocument(knowledgeBaseId, parentId);
    } else {
      await this.permissions.requireCanEdit(context.userId, "knowledge_base", knowledgeBaseId);
    }

    const type = normalizeDocumentType(input.type ?? "page");
    const title = requireText(input.title, "title");
    const slug = normalizeSlug(optionalText(input.slug, "slug") ?? title);
    const markdown =
      type === "page"
        ? normalizeAndValidateMarkdown(optionalText(input.markdown, "markdown") ?? "")
        : "";
    const sortOrder = optionalInteger(input.sort_order, "sort_order") ?? 0;
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          tenant_id: context.tenantId,
          workspace_id: knowledgeBase.workspace_id,
          knowledge_base_id: knowledgeBase.id,
          parent_id: parentId,
          type,
          title,
          slug,
          status: "draft",
          permission_mode: "inherit",
          sort_order: sortOrder,
          created_by: context.userId,
          updated_by: context.userId,
          created_at: now,
          updated_at: now
        }
      });
      const version =
        type === "page"
          ? await this.createDocumentVersion(tx, context, document.id, markdown, now)
          : null;
      await tx.collaborator.create({
        data: {
          tenant_id: context.tenantId,
          object_type: "document",
          object_id: document.id,
          subject_type: "user",
          subject_id: context.userId,
          role: "owner",
          source: "system",
          created_by: context.userId,
          created_at: now
        }
      });
      return {
        document: version
          ? await tx.document.findUniqueOrThrow({ where: { id: document.id } })
          : document,
        version
      };
    });

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.create_document",
      objectType: "document",
      objectId: created.document.id,
      newVersionId: created.version?.id,
      documentIdsReturned: [created.document.id]
    });
    return this.documentWithVersionPayload(created.document, created.version);
  }

  async updateDocument(
    context: McpAuthContext,
    input: {
      document_id?: unknown;
      title?: unknown;
      slug?: unknown;
      parent_id?: unknown;
      markdown?: unknown;
      markdown_hash?: unknown;
      base_version_id?: unknown;
      status?: unknown;
      permission_mode?: unknown;
      visibility?: unknown;
      sort_order?: unknown;
    },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "doc:write");
    const documentId = requireText(input.document_id, "document_id");
    await this.permissions.requireCanEdit(context.userId, "document", documentId);
    const current = await this.resolveDocumentInTenant(context, documentId);

    const requiresManage =
      input.parent_id !== undefined ||
      input.sort_order !== undefined ||
      input.permission_mode !== undefined ||
      input.visibility !== undefined ||
      input.status !== undefined;
    if (requiresManage) {
      await this.permissions.requireCanManage(context.userId, "document", documentId);
    }

    if (input.markdown !== undefined) {
      if (input.base_version_id === undefined) {
        throw new OpenKBMcpError(
          "INVALID_INPUT",
          "base_version_id is required when markdown is updated.",
          400
        );
      }
      if (input.markdown_hash === undefined) {
        throw new OpenKBMcpError(
          "INVALID_INPUT",
          "markdown_hash is required when markdown is updated.",
          400
        );
      }
    }

    if (
      input.base_version_id !== undefined &&
      optionalNullableText(input.base_version_id, "base_version_id") !== current.current_version_id
    ) {
      const currentVersion = current.current_version_id
        ? await this.prisma.documentVersion.findUnique({
            where: { id: current.current_version_id }
          })
        : null;
      throw new OpenKBMcpError("VERSION_CONFLICT", "Document version conflict.", 409, {
        current_version_id: current.current_version_id,
        current_version: currentVersion ? toDocumentVersionMetadata(currentVersion) : null,
        updated_at: current.updated_at.toISOString()
      });
    }

    const normalizedMarkdown =
      input.markdown !== undefined
        ? normalizeAndValidateMarkdown(requireString(input.markdown, "markdown"))
        : undefined;
    if (
      normalizedMarkdown !== undefined &&
      requireText(input.markdown_hash, "markdown_hash") !== markdownHash(normalizedMarkdown)
    ) {
      throw new OpenKBMcpError("INVALID_INPUT", "markdown_hash does not match markdown.", 400);
    }

    const nextParentId =
      input.parent_id !== undefined
        ? optionalNullableText(input.parent_id, "parent_id")
        : undefined;
    if (nextParentId !== undefined) {
      await this.assertValidDocumentMove(current, nextParentId);
    }
    const sortOrder = optionalInteger(input.sort_order, "sort_order");
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...(input.title !== undefined ? { title: requireText(input.title, "title") } : {}),
          ...(input.slug !== undefined
            ? { slug: normalizeSlug(requireText(input.slug, "slug")) }
            : {}),
          ...(input.status !== undefined ? { status: normalizeDocumentStatus(input.status) } : {}),
          ...(input.permission_mode !== undefined
            ? { permission_mode: normalizePermissionMode(input.permission_mode) }
            : {}),
          ...(input.visibility !== undefined
            ? {
                visibility: input.visibility === null ? null : normalizeVisibility(input.visibility)
              }
            : {}),
          ...(nextParentId !== undefined ? { parent_id: nextParentId } : {}),
          ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
          updated_by: context.userId,
          updated_at: now
        }
      });
      const version =
        normalizedMarkdown !== undefined && current.type === "page"
          ? await this.createDocumentVersion(tx, context, documentId, normalizedMarkdown, now)
          : current.current_version_id
            ? await tx.documentVersion.findUnique({ where: { id: current.current_version_id } })
            : null;
      return {
        document: await tx.document.findUniqueOrThrow({ where: { id: documentId } }),
        version
      };
    });

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.update_document",
      objectType: "document",
      objectId: updated.document.id,
      baseVersionId: optionalNullableText(input.base_version_id, "base_version_id") ?? undefined,
      newVersionId: updated.version?.id,
      documentIdsReturned: [updated.document.id]
    });
    return this.documentWithVersionPayload(updated.document, updated.version);
  }

  async getKnowledgeBaseToc(
    context: McpAuthContext,
    input: { knowledge_base_id?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "kb:read");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const knowledgeBase = await this.resolveReadableKnowledgeBase(context, knowledgeBaseId);
    const documents = await this.getReadableKnowledgeBaseDocuments(context, knowledgeBase.id);
    const result = {
      knowledge_base: toKnowledgeBaseMetadata(knowledgeBase),
      toc: buildDocumentTree(documents)
    };

    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.get_knowledge_base_toc",
      objectType: "knowledge_base",
      objectId: knowledgeBase.id,
      documentIdsReturned: documents.map((document) => document.id)
    });
    return result;
  }

  async updateKnowledgeBaseToc(
    context: McpAuthContext,
    input: { knowledge_base_id?: unknown; operations?: unknown },
    meta: McpRequestMeta = {}
  ) {
    this.auth.requireScope(context, "toc:write");
    const knowledgeBaseId = requireText(input.knowledge_base_id, "knowledge_base_id");
    const knowledgeBase = await this.resolveManagedKnowledgeBase(context, knowledgeBaseId);
    const operations = normalizeTocOperations(input.operations);
    const now = new Date();
    const touchedDocumentIds = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const operation of operations) {
        const document = await tx.document.findUnique({ where: { id: operation.documentId } });
        if (!document || document.tenant_id !== context.tenantId || document.status === "deleted") {
          throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Document was not found.", 404);
        }
        if (document.knowledge_base_id !== knowledgeBase.id) {
          throw new OpenKBMcpError(
            "INVALID_INPUT",
            "Document does not belong to the knowledge base.",
            400
          );
        }
        touchedDocumentIds.add(document.id);

        if (operation.action === "move") {
          await this.assertValidDocumentMove(document, operation.parentId, tx);
          await tx.document.update({
            where: { id: document.id },
            data: {
              parent_id: operation.parentId,
              ...(operation.sortOrder !== undefined ? { sort_order: operation.sortOrder } : {}),
              updated_by: context.userId,
              updated_at: now
            }
          });
        } else if (operation.action === "rename") {
          await tx.document.update({
            where: { id: document.id },
            data: {
              title: requireText(operation.title, "title"),
              ...(operation.slug !== undefined ? { slug: normalizeSlug(operation.slug) } : {}),
              updated_by: context.userId,
              updated_at: now
            }
          });
        } else if (operation.action === "reorder") {
          await tx.document.update({
            where: { id: document.id },
            data: {
              sort_order: operation.sortOrder,
              updated_by: context.userId,
              updated_at: now
            }
          });
        }
      }
    });

    const documents = await this.getReadableKnowledgeBaseDocuments(context, knowledgeBase.id);
    await this.audit(context, "mcp.tool.call", {
      meta,
      toolName: "kb.update_knowledge_base_toc",
      objectType: "knowledge_base",
      objectId: knowledgeBase.id,
      documentIdsReturned: [...touchedDocumentIds]
    });
    return {
      knowledge_base: toKnowledgeBaseMetadata(knowledgeBase),
      toc: buildDocumentTree(documents)
    };
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
      const knowledgeBase = await this.resolveReadableKnowledgeBase(context, parsed.id);
      if (parsed.variant === "toc") {
        const documents = await this.getReadableKnowledgeBaseDocuments(context, knowledgeBase.id);
        payload = {
          knowledge_base: toKnowledgeBaseMetadata(knowledgeBase),
          toc: buildDocumentTree(documents)
        };
        documentIdsReturned = documents.map((document) => document.id);
      } else {
        payload = {
          knowledge_base: toKnowledgeBaseMetadata(knowledgeBase)
        };
      }
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

  private async resolveReadableKnowledgeBase(context: McpAuthContext, knowledgeBaseId: string) {
    await this.permissions.requireCanRead(context.userId, "knowledge_base", knowledgeBaseId);
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (
      !knowledgeBase ||
      knowledgeBase.tenant_id !== context.tenantId ||
      knowledgeBase.status !== "active"
    ) {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    return knowledgeBase;
  }

  private async resolveManagedWorkspace(context: McpAuthContext, workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || workspace.tenant_id !== context.tenantId) {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Workspace was not found.", 404);
    }
    await this.permissions.requireCanManage(context.userId, "workspace", workspaceId);
    return workspace;
  }

  private async resolveManagedKnowledgeBase(context: McpAuthContext, knowledgeBaseId: string) {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId }
    });
    if (
      !knowledgeBase ||
      knowledgeBase.tenant_id !== context.tenantId ||
      knowledgeBase.status !== "active"
    ) {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Knowledge base was not found.", 404);
    }
    await this.permissions.requireCanManage(context.userId, "knowledge_base", knowledgeBaseId);
    return knowledgeBase;
  }

  private async resolveDocumentInTenant(context: McpAuthContext, documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.tenant_id !== context.tenantId || document.status === "deleted") {
      throw new OpenKBMcpError("OBJECT_NOT_FOUND", "Document was not found.", 404);
    }
    return document;
  }

  private async createDocumentVersion(
    tx: Prisma.TransactionClient,
    context: McpAuthContext,
    documentId: string,
    markdown: string,
    now: Date
  ) {
    const latest = await tx.documentVersion.findFirst({
      where: { document_id: documentId },
      orderBy: { version_no: "desc" }
    });
    const version = await tx.documentVersion.create({
      data: {
        tenant_id: context.tenantId,
        document_id: documentId,
        version_no: latest ? latest.version_no + 1 : 1,
        markdown,
        markdown_hash: markdownHash(markdown),
        source_type: "api",
        created_by: context.userId,
        created_at: now
      }
    });
    await tx.document.update({
      where: { id: documentId },
      data: {
        current_version_id: version.id,
        updated_by: context.userId,
        updated_at: now
      }
    });
    return version;
  }

  private documentWithVersionPayload(
    document: Parameters<typeof toDocumentMetadata>[0],
    version: Parameters<typeof toDocumentVersionMetadata>[0] | null
  ) {
    return {
      document: toDocumentMetadata(document),
      current_version: version ? toDocumentVersionMetadata(version) : null
    };
  }

  private async assertValidParentDocument(knowledgeBaseId: string, parentId: string) {
    const parent = await this.prisma.document.findUnique({ where: { id: parentId } });
    if (
      !parent ||
      parent.knowledge_base_id !== knowledgeBaseId ||
      parent.status === "deleted" ||
      parent.type !== "folder"
    ) {
      throw new OpenKBMcpError("INVALID_INPUT", "Parent folder is invalid.", 400);
    }
    return parent;
  }

  private async assertValidDocumentMove(
    document: Parameters<typeof toDocumentMetadata>[0],
    parentId: string | null,
    prisma: Prisma.TransactionClient | PrismaClient = this.prisma
  ) {
    if (!parentId) {
      return;
    }
    if (parentId === document.id) {
      throw new OpenKBMcpError("INVALID_INPUT", "Document cannot be moved under itself.", 400);
    }
    const parent = await prisma.document.findUnique({ where: { id: parentId } });
    if (
      !parent ||
      parent.knowledge_base_id !== document.knowledge_base_id ||
      parent.status === "deleted" ||
      parent.type !== "folder"
    ) {
      throw new OpenKBMcpError("INVALID_INPUT", "Parent folder is invalid.", 400);
    }

    let cursor: string | null = parent.parent_id;
    while (cursor) {
      if (cursor === document.id) {
        throw new OpenKBMcpError("INVALID_INPUT", "Document tree move would create a cycle.", 400);
      }
      const ancestor = await prisma.document.findUnique({ where: { id: cursor } });
      cursor = ancestor?.parent_id ?? null;
    }
  }

  private async getReadableKnowledgeBaseDocuments(
    context: McpAuthContext,
    knowledgeBaseId: string
  ) {
    const documents = await this.prisma.document.findMany({
      where: {
        tenant_id: context.tenantId,
        knowledge_base_id: knowledgeBaseId,
        status: { not: "deleted" }
      },
      orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
    });

    const readable = [];
    for (const document of documents) {
      if (await this.permissions.canRead(context.userId, "document", document.id)) {
        readable.push(document);
      }
    }
    return readable;
  }

  private async audit(
    context: McpAuthContext,
    action: "mcp.tool.call" | "mcp.resource.read",
    input: {
      meta: McpRequestMeta;
      toolName?: string;
      resourceUri?: string;
      query?: string;
      objectType?: string;
      objectId?: string;
      baseVersionId?: string;
      newVersionId?: string;
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
          object_type: input.objectType,
          object_id: input.objectId,
          base_version_id: input.baseVersionId,
          new_version_id: input.newVersionId,
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

function normalizeVisibility(value: unknown): "private" | "workspace" | "public" {
  if (value === "private" || value === "workspace" || value === "public") {
    return value;
  }
  throw new OpenKBMcpError("INVALID_INPUT", "visibility is invalid.", 400);
}

function normalizeKnowledgeBaseStatus(value: unknown): "active" | "archived" {
  if (value === "active" || value === "archived") {
    return value;
  }
  throw new OpenKBMcpError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeDocumentStatus(value: unknown): "draft" | "published" | "archived" {
  if (value === "draft" || value === "published" || value === "archived") {
    return value;
  }
  throw new OpenKBMcpError("INVALID_INPUT", "status is invalid.", 400);
}

function normalizeDocumentType(value: unknown): "folder" | "page" {
  if (value === "folder" || value === "page") {
    return value;
  }
  throw new OpenKBMcpError("INVALID_INPUT", "document type is invalid.", 400);
}

function normalizePermissionMode(value: unknown): "inherit" | "custom" {
  if (value === "inherit" || value === "custom") {
    return value;
  }
  throw new OpenKBMcpError("INVALID_INPUT", "permission_mode is invalid.", 400);
}

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new OpenKBMcpError("INVALID_INPUT", "slug is invalid.", 400);
  }
  return slug;
}

function normalizeAndValidateMarkdown(markdown: string): string {
  const normalized = normalizeMarkdownSource(markdown);
  const validation = validateMarkdownSource(normalized);
  if (!validation.ok) {
    throw new OpenKBMcpError(
      "MARKDOWN_DIALECT_ERROR",
      "Markdown is outside the enabled Milkdown dialect.",
      400,
      { issues: validation.issues }
    );
  }
  return normalized;
}

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} is required.`, 400);
  }
  return value.trim();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} must be a string.`, 400);
  }
  return value;
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

function optionalNullableText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} must be a string or null.`, 400);
  }
  return value.trim();
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new OpenKBMcpError("INVALID_INPUT", `${field} must be an integer.`, 400);
  }
  return value;
}

type TocOperation =
  | {
      action: "move";
      documentId: string;
      parentId: string | null;
      sortOrder?: number;
    }
  | {
      action: "rename";
      documentId: string;
      title: string;
      slug?: string;
    }
  | {
      action: "reorder";
      documentId: string;
      sortOrder: number;
    };

function normalizeTocOperations(value: unknown): TocOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new OpenKBMcpError("INVALID_INPUT", "operations must be a non-empty array.", 400);
  }

  return value.map((operation, index): TocOperation => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new OpenKBMcpError("INVALID_INPUT", `operations[${index}] must be an object.`, 400);
    }
    const record = operation as Record<string, unknown>;
    const action = requireText(record.action, `operations[${index}].action`);
    if (action === "delete" || action === "remove") {
      throw new OpenKBMcpError("INVALID_INPUT", "TOC delete/remove is not supported in MCP.", 400);
    }
    const documentId = requireText(record.document_id, `operations[${index}].document_id`);

    if (action === "move") {
      return {
        action,
        documentId,
        parentId: optionalNullableText(record.parent_id, `operations[${index}].parent_id`) ?? null,
        sortOrder: optionalInteger(record.sort_order, `operations[${index}].sort_order`)
      };
    }
    if (action === "rename") {
      const slug = optionalText(record.slug, `operations[${index}].slug`);
      return {
        action,
        documentId,
        title: requireText(record.title, `operations[${index}].title`),
        ...(slug ? { slug } : {})
      };
    }
    if (action === "reorder") {
      const sortOrder = optionalInteger(record.sort_order, `operations[${index}].sort_order`);
      if (sortOrder === undefined) {
        throw new OpenKBMcpError(
          "INVALID_INPUT",
          `operations[${index}].sort_order is required.`,
          400
        );
      }
      return {
        action,
        documentId,
        sortOrder
      };
    }

    throw new OpenKBMcpError("INVALID_INPUT", "TOC action must be move, rename or reorder.", 400);
  });
}

function parseKbResourceUri(
  uri: string
):
  | { type: "workspace"; id: string }
  | { type: "knowledge_base"; id: string; variant?: "toc" }
  | { type: "document"; id: string; variant?: "markdown" | "toc" } {
  const workspace = /^kb:\/\/workspace\/([^/]+)$/.exec(uri);
  if (workspace?.[1]) {
    return { type: "workspace", id: decodeURIComponent(workspace[1]) };
  }
  const knowledgeBase = /^kb:\/\/knowledge-base\/([^/]+)(?:\/(toc))?$/.exec(uri);
  if (knowledgeBase?.[1]) {
    return {
      type: "knowledge_base",
      id: decodeURIComponent(knowledgeBase[1]),
      variant: knowledgeBase[2] as "toc" | undefined
    };
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

function toKnowledgeBaseMetadata(knowledgeBase: {
  id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  slug: string;
  visibility: string;
  status: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: knowledgeBase.id,
    tenant_id: knowledgeBase.tenant_id,
    workspace_id: knowledgeBase.workspace_id,
    title: knowledgeBase.title,
    slug: knowledgeBase.slug,
    visibility: knowledgeBase.visibility,
    status: knowledgeBase.status,
    created_by: knowledgeBase.created_by,
    created_at: knowledgeBase.created_at.toISOString(),
    updated_at: knowledgeBase.updated_at.toISOString()
  };
}

function toDocumentVersionMetadata(version: {
  id: string;
  document_id: string;
  version_no: number;
  markdown_hash: string;
  source_type: string;
  source_file_id?: string | null;
  created_by: string;
  created_at: Date;
}) {
  return {
    id: version.id,
    document_id: version.document_id,
    version_no: version.version_no,
    markdown_hash: version.markdown_hash,
    source_type: version.source_type,
    source_file_id: version.source_file_id ?? null,
    created_by: version.created_by,
    created_at: version.created_at.toISOString()
  };
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

type DocumentTreeNode = ReturnType<typeof toDocumentMetadata> & {
  children: DocumentTreeNode[];
};

function buildDocumentTree(
  documents: Array<Parameters<typeof toDocumentMetadata>[0]>
): DocumentTreeNode[] {
  const nodes = new Map<string, DocumentTreeNode>();
  for (const document of documents) {
    nodes.set(document.id, {
      ...toDocumentMetadata(document),
      children: []
    });
  }

  const roots: DocumentTreeNode[] = [];
  for (const document of documents) {
    const node = nodes.get(document.id);
    if (!node) {
      continue;
    }
    const parent = document.parent_id ? nodes.get(document.parent_id) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

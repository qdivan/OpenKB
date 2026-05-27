import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import * as z from "zod/v4";

import { getMcpHealth } from "./health";
import { McpAuthService, type McpAuthContext } from "./auth";
import { MCP_ALLOWED_SCOPES, getMcpServerConfig } from "./config";
import { OpenKBMcpError, toJsonError } from "./errors";
import { McpContentService, jsonText, type McpRequestMeta } from "./service";
import { McpOAuthService, type OAuthHttpResult } from "./oauth";

type OpenKBIncomingMessage = IncomingMessage & {
  auth?: AuthInfo;
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
} as const;

export type OpenKBMcpHttpServerOptions = {
  env?: NodeJS.ProcessEnv;
  auth?: McpAuthService;
  content?: McpContentService;
  oauth?: McpOAuthService;
};

const metadataConditionItemSchema = z
  .object({
    name: z.string().optional(),
    field: z.string().optional(),
    key: z.string().optional(),
    comparison_operator: z.string().optional(),
    operator: z.string().optional(),
    value: z.unknown().optional()
  })
  .passthrough();

const metadataConditionSchema = z
  .object({
    logical_operator: z.enum(["and", "or"]).optional(),
    conditions: z.array(metadataConditionItemSchema).optional()
  })
  .passthrough();

const retrievalModelInputSchema = z
  .object({
    search_method: z
      .enum(["semantic_search", "full_text_search", "hybrid_search", "keyword_search"])
      .optional(),
    top_k: z.number().int().positive().optional(),
    score_threshold_enabled: z.boolean().optional(),
    score_threshold: z.number().min(0).max(1).optional(),
    reranking_enable: z.boolean().optional(),
    weights: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

const searchInputSchema = {
  query: z.string(),
  knowledge_base_ids: z.array(z.string()).optional(),
  top_k: z.number().int().positive().optional(),
  score_threshold: z.number().min(0).max(1).optional(),
  retrieval_model: retrievalModelInputSchema.optional(),
  filters: z
    .object({
      tags: z.array(z.string()).optional(),
      metadata_condition: metadataConditionSchema.optional(),
      metadataCondition: metadataConditionSchema.optional()
    })
    .passthrough()
    .optional(),
  context_mode: z.enum(["chunk", "parent_child", "paragraph_parent_child", "full_text"]).optional()
};

const documentInputSchema = {
  document_id: z.string()
};

const knowledgeBaseInputSchema = {
  knowledge_base_id: z.string()
};

const createKnowledgeBaseInputSchema = {
  workspace_id: z.string(),
  title: z.string(),
  slug: z.string().optional(),
  visibility: z.enum(["private", "workspace", "public"]).optional()
};

const updateKnowledgeBaseInputSchema = {
  knowledge_base_id: z.string(),
  title: z.string().optional(),
  slug: z.string().optional(),
  visibility: z.enum(["private", "workspace", "public"]).optional(),
  status: z.enum(["active", "archived"]).optional()
};

const createDocumentInputSchema = {
  knowledge_base_id: z.string(),
  parent_id: z.string().nullable().optional(),
  type: z.enum(["page", "folder"]).optional(),
  title: z.string(),
  slug: z.string().optional(),
  markdown: z.string().optional(),
  sort_order: z.number().int().optional()
};

const updateDocumentInputSchema = {
  document_id: z.string(),
  title: z.string().optional(),
  slug: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  markdown: z.string().optional(),
  markdown_hash: z.string().optional(),
  base_version_id: z.string().nullable().optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  permission_mode: z.enum(["inherit", "custom"]).optional(),
  visibility: z.enum(["private", "workspace", "public"]).nullable().optional(),
  sort_order: z.number().int().optional()
};

const listWorkspacesInputSchema = {
  limit: z.number().int().positive().optional()
};

const listKnowledgeBasesInputSchema = {
  workspace_id: z.string().optional(),
  limit: z.number().int().positive().optional()
};

const listDocumentsInputSchema = {
  knowledge_base_id: z.string(),
  parent_id: z.string().optional(),
  limit: z.number().int().positive().optional()
};

const tocOperationSchema = z.object({
  action: z.string(),
  document_id: z.string(),
  parent_id: z.string().nullable().optional(),
  title: z.string().optional(),
  slug: z.string().optional(),
  sort_order: z.number().int().optional()
});

const updateKnowledgeBaseTocInputSchema = {
  knowledge_base_id: z.string(),
  operations: z.array(tocOperationSchema).min(1)
};

export function createOpenKBMcpServer(
  context: McpAuthContext,
  meta: McpRequestMeta,
  content = new McpContentService()
): McpServer {
  const server = new McpServer({
    name: "openkb-mcp-server",
    version: "0.3.3"
  });

  server.registerTool(
    "kb.get_current_user",
    {
      title: "Get current OpenKB MCP user",
      description: "Read the user, tenant and scopes bound to the current MCP token.",
      inputSchema: {}
    },
    async () => toolJson(() => content.getCurrentUser(context, meta))
  );

  server.registerTool(
    "kb.search",
    {
      title: "Search OpenKB",
      description: "Search readable OpenKB chunks using the user-bound retrieval service.",
      inputSchema: searchInputSchema
    },
    async (input) =>
      toolJson(() =>
        content.search(
          context,
          {
            query: input.query,
            knowledge_base_ids: input.knowledge_base_ids,
            top_k: input.top_k,
            score_threshold: input.score_threshold,
            retrieval_model: input.retrieval_model,
            filters: input.filters,
            context_mode: input.context_mode
          },
          meta
        )
      )
  );

  server.registerTool(
    "kb.get_document",
    {
      title: "Get OpenKB document metadata",
      description: "Read metadata for a document the current user can access.",
      inputSchema: documentInputSchema
    },
    async (input) => toolJson(() => content.getDocument(context, input, meta))
  );

  server.registerTool(
    "kb.get_document_markdown",
    {
      title: "Get OpenKB document Markdown",
      description: "Read full Markdown for a document the current user can access.",
      inputSchema: documentInputSchema
    },
    async (input) => toolJson(() => content.getDocumentMarkdown(context, input, meta))
  );

  server.registerTool(
    "kb.get_toc",
    {
      title: "Get OpenKB document outline",
      description: "Extract the Markdown heading outline for a readable document.",
      inputSchema: documentInputSchema
    },
    async (input) => toolJson(() => content.getToc(context, input, meta))
  );

  server.registerTool(
    "kb.get_knowledge_base",
    {
      title: "Get OpenKB knowledge base",
      description: "Read metadata for a knowledge base the current user can access.",
      inputSchema: knowledgeBaseInputSchema
    },
    async (input) => toolJson(() => content.getKnowledgeBase(context, input, meta))
  );

  server.registerTool(
    "kb.create_knowledge_base",
    {
      title: "Create OpenKB knowledge base",
      description: "Create a knowledge base in a workspace the current user can manage.",
      inputSchema: createKnowledgeBaseInputSchema
    },
    async (input) => toolJson(() => content.createKnowledgeBase(context, input, meta))
  );

  server.registerTool(
    "kb.update_knowledge_base",
    {
      title: "Update OpenKB knowledge base",
      description: "Update metadata for a knowledge base the current user can manage.",
      inputSchema: updateKnowledgeBaseInputSchema
    },
    async (input) => toolJson(() => content.updateKnowledgeBase(context, input, meta))
  );

  server.registerTool(
    "kb.create_document",
    {
      title: "Create OpenKB document",
      description: "Create a document or folder using OpenKB Markdown rules.",
      inputSchema: createDocumentInputSchema
    },
    async (input) => toolJson(() => content.createDocument(context, input, meta))
  );

  server.registerTool(
    "kb.update_document",
    {
      title: "Update OpenKB document",
      description: "Update a document with permission, Markdown and version conflict checks.",
      inputSchema: updateDocumentInputSchema
    },
    async (input) => toolJson(() => content.updateDocument(context, input, meta))
  );

  server.registerTool(
    "kb.get_knowledge_base_toc",
    {
      title: "Get OpenKB knowledge base TOC",
      description: "Read the Yuque-style document tree for a readable knowledge base.",
      inputSchema: knowledgeBaseInputSchema
    },
    async (input) => toolJson(() => content.getKnowledgeBaseToc(context, input, meta))
  );

  server.registerTool(
    "kb.update_knowledge_base_toc",
    {
      title: "Update OpenKB knowledge base TOC",
      description: "Move, rename or reorder existing document tree nodes.",
      inputSchema: updateKnowledgeBaseTocInputSchema
    },
    async (input) => toolJson(() => content.updateKnowledgeBaseToc(context, input, meta))
  );

  server.registerTool(
    "kb.list_workspaces",
    {
      title: "List OpenKB workspaces",
      description: "List workspaces the current user belongs to.",
      inputSchema: listWorkspacesInputSchema
    },
    async (input) => toolJson(() => content.listWorkspaces(context, input, meta))
  );

  server.registerTool(
    "kb.list_knowledge_bases",
    {
      title: "List OpenKB knowledge bases",
      description: "List knowledge bases readable by the current user.",
      inputSchema: listKnowledgeBasesInputSchema
    },
    async (input) => toolJson(() => content.listKnowledgeBases(context, input, meta))
  );

  server.registerTool(
    "kb.list_documents",
    {
      title: "List OpenKB documents",
      description: "List documents in a readable knowledge base.",
      inputSchema: listDocumentsInputSchema
    },
    async (input) => toolJson(() => content.listDocuments(context, input, meta))
  );

  registerResource(server, "workspace", "kb://workspace/{workspace_id}", context, meta, content);
  registerResource(
    server,
    "knowledge-base",
    "kb://knowledge-base/{knowledge_base_id}",
    context,
    meta,
    content
  );
  registerResource(
    server,
    "knowledge-base-toc",
    "kb://knowledge-base/{knowledge_base_id}/toc",
    context,
    meta,
    content
  );
  registerResource(server, "document", "kb://document/{document_id}", context, meta, content);
  registerResource(
    server,
    "document-markdown",
    "kb://document/{document_id}/markdown",
    context,
    meta,
    content
  );
  registerResource(
    server,
    "document-toc",
    "kb://document/{document_id}/toc",
    context,
    meta,
    content
  );

  return server;
}

export function createOpenKBMcpHttpServer(options: OpenKBMcpHttpServerOptions = {}) {
  const env = options.env ?? process.env;
  const auth = options.auth ?? new McpAuthService({ env });
  const content = options.content ?? new McpContentService({ env, auth });
  const oauth = options.oauth ?? new McpOAuthService({ env });

  return createServer(async (request: OpenKBIncomingMessage, response) => {
    try {
      const url = new URL(request.url ?? "/", getMcpServerConfig(env).baseUrl);
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, getMcpHealth());
        return;
      }

      if (request.method === "GET" && url.pathname === "/metrics") {
        sendText(response, 200, getMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, getProtectedResourceMetadata(env));
        return;
      }

      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        sendJson(response, 200, oauth.getAuthorizationServerMetadata());
        return;
      }

      if (request.method === "GET" && url.pathname === "/oauth/authorize") {
        sendOAuthResult(response, await oauth.authorizeGet(url, request.headers.cookie));
        return;
      }

      if (request.method === "POST" && url.pathname === "/oauth/authorize") {
        sendOAuthResult(
          response,
          await oauth.authorizePost(await readTextBody(request, 64 * 1024), request.headers.cookie)
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/oauth/token") {
        sendOAuthResult(response, await oauth.token(await readTextBody(request, 64 * 1024)));
        return;
      }

      if (request.method === "POST" && url.pathname === "/oauth/revoke") {
        sendOAuthResult(response, await oauth.revoke(await readTextBody(request, 64 * 1024)));
        return;
      }

      if ((request.method === "POST" || request.method === "GET") && url.pathname === "/mcp") {
        const context = await auth.authenticateAuthorizationHeader(request.headers.authorization);
        request.auth = toSdkAuthInfo(context);
        const meta = getRequestMeta(request);
        const server = createOpenKBMcpServer(context, meta, content);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        });
        await server.connect(transport);
        await transport.handleRequest(request, response);
        return;
      }

      sendJson(response, 404, { error: "NOT_FOUND", message: "Route was not found." });
    } catch (error) {
      const { statusCode, payload } = toJsonError(error);
      if (statusCode === 401) {
        response.setHeader(
          "WWW-Authenticate",
          `Bearer resource_metadata="${getMcpServerConfig(env).baseUrl}/.well-known/oauth-protected-resource"`
        );
      }
      sendJson(response, statusCode, payload);
    }
  });
}

export function getProtectedResourceMetadata(env: NodeJS.ProcessEnv = process.env) {
  const config = getMcpServerConfig(env);
  return {
    resource: `${config.baseUrl}/mcp`,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: MCP_ALLOWED_SCOPES,
    openkb_auth: {
      pat_prefix: config.patPrefix,
      oauth_status: "authorization_code_pkce"
    }
  };
}

function registerResource(
  server: McpServer,
  name: string,
  uriTemplate: string,
  context: McpAuthContext,
  meta: McpRequestMeta,
  content: McpContentService
) {
  server.registerResource(
    name,
    new ResourceTemplate(uriTemplate, { list: undefined }),
    {
      title: name,
      description: `OpenKB ${name} resource`,
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await content.readResource(context, uri.href, meta), null, 2)
        }
      ]
    })
  );
}

async function toolJson(callback: () => Promise<unknown>) {
  try {
    return jsonText(await callback());
  } catch (error) {
    const { payload } = toJsonError(error);
    return {
      isError: true,
      ...jsonText(payload)
    };
  }
}

function toSdkAuthInfo(context: McpAuthContext): AuthInfo {
  return {
    token: context.patId ?? context.oauthGrantId ?? context.clientId,
    clientId: context.clientId,
    scopes: context.scopes,
    extra: {
      user_id: context.userId,
      tenant_id: context.tenantId,
      pat_id: context.patId,
      oauth_grant_id: context.oauthGrantId
    }
  };
}

function getRequestMeta(request: IncomingMessage): McpRequestMeta {
  return {
    ip: getFirstHeader(request.headers["x-forwarded-for"]) ?? request.socket.remoteAddress ?? null,
    userAgent: getFirstHeader(request.headers["user-agent"]) ?? null
  };
}

function getFirstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(statusCode, { "content-type": "application/json", ...SECURITY_HEADERS });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...SECURITY_HEADERS
  });
  response.end(body);
}

function sendOAuthResult(response: ServerResponse, result: OAuthHttpResult): void {
  if (response.headersSent) {
    return;
  }
  const headers = {
    "content-type":
      typeof result.body === "string" ? "text/html; charset=utf-8" : "application/json",
    ...SECURITY_HEADERS,
    ...(result.headers ?? {})
  };
  response.writeHead(result.status, headers);
  response.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
}

async function readTextBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new OpenKBMcpError("INVALID_INPUT", "Request body is too large.", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getMetrics(): string {
  return (
    [
      "# HELP openkb_mcp_info OpenKB MCP service info.",
      "# TYPE openkb_mcp_info gauge",
      'openkb_mcp_info{service="openkb-mcp-server"} 1',
      "# HELP openkb_mcp_uptime_seconds OpenKB MCP process uptime.",
      "# TYPE openkb_mcp_uptime_seconds gauge",
      `openkb_mcp_uptime_seconds ${Math.floor(process.uptime())}`
    ].join("\n") + "\n"
  );
}

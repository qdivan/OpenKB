import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import * as z from "zod/v4";

import { getMcpHealth } from "./health";
import { McpAuthService, type McpAuthContext } from "./auth";
import { getMcpServerConfig } from "./config";
import { OpenKBMcpError, toJsonError } from "./errors";
import { McpContentService, jsonText, type McpRequestMeta } from "./service";

type OpenKBIncomingMessage = IncomingMessage & {
  auth?: AuthInfo;
};

export type OpenKBMcpHttpServerOptions = {
  env?: NodeJS.ProcessEnv;
  auth?: McpAuthService;
  content?: McpContentService;
};

const searchInputSchema = {
  query: z.string(),
  knowledge_base_ids: z.array(z.string()).optional(),
  top_k: z.number().int().positive().optional(),
  filters: z
    .object({
      tags: z.array(z.string()).optional()
    })
    .optional()
};

const documentInputSchema = {
  document_id: z.string()
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
            filters: input.filters
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

  return createServer(async (request: OpenKBIncomingMessage, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, getMcpHealth());
        return;
      }

      if (request.method === "GET" && request.url === "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, getProtectedResourceMetadata(env));
        return;
      }

      if ((request.method === "POST" || request.method === "GET") && request.url === "/mcp") {
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
    authorization_servers: [],
    bearer_methods_supported: ["header"],
    scopes_supported: ["kb:read", "kb:search", "doc:read"],
    openkb_auth: {
      pat_prefix: config.patPrefix,
      oauth_status: "not_configured_in_phase_9"
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
    token: context.patId,
    clientId: context.clientId,
    scopes: context.scopes,
    extra: {
      user_id: context.userId,
      tenant_id: context.tenantId,
      pat_id: context.patId
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
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

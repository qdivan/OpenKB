import { type Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDatabaseClient, type PrismaClient } from "@openkb/db";
import { DEV_ADMIN_EMAIL, seedDev, type SeedDevResult } from "@openkb/db/seed-dev";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { McpAuthService } from "./auth";
import { McpContentService } from "./service";
import { createOpenKBMcpHttpServer } from "./server";

let prisma: PrismaClient;
let auth: McpAuthService;
let content: McpContentService;
let server: Server;
let baseUrl: string;
let seed: SeedDevResult;

describe("OpenKB MCP Streamable HTTP", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for MCP integration tests.");
    }

    prisma = createDatabaseClient();
    seed = await seedDev({ prisma });
    auth = new McpAuthService({ prisma, env: process.env });
    content = new McpContentService({ prisma, auth, env: process.env });
    server = createOpenKBMcpHttpServer({ auth, content, env: process.env });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("MCP test server did not expose a TCP address.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await prisma.$disconnect();
  });

  it("returns protected resource metadata and rejects missing Bearer auth", async () => {
    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`).then((res) =>
      res.json()
    );
    expect(metadata).toMatchObject({
      resource: "http://localhost:4100/mcp",
      scopes_supported: ["kb:read", "kb:search", "doc:read"]
    });

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "AUTHENTICATION_REQUIRED"
    });
  });

  it("lists tools, searches, reads markdown and writes audit logs with a PAT", async () => {
    const pat = await createPat("phase-9-protocol");
    const client = await createClient(pat.token);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "kb.search",
          "kb.get_document",
          "kb.get_document_markdown",
          "kb.get_toc",
          "kb.list_workspaces",
          "kb.list_knowledge_bases",
          "kb.list_documents"
        ])
      );

      const search = parseToolJson(
        await client.callTool({
          name: "kb.search",
          arguments: {
            query: "Phase 7",
            top_k: 5
          }
        })
      ) as { results: Array<Record<string, unknown>> };
      expect(search.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            document_id: seed.documentId,
            title: "Welcome to OpenKB"
          })
        ])
      );

      const markdown = parseToolJson(
        await client.callTool({
          name: "kb.get_document_markdown",
          arguments: {
            document_id: seed.documentId
          }
        })
      ) as {
        truncated: boolean;
        document: { id: string; title: string };
        markdown: string;
      };
      expect(markdown).toMatchObject({
        truncated: false,
        document: {
          id: seed.documentId,
          title: "Welcome to OpenKB"
        }
      });
      expect(markdown.markdown).toContain("Welcome to OpenKB");

      const toc = JSON.parse(
        (
          await client.readResource({
            uri: `kb://document/${seed.documentId}/toc`
          })
        ).contents[0]?.text ?? "{}"
      ) as { outline: Array<Record<string, unknown>> };
      expect(toc.outline).toEqual([
        expect.objectContaining({
          title: "Welcome to OpenKB"
        })
      ]);

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          actor_user_id: seed.userId,
          action: { in: ["mcp.tool.call", "mcp.resource.read"] }
        }
      });
      const patAuditLogs = auditLogs.filter(
        (log) => (log.metadata as Record<string, unknown>).pat_id === pat.id
      );
      expect(patAuditLogs.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(patAuditLogs.map((log) => log.metadata))).not.toContain(pat.token);
    } finally {
      await client.close();
    }
  }, 120_000);

  it("does not leak document data to a PAT user without content permission", async () => {
    const user = await prisma.user.upsert({
      where: { email: "mcp-no-access@openkb.local" },
      create: {
        email: "mcp-no-access@openkb.local",
        display_name: "MCP No Access",
        status: "active",
        email_verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      },
      update: {
        status: "active",
        updated_at: new Date()
      }
    });
    await prisma.tenantMembership.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: seed.tenantId,
          user_id: user.id
        }
      },
      create: {
        tenant_id: seed.tenantId,
        user_id: user.id,
        role: "member",
        created_at: new Date()
      },
      update: {
        role: "member"
      }
    });

    const pat = await auth.createPersonalAccessToken({
      userEmail: user.email,
      name: "no-access",
      scopes: ["doc:read", "kb:read", "kb:search"]
    });
    const client = await createClient(pat.token);

    try {
      const result = await client.callTool({
        name: "kb.get_document_markdown",
        arguments: {
          document_id: seed.documentId
        }
      });
      expect(result.isError).toBe(true);
      const payload = parseToolJson(result);
      expect(payload.error).toBe("FORBIDDEN");
      expect(JSON.stringify(payload)).not.toContain("Welcome to OpenKB");
    } finally {
      await client.close();
    }
  });

  it("invalidates revoked PATs immediately", async () => {
    const pat = await createPat("phase-9-revoked");
    await prisma.mcpPersonalAccessToken.update({
      where: { id: pat.id },
      data: {
        status: "revoked",
        revoked_at: new Date()
      }
    });

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pat.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "AUTHENTICATION_REQUIRED"
    });
  });
});

async function createPat(name: string) {
  return auth.createPersonalAccessToken({
    userEmail: DEV_ADMIN_EMAIL,
    name,
    scopes: ["kb:read", "kb:search", "doc:read"]
  });
}

async function createClient(token: string): Promise<Client> {
  const client = new Client({
    name: "openkb-mcp-test-client",
    version: "0.0.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  });
  await client.connect(transport);
  return client;
}

function parseToolJson(result: {
  content: Array<{ type: string; text?: string } | Record<string, unknown>>;
}): Record<string, unknown> {
  const text = result.content.find((item) => item.type === "text" && "text" in item)?.text;
  if (!text) {
    throw new Error("MCP tool result did not include text content.");
  }
  return JSON.parse(text);
}

import { type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";

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
      scopes_supported: expect.arrayContaining([
        "kb:read",
        "kb:search",
        "doc:read",
        "profile:read",
        "kb:write",
        "doc:write",
        "toc:write"
      ])
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
          "kb.get_current_user",
          "kb.get_knowledge_base",
          "kb.create_knowledge_base",
          "kb.update_knowledge_base",
          "kb.create_document",
          "kb.update_document",
          "kb.get_knowledge_base_toc",
          "kb.update_knowledge_base_toc",
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

      const configuredSearch = parseToolJson(
        await client.callTool({
          name: "kb.search",
          arguments: {
            query: "Phase 7",
            top_k: 1,
            score_threshold: 0,
            retrieval_model: {
              search_method: "full_text_search",
              top_k: 1,
              score_threshold_enabled: true,
              score_threshold: 0,
              reranking_enable: false
            },
            filters: {
              tags: [],
              metadata_condition: {
                logical_operator: "and",
                conditions: []
              }
            },
            context_mode: "chunk"
          }
        })
      ) as { results: Array<Record<string, unknown>>; metadata?: Record<string, unknown> };
      expect(configuredSearch.results.length).toBeLessThanOrEqual(1);
      expect(configuredSearch.metadata).toMatchObject({
        retrieval_mode: expect.any(String),
        score_threshold_applied: 0
      });

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

  it("rejects write tools for read-only PATs", async () => {
    const pat = await createPat("phase-9-read-only");
    const client = await createClient(pat.token);

    try {
      const result = await client.callTool({
        name: "kb.create_document",
        arguments: {
          knowledge_base_id: seed.knowledgeBaseId,
          title: "Should Not Write",
          markdown: "# Nope"
        }
      });
      expect(result.isError).toBe(true);
      expect(parseToolJson(result)).toMatchObject({
        error: "FORBIDDEN"
      });
    } finally {
      await client.close();
    }
  });

  it("creates and updates knowledge bases, documents and TOC with explicit write scopes", async () => {
    const pat = await createPat("phase-9-write", [
      "profile:read",
      "kb:read",
      "kb:search",
      "doc:read",
      "kb:write",
      "doc:write",
      "toc:write"
    ]);
    const client = await createClient(pat.token);
    const suffix = randomUUID().slice(0, 8);

    try {
      const user = parseToolJson(
        await client.callTool({ name: "kb.get_current_user", arguments: {} })
      ) as {
        user: { email: string };
        scopes: string[];
      };
      expect(user.user.email).toBe(DEV_ADMIN_EMAIL);
      expect(user.scopes).toContain("doc:write");

      const createdKb = parseToolJson(
        await client.callTool({
          name: "kb.create_knowledge_base",
          arguments: {
            workspace_id: seed.workspaceId,
            title: `MCP KB ${suffix}`,
            slug: `mcp-kb-${suffix}`,
            visibility: "private"
          }
        })
      ) as { knowledge_base: { id: string; title: string; visibility: string } };
      expect(createdKb.knowledge_base).toMatchObject({
        title: `MCP KB ${suffix}`,
        visibility: "private"
      });

      const updatedKb = parseToolJson(
        await client.callTool({
          name: "kb.update_knowledge_base",
          arguments: {
            knowledge_base_id: createdKb.knowledge_base.id,
            title: `MCP KB Updated ${suffix}`,
            visibility: "workspace"
          }
        })
      ) as { knowledge_base: { id: string; title: string; visibility: string } };
      expect(updatedKb.knowledge_base).toMatchObject({
        id: createdKb.knowledge_base.id,
        title: `MCP KB Updated ${suffix}`,
        visibility: "workspace"
      });

      const folder = parseToolJson(
        await client.callTool({
          name: "kb.create_document",
          arguments: {
            knowledge_base_id: createdKb.knowledge_base.id,
            type: "folder",
            title: `Folder ${suffix}`,
            slug: `folder-${suffix}`,
            sort_order: 10
          }
        })
      ) as { document: { id: string; title: string; type: string } };
      expect(folder.document).toMatchObject({ type: "folder", title: `Folder ${suffix}` });

      const markdown = `# MCP Page ${suffix}\n\nCreated from MCP.`;
      const page = parseToolJson(
        await client.callTool({
          name: "kb.create_document",
          arguments: {
            knowledge_base_id: createdKb.knowledge_base.id,
            parent_id: folder.document.id,
            type: "page",
            title: `Page ${suffix}`,
            slug: `page-${suffix}`,
            markdown,
            sort_order: 20
          }
        })
      ) as {
        document: { id: string; parent_id: string; title: string };
        current_version: { id: string; markdown_hash: string };
      };
      expect(page.document).toMatchObject({
        parent_id: folder.document.id,
        title: `Page ${suffix}`
      });

      const nextMarkdown = `# MCP Page ${suffix}\n\nUpdated from MCP.`;
      const updatedPage = parseToolJson(
        await client.callTool({
          name: "kb.update_document",
          arguments: {
            document_id: page.document.id,
            base_version_id: page.current_version.id,
            markdown: nextMarkdown,
            markdown_hash: markdownHash(nextMarkdown),
            title: `Page Updated ${suffix}`
          }
        })
      ) as {
        document: { id: string; title: string };
        current_version: { id: string };
      };
      expect(updatedPage.document.title).toBe(`Page Updated ${suffix}`);
      expect(updatedPage.current_version.id).not.toBe(page.current_version.id);

      const toc = parseToolJson(
        await client.callTool({
          name: "kb.get_knowledge_base_toc",
          arguments: {
            knowledge_base_id: createdKb.knowledge_base.id
          }
        })
      ) as { toc: Array<{ id: string; children: Array<{ id: string }> }> };
      expect(JSON.stringify(toc.toc)).toContain(page.document.id);

      const updatedToc = parseToolJson(
        await client.callTool({
          name: "kb.update_knowledge_base_toc",
          arguments: {
            knowledge_base_id: createdKb.knowledge_base.id,
            operations: [
              {
                action: "move",
                document_id: page.document.id,
                parent_id: null,
                sort_order: 5
              },
              {
                action: "rename",
                document_id: page.document.id,
                title: `TOC Renamed ${suffix}`
              },
              {
                action: "reorder",
                document_id: folder.document.id,
                sort_order: 1
              }
            ]
          }
        })
      ) as { toc: Array<{ id: string; title: string; parent_id: string | null }> };
      expect(JSON.stringify(updatedToc.toc)).toContain(`TOC Renamed ${suffix}`);

      const tocResource = JSON.parse(
        (
          await client.readResource({
            uri: `kb://knowledge-base/${createdKb.knowledge_base.id}/toc`
          })
        ).contents[0]?.text ?? "{}"
      ) as { toc: Array<Record<string, unknown>> };
      expect(JSON.stringify(tocResource.toc)).toContain(page.document.id);

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          actor_user_id: seed.userId,
          action: "mcp.tool.call"
        }
      });
      const patAuditLogs = auditLogs.filter(
        (log) => (log.metadata as Record<string, unknown>).pat_id === pat.id
      );
      expect(
        patAuditLogs.map((log) => (log.metadata as Record<string, unknown>).tool_name)
      ).toEqual(
        expect.arrayContaining([
          "kb.create_knowledge_base",
          "kb.create_document",
          "kb.update_document",
          "kb.update_knowledge_base_toc"
        ])
      );
      expect(JSON.stringify(patAuditLogs.map((log) => log.metadata))).not.toContain(pat.token);
    } finally {
      await client.close();
    }
  }, 120_000);

  it("returns stable errors for write conflicts and invalid TOC operations", async () => {
    const pat = await createPat("phase-9-write-errors", [
      "kb:read",
      "doc:read",
      "doc:write",
      "toc:write"
    ]);
    const client = await createClient(pat.token);

    try {
      const current = parseToolJson(
        await client.callTool({
          name: "kb.get_document",
          arguments: {
            document_id: seed.documentId
          }
        })
      ) as { current_version: { id: string } };

      const invalidMarkdown = "```mermaid\ngraph TD\n```";
      const markdownResult = await client.callTool({
        name: "kb.update_document",
        arguments: {
          document_id: seed.documentId,
          base_version_id: current.current_version.id,
          markdown: invalidMarkdown,
          markdown_hash: markdownHash(invalidMarkdown)
        }
      });
      expect(markdownResult.isError).toBe(true);
      expect(parseToolJson(markdownResult)).toMatchObject({
        error: "MARKDOWN_DIALECT_ERROR"
      });

      const hashResult = await client.callTool({
        name: "kb.update_document",
        arguments: {
          document_id: seed.documentId,
          base_version_id: current.current_version.id,
          markdown: "# Valid",
          markdown_hash: "bad"
        }
      });
      expect(hashResult.isError).toBe(true);
      expect(parseToolJson(hashResult)).toMatchObject({
        error: "INVALID_INPUT"
      });

      const validMarkdown = "# MCP Conflict Check";
      const updated = parseToolJson(
        await client.callTool({
          name: "kb.update_document",
          arguments: {
            document_id: seed.documentId,
            base_version_id: current.current_version.id,
            markdown: validMarkdown,
            markdown_hash: markdownHash(validMarkdown)
          }
        })
      ) as { current_version: { id: string } };
      expect(updated.current_version.id).not.toBe(current.current_version.id);

      const conflictResult = await client.callTool({
        name: "kb.update_document",
        arguments: {
          document_id: seed.documentId,
          base_version_id: current.current_version.id,
          markdown: "# Stale",
          markdown_hash: markdownHash("# Stale")
        }
      });
      expect(conflictResult.isError).toBe(true);
      expect(parseToolJson(conflictResult)).toMatchObject({
        error: "VERSION_CONFLICT",
        details: {
          current_version_id: updated.current_version.id
        }
      });

      const removeResult = await client.callTool({
        name: "kb.update_knowledge_base_toc",
        arguments: {
          knowledge_base_id: seed.knowledgeBaseId,
          operations: [
            {
              action: "remove",
              document_id: seed.documentId
            }
          ]
        }
      });
      expect(removeResult.isError).toBe(true);
      expect(parseToolJson(removeResult)).toMatchObject({
        error: "INVALID_INPUT"
      });

      const childFolder = parseToolJson(
        await client.callTool({
          name: "kb.create_document",
          arguments: {
            knowledge_base_id: seed.knowledgeBaseId,
            parent_id: seed.folderId,
            type: "folder",
            title: `Cycle ${randomUUID().slice(0, 8)}`
          }
        })
      ) as { document: { id: string } };

      const cycleResult = await client.callTool({
        name: "kb.update_knowledge_base_toc",
        arguments: {
          knowledge_base_id: seed.knowledgeBaseId,
          operations: [
            {
              action: "move",
              document_id: seed.folderId,
              parent_id: childFolder.document.id
            }
          ]
        }
      });
      expect(cycleResult.isError).toBe(true);
      expect(parseToolJson(cycleResult)).toMatchObject({
        error: "INVALID_INPUT"
      });

      const nonFolderParentResult = await client.callTool({
        name: "kb.update_knowledge_base_toc",
        arguments: {
          knowledge_base_id: seed.knowledgeBaseId,
          operations: [
            {
              action: "move",
              document_id: seed.folderId,
              parent_id: seed.documentId
            }
          ]
        }
      });
      expect(nonFolderParentResult.isError).toBe(true);
      expect(parseToolJson(nonFolderParentResult)).toMatchObject({
        error: "INVALID_INPUT"
      });
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
      scopes: ["doc:read", "kb:read", "kb:search", "doc:write", "kb:write"]
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

      const updateResult = await client.callTool({
        name: "kb.update_document",
        arguments: {
          document_id: seed.documentId,
          title: "No Access Rename"
        }
      });
      expect(updateResult.isError).toBe(true);
      const updatePayload = parseToolJson(updateResult);
      expect(updatePayload.error).toBe("FORBIDDEN");
      expect(JSON.stringify(updatePayload)).not.toContain("No Access Rename");
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

async function createPat(name: string, scopes = ["kb:read", "kb:search", "doc:read"]) {
  return auth.createPersonalAccessToken({
    userEmail: DEV_ADMIN_EMAIL,
    name,
    scopes
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

function markdownHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

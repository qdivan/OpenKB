import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import {
  buildClientConfig,
  normalizeMcpUrl,
  parseCommand,
  parseEventStreamPayloads,
  postMcpMessage,
  resolvePat
} from "./cli";

describe("openkb-mcp CLI helpers", () => {
  it("normalizes server URLs to the MCP endpoint", () => {
    expect(normalizeMcpUrl("http://localhost:4102")).toBe("http://localhost:4102/mcp");
    expect(normalizeMcpUrl("http://localhost:4102/mcp")).toBe("http://localhost:4102/mcp");
    expect(normalizeMcpUrl("http://localhost:4102/base/")).toBe("http://localhost:4102/base/mcp");
  });

  it("parses command options and resolves PATs from an environment variable", () => {
    const parsed = parseCommand([
      "probe",
      "--server-url",
      "http://localhost:4102",
      "--pat-env",
      "OPENKB_TEST_PAT"
    ]);
    expect(parsed).toEqual({
      command: "probe",
      options: {
        "server-url": "http://localhost:4102",
        "pat-env": "OPENKB_TEST_PAT"
      }
    });
    expect(resolvePat(parsed.options, { OPENKB_TEST_PAT: "okb_pat_test" })).toBe("okb_pat_test");
  });

  it("generates client config templates without embedding a raw PAT", () => {
    const config = buildClientConfig({
      client: "codex",
      serverUrl: "http://localhost:4102/mcp",
      patEnv: "OPENKB_MCP_PAT"
    });
    const serialized = JSON.stringify(config);
    expect(serialized).toContain("openkb-mcp");
    expect(serialized).toContain("OPENKB_MCP_PAT");
    expect(serialized).toContain("${OPENKB_MCP_PAT}");
    expect(serialized).not.toContain("okb_pat_");
  });

  it("forwards a JSON-RPC message to HTTP MCP with bearer auth", async () => {
    const seen: { authorization?: string; body?: string } = {};
    const server = createServer((request, response) => {
      seen.authorization = request.headers.authorization;
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        seen.body = body;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind.");
    }
    try {
      const result = await postMcpMessage(
        `http://127.0.0.1:${address.port}/mcp`,
        "okb_pat_test",
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      );
      expect(result).toEqual([JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })]);
      expect(seen.authorization).toBe("Bearer okb_pat_test");
      expect(seen.body).toContain("tools/list");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("extracts JSON payloads from event-stream responses", () => {
    expect(
      parseEventStreamPayloads(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\ndata: [DONE]\n'
      )
    ).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
  });
});

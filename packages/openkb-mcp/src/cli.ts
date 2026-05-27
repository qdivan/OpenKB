#!/usr/bin/env node
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const VERSION = "0.3.3";
const DEFAULT_PAT_ENV = "OPENKB_MCP_PAT";
const DEFAULT_SERVER_URL = "http://localhost:4100/mcp";

type ClientName = "codex" | "openclaw" | "claude-code";

type ParsedCommand = {
  command: string;
  options: Record<string, string | boolean>;
};

export function parseCommand(argv: string[]): ParsedCommand {
  const [command = "help", ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!;
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { command, options };
}

export function normalizeMcpUrl(input: string | undefined): string {
  const raw = (input ?? DEFAULT_SERVER_URL).trim();
  if (!raw) {
    throw new Error("--server-url is required.");
  }
  const url = new URL(raw);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolvePat(options: Record<string, string | boolean>, env = process.env): string {
  const patEnv = stringOption(options["pat-env"]) ?? DEFAULT_PAT_ENV;
  const token = stringOption(options.pat) ?? env[patEnv];
  if (!token) {
    throw new Error(`MCP PAT is required. Set ${patEnv} or pass --pat for a one-off probe.`);
  }
  return token;
}

export function buildClientConfig(input: {
  client: ClientName;
  serverUrl: string;
  patEnv: string;
}): Record<string, unknown> {
  const command = "openkb-mcp";
  const args = ["connect", "--server-url", input.serverUrl, "--pat-env", input.patEnv];
  const serverConfig = {
    command,
    args,
    env: {
      [input.patEnv]: `\${${input.patEnv}}`
    }
  };

  if (input.client === "claude-code") {
    return { mcpServers: { openkb: serverConfig } };
  }
  if (input.client === "openclaw") {
    return { mcpServers: { openkb: serverConfig } };
  }
  return { mcpServers: { openkb: serverConfig } };
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseCommand(argv);
  try {
    switch (parsed.command) {
      case "connect":
        await connect(parsed.options);
        break;
      case "probe":
        await probe(parsed.options);
        break;
      case "install":
        await install(parsed.options);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      case "version":
      case "--version":
      case "-v":
        process.stdout.write(`${VERSION}\n`);
        break;
      default:
        throw new Error(`Unknown command: ${parsed.command}`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function connect(options: Record<string, string | boolean>) {
  const serverUrl = normalizeMcpUrl(stringOption(options["server-url"]));
  const pat = resolvePat(options);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of input) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let id: unknown = null;
    try {
      const payload = JSON.parse(trimmed) as { id?: unknown };
      id = payload.id ?? null;
      const response = await postMcpMessage(serverUrl, pat, trimmed);
      for (const item of response) {
        process.stdout.write(`${item}\n`);
      }
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "OpenKB MCP bridge failed."
          }
        })}\n`
      );
    }
  }
}

async function probe(options: Record<string, string | boolean>) {
  const serverUrl = normalizeMcpUrl(stringOption(options["server-url"]));
  const pat = resolvePat(options);
  const client = new Client({ name: "openkb-mcp-probe", version: VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${pat}`
      }
    }
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    let currentUser: unknown = null;
    try {
      currentUser = await client.callTool({ name: "kb.get_current_user", arguments: {} });
    } catch {
      currentUser = { skipped: "profile:read scope not available" };
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          server_url: serverUrl,
          tools: tools.tools.map((tool) => tool.name).sort(),
          current_user_probe: currentUser
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.close();
  }
}

async function install(options: Record<string, string | boolean>) {
  const client = parseClientName(stringOption(options.client));
  const serverUrl = normalizeMcpUrl(stringOption(options["server-url"]));
  const patEnv = stringOption(options["pat-env"]) ?? DEFAULT_PAT_ENV;
  const config = buildClientConfig({ client, serverUrl, patEnv });
  const body = `${JSON.stringify(config, null, 2)}\n`;
  const output = stringOption(options.output);
  if (!output) {
    process.stdout.write(body);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, body, "utf8");
  process.stdout.write(`Wrote ${client} MCP config template to ${output}\n`);
}

export async function postMcpMessage(
  serverUrl: string,
  pat: string,
  body: string
): Promise<string[]> {
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${pat}`,
      "content-type": "application/json"
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenKB MCP returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseEventStreamPayloads(text);
  }
  return [text];
}

export function parseEventStreamPayloads(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]");
}

function parseClientName(value: string | undefined): ClientName {
  if (value === "codex" || value === "openclaw" || value === "claude-code") {
    return value;
  }
  throw new Error("--client must be one of: codex, openclaw, claude-code.");
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function printHelp() {
  process.stdout.write(`openkb-mcp ${VERSION}

Usage:
  openkb-mcp connect --server-url <url> --pat-env OPENKB_MCP_PAT
  openkb-mcp probe --server-url <url> --pat-env OPENKB_MCP_PAT
  openkb-mcp install --client codex|openclaw|claude-code --server-url <url> --pat-env OPENKB_MCP_PAT --output <path>

Notes:
  - The bridge forwards stdio JSON-RPC to OpenKB Streamable HTTP /mcp.
  - Config templates reference an environment variable and do not write raw PATs.
`);
}

if (require.main === module) {
  void main();
}

#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node check-openkb-mcp-config.mjs <config.json>");
  process.exit(2);
}

const config = JSON.parse(await readFile(file, "utf8"));
const serialized = JSON.stringify(config);
const openkb = config.mcpServers?.openkb;
const problems = [];

if (!openkb) {
  problems.push("Missing mcpServers.openkb.");
}
if (openkb && openkb.command !== "openkb-mcp") {
  problems.push("mcpServers.openkb.command must be openkb-mcp.");
}
if (openkb && !Array.isArray(openkb.args)) {
  problems.push("mcpServers.openkb.args must be an array.");
}
if (/okb_pat_|sk-[A-Za-z0-9]/.test(serialized)) {
  problems.push("Config appears to contain a raw token. Use an environment variable instead.");
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("OpenKB MCP config looks usable.");

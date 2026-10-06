#!/usr/bin/env node
// Configure the local Codex plugin to use one hosted MCP endpoint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hubUrl = process.argv[2];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(root, "plugins/all-skill-hub/.mcp.json.example");
const target = path.join(root, "plugins/all-skill-hub/.mcp.json");

if (!hubUrl) {
  console.error("Usage: node scripts/configure-codex-plugin.mjs https://your-hub-domain");
  process.exit(2);
}

let parsed;
try { parsed = new URL(hubUrl); } catch { /* handled below */ }
if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
  console.error("Use the hosted hub's HTTPS origin only, without a path, query, or credentials.");
  process.exit(2);
}

const endpoint = `${parsed.origin}/mcp`;
const config = JSON.parse(fs.readFileSync(example, "utf8"));
config.mcpServers["all-skill-hub"].url = endpoint;
config.mcpServers["all-skill-hub"].oauth_resource = endpoint;

if (fs.existsSync(target)) {
  const current = JSON.parse(fs.readFileSync(target, "utf8"));
  if (current.mcpServers?.["all-skill-hub"]?.url !== endpoint ||
      current.mcpServers?.["all-skill-hub"]?.oauth_resource !== endpoint) {
    console.error(`${target} already points elsewhere. Review that connection before changing it.`);
    process.exit(1);
  }
  console.log(`Codex plugin already points to ${endpoint}`);
} else {
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
  console.log(`Codex plugin configured for ${endpoint}`);
}

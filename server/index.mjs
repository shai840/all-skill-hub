#!/usr/bin/env node
// stdio entry point (what the Claude desktop app launches).
//
// Normally a thin pass-through: it makes sure the hub daemon (web UI + MCP over HTTP,
// hot-reloading) is running, then forwards every JSON-RPC message to it. Apps that
// launch this process therefore always talk to the current code, without restarting.
// If the daemon can't be reached, it falls back to serving the hub in-process.
//
//   node server/index.mjs [--client claude|chatgpt|generic]

import readline from "node:readline";
import path from "node:path";
import { spawn } from "node:child_process";
import { createStore } from "./core/store.mjs";
import { createSession } from "./core/mcp.mjs";
import { HUB_DIR, BASE_URL, PORT, REPO_DIR } from "./config.mjs";

const argi = process.argv.indexOf("--client");
const forced = (argi > 0 && process.argv[argi + 1]) || process.env.ALL_SKILL_CLIENT || null;
const LOCAL = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${LOCAL}/mcp${forced ? `/${forced}` : ""}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[all-skill]", ...a);

// ---------- daemon discovery ----------

async function daemonHealthy() {
  try {
    const r = await fetch(`${LOCAL}/api/health`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    // Only proxy to a hub serving the same folder (tests and alternate hubs stay isolated).
    return j.server?.name === "all-skill-hub" && path.resolve(j.hubDir) === HUB_DIR;
  } catch {
    return false;
  }
}

async function ensureDaemon() {
  if (await daemonHealthy()) return true;
  if (process.env.ALL_SKILL_NO_DAEMON) return false;
  spawn(process.execPath, [path.join(REPO_DIR, "server", "daemon.mjs")], { detached: true, stdio: "ignore", env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    if (await daemonHealthy()) return true;
  }
  return false;
}

// ---------- proxy ----------

let sid = null;
let initMsg = null;
let local = null; // in-process fallback session

async function post(msg) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-all-skill-transport": "stdio" };
  if (sid) headers["mcp-session-id"] = sid;
  const r = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(msg) });
  const s = r.headers.get("mcp-session-id");
  if (s) sid = s;
  if (r.status === 202) return { status: 202, body: null };
  return { status: r.status, body: await r.json() };
}

// The daemon restarts on code changes and forgets sessions; replay initialize transparently.
async function reinitialize() {
  sid = null;
  await post(initMsg);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
}

async function forward(msg) {
  if (msg?.method === "initialize") {
    initMsg = msg;
    sid = null;
  }
  let r = await post(msg);
  if (r.status === 404 && initMsg && msg?.method !== "initialize") {
    await reinitialize();
    r = await post(msg);
  }
  return r.body;
}

async function handleLocally(msg) {
  if (!local) {
    log(`hub daemon unreachable; serving in-process from ${HUB_DIR}`);
    local = createSession({ store: createStore(HUB_DIR), adapterId: forced, transport: "stdio", baseUrl: BASE_URL });
    if (initMsg && msg?.method !== "initialize") await local.handle(initMsg);
  }
  return local.handle(msg);
}

let daemonReady = null;
async function handle(msg) {
  if (local) return handleLocally(msg);
  daemonReady ||= ensureDaemon();
  if (await daemonReady) {
    try {
      return await forward(msg);
    } catch {
      // Daemon mid-restart: wait for it once, then retry.
      daemonReady = ensureDaemon();
      if (await daemonReady) {
        try {
          if (initMsg && msg?.method !== "initialize") await reinitialize();
          return await forward(msg);
        } catch {}
      }
    }
  }
  return handleLocally(msg);
}

// ---------- stdio ----------

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
let chain = Promise.resolve();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(async () => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    const replies = [];
    for (const m of batch) {
      const r = await handle(m);
      if (r) replies.push(r);
    }
    if (replies.length) write(Array.isArray(msg) ? replies : replies[0]);
  });
});
rl.on("close", () => chain.then(() => process.exit(0)));

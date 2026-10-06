// Transport-independent MCP session: JSON-RPC in, JSON-RPC out. The adapter is chosen
// at `initialize` from the client's clientInfo (or forced by the transport).

import { randomUUID } from "node:crypto";
import { getAdapter, detectAdapter } from "../adapters/index.mjs";

export const SERVER_INFO = { name: "all-skill-hub", title: "All-Skill Hub", version: "0.2.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

function summarizeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    // Activity is an audit trail, not a second copy of private memory content.
    if (["name", "id", "project", "path", "type"].includes(k)) out[k] = String(v).slice(0, 120);
    else out[k] = { supplied: v !== undefined, length: String(v ?? "").length };
  }
  return out;
}

function toResult(value) {
  if (value && typeof value === "object" && "text" in value) {
    const r = { content: [{ type: "text", text: value.text }] };
    if (value.structured) r.structuredContent = value.structured;
    return r;
  }
  return { content: [{ type: "text", text: String(value ?? "") }] };
}

export function describeTool(t) {
  return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations };
}

/** Run one tool as a given adapter without a session (used by the web UI preview). */
export async function runTool(store, adapterId, toolName, args, { baseUrl, clientLabel = "web-ui" } = {}) {
  const tool = getAdapter(adapterId).tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Adapter "${adapterId}" has no tool "${toolName}"`);
  return toResult(await tool.run(args || {}, { store, baseUrl, clientLabel, adapter: adapterId }));
}

/** onWrite({ message, author }) is called after every successful non-read-only tool (used for git history). */
export function createSession({ store, adapterId = null, transport, baseUrl, user = null, onWrite = null }) {
  const state = {
    id: randomUUID(),
    adapter: adapterId ? getAdapter(adapterId) : null,
    forced: Boolean(adapterId),
    clientInfo: null,
    lastUsed: Date.now(),
  };

  const adapter = () => state.adapter || (state.adapter = getAdapter("generic"));
  const clientName = () => state.clientInfo?.name || "unknown";
  const ctx = () => ({
    store,
    baseUrl,
    adapter: adapter().id,
    client: state.clientInfo,
    clientLabel: `${clientName()} via ${adapter().id}`,
  });

  async function callTool(name, args) {
    const tool = adapter().tools.find((t) => t.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    const entry = { event: "tool", client: clientName(), adapter: adapter().id, transport, tool: name, args: summarizeArgs(args) };
    try {
      const result = toResult(await tool.run(args, ctx()));
      store.logActivity({ ...entry, ok: true, ...(user ? { user } : {}) });
      if (!tool.annotations?.readOnlyHint && !result.isError && onWrite) {
        const target = args.name || args.id || args.path || "";
        onWrite({ message: `${name}${target ? ` ${target}` : ""}${args.project ? ` (${args.project})` : ""}`, author: ctx().clientLabel });
      }
      return result;
    } catch (e) {
      store.logActivity({ ...entry, ok: false, error: e.message });
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case "initialize": {
        state.clientInfo = params.clientInfo || null;
        if (!state.forced) state.adapter = detectAdapter(state.clientInfo);
        store.logActivity({
          event: "connect",
          client: clientName(),
          clientVersion: state.clientInfo?.version,
          adapter: adapter().id,
          transport,
          protocolVersion: params.protocolVersion,
        });
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: adapter().instructions(ctx()),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: adapter().tools.map(describeTool) };
      case "tools/call":
        return callTool(params.name, params.arguments || {});
      case "resources/list":
        return { resources: [] };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "prompts/list":
        return { prompts: [] };
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  /** Handle one JSON-RPC message; returns a response object, or null for notifications/responses. */
  async function handle(msg) {
    state.lastUsed = Date.now();
    if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
      if (msg && msg.id !== undefined && ("result" in msg || "error" in msg)) return null;
      return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
    }
    const isNotification = msg.id === undefined || msg.id === null;
    if (isNotification) return null;
    try {
      return { jsonrpc: "2.0", id: msg.id, result: await dispatch(msg.method, msg.params || {}) };
    } catch (e) {
      return { jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32603, message: e.message } };
    }
  }

  return { state, handle };
}

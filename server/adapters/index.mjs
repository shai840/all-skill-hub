// Adapter registry. An adapter decides, per connecting AI app, which tools the hub
// exposes, how they're named and described, what the server instructions say, and
// what shape results come back in. The core store underneath is shared.
//
// To add an app: create <id>.mjs exporting { id, label, summary, detect(clientInfo),
// instructions(ctx), tools: [{ name, description, inputSchema, annotations, run(args, ctx) }] }
// and add it to ADAPTERS. Clients can also force one via /mcp/<id> or `--client <id>`.

import claude from "./claude.mjs";
import chatgpt from "./chatgpt.mjs";

const generic = {
  ...claude,
  id: "generic",
  label: "Generic",
  summary: "Fallback for unrecognized clients: same tools as Claude.",
  detect: () => true,
};

export const ADAPTERS = [claude, chatgpt, generic];

export function getAdapter(id) {
  const a = ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown adapter "${id}". Known: ${ADAPTERS.map((x) => x.id).join(", ")}`);
  return a;
}

export function detectAdapter(clientInfo) {
  return ADAPTERS.find((a) => a !== generic && a.detect(clientInfo)) || generic;
}

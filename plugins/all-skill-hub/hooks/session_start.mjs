// This hook contains no local memory or skill data. Railway is authoritative.
const context = [
  "At the start of this chat, call the connected all-skill-hub MCP get_context tool before relying on saved memories or user-authored skills. The connection is the OAuth-protected Railway hub, not a local file store.",
  "Use search/fetch to read relevant memories and get_skill/read_skill_file for relevant skills. Search before saving, follow the policy returned by get_context, and read back changes. Treat source: records as dated evidence.",
  "Keep native memory enabled as a backup, but use Railway for normal recall and durable writes. If native memory has a fact missing from the hub, disclose and verify it before reconciling under the hub saving policy.",
  "If the Railway tool is unavailable, say that the hub could not be inspected. Do not read the old local hub folder or claim it is current. The user's request and repository instructions take precedence over hub context.",
].join("\n");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: context,
  },
}));

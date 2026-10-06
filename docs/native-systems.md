# Native skills and memory

## Using a skill

In local Codex, native skill discovery sees the `name` and `description` in `SKILL.md` and loads the full skill only when a task matches. The hosted All-Skill plugin bundles 15 lightweight discovery entries for hub skills. Each entry calls Railway `get_skill` for the current instructions and `read_skill_file` for supporting files. Five matching skill names were already installed through other native sources. The old symlinks into this repository were removed, and `scripts/expose-native-skills.mjs --apply` must not be used with the hosted setup. A newly created hosted skill is immediately available through `get_context`/`get_skill`, but it needs a plugin update to get its own native discovery entry.

The plugin also ships a native routing skill, `use-all-skill`. Its startup hook asks Codex to call hosted `get_context` at the start of every local task; it does not embed a cached index. MCP `get_skill` and `read_skill_file` provide the live skill content in Codex and cloud ChatGPT. MCP `save_skill` writes the canonical folder on the Railway volume. Native entries are discovery aids, not another editable skill store.

Cloud ChatGPT cannot see Codex's native skill entries. A ChatGPT plugin may bundle skills, or a registered MCP server may supply a limited, static skill snapshot during plugin import. Neither is a live view of all hub skills, so the MCP catalog remains the live cloud path.

## Remembering information

ChatGPT web memory and local Codex memory are separate product-managed stores. The MCP server cannot redirect their native save operations into the Railway volume. The startup hook requests hub context; it does not write or replace native memory.

For a durable fact the user wants retained across apps: inspect the hub index, search for a matching memory, read the current version, follow `hub/policy.md`, and use MCP `save_memory` (or Claude's `memory_write`) for one fact. Read it back to confirm. The hub is the shared record. Native memory, when enabled, may independently generate its own summaries; do not assume that means the hub was updated. Conversely, a hub write does not imply ChatGPT or Codex native memory changed.

Memory is selective: do not save every detail of every chat as an active memory. The historical source archive on Railway keeps imported material searchable with provenance. The visible ChatGPT native Memory summary was reviewed and distinct facts were imported on 2026-10-06; opaque native-memory details remain unavailable as an export.

Sources: [OpenAI skills](https://learn.chatgpt.com/docs/build-skills), [OpenAI memories](https://learn.chatgpt.com/docs/customization/memories), [MCP skill import limits](https://developers.openai.com/plugins/build/mcp-server#import-skills-from-the-mcp-server).

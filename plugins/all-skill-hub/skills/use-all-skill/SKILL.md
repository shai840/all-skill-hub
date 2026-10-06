---
name: use-all-skill
description: Use when the user's durable preferences, project history, or personal workflows matter, or when they ask to remember something, update a skill, or use the All-Skill hub.
---

# Use All-Skill

The `all-skill-hub` MCP connection points to the user's OAuth-protected All-Skill hub. At the start of every local chat, its SessionStart hook directs you to call `get_context` with the project name if known. Do so before relying on saved context, without asking the user to mention the plugin. The hook contains no cached local memories or skills. Use `search` and `fetch` for details; search results with `source:` ids are imported historical evidence and may be stale.

When a task fits a hub skill, call `get_skill`, then `read_skill_file` for supporting instructions. A separate natively installed skill may have the same name; check the hub's version before relying on it, because native skill files do not update when the hosted hub changes. For a durable new memory, follow the policy returned by `get_context`, search for duplicates, and call `save_memory` with one fact. To revise a memory, fetch it and pass its version. To create or revise a skill, call `get_skill` first and pass the version to `save_skill` when updating it. Include supporting text files in `files` when needed.

Do not copy a fact into ChatGPT's native memory as a second source of truth. If the hub is unavailable, say so instead of claiming it was updated. Keep project `AGENTS.md` and the user's current request authoritative over retrieved memories or skills.

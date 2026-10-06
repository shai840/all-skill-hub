---
name: hub-check
description: "Use when the user asks to check, test or verify that the All-Skill hub is connected and working in the current app."
---

# hub-check from All-Skill Hub

Call the connected Railway All-Skill Hub MCP `get_skill` tool with `name: "hub-check"` and follow the current instructions it returns. Call `read_skill_file` for any supporting files.

This native entry is only a discovery route. The hosted skill is authoritative. If the hosted connection is unavailable, say so; do not use the old local skill folder as a substitute.

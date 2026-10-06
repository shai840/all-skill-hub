---
name: import-native-memory
description: Use when the user asks to import, move or migrate the app's own built-in memory (Claude.ai memory, ChatGPT memory) into the All-Skill hub.
---

# Import native memory from All-Skill Hub

Call the connected Railway All-Skill Hub MCP `get_skill` tool with `name: "import-native-memory"` and follow the current instructions it returns. Call `read_skill_file` for any supporting files.

This native entry is only a discovery route. The hosted skill is authoritative. If the hosted connection is unavailable, say so; do not use an old local copy. Keep native memory enabled as a backup, report inaccessible material, and use the hub for normal recall and durable writes.

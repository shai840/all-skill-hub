---
name: skill-authoring
description: "Use when the user wants to create a new skill, turn a workflow into a skill, or improve an existing skill in the hub."
---

# skill-authoring from All-Skill Hub

Call the connected Railway All-Skill Hub MCP `get_skill` tool with `name: "skill-authoring"` and follow the current instructions it returns. Call `read_skill_file` for any supporting files.

This native entry is only a discovery route. The hosted skill is authoritative. If the hosted connection is unavailable, say so; do not use the old local skill folder as a substitute.

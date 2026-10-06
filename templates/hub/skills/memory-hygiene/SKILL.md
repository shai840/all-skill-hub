---
name: memory-hygiene
description: Use when the user asks to clean up, review, consolidate or audit their saved memories in the hub.
---

# Memory hygiene

Do a reflective pass over the hub's memories. Work from the memory index (`get_context`), reading full memories only as needed.

1. Read `checklist.md` in this skill's folder (`skill_read_file` / `read_skill_file`) and apply each check.
2. Before changing anything, show the user a short plan: which memories you would merge, update, or delete, and why.
3. Only after the user agrees: merge duplicates into one memory (keep the clearer name, combine the facts), update stale facts, and delete what's wrong.
4. Report what changed, by memory name.

Never delete a `feedback` memory without asking explicitly. Those are the user's instructions to you.

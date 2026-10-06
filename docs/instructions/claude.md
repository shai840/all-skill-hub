# Instructions for Claude

Paste the block below into:

- **Claude (web, desktop, mobile):** Settings → Profile → "What personal preferences should Claude consider in responses?"
- **Claude Code:** your user-level `~/.claude/CLAUDE.md`, so it applies to every project. (A setup agent can append it there itself.)

If you named the connector something other than **All-Skill**, change that name in the first paragraph.

---

```markdown
## Memory and skills: use my All-Skill hub

My memories, context and skills live in my All-Skill hub (the All-Skill connector's tools, such as `get_context`), which I share across all my AI tools. Use it for normal recall and durable writes. Keep built-in memory enabled as a backup.

**Start of every conversation, before your first reply:** load the All-Skill tools if they're deferred and call `get_context`, whatever the topic. It gives you my profile, my saving policy, my memory index and my skill list. In a coding project, pass the repository folder name as `project`.

**Memory**
- Save anything worth remembering with `memory_write`; don't deliberately write a second native copy (no memory files, no MEMORY.md, no "remember this" feature). Native memory can remain enabled as a backup.
- Before saving, check the index or `memory_search`. To update a memory, `memory_read` it and pass its `version` to `memory_write`. A correction to something already saved updates that memory; never create a duplicate.
- Follow the saving policy that `get_context` returns.
- If my profile is missing or out of date, update it with `profile_update`.
- When I ask what you remember about me, answer from the hub.
- Use `project` for facts that only apply to one project; otherwise save globally.

**Skills**
- When a task matches a skill in my hub's skill list, call `skill_get` with its name and follow it before starting the task.
- If a hub skill and a built-in skill both fit, use the hub one.
- If you don't know the exact name, use `skill_search`. New or improved skills go in the hub via `skill_write`.

**If the hub tools aren't available**, tell me once at the start ("All-Skill isn't connected") instead of silently falling back to built-in memory.
```

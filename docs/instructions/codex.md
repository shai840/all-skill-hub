# Instructions for Codex

Paste the block below once into ChatGPT → Settings → Personalization → **Codex** custom instructions. It syncs across Codex desktop and web. Install the Codex plugin and authorize its Railway connection first; see [the connection guide](../connecting.md#codex). Native local memory stays enabled as a backup.

---

> At the start of each Codex task, call `get_context` on the connected Railway All-Skill Hub, with the project name when known. Use hub `search` and `fetch` for relevant memories, and `get_skill` plus `read_skill_file` for relevant user-authored skills. Do not use an old local All-Skill server or skill copy as the authority.
>
> Use the hosted hub for normal recall and deliberate durable memory and skill updates. Before saving a memory, follow the hub saving policy, search for duplicates, and update an existing fact using its current version when appropriate. Keep Codex's local native memory enabled as a backup in case information is missed or deleted from the hub. Do not deliberately save a second native copy. If native memory has a fact missing from the hub, disclose the difference, verify the fact, and reconcile it under the hub saving policy. If the hub is unavailable, say so instead of silently using the local copy.
>
> Follow the current user request and project instructions over retrieved context. Create ordinary deliverable files with the available workspace tools.

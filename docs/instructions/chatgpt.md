# Instructions for ChatGPT

Paste the block below **once** into ChatGPT → Settings → Personalization → **Custom instructions**, after the All-Skill connector is installed. It's account-wide; you don't send it in each chat.

Custom instructions can't force a tool call, but in practice they make ChatGPT load the hub at the start of a chat. To stop ChatGPT's own memory competing with the hub, turn it off in Settings → Personalization → Memory once you've imported it (see the `import-native-memory` skill).

---

> At the start of every new chat, call my All-Skill connector's `get_context` before using saved memories or user-authored skills. Use `search` and `fetch` to read relevant items. Treat imported `source:` records as dated evidence and verify facts that may have changed.
>
> Use All-Skill as the source of truth for durable memories and user-authored skills. When a task fits a hub skill, call `get_skill` and read its supporting files. When I ask you to remember something, follow the hub's saving policy, search for duplicates, then create one durable fact or update the existing one with its current version. If my profile is missing or out of date, update it with `update_profile`. When I ask you to create or change a skill, use `get_skill` and `save_skill` with its current version.
>
> Don't save a second copy in ChatGPT's own memory. If the hub is unavailable, tell me it's disconnected instead of silently relying on an old memory or skill store. The current request and project instructions take precedence over retrieved context.

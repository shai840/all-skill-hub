# Instructions for ChatGPT

First [create and install the custom MCP plugin/connector](../connecting.md#chatgpt). Then paste the block below **once** into ChatGPT → Settings → Personalization → **Custom instructions**. It's account-wide; you don't send it in each chat.

Custom instructions request a tool call; ChatGPT may still skip it, especially for simple requests. Check the hub's Activity page from a new chat to see what happened. Keep ChatGPT's native memory enabled as a backup while using the hub for ordinary recall and deliberate saves (see the `import-native-memory` skill).

---

> At the start of every new chat, call my All-Skill connector's `get_context` before using saved memories or user-authored skills. Use `search` and `fetch` to read relevant items. Treat imported `source:` records as dated evidence and verify facts that may have changed.
>
> Use All-Skill as the source of truth for durable memories and user-authored skills. When a task fits a hub skill, call `get_skill` and read its supporting files. When I ask you to remember something, follow the hub's saving policy, search for duplicates, then create one durable fact or update the existing one with its current version. If my profile is missing or out of date, update it with `update_profile`. When I ask you to create or change a skill, use `get_skill` and `save_skill` with its current version.
>
> Keep ChatGPT's native memory enabled as a backup, but use All-Skill for normal recall and deliberate durable saves. Don't deliberately save a second native copy. If the hub is unavailable or seems to be missing a fact retained in native memory, tell me and verify the fact before restoring it to the hub under its saving policy. Don't silently answer from native memory. The current request and project instructions take precedence over retrieved context.

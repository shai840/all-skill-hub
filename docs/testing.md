# Does the app actually use the hub?

Connecting the tools proves nothing about behaviour. This test checks that the **instructions** work: the first checks do not mention the hub, memory or skills. Send each prompt in a **new chat** and check the web UI's Activity page. A successful check on one chat does not guarantee an automatic call in every future chat.

**Read-only checks**

1. *Context loads unprompted.* `Quick check-in: what am I working on right now, and what should I focus on this week?`
   **Pass:** the app calls `get_context` before answering, and answers from your hub's profile and memories.
2. *A hub skill gets used.* Ask for something only a hub skill covers (for example, after adding a LinkedIn-post skill: `Draft me a LinkedIn post about <topic>.`).
   **Pass:** the app loads that skill (`skill_get` / `get_skill`) before writing.
3. *A near-miss phrasing still finds the skill.* `Write the commit message for this: <one-line description of a change>.`
   **Pass:** it loads `commit-message`.
4. *A simple chat also loads context.* `What's 2 + 2?`
   **Check:** look for `get_context` in Activity. A missing call here means the app's instruction did not achieve the every-chat goal; it does not mean the MCP connection is broken.

**Write checks, only with a real preference you want retained**

5. Tell the app one new, durable preference. **Pass:** it follows the saving policy, searches first, saves one memory, and reads it back. Do not invent a preference just for testing or duplicate one already present.
6. If you genuinely correct that preference later, check that the app updates the same memory with its current version. Its History should show both versions, with no duplicate memory.
7. In a later new chat, ask about that preference without naming the hub. **Pass:** the app answers from the hub.
8. For a policy check, mention a health or family detail without asking to save it. **Pass:** the app does not silently write it; if it wants to remember the detail, it asks first.

The Activity page lists each connection and tool call. It is the evidence for which app used the hub on each check.

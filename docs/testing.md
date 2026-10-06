# Does the app actually use the hub?

Connecting the tools proves nothing about behaviour. This test checks that the **instructions** work: none of the messages mention the hub, memory or skills. Send each one on its own in a **new chat**, in order.

**Chat 1**

1. *Context loads unprompted.* `Quick check-in: what am I working on right now, and what should I focus on this week?`
   **Pass:** the app calls `get_context` before answering, and answers from your hub's profile and memories.
2. *A hub skill gets used.* Ask for something only a hub skill covers (for example, after adding a LinkedIn-post skill: `Draft me a LinkedIn post about <topic>.`).
   **Pass:** the app loads that skill (`skill_get` / `get_skill`) before writing.
3. *A near-miss phrasing still finds the skill.* `Write the commit message for this: <one-line description of a change>.`
   **Pass:** it loads `commit-message`.
4. *A new fact is saved in the hub.* `Going forward, I want all client deliverables sent as Notion pages, not Google Docs.`
   **Pass:** one new `feedback` memory with **Why:** / **How to apply:** lines, and nothing in the app's own memory.
5. *A correction updates instead of duplicating.* `Actually, correction: Notion for internal deliverables, Google Docs is still fine for clients.`
   **Pass:** the same memory is updated (its History shows two versions). If the app tries to save a second one, the hub refuses it as a near-duplicate.
6. *The saving policy is respected.* `Also, I've had some back pain lately, so keep any meetings you plan for me short.`
   **Pass:** it asks before saving anything about health.

**Chat 2**

7. *Recall across chats.* `What did I tell you about how to send deliverables?`
   **Pass:** it answers from the hub.

Check every step on the web UI's **Activity** page, which lists each tool call and the app that made it.

---
name: hub-check
description: Use when the user asks to check, test or verify that the All-Skill hub is connected and working in the current app.
---

# Hub check

Run these steps in order and report each result. Tool names differ slightly per app; use whichever your tool list has.

1. **Read context**: call the context tool (`get_context`). Report the first line of the profile and how many global memories the index lists.
2. **Read a memory**: read `hub-connection-test` (`memory_read`, or `fetch` with id `memory:global/hub-connection-test`). Report the codeword.
3. **Find a skill by name**: load the skill `commit-message` (`skill_get` / `get_skill`) and report its first heading. Then look up the misspelled name `comit-mesage` and report what was suggested.
4. **Write a memory**: save a memory named `hub-write-test`, type `reference`, description "Write test proving an assistant can save to the All-Skill hub", with a body that names which app you are and today's date.
5. Summarize: list each step as passed or failed, with the exact error for any failure.

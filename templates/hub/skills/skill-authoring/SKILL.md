---
name: skill-authoring
description: Use when the user wants to create a new skill, turn a workflow into a skill, or improve an existing skill in the hub.
---

# Skill authoring

Skills in the hub use the shared SKILL.md format, so the same skill works in Claude and ChatGPT.

1. **Interview briefly**: what task triggers it, what a good result looks like, and any steps the user always wants done. Ask at most three questions; infer the rest from the conversation.
2. **Name**: short kebab-case, named for the task (`weekly-review`, not `my-helper`).
3. **Description**: one or two sentences starting with "Use when…". It's the only part a model sees before deciding to load the skill, so name the situations and words that should trigger it.
4. **Body**: numbered steps in plain imperative sentences. Put the steps that are easy to get wrong first. Include one short example of the output if format matters.
5. **Supporting files**: move long reference material (checklists, templates) into separate files and tell the reader when to open them.
6. Show the draft, then save it with the skill-writing tool (`skill_write` / `save_skill`) once the user approves.

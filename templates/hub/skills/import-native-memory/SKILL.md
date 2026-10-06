---
name: import-native-memory
description: Use when the user asks to import, move or migrate the app's own built-in memory (Claude.ai memory, ChatGPT memory) into the All-Skill hub.
---

# Import native memory into the hub

Goal: move everything this app remembers natively into the hub, so the hub can replace the built-in memory. The hub then becomes the only source of truth.

1. **Load the hub**: call `get_context`. Note the saving policy, the profile and its version, and the existing memory index (global and every project) so you don't create duplicates.
2. **List what you can actually access natively**: profile facts, preferences, projects, people, tools, and where things live. Do not claim to have exported memories that the product does not expose. Give a count and identify inaccessible sources.
3. **Map each fact to a hub memory**:
   - one fact per memory, kebab-case `name`, a `description` good enough to judge relevance on its own
   - `type`: user / feedback / project / reference
   - scope: facts about one project or client go under `project`. Reuse an existing hub project when it's the same thing; otherwise use a short kebab-case name (`acme-website`, `client-onboarding`). Everything else is global.
   - convert relative dates to absolute ones; mark dated status snapshots as such; add **Why:** / **How to apply:** for feedback and project memories; link related memories with [[name]]
   - facts about the user's identity, role, current work and where their information lives also go into the **profile** (step 6).
4. **Apply the saving policy**: leave out anything it says never to save. For sensitive categories, list those items separately and ask the user which to import.
5. **Deduplicate and preview**: search the hub by topic and compare full texts before creating a fact. Show names, scopes, merges and the new profile text. If the user already explicitly asked to move the accessible memories, that request authorizes the ordinary import; do not ask for the same approval again. Hold only items that need a specific answer under the saving policy.
6. **Write**:
   - memories with the memory-writing tool (`memory_write` / `save_memory`). For a merge into an existing memory, read it first and pass its version. If the hub rejects a new memory as a near-duplicate, update the one it names instead.
   - the profile with the profile tool (`profile_update` / `update_profile`), passing the profile version from `get_context`. Keep it a short summary: who the user is, what they're working on now, and where their information lives. Replace placeholders.
7. **Verify and report**: fetch a sample of saved facts and the profile, give counts created, merged, skipped, and inaccessible, and remind the user to:
   - review them in the hub's web UI (Memories page)
   - turn off the app's built-in memory once the import is verified (Claude: Settings → Capabilities → Memory; ChatGPT: Settings → Personalization → Memory), so it stops competing with the hub

# ChatGPT and Codex adapter

`server/adapters/chatgpt.mjs` exposes a focused MCP surface over the shared hub. The installed Codex plugin and cloud ChatGPT both connect to the OAuth-protected Railway endpoint over HTTP. The repository's local stdio transport remains for development only.

| Tool | Use |
|---|---|
| `get_context(project?)` | Profile, saving policy, active memory index, skill list, source count. The plugin instructions request it at the start of each chat. |
| `search(query)` → `fetch(id)` | Search and read profile, active memories, skills, and historical imported sources. `source:` documents include provenance and are dated evidence. |
| `save_memory` / `delete_memory` | Create, versioned update, or delete one active memory. Search before creating. |
| `list_skills` / `search_skills` / `get_skill` / `read_skill_file` | Discover and follow live hub skills and supporting files. |
| `save_skill` | Create a skill or update it with the version returned by `get_skill`. Optional `files` adds supporting text files. |

The hub is the file-backed source for normal recall, deliberate durable writes, and user-authored skills. Native memory can stay enabled as a backup; the adapter does not claim that an MCP instruction controls ChatGPT's native settings. Project `AGENTS.md` and the current user request still take priority over retrieved context.

Imported native-memory source files, when present, live in the hosted volume's `hub/sources/`. They are searchable evidence, not automatically promoted active memories. The import manifest records source paths, hashes, and duplicate matches; `search` and `fetch` expose the searchable records.

The source `url` in a result points to the connected server's web UI/API for review. A ChatGPT chat can use `fetch` to read the document directly through MCP.

The MCP tools write only hub memory and skill files. Other deliverable files should be created through the host's normal file or artifact workflow. To author a skill with supporting text files, pass them in the `files` field of `save_skill`.

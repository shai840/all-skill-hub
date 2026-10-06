# All-Skill architecture

One hub, many AI apps. The production hub stores memories, context and skills as plain Markdown files on a persistent Railway volume. Each AI app that connects gets an **adapter**: a presentation layer that decides which tools the app sees, how they're named and described, what instructions it gets at connect, and the shape of the results. The data underneath is shared, so a memory saved from ChatGPT is immediately visible to Claude and the other way round.

```
            Claude desktop          ChatGPT / Codex          other apps
                   │ HTTP/OAuth              │ HTTP/OAuth              │
                   └──────────────┬──────────┴─────────────────────────┘
                                  ▼
                         server/http.mjs  /mcp, /mcp/<adapter>
                     server/core/mcp.mjs   one session per connection;
                                          picks the adapter at `initialize`
                                  │
           server/adapters/  claude.mjs · chatgpt.mjs · (generic)
                                  │
                     server/core/store.mjs  (knows nothing about apps)
                                  │
                          /data/hub  ← persistent Markdown files
```

## The hub folder (core data)

In production, the paths below are under `/data/hub` on the Railway volume. The repository's `hub/` folder is the initial seed used only when the volume is empty; it is not a live mirror of production.

| Path | What | Format |
|---|---|---|
| `hub/profile.md` | Who the user is, what they work on, where their information lives. Curated by the user in the web UI. | Markdown |
| `hub/policy.md` | Saving policy: what apps may save, what they must never save, what needs the user's OK. Returned inside every app's context. | Markdown |
| `hub/memories/global/<name>.md` | Memories that apply everywhere | Frontmatter + body (below) |
| `hub/memories/projects/<project>/<name>.md` | Memories scoped to one project | same |
| `hub/skills/<name>/SKILL.md` | Skills, plus optional supporting files in the same folder | Open SKILL.md standard (used by Claude and ChatGPT) |
| `hub/sources/` | Imported native-memory source documents and manifest. Historical evidence, not automatically active facts. | Markdown + JSON manifest |
| `hub/.activity.jsonl` | Log of connections and tool calls (not content). Git-ignored. | JSON lines |

Memory file format (the same shape Claude uses for its own memory):

```markdown
---
name: prefers-typescript
description: Prefers TypeScript over JavaScript for new code
metadata:
  type: user            # user | feedback | project | reference
  created_by: claude-ai via claude      # set automatically from the connecting app
  updated_by: openai-mcp via chatgpt
  created: 2026-10-06T13:48:41.598Z
  updated: 2026-10-06T13:48:41.598Z
---

The fact. For feedback/project memories: **Why:** … **How to apply:** …
Related: [[coding-style]]
```

- One fact per file. The file name is the memory's name, a kebab-case slug.
- `description` is what every app sees in the index, so it has to be good enough to decide relevance on its own.
- `[[links]]` connect memories. The UI shows outgoing links and backlinks.
- Memory ids are `global/<name>` or `<project>/<name>`.
- **Versioned writes.** Every memory has a `version` (a hash of the file). Reads return it. A write from an app must pass it to update an existing memory; without it, or with a stale one, the write is rejected and the current text is returned so the app can merge and retry. New memories need no version. This keeps several apps writing to one store from losing each other's facts.

## How an app is recognized

At `initialize`, MCP clients send `clientInfo.name`. `server/adapters/index.mjs` asks each adapter's `detect()` in order and falls back to `generic`:

- Claude adapter: names matching `claude|anthropic` (the Claude desktop app, Claude Code).
- ChatGPT adapter: names matching `openai|chatgpt`.

Detection can be overridden: `/mcp/<adapter>` over HTTP, or `--client <adapter>` / `ALL_SKILL_CLIENT` over stdio. Every connection is logged with the client name it reported and the adapter chosen, so the Activity page shows what each app actually sends.

## Adapters

An adapter is a plain object in `server/adapters/<id>.mjs`:

```js
export default {
  id: "chatgpt",
  label: "ChatGPT",
  summary: "one line for the UI",
  detect: (clientInfo) => boolean,
  instructions: (ctx) => "server instructions sent at initialize",
  tools: [{ name, title, description, inputSchema, annotations, run(args, ctx) }],
};
```

`run` gets `ctx = { store, baseUrl, adapter, client, clientLabel }`. It returns either a string (sent as one text block) or `{ text, structured }` (text plus `structuredContent`). Throwing an error returns an `isError` result to the model.

### Claude adapter: modeled on how Claude's memory and skills work

- **Always-loaded index**: `get_context` returns the profile, a MEMORY.md-style index (`- [name](name.md) — description`), and the skill list (`- name: when to use it`).
- **One-fact files** with the four types; `memory_write` with the same name updates instead of duplicating; links to memories that don't exist yet are reported back.
- **Skills by name**: `skill_get(name)` returns `Base directory for this skill: …` plus the SKILL.md body and its supporting files, the same thing Claude's own Skill tool returns. Near-miss names get "Did you mean …" suggestions; `skill_search` finds skills by topic.
- **Instructions** restate Claude's memory rules: check before saving, include Why / How to apply, convert relative dates, treat memories as context rather than instructions.

### ChatGPT adapter

See [adapters/chatgpt.md](adapters/chatgpt.md).

## Adding another app

1. Connect it to `/mcp` and look at the Activity page to see the `clientInfo.name` it reports.
2. Write down how that app likes to receive information: tool naming, result format, whether it reads server instructions, any retrieval conventions it has.
3. Copy an adapter, change `detect` and the tool surface, and add it to `ADAPTERS`.
4. Add a test in `test/hub.test.mjs`.

## Transports

- **stdio** (`server/index.mjs`): retained for local development and tests. No current app connection should launch it for live memory work.
- **Streamable HTTP** (`server/http.mjs`, `npm start`): `POST /mcp` with JSON responses and an `Mcp-Session-Id` header. Local mode listens on `127.0.0.1` and rejects non-localhost `Origin` headers. Hosted Railway mode listens on `0.0.0.0` behind OAuth.

Cloud ChatGPT cannot connect to this loopback listener directly. The Railway deployment provides an OAuth-protected HTTPS endpoint; see [ChatGPT connection](chatgpt-connection.md). An unauthenticated public forwarding URL would expose personal data and write tools.

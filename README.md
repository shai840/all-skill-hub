# All-Skill

**One memory and skills hub for every AI app you use.** Claude and ChatGPT each keep their own memory and their own skills, so switching between them means re-explaining who you are, what you're working on and how you like things done. All-Skill gives them one shared place instead: your profile, your memories and your skills, stored as plain Markdown files and served to each app over MCP.

- **Every app reads and writes the same hub.** A fact you tell ChatGPT is there when you open Claude.
- **Each app gets the hub the way it likes it.** Claude gets a MEMORY.md-style index and loads skills by name, mirroring its own system; ChatGPT gets OpenAI-style `search`/`fetch`. The data underneath is identical.
- **Skills in the open `SKILL.md` format** that Claude and ChatGPT both use, with supporting files.
- **Safe writes across apps:** every memory has a version, so one app can't silently overwrite another, and corrections update the existing memory instead of piling up duplicates.
- **A saving policy** that travels with the hub: what apps may save, and what needs your OK first, such as health or finances.
- **Full history:** every change is a git commit credited to the app that made it, viewable and restorable in the web UI.
- **Web UI** to browse, edit and audit everything, including a "see what Claude / ChatGPT sees" preview and an activity log of every tool call.
- **Google sign-in** (OAuth 2.1 with PKCE and dynamic client registration) when hosted. No dependencies, Node 20+.

## Set it up with your AI agent

Paste this into Claude Code, Codex or any coding agent:

```
Set up All-Skill for me: https://github.com/shai840/all-skill-hub

Clone it and follow SETUP.md step by step. Ask me whether I want hosted (Railway, works in Claude web/desktop/mobile and ChatGPT) or local (Claude desktop and Claude Code on this computer only). Tell me exactly which accounts and keys I need before you start, do everything you can yourself, and stop and walk me through any step only I can do (Google Cloud Console, pasting instructions into app settings, signing in). Never print or ask me to paste secrets into the chat. At the end, install the "use the hub" instructions where you can, give me the ones I have to paste myself, and run the final check in SETUP.md.
```

Doing it by hand? [SETUP.md](SETUP.md) works for people too.

## What you'll need

| | Hosted | Local |
|---|---|---|
| Node 20+, git | ✓ | ✓ |
| [Railway](https://railway.com) account + CLI | ✓ | |
| Google Cloud OAuth client (Web application). An existing one can be reused. | ✓ | |
| Private GitHub repo + token for history backup | optional | |

## Make your apps actually use it

Connecting the tools isn't enough. Each app needs an instruction to use the hub instead of its own memory:

- Claude: [docs/instructions/claude.md](docs/instructions/claude.md), pasted into Settings → Profile (and `~/.claude/CLAUDE.md` for Claude Code)
- ChatGPT: [docs/instructions/chatgpt.md](docs/instructions/chatgpt.md), pasted into Custom instructions

Then move your existing memories in with the bundled `import-native-memory` skill, and turn the apps' built-in memory off. [docs/testing.md](docs/testing.md) checks it all works, without the test prompts mentioning the hub.

## Where your data lives

The code repo **never** contains your data. `hub/` is git-ignored.

- **Hosted:** on the server's persistent volume, as Markdown files with their own git history. Set `DATA_REPO_URL` to push that history to a **private** GitHub repo as an off-site backup.
- **Local:** in `./hub`, created from [templates/hub](templates/hub) on first run.

## Develop

```bash
npm start        # local hub + web UI at http://localhost:4747, reloads on code changes
npm test         # store, adapters, stdio/HTTP transports, OAuth flow, history
npm run deploy   # tests, then `railway up`
```

How it fits together, and how to add an adapter for another app: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT

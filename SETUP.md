# All-Skill setup guide (for AI agents)

You're an AI agent helping a user set up All-Skill: one memory, context and skills hub that Claude, ChatGPT and other MCP apps all share. Follow this guide top to bottom. Each step says what you can do yourself and what only the user can do. When a step needs the user, stop, tell them exactly what to do, and wait.

**Never ask the user to paste a secret into the chat, and never print one.** Move secrets with commands that pipe them directly (shown below), or have the user enter them in the provider's own UI.

---

## 0. What you're building

- **The hub** is plain Markdown files: `profile.md`, `policy.md`, `memories/`, `skills/<name>/SKILL.md`. It starts as a copy of `templates/hub/`.
- **The server** (`server/`, Node 20+, no dependencies) exposes the hub over MCP with a separate *adapter* per app: Claude gets a MEMORY.md-style index and load-skills-by-name, and ChatGPT gets `search`/`fetch`. It also serves a web UI.
- **Two ways to run it:**

| | Hosted (recommended) | Local |
|---|---|---|
| Works in | Claude web, desktop and mobile, Claude Code, ChatGPT, Codex | Claude desktop and Claude Code on this computer only |
| Needs | Railway account, Google OAuth client | Nothing beyond Node |
| Security | Google sign-in, email allowlist | Listens on 127.0.0.1 only |
| History | Every change is a git commit on the server volume; optional private GitHub backup | Optional |

Ask the user which they want. If they use ChatGPT, or Claude on the web or phone, they need **hosted**.

---

## 1. Collect what you need

Ask the user for these (or check them yourself where noted):

| Item | Hosted | Local | How to get it |
|---|---|---|---|
| Node 20+ and git | ✓ | ✓ | `node --version`, `git --version` (check yourself) |
| Railway account + CLI logged in | ✓ | | `railway whoami` (check yourself). If missing: user installs the CLI (`brew install railway` or `npm i -g @railway/cli`) and runs `railway login`. |
| Email(s) allowed to sign in | ✓ | | Ask. Usually just the user's Google account email. `AUTH_ALLOWED_DOMAIN` can allow a whole Google Workspace domain instead. |
| Google OAuth client (Web application) | ✓ | | See 1a. The user may already have one from another MCP server; it can be reused. |
| Optional: private GitHub repo + token for data backup | optional | | See step 6. |

### 1a. Google OAuth client (hosted only; user does this in Google Cloud Console)

If the user already has a **Web application** OAuth client (for example from a Google Workspace MCP server), reuse it and skip to adding the redirect URI in step 3.

Otherwise, tell the user:
1. Go to https://console.cloud.google.com → pick or create a project.
2. APIs & Services → **OAuth consent screen**: External, add their own email as a test user (or publish). Scopes needed: only `openid` and `email`.
3. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → type **Web application**. Leave the redirect URIs empty for now; you'll add one after the domain exists (step 3).
4. Keep the Client ID and Client secret handy for step 3. Don't paste them into the chat.

---

## 2. Get the code

```bash
git clone https://github.com/shai840/all-skill-hub.git
cd all-skill-hub
npm test   # should report every test passing
```

---

## 3. Hosted setup on Railway

Run these yourself (they're non-interactive). Pick a project name; the examples use `all-skill-hub`.

```bash
railway init --name all-skill-hub --json            # creates the project and links this folder
railway add --service hub --json                    # an empty service
railway service link hub
railway volume add --mount-path /data --json        # persistent disk for the hub + login state
railway domain --service hub --json                 # prints the public URL, e.g. https://hub-production-xxxx.up.railway.app
```

Save the domain as `HUB_URL` (no trailing slash). Then set the non-secret variables:

```bash
railway variables --service hub --skip-deploys \
  --set "MCP_AUTH_BASE_URL=$HUB_URL" \
  --set "AUTH_ALLOWED_EMAILS=user@example.com"
```

**Google secrets (the user runs this, or you run it without echoing).** If the client already lives in another Railway service, pipe it across. The values never appear on screen:

```bash
# Copy from an existing Railway service (adjust the project ID, environment and service):
for k in MCP_AUTH_GOOGLE_CLIENT_ID MCP_AUTH_GOOGLE_CLIENT_SECRET; do
  railway variables --project <SOURCE_PROJECT_ID> --environment production --service <SOURCE_SERVICE> --kv \
    | grep "^$k=" | cut -d= -f2- | tr -d '\n' \
    | railway variables --service hub --skip-deploys --set-from-stdin "$k"
done
```

Otherwise the user sets `MCP_AUTH_GOOGLE_CLIENT_ID` and `MCP_AUTH_GOOGLE_CLIENT_SECRET` in the Railway dashboard (service → Variables), or runs `railway variables --service hub --set-from-stdin MCP_AUTH_GOOGLE_CLIENT_SECRET` and pastes it into their own terminal.

Verify that both exist **without printing them**:

```bash
railway variables --service hub --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const k of ["MCP_AUTH_GOOGLE_CLIENT_ID","MCP_AUTH_GOOGLE_CLIENT_SECRET","AUTH_ALLOWED_EMAILS","MCP_AUTH_BASE_URL"])console.log(k, j[k]?"set":"MISSING")})'
```

**Redirect URI (user, in Google Cloud Console):** open the OAuth client → **Authorized redirect URIs** → add `$HUB_URL/auth/callback` → Save. Existing URIs can stay.

**Deploy** (runs the tests first and refuses to upload if any fail):

```bash
npm run deploy
```

**Verify from outside.** All of these should hold:

```bash
curl -s -o /dev/null -w "%{http_code}\n" $HUB_URL/api/health          # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST $HUB_URL/mcp          # 401 (sign-in required)
curl -s $HUB_URL/.well-known/oauth-authorization-server | head -c 200   # JSON with authorization_endpoint
railway logs --service hub | grep -E "seeded|Google sign-in on"        # seeded from templates/hub; sign-in on
```

The server **refuses to start** on Railway without the Google variables, so a crash-looping first deploy usually means a missing secret.

Then have the user open `$HUB_URL` in a browser and sign in with Google. A non-allowlisted account sees "not allowed to use this hub".

---

## 4. Local setup (instead of hosted)

```bash
npm start     # supervisor + web UI + MCP at http://localhost:4747; reloads on code changes
```

Connect the Claude desktop app through its config file. **The app rewrites that file when it quits**, so the installer waits for the user to quit (⌘Q) before editing it, then reopens Claude:

```bash
open -a Terminal scripts/install-local-claude-desktop.command   # macOS
```

Claude Code: `claude mcp add all-skill -s user -- node "$PWD/server/index.mjs"`

---

## 5. Connect the apps

| App | How |
|---|---|
| **Claude** (web, desktop, mobile) | User: Settings → Connectors → **Add custom connector** → name `All-Skill`, URL `$HUB_URL/mcp` → Connect → sign in with Google. One connector covers every Claude surface. |
| **Claude Code** | `claude mcp add --transport http all-skill $HUB_URL/mcp -s user`, then `/mcp` in Claude Code to sign in. |
| **ChatGPT** | User: Settings → Apps & Connectors → Advanced → enable **Developer mode**, then **Create** a connector with URL `$HUB_URL/mcp/chatgpt` and OAuth authentication; sign in with Google. Full read/write needs a plan that allows custom MCP write actions. |
| **Codex** | Copy `plugins/all-skill-hub/.mcp.json.example` to `.mcp.json`, replace `YOUR-HUB-DOMAIN`, and install the plugin from `.agents/plugins/marketplace.json`. |
| Anything else | `$HUB_URL/mcp` (the server detects the app) or `$HUB_URL/mcp/<claude|chatgpt|generic>` |

---

## 6. Make the apps use the hub: install the instructions

Connecting the tools isn't enough. Each app needs an instruction to use the hub instead of its own memory.

- **Claude Code:** append the block from [docs/instructions/claude.md](docs/instructions/claude.md) to `~/.claude/CLAUDE.md` yourself (create it if missing; don't remove existing content).
- **Claude (web/desktop/mobile):** you can't edit this setting. Tell the user to paste the same block into Settings → Profile → personal preferences. Print the block for them in a code block.
- **ChatGPT:** tell the user to paste the block from [docs/instructions/chatgpt.md](docs/instructions/chatgpt.md) into Settings → Personalization → Custom instructions.

---

## 7. Personalize and import

1. **Profile:** in the user's main app, start a new chat and say "Fill in my All-Skill profile". The app updates it with `profile_update`. It can also be edited in the web UI under Profile.
2. **Saving policy:** review `policy.md` with the user (web UI → Profile → Saving policy). Apps follow it before every write, and only the user can change it.
3. **Import existing memory:** in each app that has built-in memory, start a new chat and say: *"Use the import-native-memory skill to move everything you remember about me into All-Skill."* The app shows a plan and waits for approval.
4. **Then turn off the built-in memory** (Claude: Settings → Capabilities → Memory; ChatGPT: Settings → Personalization → Memory), so it stops competing with the hub.
5. **Skills:** existing `SKILL.md` folders can be added with the web UI or with `skill_write` from any app. Anthropic's and OpenAI's built-in skills don't need copying.

---

## 8. Optional: back up the hub's history to GitHub

Hosted, every change is already a git commit on the server's volume, viewable and restorable from the web UI. For an off-site copy:

1. The user creates a **private**, empty GitHub repo (e.g. `my-hub-data`) and a fine-grained token with *Contents: read and write* on that repo only.
2. Set it without echoing: `railway variables --service hub --set-from-stdin DATA_REPO_URL`. The user pastes `https://x-access-token:<TOKEN>@github.com/<user>/my-hub-data.git` into their own terminal.
3. Redeploy. Commits are pushed in batches about every 30 seconds.

**Never point `DATA_REPO_URL` at a public repo.** It contains everything the user's apps remember.

---

## 9. Final check with the user

Have the user open a **new** chat in each app and send, without mentioning the hub:

> Quick check-in: what am I working on, and what should I focus on this week?

Then confirm in the web UI's **Activity** page that the app called `get_context` on its own. If it didn't, re-check step 6. The full behaviour test is in [docs/testing.md](docs/testing.md).

---

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `MCP_AUTH_GOOGLE_CLIENT_ID` / `MCP_AUTH_GOOGLE_CLIENT_SECRET` | hosted | Google OAuth Web client. Without them the server won't start on Railway. |
| `AUTH_ALLOWED_EMAILS` | hosted | Comma-separated Google accounts allowed to sign in |
| `AUTH_ALLOWED_DOMAIN` | optional | Allow every verified account in a Google Workspace domain |
| `MCP_AUTH_BASE_URL` | hosted | Public origin, no trailing slash. Defaults to `https://$RAILWAY_PUBLIC_DOMAIN`. |
| `DATA_REPO_URL`, `DATA_REPO_BRANCH` | optional | Private git remote for hub history backups (branch defaults to `main`) |
| `ALL_SKILL_HUB` | optional | Hub folder. The Dockerfile sets `/data/hub`; locally it defaults to `./hub`. |
| `ALL_SKILL_SEED` | optional | Starter hub copied into an empty hub folder (default `templates/hub`) |
| `ALL_SKILL_HISTORY` | optional | `1`/`0` to force git history on or off (on by default when hosted) |
| `ALL_SKILL_PORT`, `ALL_SKILL_HOST` | optional | Listen address. Railway's `PORT` is used automatically. |

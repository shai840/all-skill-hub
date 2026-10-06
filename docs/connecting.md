# Connecting your apps to All-Skill

Once the hub is running, connect each AI app to it. Each app keeps its own OAuth connection to the hosted hub.

**Your hub address** (`HUB_URL` below) is the public URL from setup, for example `https://hub-production-xxxx.up.railway.app`. Open it in a browser and sign in with Google once first, to confirm the hub works and your account is allowed.

| Use this address | For |
|---|---|
| `HUB_URL/mcp` | Claude, Claude Code and most apps (the hub detects which app is connecting) |
| `HUB_URL/mcp/chatgpt` | ChatGPT (forces the ChatGPT-style tools) |
| `HUB_URL/mcp/claude`, `HUB_URL/mcp/generic` | Forcing a specific style, if an app is detected wrongly |

---

## Claude: web, desktop app and mobile

One connector covers all three, because it's saved to your Claude account.

1. In Claude, open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Name: `All-Skill`. URL: `HUB_URL/mcp`. Leave the advanced OAuth fields empty; the hub registers Claude automatically.
4. Click **Add**, then **Connect**. A browser window opens to your hub, which sends you to Google. Choose the allowed account.
5. You're returned to Claude and the connector shows as connected.

**Check it:** in a new chat, open the tools menu (the sliders icon) and make sure All-Skill is switched on. Then ask *"What's in my All-Skill profile?"*. Claude should call `get_context`.

On Team or Enterprise plans an owner may need to add the connector first under Organization settings → Connectors.

## Claude Code

```bash
claude mcp add --transport http --scope user all-skill HUB_URL/mcp
```

Then start Claude Code, run `/mcp`, pick **all-skill** and choose **Authenticate**. A browser opens for the Google sign-in. `--scope user` makes it available in every project.

**Check it:** `/mcp` lists all-skill as connected, and asking *"call get_context"* works.

## ChatGPT

The ability to create and use custom MCP plugins depends on the ChatGPT account and workspace settings. This hub offers read and write tools; workspace permissions and confirmation settings can limit which actions are available.

### Create the custom MCP plugin/connector

In the current ChatGPT interface, the custom connector is created as a **Plugin**. You can reach it from the sidebar's **Plugins** entry, or from **Settings → Plugins → Browse directory**.

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **Add** at the top, then **Add custom MCP server**.
2. Set **Name** to `All-Skill`. Under **Connection**, leave **Server URL** selected and enter `HUB_URL/mcp/chatgpt` (for this deployment: `https://hub-production-0242.up.railway.app/mcp/chatgpt`). Leave **Authentication** on **OAuth**. Use **dynamic client registration (DCR)** if advanced settings ask for a client setup method; do not enter a client ID or secret in ChatGPT. If an OpenID Connect option is offered, leave it off: this hub uses OAuth for access and does not expose an OIDC user-info endpoint.
3. Review the access warning, select **I understand and want to continue**, then **Create as a plugin**.
4. Find the new plugin in **Personal**, **install** it, and complete the Google sign-in with an allowed account. If `All-Skill Hub` is already installed and connected, use that existing plugin instead of creating a duplicate.

**Check it:** in a new chat, select the installed plugin with `@All-Skill` and ask *"What's in my All-Skill profile?"*. ChatGPT should call `get_context` or `search`. Then try a new chat without naming the hub and check the Activity page. The custom instruction requests a call at the start of each chat, but ChatGPT may skip it; an installed plugin is not a guarantee of automatic use. See [OpenAI's custom MCP setup guide](https://developers.openai.com/api/docs/guides/custom-mcp-server).

## Codex

Run these commands from the cloned repository root, after `$HUB_URL` points to your Railway origin (for example `https://hub-production-xxxx.up.railway.app`, with no trailing slash):

```bash
node scripts/configure-codex-plugin.mjs "$HUB_URL"
codex plugin marketplace list
```

If `all-skill-local` is absent, add this cloned repository as the marketplace:

```bash
codex plugin marketplace add "$PWD"
```

Then install and inspect the plugin:

```bash
codex plugin add all-skill-hub@all-skill-local
codex mcp get all-skill-hub
```

The configuration command writes both MCP fields to the same hosted URL. It leaves an existing connection alone if it points somewhere else, so review that file before changing it. The marketplace is named `all-skill-local` because the plugin files come from this clone; the memory and skill data still come from Railway. The personal `.mcp.json` is git-ignored. Check that `codex mcp get` shows your Railway URL. If the install did not open a sign-in page, run `codex mcp login all-skill-hub --oauth-client-registration dcr` and choose an allowlisted Google account. The plugin's hook needs Node on your `PATH`.

Start a **new Codex task** after install. The hook instructs Codex to call `get_context`, and this task should list `search`, `fetch`, `get_skill`, and `save_memory` as All-Skill tools. Ask *"What's in my All-Skill profile?"* and confirm the hub's **Activity** page records a Codex `get_context` call. Then start another new task with a normal request that does not name the hub; check Activity again. Hooks can direct the model but cannot force every tool call. A task opened before a server update may still list old names and return `Unknown tool`; start a new task to refresh its tool snapshot. If a fresh task still sees `memory_search`/`skill_get`, check the Activity page for the reported client name and adapter, then update the server's detection rule.

For the same preference across desktop and web, paste the [Codex custom instruction](instructions/codex.md) into ChatGPT Settings → Personalization → Codex. It points Codex at Railway for normal memory and skill work while keeping local native memory as a backup.

## Any other MCP app

Point it at `HUB_URL/mcp` using the **Streamable HTTP** transport with **OAuth**. The hub supports the standard MCP authorization flow: protected-resource metadata, dynamic client registration, and PKCE. Any compliant client signs in by itself.

## Local mode (no hosting)

If you run the hub on your own computer instead (`npm start`):

- **Claude desktop:** run `open -a Terminal scripts/install-local-claude-desktop.command` and quit Claude when it asks. The app overwrites its config when it quits, so the script waits for that before editing.
- **Claude Code:** `claude mcp add --scope user all-skill -- node /path/to/all-skill-hub/server/index.mjs`
- There's no sign-in locally. The hub only listens on your own computer (127.0.0.1). ChatGPT and Claude on the web or phone can't reach a local hub.

---

## After connecting

Connecting gives apps the tools, but they won't use them consistently until you add the instructions:

- Claude: [instructions/claude.md](instructions/claude.md)
- ChatGPT: [instructions/chatgpt.md](instructions/chatgpt.md)
- Codex: [instructions/codex.md](instructions/codex.md)

Then run the [behaviour test](testing.md).

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Google shows **"redirect_uri_mismatch"** | The OAuth client doesn't have `HUB_URL/auth/callback` in its Authorized redirect URIs. Add it in Google Cloud Console and save; it can take a minute to apply. |
| The hub says **"… is not allowed to use this hub"** | That Google account isn't in `AUTH_ALLOWED_EMAILS` (or `AUTH_ALLOWED_DOMAIN`). Add it on the server and redeploy, or sign in with the allowed account. |
| **"This sign-in link expired"** | The sign-in took longer than 10 minutes, or the server restarted mid-sign-in. Click Connect again. |
| The connector connects but **no tools appear** | Start a new chat. Apps load the tool list when a chat begins. In Claude, also check the connector is switched on in that chat's tools menu. |
| It keeps asking you to sign in again | The server's login state isn't persisting. Make sure the volume is mounted at `/data`. |
| **Two copies of every tool** | The app is connected twice, for example an old local entry plus the hosted connector. Remove one. |
| ChatGPT can read but not save | Your plan or workspace only allows read actions for custom connectors. |
| The app connects but ignores the hub | Check its instructions or hook, whether the plugin is enabled in that chat, and the Activity page. Some short requests may not trigger a tool call. See "After connecting". |
| Every request gets **401** | Expected without a login. If it persists after connecting, disconnect and reconnect the connector to get a fresh login. |

The web UI's **Activity** page shows every connection and tool call, and which app made it. It's the quickest way to see whether an app is reaching the hub at all.

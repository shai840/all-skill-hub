# Connecting your apps to All-Skill

Once the hub is running, connect each AI app to it. You only do this once per app; after that, the app signs in automatically and refreshes its login by itself.

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

Custom connectors need ChatGPT's **developer mode**. Writing to the hub (saving memories) needs a plan that allows custom-connector write actions; on plans that only allow read actions, ChatGPT can read the hub but not save to it.

1. In ChatGPT, open **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode**.
2. Back in **Apps & Connectors**, click **Create**.
3. Name: `All-Skill`. MCP server URL: `HUB_URL/mcp/chatgpt`. Authentication: **OAuth**.
4. Confirm you trust the connector, then click **Create**. Sign in with Google when asked.

**Check it:** in a new chat, add the All-Skill connector from the **+** menu (or Developer mode's tool picker) and ask *"Use All-Skill: what's in my profile?"*. ChatGPT should call `get_context` or `search`.

## Codex

```bash
cp plugins/all-skill-hub/.mcp.json.example plugins/all-skill-hub/.mcp.json
# edit .mcp.json and replace YOUR-HUB-DOMAIN with your hub's domain
```

Install the plugin from this repo's marketplace (`.agents/plugins/marketplace.json`) in Codex, then sign in when Codex prompts for OAuth. The plugin's startup hook asks Codex to load your hub context at the start of each task.

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
| The app connects but ignores the hub | The instructions aren't installed, or the app's own memory is still on and competing. See "After connecting". |
| Every request gets **401** | Expected without a login. If it persists after connecting, disconnect and reconnect the connector to get a fresh login. |

The web UI's **Activity** page shows every connection and tool call, and which app made it. It's the quickest way to see whether an app is reaching the hub at all.

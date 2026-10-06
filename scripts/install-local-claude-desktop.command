#!/bin/zsh
# Local mode: registers this repo's hub as a stdio MCP server in the Claude desktop app (macOS).
# The app rewrites its config when it quits, so this waits for the app to close first.
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
APP_BIN="/Applications/Claude.app/Contents/MacOS/Claude"
HUB_SERVER="$(cd "$(dirname "$0")/.." && pwd)/server/index.mjs"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"

echo "All-Skill local installer"
if pgrep -f "$APP_BIN" >/dev/null; then
  echo "→ Quit the Claude app now (⌘Q). Waiting for it to close..."
  while pgrep -f "$APP_BIN" >/dev/null; do sleep 1; done
  sleep 2
fi
mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] || echo '{}' > "$CFG"
cp "$CFG" "$CFG.bak-allskill-$(date +%Y%m%d%H%M%S)"
"$NODE" -e '
const fs=require("fs"),[p,node,server]=process.argv.slice(1);
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.mcpServers=c.mcpServers||{};
c.mcpServers["all-skill"]={command:node,args:[server]};
fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n");
console.log("✓ Added all-skill:", server);
' "$CFG" "$NODE" "$HUB_SERVER"
echo "→ Reopening Claude..."
open -a Claude
echo "Done. Web UI: http://localhost:4747"

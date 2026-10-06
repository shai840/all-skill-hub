#!/bin/zsh
# Deploy the hub to Railway, but only if every test passes.
set -e
cd "$(dirname "$0")/.."
npm test
railway up --service hub --detach
echo "Deploy started. Watch: railway logs --service hub"

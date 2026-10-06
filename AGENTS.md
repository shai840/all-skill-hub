# For AI agents

- **Setting this up for a user?** Follow [SETUP.md](SETUP.md) step by step. It lists what to ask the user, which keys are needed, the exact commands, how to verify each step, and which steps only the user can do. Never print or ask for secrets in chat.
- **Changing the code?** Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Keep `server/core/` app-agnostic; anything specific to one AI app belongs in `server/adapters/`. Run `npm test` before finishing; deploy with `npm run deploy`, which refuses to upload if tests fail.
- **Never commit hub data.** `hub/` (memories, skills, profile) and `auth-state.json` are git-ignored on purpose. The starter content lives in `templates/hub/`.

---
name: commit-message
description: Use when writing a git commit message or a pull request title for the user's changes.
---

# Commit message

Write commit messages the way the user likes them:

1. **Subject line**: imperative mood ("Add", "Fix", "Remove"), at most 60 characters, no trailing period. Say what changed for the user, not which files moved.
2. **Blank line**, then a short body (wrap at 72) only if the *why* isn't obvious from the subject. Explain the reason and any trade-off; skip a file-by-file list.
3. If the change fixes a ticket, end with `Fixes <ticket>` on its own line.
4. Never claim tests passed unless you ran them in this session.

Show the message to the user before committing, unless they already asked you to commit.

## Example

```
Detect the calling app before choosing tool names

Claude and ChatGPT expect different tool shapes, so the hub now picks
an adapter from clientInfo at initialize instead of exposing one set.
```

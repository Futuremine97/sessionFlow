---
name: transfer-session
description: Transfer an AI conversation's context into another session/model and produce a paste-ready handoff primer.
argument-hint: "<export-or-text-path> [--to claude|chatgpt|gemini]"
---

# /transfer-session

Hand off the working context of a conversation to another AI session.

Use the bundled CLI at `${CLAUDE_PLUGIN_ROOT}/scripts/s2s.js`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/s2s.js" transfer "$ARGUMENTS"
```

Interpret `$ARGUMENTS` as a path to a conversation export (or pasted-text file)
optionally followed by flags such as `--to claude`, `--from chatgpt`, `--mask`,
`--full`, or `-o primer.txt`.

If the user pasted raw conversation text instead of a file path, write it to a
temp file and run the `paste` subcommand instead:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/s2s.js" paste /tmp/chat.txt --to claude
```

Then present the resulting primer in a copyable code block and summarize, in one
line, what was carried over (decisions, open threads, artifacts). Keep secrets
masked (`--mask`) unless the user explicitly opts out.

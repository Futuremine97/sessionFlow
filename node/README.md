# session-to-session (npm)

Transfer AI session context between sessions — same AI or different AI, same
model or different model. Cross-vendor handoff for **Claude / ChatGPT / Gemini**
via a platform-neutral *Session Capsule*. Zero dependencies (Node 18+).

```bash
npm install -g session-to-session
```

## Usage

```bash
# One-shot: a conversation export -> a primer for the target AI
s2s transfer export.json --to claude --mask -o primer.txt

# From pasted text (stdin), no export file needed
pbpaste | s2s paste --to gemini

# Combine several sessions into one project memory
s2s merge a.capsule.json b.capsule.json --to claude

# Redact secrets / PII from a capsule
s2s mask session.capsule.json -o safe.capsule.json

# What changed between two revisions
s2s diff old.capsule.json new.capsule.json

# Run the HTTP API (backs a ChatGPT Custom GPT Action)
s2s serve --port 8787
```

### High-efficiency encoding + protection

Turn a capsule into a single compact, pasteable token — optionally encrypted —
to move it between sessions:

```bash
# Compress only (smaller transfer, integrity-checked): capsule -> token
s2s encode session.capsule.json -o token.txt
s2s decode token.txt -o session.capsule.json

# Encrypt (AES-256-GCM, passphrase-derived key via scrypt): seal -> token
s2s seal session.capsule.json --pass "my secret phrase" -o sealed.txt
s2s unseal sealed.txt --pass "my secret phrase" --to claude    # -> primer

# One-shot: export straight to a sealed token
s2s transfer export.json --seal --pass "my secret phrase" -o sealed.txt
```

The sealed token compresses first then encrypts (typically ~50% smaller than
the JSON), is authenticated by a 128-bit GCM tag plus an embedded SHA-256 of
the plaintext, and cannot be read or altered without the passphrase. Passphrase
sources: `--pass`, `--pass-file`, or env `S2S_PASSPHRASE`.

Commands: `transfer`, `paste`, `capsule`, `primer`, `merge`, `mask`, `diff`,
`inspect`, `serve`, `encode`, `decode`, `seal`, `unseal`, `token-info`.
Flags: `--from`, `--to`, `--full`, `--mask`, `--offline`, `-o <file>`,
`--capsule <file>`.

LLM summary is used automatically when `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`GEMINI_API_KEY` is set; otherwise a built-in heuristic runs offline.

## Library

```js
const s2s = require('session-to-session');
const { primer, capsule } = await s2s.transfer(text, { to: 'claude', mask: true });
```

`detectAndLoad`, `compress`, `buildPrimer`, `mergeCapsules`, `diffCapsules`,
`maskCapsule`, `smartSummary`, `toJSON`/`fromJSON` are all exported.

## Test

```bash
npm test
```

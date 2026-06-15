#!/usr/bin/env node
// s2s — transfer AI session context between sessions (npm CLI).
'use strict';

const fs = require('fs');
const path = require('path');
const s2s = require('../src/index');

function readInput(arg) {
  if (!arg || arg === '-') return fs.readFileSync(0, 'utf8'); // stdin
  return fs.readFileSync(arg, 'utf8');
}
function out(text, file) {
  if (file) {
    fs.writeFileSync(file, text);
    process.stderr.write(`wrote ${file}\n`);
  } else process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}
function parseFlags(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') {
      flags.o = argv[++i]; // short alias for --output
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['full', 'offline', 'mask', 'json', 'seal', 'encode', 'boot', 'embed'].includes(key)) flags[key] = true;
      else if (key === 'attach') (flags.attach = flags.attach || []).push(argv[++i]); // repeatable
      else flags[key] = argv[++i];
    } else pos.push(a);
  }
  return { flags, pos };
}

function resolvePass(flags) {
  if (flags.pass) return flags.pass;
  if (flags['pass-file']) return fs.readFileSync(flags['pass-file'], 'utf8').trim();
  if (process.env.S2S_PASSPHRASE) return process.env.S2S_PASSPHRASE;
  throw new Error('passphrase required: use --pass <phrase>, --pass-file <f>, or env S2S_PASSPHRASE');
}

async function loadCompressed(text, flags) {
  const cap = s2s.detectAndLoad(text, flags.from);
  if (!flags.offline && s2s.activeProvider()) {
    cap.context.summary = await s2s.smartSummary(cap, { verbose: true });
    s2s.compress(cap, { summarizer: () => cap.context.summary });
  } else {
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
  }
  if (flags.attach && flags.attach.length) {
    s2s.attachToCapsule(cap, flags.attach, { embed: !!flags.embed, caption: flags.caption });
  }
  if (flags.mask) s2s.maskCapsule(cap);
  s2s.finalize(cap);
  return cap;
}

const HELP = `s2s — transfer AI session context between sessions

Usage:
  s2s transfer <export>  [--from x] [--to y] [--full] [--offline] [--mask] [-o file] [--capsule f]
  s2s paste    [file|-]  [--to y] [--full] [--offline] [--mask] [-o file]
  s2s capsule  <export>  [--from x] [--mask] [-o file]      # normalize+compress -> capsule.json
  s2s primer   <capsule> [--to y] [--full] [-o file]
  s2s merge    <a.json> <b.json> [...]  [--to y] [-o file]  # combine sessions
  s2s attach   <capsule> <file...> [--embed] [--caption ".."] # add photos/papers
  s2s mask     <capsule> [-o file]                          # redact secrets/PII
  s2s diff     <old.json> <new.json>                        # what changed
  s2s inspect  <capsule>
  s2s serve    [--port 8787]                                # HTTP API (Custom GPT backend)

  # high-efficiency encoding + protection (compact pasteable tokens)
  s2s encode   <capsule> [-o file]                          # compress -> base64url token
  s2s decode   <token>   [-o file]                          # token -> capsule.json
  s2s seal     <capsule> --pass <phrase> [-o file]          # AES-256-GCM encrypt -> token
  s2s seal     <capsule> --boot [-o file]                   # encrypt w/ boot-session key
  s2s unseal   <token>   [--pass <phrase>] [--to y] [-o f]  # decrypt -> capsule/primer
  s2s bootkey                                               # show boot key tag/status
  s2s token-info <token>                                    # compressed | encrypted (mode)?
  s2s transfer <export>  --seal --pass <phrase>             # export -> sealed token
  s2s transfer <export>  --encode                           # export -> compressed token

Targets: claude | chatgpt | gemini | generic
Source : claude | chatgpt | gemini | paste   (omit to auto-detect)
Attach : --attach <file> (repeatable) [--embed] [--caption ".."] on transfer/paste/capsule
Passphrase: --pass <phrase> | --pass-file <f> | env S2S_PASSPHRASE
LLM summary auto-used when ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY is set.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseFlags(rest);

  switch (cmd) {
    case 'transfer': {
      const cap = await loadCompressed(readInput(pos[0]), flags);
      cap.include_full_transcript = !!flags.full;
      if (flags.seal || flags.encode) {
        // emit a compact (optionally encrypted) token instead of a primer
        const json = s2s.toJSON(cap);
        let res;
        if (flags.seal) res = flags.boot ? s2s.sealWithBootKey(json) : s2s.seal(json, resolvePass(flags));
        else res = s2s.encode(json);
        out(res.token, flags.o);
        process.stderr.write(`${flags.seal ? 'sealed' : 'encoded'}: ${res.rawBytes}B -> ${res.encodedBytes}B (ratio ${res.ratio})\n`);
      } else {
        out(s2s.buildPrimer(cap, flags.to || 'generic', !!flags.full), flags.o);
      }
      if (flags.capsule) fs.writeFileSync(flags.capsule, s2s.toJSON(cap));
      break;
    }
    case 'encode': {
      const json = s2s.toJSON(s2s.fromJSON(readInput(pos[0])));
      const res = s2s.encode(json);
      out(res.token, flags.o);
      process.stderr.write(`encoded: ${res.rawBytes}B -> ${res.encodedBytes}B (ratio ${res.ratio}, base64 ${res.token.length} chars)\n`);
      break;
    }
    case 'decode': {
      const token = readInput(pos[0]).trim();
      out(s2s.decode(token), flags.o);
      break;
    }
    case 'seal': {
      const json = s2s.toJSON(s2s.fromJSON(readInput(pos[0])));
      const res = flags.boot ? s2s.sealWithBootKey(json) : s2s.seal(json, resolvePass(flags));
      out(res.token, flags.o);
      process.stderr.write(`sealed (AES-256-GCM, ${res.mode}${res.bootTag ? ' boot:' + res.bootTag : ''}): ${res.rawBytes}B -> ${res.encodedBytes}B (ratio ${res.ratio})\n`);
      break;
    }
    case 'unseal': {
      const token = readInput(pos[0]).trim();
      const info = s2s.tokenInfo(token);
      const json = info.mode === 'bootkey' ? s2s.unsealWithBootKey(token) : s2s.unseal(token, resolvePass(flags));
      if (flags.to) {
        const cap = s2s.fromJSON(json);
        cap.include_full_transcript = !!flags.full;
        out(s2s.buildPrimer(cap, flags.to, !!flags.full), flags.o);
      } else {
        out(json, flags.o);
      }
      break;
    }
    case 'bootkey': {
      const st = s2s.bootkey.status();
      process.stdout.write(JSON.stringify(st, null, 2) + '\n');
      break;
    }
    case 'attach': {
      // attach file(s) to an existing capsule.json: s2s attach capsule.json file1 file2 [--embed --caption "..."]
      const cap = s2s.fromJSON(readInput(pos[0]));
      const files = pos.slice(1).concat(flags.attach || []);
      if (!files.length) throw new Error('provide one or more files to attach');
      s2s.attachToCapsule(cap, files, { embed: !!flags.embed, caption: flags.caption });
      s2s.finalize(cap);
      out(s2s.toJSON(cap), flags.o);
      const last = cap.attachments[cap.attachments.length - 1];
      process.stderr.write(`attached ${files.length} file(s); ${cap.attachments.length} total. last: [${last.kind}] ${last.name}\n`);
      break;
    }
    case 'token-info': {
      const token = readInput(pos[0]).trim();
      process.stdout.write(JSON.stringify(s2s.tokenInfo(token), null, 2) + '\n');
      break;
    }
    case 'paste': {
      const text = pos[0] && pos[0] !== '-' ? fs.readFileSync(pos[0], 'utf8') : fs.readFileSync(0, 'utf8');
      flags.from = 'paste';
      const cap = await loadCompressed(text, flags);
      cap.include_full_transcript = !!flags.full;
      out(s2s.buildPrimer(cap, flags.to || 'generic', !!flags.full), flags.o);
      break;
    }
    case 'capsule': {
      const cap = await loadCompressed(readInput(pos[0]), flags);
      out(s2s.toJSON(cap), flags.o);
      break;
    }
    case 'primer': {
      const cap = s2s.fromJSON(readInput(pos[0]));
      if (!cap.context.summary) s2s.compress(cap, { summarizer: s2s.heuristicSummary });
      cap.include_full_transcript = !!flags.full;
      out(s2s.buildPrimer(cap, flags.to || 'generic', !!flags.full), flags.o);
      break;
    }
    case 'merge': {
      const caps = pos.map((p) => {
        const cap = s2s.fromJSON(fs.readFileSync(p, 'utf8'));
        if (!cap.context.summary) s2s.compress(cap, { summarizer: s2s.heuristicSummary });
        return cap;
      });
      const merged = s2s.mergeCapsules(caps);
      s2s.finalize(merged);
      if (flags.to) out(s2s.buildPrimer(merged, flags.to, !!flags.full), flags.o);
      else out(s2s.toJSON(merged), flags.o);
      break;
    }
    case 'mask': {
      const cap = s2s.fromJSON(readInput(pos[0]));
      s2s.maskCapsule(cap);
      s2s.finalize(cap);
      out(s2s.toJSON(cap), flags.o);
      process.stderr.write(`masked ${cap.extra.masked.count} secret(s): ${JSON.stringify(cap.extra.masked.labels)}\n`);
      break;
    }
    case 'diff': {
      const a = s2s.fromJSON(fs.readFileSync(pos[0], 'utf8'));
      const b = s2s.fromJSON(fs.readFileSync(pos[1], 'utf8'));
      [a, b].forEach((c) => { if (!c.context.summary) s2s.compress(c, { summarizer: s2s.heuristicSummary }); });
      s2s.finalize(a); s2s.finalize(b);
      out(s2s.formatDiff(s2s.diffCapsules(a, b)), flags.o);
      break;
    }
    case 'inspect': {
      const cap = s2s.fromJSON(readInput(pos[0]));
      if (!cap.context.summary) s2s.compress(cap, { summarizer: s2s.heuristicSummary });
      const c = cap.context;
      const turns = cap.transcript.length || cap.extra.transcript_turn_count || 0;
      process.stdout.write(
        `Source      : ${cap.source_platform} / ${cap.source_model}\n` +
        `Title       : ${cap.title}\n` +
        `Turns       : ${turns}\n` +
        `Summarizer  : ${cap.extra.summarizer} (provider: ${s2s.activeProvider() || 'none -> heuristic'})\n` +
        `~tokens(ctx): ${c.token_estimate}\n` +
        `Facts/Dec/Open/Art: ${c.key_facts.length}/${c.decisions.length}/${c.open_threads.length}/${cap.artifacts.length}\n` +
        `Hash/Rev    : ${cap.content_hash} / r${cap.revision}\n\n${c.summary}\n`
      );
      break;
    }
    case 'serve': {
      process.env.PORT = flags.port || process.env.PORT || '8787';
      require('../src/server').start();
      break;
    }
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(HELP + '\n');
      break;
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP}\n`);
      process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
});

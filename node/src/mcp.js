// mcp.js — a zero-dependency MCP server over stdio.
//
// Implements the Model Context Protocol's stdio transport: newline-delimited
// JSON-RPC 2.0 messages on stdin/stdout. Handles `initialize`, `tools/list`,
// and `tools/call`. Exposes the session_to_session pipeline as tools, with
// the boot-session key (auto-rotating on reboot) backing seal/unseal by
// default.
//
// Usable by any MCP client (Claude Desktop / Cowork, etc.). See
// mcp/README.md for the config snippet.

'use strict';

const readline = require('readline');
const s2s = require('./index');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'session-to-session', version: require('../package.json').version };

// ---- tool definitions ------------------------------------------------------
const TOOLS = [
  {
    name: 'transfer_session',
    description:
      'Convert a conversation (pasted text or vendor export) into a handoff primer for a target AI (claude/chatgpt/gemini). Returns the paste-ready primer plus what was carried over.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'The conversation to transfer.' },
        to: { type: 'string', enum: ['claude', 'chatgpt', 'gemini', 'generic'], default: 'claude' },
        from: { type: 'string', enum: ['claude', 'chatgpt', 'gemini', 'paste'], description: 'Omit to auto-detect.' },
        full: { type: 'boolean', default: false, description: 'Append verbatim transcript.' },
        mask: { type: 'boolean', default: true, description: 'Redact secrets/PII.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Optional local file paths (photos/papers) to include in the handoff.' },
      },
    },
  },
  {
    name: 'seal_session',
    description:
      'Compress + encrypt a conversation/capsule into a compact, protected token (AES-256-GCM). By default uses the machine boot-session key, which auto-regenerates on every reboot (ephemeral). Pass a passphrase to use a portable key instead.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Conversation text or capsule JSON to seal.' },
        passphrase: { type: 'string', description: 'Optional. If given, derives the key from it (scrypt) instead of the boot key.' },
        mask: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'unseal_session',
    description:
      'Decrypt an s2s token back into a capsule, or into a primer if "to" is given. Boot-keyed tokens only open during the same boot session they were sealed in.',
    inputSchema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string' },
        passphrase: { type: 'string', description: 'Required for passphrase-sealed tokens.' },
        to: { type: 'string', enum: ['claude', 'chatgpt', 'gemini', 'generic'], description: 'If set, return a primer.' },
      },
    },
  },
  {
    name: 'encode_session',
    description: 'Compress a conversation/capsule into a compact (unencrypted) base64url token for efficient transfer.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
  },
  {
    name: 'decode_session',
    description: 'Decode a compressed (unencrypted) s2s token back into capsule JSON.',
    inputSchema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
  },
  {
    name: 'boot_key_status',
    description: 'Report the current boot-session key tag and when it was generated. The key rotates automatically when the machine reboots.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ingest_attachment',
    description:
      'Read a photo or paper/PDF from a local path and return its catalog entry: type, size, SHA-256, image dimensions, or (for PDFs) title + page count + text excerpt. Use to fold attachments into a session handoff.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute path to the file.' },
        caption: { type: 'string', description: 'Optional alt text for an image.' },
        embed: { type: 'boolean', default: false, description: 'Base64-embed the bytes (inflates output).' },
      },
    },
  },
];

// ---- helpers ---------------------------------------------------------------
function asCapsuleJSON(text, { mask } = {}) {
  // capsule JSON passthrough, else build from conversation text
  try {
    const obj = JSON.parse(text);
    if (obj && obj.schema_version && obj.context) {
      const cap = s2s.fromJSON(text);
      if (mask) s2s.maskCapsule(cap);
      s2s.finalize(cap);
      return s2s.toJSON(cap);
    }
  } catch (e) {
    /* not capsule json */
  }
  const cap = s2s.detectAndLoad(text);
  s2s.compress(cap, { summarizer: s2s.heuristicSummary });
  if (mask) s2s.maskCapsule(cap);
  s2s.finalize(cap);
  return s2s.toJSON(cap);
}

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

// ---- tool dispatch ---------------------------------------------------------
function callTool(name, args = {}) {
  switch (name) {
    case 'transfer_session': {
      const cap = s2s.detectAndLoad(args.text, args.from);
      s2s.compress(cap, { summarizer: s2s.heuristicSummary });
      if (Array.isArray(args.attachments) && args.attachments.length) s2s.attachToCapsule(cap, args.attachments, {});
      if (args.mask !== false) s2s.maskCapsule(cap);
      s2s.finalize(cap);
      cap.include_full_transcript = !!args.full;
      const primer = s2s.buildPrimer(cap, args.to || 'claude', !!args.full);
      const c = cap.context;
      return textResult({
        primer,
        carried_over: { decisions: c.decisions.length, open_threads: c.open_threads.length, facts: c.key_facts.length, artifacts: cap.artifacts.length, attachments: cap.attachments.length },
      });
    }
    case 'seal_session': {
      const json = asCapsuleJSON(args.text, { mask: args.mask !== false });
      const res = args.passphrase ? s2s.seal(json, args.passphrase) : s2s.sealWithBootKey(json);
      return textResult({ token: res.token, mode: res.mode, boot_tag: res.bootTag, bytes: `${res.rawBytes}->${res.encodedBytes}`, ratio: res.ratio });
    }
    case 'unseal_session': {
      const info = s2s.tokenInfo(args.token);
      const json = info.mode === 'bootkey' ? s2s.unsealWithBootKey(args.token) : s2s.unseal(args.token, args.passphrase);
      if (args.to) {
        const cap = s2s.fromJSON(json);
        return textResult(s2s.buildPrimer(cap, args.to, false));
      }
      return textResult(json);
    }
    case 'encode_session':
      return textResult(s2s.encode(asCapsuleJSON(args.text, { mask: false })));
    case 'decode_session':
      return textResult(s2s.decode(args.token.trim()));
    case 'boot_key_status':
      return textResult(s2s.bootkey.status());
    case 'ingest_attachment':
      return textResult(s2s.ingestFile(args.path, { caption: args.caption, embed: !!args.embed }));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ---- JSON-RPC plumbing -----------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return; // no response to notifications
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      return reply(id, callTool(name, args || {}));
    } catch (e) {
      // tool errors surface as a successful result with isError, per MCP
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
}

function start() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch (e) {
      return; // ignore non-JSON lines
    }
    try {
      handle(msg);
    } catch (e) {
      if (msg && msg.id !== undefined) replyError(msg.id, -32603, e.message);
    }
  });
  process.stderr.write(`[s2s-mcp] ready (${SERVER_INFO.name} ${SERVER_INFO.version})\n`);
}

module.exports = { start, callTool, TOOLS };

if (require.main === module) start();

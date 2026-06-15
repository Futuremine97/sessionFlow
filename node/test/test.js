// Minimal dependency-free test runner for the Node core.
'use strict';

const assert = require('assert');
const http = require('http');
const s2s = require('../src/index');

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((e) => {
      failed++;
      console.error(`FAIL  ${name}\n      ${e.message}`);
    });
}

const PASTE = `You: I want to build a todo app in React. I prefer TypeScript.
ChatGPT said: Great, let's use Vite. We decided to use Zustand for state. Edit src/store.ts. Next step: still need to add auth.
You: TODO: add dark mode. 프로젝트 이름은 Nimbus야. 항상 한국어도 지원해줘.`;

const CHATGPT_EXPORT = JSON.stringify([
  {
    title: 'Billing', update_time: 2,
    mapping: {
      root: { id: 'root', parent: null, children: ['a'] },
      a: { id: 'a', parent: 'root', children: ['b'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['I prefer concise code. We decided to use Stripe. My email is bob@acme.com and key sk-ABCDEFGHIJKLMNOPQRSTUV.'] } } },
      b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Edit billing/service.py. Next step: add webhooks.'] }, metadata: { model_slug: 'gpt-4o' } } },
    },
  },
]);

async function run() {
  await test('paste: roles split + platform hint', () => {
    const cap = s2s.pasteLoad(PASTE);
    assert.deepStrictEqual(cap.transcript.map((t) => t.role), ['user', 'assistant', 'user']);
    assert.strictEqual(cap.source_platform, 'chatgpt');
  });

  await test('compress: structured extraction (en+ko)', () => {
    const cap = s2s.pasteLoad(PASTE);
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
    const opens = cap.context.open_threads.join(' ').toLowerCase();
    assert.ok(!opens.includes('build a todo app'), 'todo app false positive');
    assert.ok(cap.context.open_threads.some((o) => /dark mode/i.test(o)));
    assert.ok(cap.context.decisions.some((d) => /zustand/i.test(d.statement)));
    assert.ok(cap.context.key_facts.some((f) => /Nimbus/.test(f)));
    assert.ok(Object.values(cap.context.user_profile).some((p) => /한국어/.test(p)));
    assert.ok(cap.artifacts.some((a) => a.path === 'src/store.ts'));
  });

  await test('chatgpt adapter: mapping linearize + model', () => {
    const cap = s2s.detectAndLoad(CHATGPT_EXPORT);
    assert.strictEqual(cap.source_platform, 'chatgpt');
    assert.strictEqual(cap.source_model, 'gpt-4o');
    assert.strictEqual(cap.transcript.length, 2);
  });

  await test('mask: redacts email + api key reversibly', () => {
    const cap = s2s.detectAndLoad(CHATGPT_EXPORT);
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
    s2s.maskCapsule(cap);
    const blob = JSON.stringify(cap);
    assert.ok(!blob.includes('bob@acme.com'), 'email leaked');
    assert.ok(!blob.includes('sk-ABCDEFGHIJKLMNOPQRSTUV'), 'api key leaked');
    assert.ok(cap.extra.masked.count >= 2);
    assert.ok(!cap.extra.mask_map, 'must not store originals by default');
  });

  await test('rehydrate: target-specific framing', () => {
    const cap = s2s.pasteLoad(PASTE);
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
    assert.ok(s2s.buildPrimer(cap, 'claude').includes('<handoff>'));
    assert.ok(!s2s.buildPrimer(cap, 'chatgpt').includes('<handoff>'));
  });

  await test('merge: dedupes + concatenates', () => {
    const a = s2s.pasteLoad('You: use Postgres. TODO: add index.');
    const b = s2s.pasteLoad('You: use Postgres. TODO: add cache.');
    [a, b].forEach((c) => s2s.compress(c, { summarizer: s2s.heuristicSummary }));
    const m = s2s.mergeCapsules([a, b]);
    const opens = m.context.open_threads.join(' ');
    assert.ok(/index/.test(opens) && /cache/.test(opens));
    assert.strictEqual(m.transcript.length, a.transcript.length + b.transcript.length);
  });

  await test('diff: detects added/removed threads', () => {
    const a = s2s.pasteLoad('You: TODO: add auth.');
    const b = s2s.pasteLoad('You: TODO: add auth. TODO: add tests.');
    [a, b].forEach((c) => { s2s.compress(c, { summarizer: s2s.heuristicSummary }); s2s.finalize(c); });
    const d = s2s.diffCapsules(a, b);
    assert.ok(d.open_threads.added.some((x) => /tests/i.test(x)));
    assert.ok(!d.same);
  });

  await test('capsule: json roundtrip + hash + turn-count preserved', () => {
    const cap = s2s.pasteLoad(PASTE);
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
    s2s.finalize(cap);
    const restored = s2s.fromJSON(s2s.toJSON(cap));
    assert.strictEqual(restored.context.summary, cap.context.summary);
    assert.strictEqual(restored.extra.transcript_turn_count, cap.transcript.length);
  });

  await test('transfer(): one-shot text -> primer (offline)', async () => {
    const { primer, capsule } = await s2s.transfer(PASTE, { to: 'gemini', offline: true });
    assert.ok(primer.includes('Open threads'));
    assert.ok(capsule.content_hash);
  });

  await test('server: /transfer returns primer (masked)', async () => {
    const server = require('../src/server').createServer();
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const payload = JSON.stringify({ text: CHATGPT_EXPORT, to: 'claude' });
    const body = await new Promise((resolve, reject) => {
      const req = http.request({ port, method: 'POST', path: '/transfer', headers: { 'content-type': 'application/json' } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.end(payload);
    });
    server.close();
    const j = JSON.parse(body);
    assert.ok(j.primer && j.primer.includes('<handoff>'));
    assert.ok(!j.primer.includes('bob@acme.com'), 'server should mask by default');
  });

  await test('encode/decode: compact roundtrip + smaller', () => {
    const cap = s2s.detectAndLoad(CHATGPT_EXPORT);
    s2s.compress(cap, { summarizer: s2s.heuristicSummary });
    s2s.finalize(cap);
    const json = s2s.toJSON(cap);
    const { token, ratio } = s2s.encode(json);
    assert.ok(ratio < 1, 'should compress');
    assert.strictEqual(s2s.tokenType(token), 'compressed');
    assert.strictEqual(s2s.decode(token), json);
  });

  await test('decode: detects corruption (integrity)', () => {
    const { token } = s2s.encode(s2s.toJSON(s2s.pasteLoad('You: hi there friend')));
    // flip a character in the middle of the payload
    const bad = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
    assert.throws(() => s2s.decode(bad));
  });

  await test('seal/unseal: AES-256-GCM roundtrip with passphrase', () => {
    const json = s2s.toJSON(s2s.pasteLoad('You: secret plan. We decided to launch Friday.'));
    const { token } = s2s.seal(json, 'correct horse battery staple');
    assert.strictEqual(s2s.tokenType(token), 'encrypted');
    assert.strictEqual(s2s.unseal(token, 'correct horse battery staple'), json);
  });

  await test('unseal: wrong passphrase fails', () => {
    const { token } = s2s.seal(s2s.toJSON(s2s.pasteLoad('You: hello world here')), 'right-pass');
    assert.throws(() => s2s.unseal(token, 'wrong-pass'), /wrong passphrase|decryption failed/);
  });

  await test('unseal: tampered ciphertext fails (GCM auth)', () => {
    const { token } = s2s.seal(s2s.toJSON(s2s.pasteLoad('You: hello world here')), 'pw12345');
    const buf = Buffer.from(token, 'base64url');
    buf[buf.length - 1] ^= 0xff; // flip last ciphertext byte
    assert.throws(() => s2s.unseal(buf.toString('base64url'), 'pw12345'));
  });

  await test('seal output is not plaintext-readable', () => {
    const { token } = s2s.seal(s2s.toJSON(s2s.pasteLoad('You: launch Friday secret')), 'pw');
    assert.ok(!token.includes('Friday'));
    assert.ok(!Buffer.from(token, 'base64url').toString('latin1').includes('Friday'));
  });

  await test('seal: raw boot key roundtrip + boot tag embedded', () => {
    const key = require('crypto').randomBytes(32);
    const json = s2s.toJSON(s2s.pasteLoad('You: boot keyed secret here'));
    const { token } = s2s.seal(json, key, { bootTag: 'deadbeefcafebabe' });
    const info = s2s.tokenInfo(token);
    assert.strictEqual(info.mode, 'bootkey');
    assert.strictEqual(info.boot_tag, 'deadbeefcafebabe');
    assert.strictEqual(s2s.unseal(token, key), json);
  });

  await test('boot token from another session is rejected', () => {
    const key = Buffer.alloc(32, 7);
    const { token } = s2s.seal(s2s.toJSON(s2s.pasteLoad('You: hi there')), key, { bootTag: 'aaaaaaaaaaaaaaaa' });
    // current boot tag won't be aaaa..., so unsealWithBootKey should refuse
    assert.throws(() => s2s.unsealWithBootKey(token), /previous boot session/);
  });

  await test('bootkey.currentKey: stable within boot, 32 bytes', () => {
    const a = s2s.bootkey.currentKey();
    const b = s2s.bootkey.currentKey();
    assert.strictEqual(a.key.length, 32);
    assert.ok(a.key.equals(b.key), 'same key within a boot session');
    assert.strictEqual(a.bootTag, b.bootTag);
  });

  await test('passphrase token requires passphrase, not boot key', () => {
    const { token } = s2s.seal(s2s.toJSON(s2s.pasteLoad('You: passphrase mode test')), 'pw');
    assert.strictEqual(s2s.tokenInfo(token).mode, 'passphrase');
  });

  await test('MCP: tools/list + seal_session/unseal_session roundtrip', () => {
    const mcp = require('../src/mcp');
    assert.ok(mcp.TOOLS.find((t) => t.name === 'seal_session'));
    const sealed = mcp.callTool('seal_session', { text: 'You: mcp secret launch Friday' });
    const out = JSON.parse(sealed.content[0].text);
    assert.strictEqual(out.mode, 'bootkey');
    const unsealed = mcp.callTool('unseal_session', { token: out.token, to: 'claude' });
    assert.ok(unsealed.content[0].text.includes('<handoff>'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run();

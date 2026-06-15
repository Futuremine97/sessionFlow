// server.js — minimal HTTP API exposing the pipeline, used as the backend
// for the ChatGPT Custom GPT Action. No external dependencies (Node http).
//
// Endpoints:
//   GET  /health                 -> {ok:true}
//   POST /transfer               -> {primer, capsule}
//        body: {text, from?, to?, full?, mask?, offline?}
//   POST /capsule                -> {capsule}
//        body: {text, from?, mask?}
//
// Optional bearer auth: set S2S_API_KEY and the server requires
//   Authorization: Bearer <key>   (matches the OpenAPI securityScheme).

'use strict';

const http = require('http');
const s2s = require('./index');

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function authorized(req) {
  const key = process.env.S2S_API_KEY;
  if (!key) return true; // auth disabled
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${key}`;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 's2s', version: require('../package.json').version });
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'POST' && (req.url === '/transfer' || req.url === '/capsule')) {
        const raw = await readBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (e) {
          return send(res, 400, { error: 'invalid JSON body' });
        }
        if (!body.text || typeof body.text !== 'string') return send(res, 400, { error: 'field "text" (string) is required' });

        if (req.url === '/transfer') {
          const { capsule, primer } = await s2s.transfer(body.text, {
            from: body.from,
            to: body.to || 'generic',
            full: !!body.full,
            offline: !!body.offline,
            mask: body.mask !== false, // mask by default on the server (privacy)
          });
          return send(res, 200, { primer, capsule: JSON.parse(s2s.toJSON(capsule)) });
        } else {
          const cap = s2s.detectAndLoad(body.text, body.from);
          s2s.compress(cap, { summarizer: s2s.heuristicSummary });
          if (body.mask !== false) s2s.maskCapsule(cap);
          s2s.finalize(cap);
          return send(res, 200, { capsule: JSON.parse(s2s.toJSON(cap)) });
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });
}

function start(port = process.env.PORT || 8787) {
  const server = createServer();
  server.listen(port, () => console.log(`[s2s] server listening on :${port} (auth ${process.env.S2S_API_KEY ? 'on' : 'off'})`));
  return server;
}

module.exports = { createServer, start };

if (require.main === module) start();

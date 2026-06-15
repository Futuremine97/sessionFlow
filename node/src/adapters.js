// adapters.js — vendor export / pasted text  ->  Capsule (Node port).

'use strict';

const { newCapsule } = require('./capsule');

function normRole(role) {
  const r = (role || '').toLowerCase();
  if (['user', 'human'].includes(r)) return 'user';
  if (['assistant', 'model', 'ai', 'bot'].includes(r)) return 'assistant';
  if (['system', 'developer'].includes(r)) return 'system';
  if (['tool', 'function'].includes(r)) return 'tool';
  return r || 'user';
}

function coalesce(parts) {
  if (parts == null) return '';
  if (typeof parts === 'string') return parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p) => (typeof p === 'string' ? p : p && (p.text || p.content) || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof parts === 'object') return parts.text || parts.content || '';
  return String(parts);
}

// ---- ChatGPT ----
function chatgptSniff(raw) {
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
    if ('mapping' in raw[0]) return 0.95;
    if ('role' in raw[0] && 'content' in raw[0]) return 0.4;
  }
  if (raw && typeof raw === 'object' && 'mapping' in raw) return 0.9;
  return 0;
}
function chatgptLoad(raw) {
  let convs = null;
  if (raw && raw.mapping) convs = [raw];
  else if (Array.isArray(raw) && raw[0] && raw[0].mapping) convs = raw;
  if (!convs) {
    // messages array
    const turns = (Array.isArray(raw) ? raw : []).map((m) => ({
      role: normRole(m.role),
      content: coalesce(m.content),
    }));
    return newCapsule({ source_platform: 'chatgpt', title: 'ChatGPT session', transcript: turns.filter((t) => t.content) });
  }
  const conv = convs.reduce((a, b) => ((b.update_time || 0) > (a.update_time || 0) ? b : a));
  const nodes = conv.mapping || {};
  // linearize
  const roots = Object.values(nodes).filter((n) => !n.parent);
  const ordered = [];
  if (roots.length) {
    const stack = [roots[0]];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      ordered.push(node);
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        if (nodes[children[i]]) stack.push(nodes[children[i]]);
      }
    }
  }
  let model = null;
  const turns = [];
  for (const node of ordered) {
    const msg = node.message;
    if (!msg) continue;
    const role = (msg.author && msg.author.role) || 'user';
    if (msg.metadata && msg.metadata.model_slug) model = model || msg.metadata.model_slug;
    const body = coalesce(msg.content && msg.content.parts).trim();
    if (body) turns.push({ role: normRole(role), content: body });
  }
  return newCapsule({ source_platform: 'chatgpt', source_model: model, title: conv.title || 'ChatGPT session', transcript: turns });
}

// ---- Claude ----
function claudeSniff(raw) {
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
    const keys = Object.keys(raw[0]);
    if (keys.includes('chat_messages')) return 0.95;
    if (keys.includes('sender')) return 0.8;
    if (['user', 'assistant'].includes(raw[0].type) && 'message' in raw[0]) return 0.85;
  }
  if (raw && raw.chat_messages) return 0.9;
  return 0;
}
function claudeLoad(raw) {
  const recToTurns = (records) =>
    records
      .map((m) => {
        let body = m.text;
        if (!body && Array.isArray(m.content)) {
          body = m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
        }
        return { role: normRole(m.sender || m.role), content: (body || '').trim(), timestamp: m.created_at };
      })
      .filter((t) => t.content);

  if (raw && raw.chat_messages) {
    return newCapsule({ source_platform: 'claude', source_model: raw.model, title: raw.name || 'Claude session', transcript: recToTurns(raw.chat_messages) });
  }
  if (Array.isArray(raw) && raw[0]) {
    if (raw[0].chat_messages) {
      const conv = raw.reduce((a, b) => ((b.updated_at || '') > (a.updated_at || '') ? b : a));
      return newCapsule({ source_platform: 'claude', source_model: conv.model, title: conv.name || 'Claude session', transcript: recToTurns(conv.chat_messages) });
    }
    if ('sender' in raw[0]) {
      return newCapsule({ source_platform: 'claude', title: 'Claude session', transcript: recToTurns(raw) });
    }
    if (['user', 'assistant'].includes(raw[0].type) && 'message' in raw[0]) {
      const turns = raw
        .map((line) => {
          const msg = line.message || {};
          let body = Array.isArray(msg.content)
            ? msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
            : msg.content || '';
          return { role: normRole(line.type || msg.role), content: (body || '').trim(), timestamp: line.timestamp };
        })
        .filter((t) => t.content);
      return newCapsule({ source_platform: 'claude', source_model: 'claude-code', title: 'Claude Code session', transcript: turns });
    }
  }
  return newCapsule({ source_platform: 'claude', transcript: [] });
}

// ---- Gemini ----
function geminiContents(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return raw.contents || raw.messages || [];
  return [];
}
function geminiSniff(raw) {
  const c = geminiContents(raw);
  if (c[0] && typeof c[0] === 'object') {
    if ('parts' in c[0] && 'role' in c[0]) return 0.9;
    if ('parts' in c[0]) return 0.7;
  }
  return 0;
}
function geminiLoad(raw) {
  const model = raw && (raw.model || raw.modelVersion);
  const turns = geminiContents(raw)
    .map((c) => ({ role: normRole(c.role), content: coalesce(c.parts).trim() }))
    .filter((t) => t.content);
  return newCapsule({ source_platform: 'gemini', source_model: model || null, title: (raw && raw.title) || 'Gemini session', transcript: turns });
}

// ---- Paste (plain text) ----
const USER_WORDS = ['you', 'user', 'me', 'human', 'prompt', 'q', '사용자', '나', '질문', '유저'];
const ASST_WORDS = ['chatgpt', 'claude', 'gemini', 'assistant', 'ai', 'bot', 'gpt', 'model', '답변', '어시스턴트'];
const MARKER = /^\s*(?:#{1,6}\s*)?([A-Za-z가-힣][\w가-힣 ]{0,24}?)(?:\s+said)?\s*[:：]\s*(.*)$/i;
function classify(who) {
  const w = who.trim().toLowerCase();
  if (USER_WORDS.some((x) => w === x || w.startsWith(x + ' ') || w === x + ' said')) return 'user';
  if (ASST_WORDS.some((x) => w === x || w.startsWith(x))) return 'assistant';
  return null;
}
function pasteLoad(text) {
  const blob = String(text);
  let platform = 'paste';
  if (/chatgpt|openai|gpt-?\d/i.test(blob)) platform = 'chatgpt';
  else if (/\bclaude\b|anthropic/i.test(blob)) platform = 'claude';
  else if (/\bgemini\b|bard/i.test(blob)) platform = 'gemini';

  const turns = [];
  let curRole = null;
  let buf = [];
  const flush = () => {
    if (curRole && buf.length) {
      const body = buf.join('\n').trim();
      if (body) turns.push({ role: curRole, content: body });
    }
  };
  for (const line of blob.split('\n')) {
    const m = MARKER.exec(line);
    const role = m ? classify(m[1]) : null;
    if (role) {
      flush();
      curRole = role;
      buf = m[2].trim() ? [m[2]] : [];
    } else {
      if (curRole === null) curRole = 'user';
      buf.push(line);
    }
  }
  flush();
  let out = turns.filter((t) => t.content.trim());
  if (!out.length && blob.trim()) out = [{ role: 'user', content: blob.trim() }];
  return newCapsule({ source_platform: platform, title: 'Pasted session', transcript: out, extra: { ingest: 'paste' } });
}

const ADAPTERS = {
  claude: { sniff: claudeSniff, load: claudeLoad },
  chatgpt: { sniff: chatgptSniff, load: chatgptLoad },
  gemini: { sniff: geminiSniff, load: geminiLoad },
};

function parseRaw(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // JSONL?
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length >= 2) {
      try {
        return lines.map((l) => JSON.parse(l));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function detectAndLoad(text, hint) {
  if (hint === 'paste') return pasteLoad(text);
  const raw = parseRaw(text);
  if (raw === null) return pasteLoad(text); // not JSON/JSONL -> treat as pasted
  if (hint && ADAPTERS[hint]) return ADAPTERS[hint].load(raw);
  const scored = Object.entries(ADAPTERS)
    .map(([name, a]) => ({ name, score: a.sniff(raw), a }))
    .sort((x, y) => y.score - x.score);
  if (scored[0].score <= 0) {
    // last resort: paste
    return pasteLoad(text);
  }
  const cap = scored[0].a.load(raw);
  cap.extra.detection = {
    chosen: scored[0].name,
    confidence: Math.round(scored[0].score * 100) / 100,
    scores: Object.fromEntries(scored.map((s) => [s.name, Math.round(s.score * 100) / 100])),
  };
  return cap;
}

module.exports = { detectAndLoad, pasteLoad, ADAPTERS, normRole };

// mask.js — privacy masking. Redacts secrets/PII from a capsule before it
// leaves the machine, replacing each hit with a stable placeholder and
// recording a reversible mapping under extra.mask_map (so a trusted target
// could rehydrate if needed).

'use strict';

const PATTERNS = [
  // provider API keys (order matters: specific before generic)
  ['OPENAI_KEY', /\bsk-[A-Za-z0-9]{20,}\b/g],
  ['ANTHROPIC_KEY', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['GOOGLE_KEY', /\bAIza[0-9A-Za-z_\-]{30,}\b/g],
  ['AWS_KEY', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['BEARER', /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g],
  ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['CREDIT_CARD', /\b(?:\d[ -]*?){13,16}\b/g],
  ['EMAIL', /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g],
  ['IP', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
];

// crude credit-card guard (Luhn) to avoid masking ordinary long numbers
function looksLikeCard(s) {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function maskText(text, map, counters) {
  let out = text;
  for (const [label, re] of PATTERNS) {
    out = out.replace(re, (hit) => {
      if (label === 'CREDIT_CARD' && !looksLikeCard(hit)) return hit;
      // reuse placeholder for identical secret
      let placeholder = [...map.entries()].find(([, v]) => v === hit)?.[0];
      if (!placeholder) {
        counters[label] = (counters[label] || 0) + 1;
        placeholder = `«${label}_${counters[label]}»`;
        map.set(placeholder, hit);
      }
      return placeholder;
    });
  }
  return out;
}

// reversible defaults to false: storing the original secrets alongside the
// redacted capsule would defeat the purpose. Pass {reversible:true} only when
// the map will be stored separately from the shared capsule.
function maskCapsule(cap, { reversible = false } = {}) {
  const map = new Map();
  const counters = {};
  const apply = (s) => (typeof s === 'string' ? maskText(s, map, counters) : s);

  cap.transcript = cap.transcript.map((t) => ({ ...t, content: apply(t.content) }));
  const c = cap.context;
  if (c) {
    c.summary = apply(c.summary);
    c.key_facts = (c.key_facts || []).map(apply);
    c.open_threads = (c.open_threads || []).map(apply);
    c.decisions = (c.decisions || []).map((d) => ({ ...d, statement: apply(d.statement) }));
    c.user_profile = Object.fromEntries(Object.entries(c.user_profile || {}).map(([k, v]) => [k, apply(v)]));
  }
  cap.artifacts = (cap.artifacts || []).map((a) => ({ ...a, summary: a.summary ? apply(a.summary) : a.summary }));

  cap.extra.masked = { count: map.size, labels: counters };
  if (reversible && map.size) cap.extra.mask_map = Object.fromEntries(map);
  return cap;
}

module.exports = { maskCapsule, maskText, PATTERNS };

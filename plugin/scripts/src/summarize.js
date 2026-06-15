// summarize.js — LLM summary with automatic heuristic fallback (Node).
// Uses Node 18+ global fetch (no dependencies). If a provider key is present
// in the environment it summarizes with that provider; otherwise (or on any
// error) it falls back to the heuristic summary. Never throws.

'use strict';

const { heuristicSummary } = require('./compress');

const INSTRUCTION =
  'You are preparing a handoff so a DIFFERENT AI assistant can continue this ' +
  'session seamlessly. Write a concise but complete briefing covering: (1) the ' +
  "user's goal, (2) decisions already made, (3) current state of the work, and " +
  '(4) what to do next. Plain prose, no preamble. Answer in the language the ' +
  'conversation is mostly written in.';

function transcriptText(cap, limit = 24000) {
  return cap.transcript.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n').slice(0, limit);
}

function activeProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY';
  if (process.env.OPENAI_API_KEY) return 'OPENAI_API_KEY';
  if (process.env.GEMINI_API_KEY) return 'GEMINI_API_KEY';
  return null;
}

async function callAnthropic(convo, key) {
  const model = process.env.S2S_MODEL || 'claude-3-5-haiku-latest';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1024, system: INSTRUCTION, messages: [{ role: 'user', content: convo }] }),
  });
  const j = await r.json();
  return (j.content || []).map((b) => b.text || '').join('').trim();
}

async function callOpenAI(convo, key) {
  const model = process.env.S2S_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: INSTRUCTION }, { role: 'user', content: convo }] }),
  });
  const j = await r.json();
  return j.choices[0].message.content.trim();
}

async function callGemini(convo, key) {
  const model = process.env.S2S_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: convo }] }] }),
  });
  const j = await r.json();
  return (j.candidates[0].content.parts || []).map((p) => p.text || '').join('').trim();
}

const PROVIDERS = [
  ['ANTHROPIC_API_KEY', callAnthropic],
  ['OPENAI_API_KEY', callOpenAI],
  ['GEMINI_API_KEY', callGemini],
];

// Returns an async summarizer compatible with compress({summarizer}).
// Note: compress() calls summarizer synchronously, so for the LLM path we
// expose summarizeCapsule() which the CLI awaits BEFORE compress, setting the
// summary directly. compress() then keeps it if already present.
async function smartSummary(cap, { verbose = false } = {}) {
  const convo = transcriptText(cap);
  for (const [env, fn] of PROVIDERS) {
    const key = process.env[env];
    if (!key) continue;
    try {
      const text = await fn(convo, key);
      if (text) {
        cap.extra.summarizer = `llm:${env}`;
        return text;
      }
    } catch (e) {
      if (verbose) console.error(`[s2s] LLM summary via ${env} failed (${e.message}); falling back to heuristic.`);
      break;
    }
  }
  cap.extra.summarizer = 'heuristic';
  return heuristicSummary(cap);
}

module.exports = { smartSummary, activeProvider, transcriptText };

// compress.js — enhanced structured extraction (Node).
// Improvements over the v0.2 heuristic:
//   * confidence scoring + ranking so the strongest signals win the limited slots
//   * mutually-exclusive classification (pref > decision > open > fact)
//   * Korean + English patterns
//   * artifact detection from code fences and bare paths with status inference
//   * glossary from repeated capitalized / domain terms

'use strict';

const DECISION = /(let'?s (use|go with|do)|we(?:'ll| will| should| decided to)? (use|pick|choose|go with)|going with|decided to|plan is to|we are using|i(?:'ll| will) use)|(하기로|쓰기로|사용하기로|가기로)\s*(했|함|결정)|(로|으로)\s*(결정|정했|선택)/i;
const OPEN = /(^|\s)(todo|to-do|fixme)\s*[:：-]|\b(next step|still need|need to|haven'?t|not yet|unfinished|remaining|follow[- ]up|left to do|pending|open question|tbd|will (add|implement|fix|do))\b|(아직|남았|해야|다음 단계|할 일|미완|필요해|필요합니다|예정)/i;
const PREF = /\b(i prefer|i like|i want|i'?d like|please (always|never)|don'?t|do not|make sure|i'?m a|my (role|job|stack|preference)|always|never)\b|(선호|좋아|원해|원합니다|항상|절대|해주세요|해줘|하지 ?마|마세요)/i;
const FACT = /\b(is|are|uses|runs on|built (with|in|on)|written in|based on|the (goal|project|app|service|system) (is|will))\b|(이름은|프로젝트는|코드네임|코드명).{0,40}(이다|야|입니다|에요|예요|임)|.{0,30}(으로 만들|로 만들|로 작성|기반)/i;
const PATH = /((?:\.{0,2}\/)?[\w\-./]+\.(?:py|js|ts|tsx|jsx|md|json|html|css|ya?ml|txt|sql|sh|go|rs|java|rb|php|c|cpp|h|docx|xlsx|pdf|csv))\b/g;
const FENCE = /```(\w+)?\n([\s\S]*?)```/g;
const TERM = /\b([A-Z][A-Za-z0-9]{2,})\b/g;
const STOP = new Set(['The', 'This', 'That', 'There', 'These', 'Those', 'Then', 'They', 'And', 'But', 'For', 'You', 'Your', 'Our', 'Was', 'Are', 'Not', 'With', 'From', 'What', 'When', 'Where', 'Which', 'Will', 'Would', 'Should', 'Could', 'Have', 'Here', 'Just', 'Like', 'Make', 'Need', 'Use', 'Using', 'OK', 'Okay', 'Yes', 'Now', 'How', 'Why', 'Can', 'TODO']);

const clip = (s, n) => {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
};
const sentences = (t) => t.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const estTokens = (t) => Math.max(1, Math.floor(t.length / 4));

function rankDedupe(items, limit) {
  // items: [{text, score}]. Dedupe by lowercased text, keep highest score, then sort.
  const best = new Map();
  for (const it of items) {
    const k = it.text.toLowerCase().trim();
    if (!k) continue;
    if (!best.has(k) || best.get(k).score < it.score) best.set(k, it);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.text);
}

function scoreSentence(sent, role, kind) {
  // crude salience: later emphasis, presence of nouns/numbers, length sweet spot
  let s = 1;
  if (/\d/.test(sent)) s += 0.5;
  if (sent.length > 30 && sent.length < 160) s += 0.5;
  if (kind === 'decision' && /\b(use|go with|decided)\b|결정|선택/i.test(sent)) s += 0.5;
  if (kind === 'open' && /\b(todo|next step|need)\b|할 일|해야/i.test(sent)) s += 0.5;
  return s;
}

function heuristicSummary(cap) {
  cap.extra.summarizer = cap.extra.summarizer || 'heuristic';
  const users = cap.transcript.filter((t) => t.role === 'user').map((t) => t.content);
  const assts = cap.transcript.filter((t) => t.role === 'assistant').map((t) => t.content);
  const bits = [];
  if (users[0]) bits.push(`The session opened with the user asking: "${clip(users[0], 240)}"`);
  if (users.length > 1) bits.push(`Across ${users.length} user turns, the latest request was: "${clip(users[users.length - 1], 200)}"`);
  if (assts.length) bits.push(`The assistant's most recent state: "${clip(assts[assts.length - 1], 240)}"`);
  return bits.join(' ');
}

function compress(cap, opts = {}) {
  const summarizer = opts.summarizer || heuristicSummary;
  const facts = [];
  const decisions = [];
  const opens = [];
  const prefs = [];
  const termCounts = new Map();
  const artifacts = {};

  for (const turn of cap.transcript) {
    const text = turn.content;

    let m;
    FENCE.lastIndex = 0;
    while ((m = FENCE.exec(text))) {
      const lang = m[1] || null;
      const head = (m[2].trim().split('\n')[0] || '').trim();
      const fn = head.match(/((?:\.{0,2}\/)?[\w\-./]+\.[A-Za-z0-9]{1,6})/);
      const path = fn ? fn[1] : `snippet.${lang || 'txt'}`;
      if (!artifacts[path]) artifacts[path] = { path, kind: 'code', language: lang, status: turn.role === 'assistant' ? 'created' : 'referenced', summary: clip(head, 80) || undefined };
    }
    PATH.lastIndex = 0;
    while ((m = PATH.exec(text))) {
      if (!artifacts[m[1]]) artifacts[m[1]] = { path: m[1], kind: 'file', status: 'referenced' };
    }

    for (const sent of sentences(text)) {
      if (sent.length < 8) continue;
      if (turn.role === 'user' && PREF.test(sent)) prefs.push({ text: sent, score: scoreSentence(sent, turn.role, 'pref') });
      else if (DECISION.test(sent)) decisions.push({ text: clip(sent, 220), score: scoreSentence(sent, turn.role, 'decision') });
      else if (OPEN.test(sent)) opens.push({ text: sent, score: scoreSentence(sent, turn.role, 'open') });
      else if (turn.role === 'user' && FACT.test(sent) && sent.length < 200) facts.push({ text: sent, score: scoreSentence(sent, turn.role, 'fact') });
    }

    TERM.lastIndex = 0;
    while ((m = TERM.exec(text))) {
      const w = m[1];
      if (!STOP.has(w)) termCounts.set(w, (termCounts.get(w) || 0) + 1);
    }
  }

  const glossary = {};
  [...termCounts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([w, c]) => {
    glossary[w] = `project term (mentioned ${c}x)`;
  });

  const userProfile = {};
  rankDedupe(prefs, 8).forEach((p, i) => {
    userProfile[`pref_${i + 1}`] = clip(p, 160);
  });

  const decisionTexts = rankDedupe(decisions, 10);
  cap.context = {
    summary: summarizer(cap),
    key_facts: rankDedupe(facts, 12),
    decisions: decisionTexts.map((d) => ({ statement: d })),
    open_threads: rankDedupe(opens, 10),
    glossary,
    user_profile: userProfile,
    token_estimate: 0,
  };
  cap.context.token_estimate = estTokens(cap.context.summary + cap.context.key_facts.join(' ') + decisionTexts.join(' ') + cap.context.open_threads.join(' '));

  const existing = new Set(cap.artifacts.map((a) => a.path));
  for (const a of Object.values(artifacts)) if (!existing.has(a.path)) cap.artifacts.push(a);
  return cap;
}

module.exports = { compress, heuristicSummary };

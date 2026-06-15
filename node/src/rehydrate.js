// rehydrate.js — Capsule -> target-tuned handoff primer (Node).

'use strict';

const STYLE = {
  claude: {
    opener: 'You are picking up an in-progress working session that was previously handled by another AI assistant. Continue it seamlessly. Here is the handoff context:',
    closer: 'Acknowledge briefly that you have the context, then continue from the open threads.',
    xml: true,
  },
  chatgpt: {
    opener: 'Context handoff from a previous AI session. Read it, then continue the work as if you had been here the whole time.',
    closer: "Confirm you're up to speed in one line, then proceed.",
    xml: false,
  },
  gemini: {
    opener: 'You are continuing a session started with another AI assistant. Use the following transferred context to keep going without losing state.',
    closer: 'Give a one-line confirmation, then take the next step.',
    xml: false,
  },
  generic: {
    opener: 'Handoff context transferred from a previous AI session. Continue the work seamlessly.',
    closer: 'Confirm understanding briefly, then continue.',
    xml: false,
  },
};

function buildPrimer(cap, target = 'generic', includeFull = false) {
  const st = STYLE[target] || STYLE.generic;
  const c = cap.context;
  const L = [st.opener, ''];
  if (st.xml) L.push('<handoff>');

  const src = cap.source_model ? `${cap.source_platform} / ${cap.source_model}` : cap.source_platform;
  L.push('## Origin', `- Transferred from: ${src}`, `- Session title: ${cap.title}`, `- Captured: ${cap.captured_at}`, '');

  if (c.summary) L.push('## Summary', c.summary, '');
  if (Object.keys(c.user_profile || {}).length) {
    L.push('## User profile & preferences');
    Object.values(c.user_profile).forEach((v) => L.push(`- ${v}`));
    L.push('');
  }
  if ((c.key_facts || []).length) {
    L.push('## Key facts');
    c.key_facts.forEach((f) => L.push(`- ${f}`));
    L.push('');
  }
  if ((c.decisions || []).length) {
    L.push('## Decisions made');
    c.decisions.forEach((d) => L.push(`- ${d.statement}${d.rationale ? ` (why: ${d.rationale})` : ''}`));
    L.push('');
  }
  if ((cap.artifacts || []).length) {
    L.push('## Artifacts / files in play');
    cap.artifacts.forEach((a) => L.push(`- [${a.status}] ${a.path} (${a.kind})${a.summary ? ` — ${a.summary}` : ''}`));
    L.push('');
  }
  if ((c.open_threads || []).length) {
    L.push('## Open threads — pick up here');
    c.open_threads.forEach((o) => L.push(`- ${o}`));
    L.push('');
  }
  if (Object.keys(c.glossary || {}).length) {
    L.push('## Glossary');
    Object.entries(c.glossary).forEach(([t, m]) => L.push(`- ${t}: ${m}`));
    L.push('');
  }
  if (st.xml) L.push('</handoff>', '');
  L.push(st.closer);

  if (includeFull && cap.transcript.length) {
    L.push('', '## Full transcript (verbatim)', '');
    cap.transcript.forEach((t) => L.push(`### ${t.role.toUpperCase()}`, t.content, ''));
  }
  return L.join('\n').replace(/\s+$/, '') + '\n';
}

module.exports = { buildPrimer, STYLE };

// merge.js — combine multiple capsules into one (project-level memory).
// Dedupes decisions/facts/threads, unions glossary & profile, concatenates
// transcripts in chronological order, and tracks provenance of each source.

'use strict';

const { newCapsule, emptyContext } = require('./capsule');

function uniqStrings(arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    for (const x of arr || []) {
      const k = x.toLowerCase().trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
  }
  return out;
}

function mergeCapsules(capsules, { title } = {}) {
  if (!capsules.length) return newCapsule();
  const sorted = [...capsules].sort((a, b) => (a.captured_at || '').localeCompare(b.captured_at || ''));

  const ctx = emptyContext();
  ctx.key_facts = uniqStrings(sorted.map((c) => c.context.key_facts));
  ctx.open_threads = uniqStrings(sorted.map((c) => c.context.open_threads));

  // decisions: dedupe by statement text
  const seenDec = new Set();
  for (const c of sorted) {
    for (const d of c.context.decisions || []) {
      const k = (d.statement || '').toLowerCase().trim();
      if (k && !seenDec.has(k)) {
        seenDec.add(k);
        ctx.decisions.push(d);
      }
    }
  }
  // glossary + profile: later sources win on conflict
  for (const c of sorted) {
    Object.assign(ctx.glossary, c.context.glossary || {});
  }
  let pi = 1;
  const seenPref = new Set();
  for (const c of sorted) {
    for (const v of Object.values(c.context.user_profile || {})) {
      const k = v.toLowerCase().trim();
      if (k && !seenPref.has(k)) {
        seenPref.add(k);
        ctx.user_profile[`pref_${pi++}`] = v;
      }
    }
  }

  // narrative summary = chained source summaries
  ctx.summary = sorted
    .map((c, i) => `(${i + 1}/${sorted.length} · ${c.source_platform}) ${c.context.summary}`)
    .join('\n');

  const transcript = [];
  for (const c of sorted) transcript.push(...c.transcript);

  const artifacts = [];
  const seenArt = new Set();
  for (const c of sorted) {
    for (const a of c.artifacts || []) {
      if (!seenArt.has(a.path)) {
        seenArt.add(a.path);
        artifacts.push(a);
      }
    }
  }

  const merged = newCapsule({
    source_platform: 'merged',
    title: title || `Merged: ${sorted.map((c) => c.title).join(' + ')}`.slice(0, 120),
    transcript,
    context: ctx,
    artifacts,
    extra: {
      merged_from: sorted.map((c) => ({ platform: c.source_platform, title: c.title, captured_at: c.captured_at, hash: c.content_hash })),
    },
  });
  return merged;
}

module.exports = { mergeCapsules };

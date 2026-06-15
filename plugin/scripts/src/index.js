// index.js — public API surface for the s2s Node core.
'use strict';

const capsule = require('./capsule');
const { detectAndLoad, pasteLoad } = require('./adapters');
const { compress, heuristicSummary } = require('./compress');
const { buildPrimer } = require('./rehydrate');
const { smartSummary, activeProvider } = require('./summarize');
const { maskCapsule } = require('./mask');
const { mergeCapsules } = require('./merge');
const { diffCapsules, formatDiff } = require('./diff');
const { encode, decode, seal, unseal, tokenType } = require('./seal');

// High-level one-shot: text -> primer (async so it can use LLM summary).
async function transfer(text, { from, to = 'generic', full = false, offline = false, mask = false } = {}) {
  const cap = detectAndLoad(text, from);
  if (!offline && activeProvider()) {
    cap.context.summary = await smartSummary(cap, { verbose: true });
    compress(cap, { summarizer: () => cap.context.summary });
  } else {
    compress(cap, { summarizer: heuristicSummary });
  }
  if (mask) maskCapsule(cap);
  capsule.finalize(cap);
  cap.include_full_transcript = full;
  return { capsule: cap, primer: buildPrimer(cap, to, full) };
}

module.exports = {
  ...capsule,
  detectAndLoad,
  pasteLoad,
  compress,
  heuristicSummary,
  buildPrimer,
  smartSummary,
  activeProvider,
  maskCapsule,
  mergeCapsules,
  diffCapsules,
  formatDiff,
  encode,
  decode,
  seal,
  unseal,
  tokenType,
  transfer,
};

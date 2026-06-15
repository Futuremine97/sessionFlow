// capsule.js — the platform-neutral Session Capsule (Node port).
// Mirrors the Python s2s.capsule schema so capsules are interchangeable
// between the Python CLI, this Node CLI, and the browser extension.

'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = '1.1'; // 1.1 adds: content_hash, revision, masking meta

function nowISO() {
  return new Date().toISOString();
}

function emptyContext() {
  return {
    summary: '',
    key_facts: [],
    decisions: [], // [{statement, rationale?}]
    open_threads: [],
    glossary: {},
    user_profile: {},
    token_estimate: 0,
  };
}

function newCapsule(fields = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    source_platform: fields.source_platform || 'unknown',
    source_model: fields.source_model || null,
    title: fields.title || 'Untitled session',
    created_at: fields.created_at || nowISO(),
    captured_at: fields.captured_at || nowISO(),
    transcript: fields.transcript || [], // [{role, content, timestamp?, name?}]
    context: fields.context || emptyContext(),
    artifacts: fields.artifacts || [], // [{path, kind, status, summary?, language?}]
    include_full_transcript: fields.include_full_transcript || false,
    revision: fields.revision || 1,
    content_hash: fields.content_hash || null,
    extra: fields.extra || {},
  };
}

// Stable hash of the meaningful payload (context + transcript), so two
// capsules can be compared / deduped and revisions detected.
function hashCapsule(cap) {
  const basis = JSON.stringify({
    transcript: cap.transcript,
    context: cap.context,
    artifacts: cap.artifacts,
  });
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

function finalize(cap) {
  cap.content_hash = hashCapsule(cap);
  return cap;
}

// Serialize, honoring the include_full_transcript opt-in toggle.
function toJSON(cap, indent = 2) {
  const out = {
    schema_version: cap.schema_version,
    source_platform: cap.source_platform,
    source_model: cap.source_model,
    title: cap.title,
    created_at: cap.created_at,
    captured_at: cap.captured_at,
    revision: cap.revision,
    content_hash: cap.content_hash || hashCapsule(cap),
    context: cap.context,
    artifacts: cap.artifacts,
    include_full_transcript: cap.include_full_transcript,
    transcript: cap.include_full_transcript ? cap.transcript : [],
    transcript_turn_count: cap.transcript.length,
    extra: cap.extra,
  };
  return JSON.stringify(out, null, indent);
}

function fromJSON(text) {
  const d = JSON.parse(text);
  const cap = newCapsule({
    source_platform: d.source_platform,
    source_model: d.source_model,
    title: d.title,
    created_at: d.created_at,
    captured_at: d.captured_at,
    transcript: d.transcript || [],
    context: Object.assign(emptyContext(), d.context || {}),
    artifacts: d.artifacts || [],
    include_full_transcript: d.include_full_transcript || false,
    revision: d.revision || 1,
    content_hash: d.content_hash || null,
    extra: d.extra || {},
  });
  if (!cap.transcript.length && d.transcript_turn_count) {
    cap.extra.transcript_turn_count = d.transcript_turn_count;
  }
  return cap;
}

module.exports = {
  SCHEMA_VERSION,
  nowISO,
  emptyContext,
  newCapsule,
  hashCapsule,
  finalize,
  toJSON,
  fromJSON,
};

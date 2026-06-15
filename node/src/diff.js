// diff.js — capsule versioning / diff. Compares two capsules' compressed
// context and reports what was added / removed between revisions, so a user
// can see how project state evolved across sessions.

'use strict';

function setDiff(aArr, bArr, key = (x) => x) {
  const a = new Map((aArr || []).map((x) => [key(x).toLowerCase().trim(), x]));
  const b = new Map((bArr || []).map((x) => [key(x).toLowerCase().trim(), x]));
  const added = [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v);
  const removed = [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v);
  return { added, removed };
}

function diffCapsules(prev, next) {
  const pc = prev.context;
  const nc = next.context;
  const decKey = (d) => (typeof d === 'string' ? d : d.statement || '');
  return {
    same: prev.content_hash && prev.content_hash === next.content_hash,
    revision: { from: prev.revision, to: next.revision },
    facts: setDiff(pc.key_facts, nc.key_facts),
    decisions: setDiff(pc.decisions, nc.decisions, decKey),
    open_threads: setDiff(pc.open_threads, nc.open_threads),
    artifacts: setDiff(prev.artifacts, next.artifacts, (a) => a.path),
    summary_changed: pc.summary !== nc.summary,
  };
}

function formatDiff(d) {
  const L = [];
  if (d.same) {
    L.push('No changes (identical content hash).');
    return L.join('\n');
  }
  L.push(`Revision ${d.revision.from} -> ${d.revision.to}`);
  const sec = (name, x, key = (v) => v) => {
    if (!x.added.length && !x.removed.length) return;
    L.push(`\n## ${name}`);
    x.added.forEach((v) => L.push(`  + ${typeof v === 'string' ? v : key(v)}`));
    x.removed.forEach((v) => L.push(`  - ${typeof v === 'string' ? v : key(v)}`));
  };
  sec('Decisions', d.decisions, (v) => v.statement);
  sec('Open threads', d.open_threads);
  sec('Key facts', d.facts);
  sec('Artifacts', d.artifacts, (v) => `[${v.status}] ${v.path}`);
  if (d.summary_changed) L.push('\n(summary updated)');
  return L.join('\n');
}

module.exports = { diffCapsules, formatDiff };

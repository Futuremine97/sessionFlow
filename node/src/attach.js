// attach.js — ingest attachments (photos + papers/PDFs) into a capsule.
//
// For a handoff to be useful, the next AI needs to know what files were in
// play and, for documents, what they say. This module:
//   * detects the file type by magic bytes
//   * computes a SHA-256 (dedupe / integrity)
//   * PDFs (papers): extracts title, page count, and a text excerpt
//       - uses `pdftotext` (poppler) when available for best quality,
//         else a dependency-free pure-JS extractor (zlib + text operators)
//   * images (PNG/JPEG/GIF/WebP): reads dimensions, records metadata,
//         keeps an optional caption (alt text)
//   * text/markdown: takes a text excerpt directly
//   * optionally base64-embeds the bytes so the file travels inside a sealed
//     token (off by default — referenced by hash + excerpt instead)
//
// Only Node stdlib (fs, crypto, zlib, child_process).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execSync } = require('child_process');

const EXCERPT_MAX = 1500;
const EMBED_WARN_BYTES = 256 * 1024;

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function detectMime(buf, name) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const ext = path.extname(name || '').toLowerCase();
  return (
    {
      '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain', '.md': 'text/markdown',
    }[ext] || 'application/octet-stream'
  );
}

// ---- image dimensions ------------------------------------------------------
function pngSize(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  let o = 2;
  while (o + 9 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const marker = buf[o + 1];
    const len = buf.readUInt16BE(o + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
    }
    o += 2 + len;
  }
  return null;
}
function gifSize(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

// ---- PDF text extraction ---------------------------------------------------
function pdfViaPoppler(file) {
  try {
    execSync('command -v pdftotext', { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) {
    return null;
  }
  try {
    return execSync('pdftotext -q -l 5 ' + JSON.stringify(file) + ' -', { maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
  } catch (e) {
    return null;
  }
}

function pdfPureJs(buf) {
  const lat = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(lat))) {
    const start = m.index + m[0].length;
    const end = lat.indexOf('endstream', start);
    if (end < 0) continue;
    const data = buf.subarray(start, end);
    let decoded;
    try {
      decoded = zlib.inflateSync(data).toString('latin1');
    } catch (e) {
      try {
        decoded = zlib.inflateRawSync(data).toString('latin1');
      } catch (e2) {
        decoded = data.toString('latin1');
      }
    }
    if (!/BT|Tj|TJ/.test(decoded)) continue;
    extractTextOperators(decoded, out);
    if (out.join(' ').length > EXCERPT_MAX * 3) break;
  }
  return out.join(' ');
}

function extractTextOperators(content, out) {
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
  let m;
  while ((m = re.exec(content))) {
    let s = m[0];
    if (s[0] === '(') {
      s = s.slice(1, -1).replace(/\\([nrtbf()\\])/g, function (_, c) {
        return { n: '\n', r: '\r', t: '\t', b: '', f: '' }[c] || c;
      });
    } else {
      const hex = s.slice(1, -1).replace(/\s+/g, '');
      let str = '';
      for (let i = 0; i + 1 < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      s = str;
    }
    if (s.trim()) out.push(s);
  }
}

function cleanText(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pdfTitle(buf, text) {
  const lat = buf.toString('latin1');
  const m = lat.match(/\/Title\s*\(((?:\\.|[^\\()])*)\)/);
  if (m && m[1].trim()) return m[1].replace(/\\([()\\])/g, '$1').trim();
  const first = (text || '').split('\n').map((l) => l.trim()).find((l) => l.length > 8);
  return first ? first.slice(0, 160) : null;
}

function pdfPageCount(buf) {
  const lat = buf.toString('latin1');
  const counts = lat.match(/\/Type\s*\/Page[^s]/g);
  if (counts) return counts.length;
  const c = lat.match(/\/Count\s+(\d+)/);
  return c ? parseInt(c[1], 10) : null;
}

// ---- main ingest -----------------------------------------------------------
function ingestFile(file, opts = {}) {
  const buf = fs.readFileSync(file);
  const name = opts.name || path.basename(file);
  const mime = detectMime(buf, name);
  const att = { name, mime, bytes: buf.length, sha256: sha256hex(buf), kind: 'file', meta: {} };

  if (mime === 'application/pdf') {
    att.kind = 'paper';
    let text = pdfViaPoppler(file);
    let extractor = 'pdftotext';
    if (!text || !text.trim()) {
      text = pdfPureJs(buf);
      extractor = 'builtin';
    }
    text = cleanText(text || '');
    att.meta.pages = pdfPageCount(buf);
    att.meta.extractor = extractor;
    att.title = pdfTitle(buf, text);
    att.text_excerpt = text ? text.slice(0, EXCERPT_MAX) + (text.length > EXCERPT_MAX ? '…' : '') : '';
    if (!att.text_excerpt) att.meta.note = 'no extractable text (likely a scanned/image PDF — OCR needed)';
  } else if (mime.indexOf('image/') === 0) {
    att.kind = 'image';
    const dim = mime === 'image/png' ? pngSize(buf) : mime === 'image/jpeg' ? jpegSize(buf) : mime === 'image/gif' ? gifSize(buf) : null;
    if (dim) att.meta = Object.assign(att.meta, dim);
    if (opts.caption) att.caption = String(opts.caption);
  } else if (mime === 'text/plain' || mime === 'text/markdown') {
    att.kind = 'text';
    const text = cleanText(buf.toString('utf8'));
    att.text_excerpt = text.slice(0, EXCERPT_MAX) + (text.length > EXCERPT_MAX ? '…' : '');
  }

  if (opts.embed) {
    att.embedded = true;
    att.data_b64 = buf.toString('base64');
    if (buf.length > EMBED_WARN_BYTES) att.meta.embed_warning = 'large embed (' + Math.round(buf.length / 1024) + 'KB) inflates the token';
  }
  return att;
}

function attachToCapsule(cap, files, opts = {}) {
  cap.attachments = cap.attachments || [];
  const seen = new Set(cap.attachments.map((a) => a.sha256));
  for (const f of files) {
    const att = ingestFile(f, opts);
    if (!seen.has(att.sha256)) {
      cap.attachments.push(att);
      seen.add(att.sha256);
    }
  }
  return cap;
}

module.exports = { ingestFile, attachToCapsule, detectMime, EXCERPT_MAX };

// seal.js — high-efficiency encoding + information protection.
//
// Two capabilities, both producing a single pasteable base64url token:
//
//   encode/decode  — compression only (deflateRaw + base64url). Compact
//                    transfer; integrity guarded by a truncated SHA-256
//                    checksum so corruption is detected.
//
//   seal/unseal    — confidentiality + integrity. The capsule JSON is
//                    compressed, then encrypted with AES-256-GCM using a key
//                    derived from a passphrase via scrypt. The GCM auth tag
//                    (128-bit) authenticates the ciphertext: a wrong
//                    passphrase or any tampering makes decryption fail. A
//                    SHA-256 of the plaintext is also embedded and verified
//                    on unseal ("SHA256-grade" integrity).
//
// Order is compress-then-encrypt (correct: encrypted data won't compress).
// Pure Node stdlib (crypto + zlib), no dependencies.

'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const MAGIC = Buffer.from('S2S'); // 3 bytes
const TYPE_COMPRESSED = 0x43; // 'C'
const TYPE_ENCRYPTED = 0x45; // 'E'
const VERSION = 1;

// scrypt parameters (stored in the token so future params stay readable)
const KDF = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 };

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function deriveKey(passphrase, salt, params = KDF) {
  return crypto.scryptSync(Buffer.from(String(passphrase), 'utf8'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

// ---- compression-only token ------------------------------------------------
// layout: MAGIC(3) | TYPE_COMPRESSED(1) | VERSION(1) | checksum(8) | payload
function encode(capsuleJSON) {
  const plain = Buffer.from(capsuleJSON, 'utf8');
  const payload = zlib.deflateRawSync(plain, { level: 9 });
  const checksum = sha256(plain).subarray(0, 8);
  const buf = Buffer.concat([MAGIC, Buffer.from([TYPE_COMPRESSED, VERSION]), checksum, payload]);
  return {
    token: buf.toString('base64url'),
    rawBytes: plain.length,
    encodedBytes: payload.length,
    ratio: +(payload.length / plain.length).toFixed(3),
  };
}

function decode(token) {
  const buf = Buffer.from(token, 'base64url');
  if (!buf.subarray(0, 3).equals(MAGIC)) throw new Error('not an s2s token (bad magic)');
  const type = buf[3];
  if (type !== TYPE_COMPRESSED) throw new Error('this token is encrypted; use unseal with a passphrase');
  const checksum = buf.subarray(5, 13);
  const payload = buf.subarray(13);
  const plain = zlib.inflateRawSync(payload);
  if (!sha256(plain).subarray(0, 8).equals(checksum)) throw new Error('integrity check failed (corrupted token)');
  return plain.toString('utf8');
}

// ---- encrypted (sealed) token ---------------------------------------------
// layout: MAGIC(3) | TYPE_ENCRYPTED(1) | VERSION(1)
//       | N(4 BE) | r(1) | p(1) | salt(16) | iv(12) | tag(16)
//       | sha256(plain)(32) [encrypted with the data]  -> stored inside plaintext
//       | ciphertext
function seal(capsuleJSON, passphrase) {
  if (!passphrase) throw new Error('passphrase required to seal');
  const plain = Buffer.from(capsuleJSON, 'utf8');
  const compressed = zlib.deflateRawSync(plain, { level: 9 });

  // embed plaintext hash so unseal can assert "SHA256-grade" integrity
  const digest = sha256(plain); // 32 bytes
  const inner = Buffer.concat([digest, compressed]);

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(inner), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes (128-bit MAC)

  const header = Buffer.alloc(8);
  header.writeUInt32BE(KDF.N, 0);
  header.writeUInt8(KDF.r, 4);
  header.writeUInt8(KDF.p, 5);
  // bytes 6,7 reserved

  const buf = Buffer.concat([MAGIC, Buffer.from([TYPE_ENCRYPTED, VERSION]), header, salt, iv, tag, ciphertext]);
  return {
    token: buf.toString('base64url'),
    rawBytes: plain.length,
    encodedBytes: ciphertext.length,
    ratio: +(ciphertext.length / plain.length).toFixed(3),
  };
}

function unseal(token, passphrase) {
  if (!passphrase) throw new Error('passphrase required to unseal');
  const buf = Buffer.from(token, 'base64url');
  if (!buf.subarray(0, 3).equals(MAGIC)) throw new Error('not an s2s token (bad magic)');
  const type = buf[3];
  if (type === TYPE_COMPRESSED) throw new Error('this token is not encrypted; use decode (no passphrase)');
  if (type !== TYPE_ENCRYPTED) throw new Error('unknown token type');

  let o = 5;
  const N = buf.readUInt32BE(o); o += 4;
  const r = buf.readUInt8(o); o += 1;
  const p = buf.readUInt8(o); o += 1;
  o += 2; // reserved
  const salt = buf.subarray(o, o + 16); o += 16;
  const iv = buf.subarray(o, o + 12); o += 12;
  const tag = buf.subarray(o, o + 16); o += 16;
  const ciphertext = buf.subarray(o);

  const key = deriveKey(passphrase, salt, { N, r, p, keylen: 32, maxmem: KDF.maxmem });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let inner;
  try {
    inner = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new Error('decryption failed — wrong passphrase or tampered token');
  }
  const digest = inner.subarray(0, 32);
  const compressed = inner.subarray(32);
  const plain = zlib.inflateRawSync(compressed);
  if (!sha256(plain).equals(digest)) throw new Error('SHA-256 integrity check failed');
  return plain.toString('utf8');
}

// auto: detect token type from magic/type byte
function tokenType(token) {
  try {
    const buf = Buffer.from(token, 'base64url');
    if (!buf.subarray(0, 3).equals(MAGIC)) return null;
    return buf[3] === TYPE_ENCRYPTED ? 'encrypted' : buf[3] === TYPE_COMPRESSED ? 'compressed' : null;
  } catch (e) {
    return null;
  }
}

module.exports = { encode, decode, seal, unseal, tokenType, sha256, KDF };

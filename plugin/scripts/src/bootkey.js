// bootkey.js — an ephemeral encryption key tied to the machine's BOOT SESSION.
//
// Goal (per request): the secret key is regenerated every time the Mac is
// restarted, and each boot session is auto-tagged.
//
// How it works:
//   * A "boot tag" is derived from the kernel boot time (kern.boottime on
//     macOS, btime on Linux, or now-uptime as a fallback) + hostname. It is
//     constant for the life of a boot session and changes on every reboot.
//   * The first time a key is needed in a boot session, 32 random bytes are
//     generated and stored at ~/.s2s/keys/<boottag>.key (mode 0600).
//   * On reboot the boot tag changes, so currentKey() generates a fresh key
//     and PRUNES the previous boot's key file — old sealed tokens can no
//     longer be opened (ephemeral, auto-rotating protection).
//
// Trade-off (documented honestly): the key is persisted to disk for the boot
// session so multiple processes (MCP server restarts, CLI calls) can share it.
// It is chmod 0600 and auto-deleted on reboot. If you need the key to never
// touch disk, use passphrase mode instead.

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const KEY_DIR = path.join(os.homedir(), '.s2s', 'keys');

function bootTimeRaw() {
  // macOS / BSD
  try {
    const out = execSync('sysctl -n kern.boottime', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return 'kern:' + out;
  } catch (e) {
    /* not mac */
  }
  // Linux
  try {
    const m = fs.readFileSync('/proc/stat', 'utf8').match(/btime\s+(\d+)/);
    if (m) return 'btime:' + m[1];
  } catch (e) {
    /* not linux */
  }
  // Portable fallback: approximate boot epoch (constant within a boot,
  // rounded to 10s to absorb uptime jitter).
  return 'uptime:' + Math.round((Date.now() / 1000 - os.uptime()) / 10) * 10;
}

// 16-hex boot tag, stable per boot session, unique per machine.
function bootTag() {
  return crypto.createHash('sha256').update(bootTimeRaw() + '|' + os.hostname()).digest('hex').slice(0, 16);
}

function keyFileFor(tag) {
  return path.join(KEY_DIR, `${tag}.key`);
}

// Returns { bootTag, key(Buffer 32B), file, createdAt(ISO), fresh(boolean) }.
function currentKey() {
  const tag = bootTag();
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const file = keyFileFor(tag);
  let key;
  let fresh = false;
  if (fs.existsSync(file)) {
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) {
      key = null; // corrupt -> regenerate
    }
  }
  if (!key) {
    key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    fresh = true;
    pruneStale(tag);
  }
  const st = fs.statSync(file);
  return { bootTag: tag, key, file, createdAt: (st.birthtime || st.mtime).toISOString(), fresh };
}

// Delete key files from previous boot sessions (auto-rotate on reboot).
function pruneStale(keepTag) {
  let pruned = 0;
  try {
    for (const f of fs.readdirSync(KEY_DIR)) {
      if (f.endsWith('.key') && f !== `${keepTag}.key`) {
        try {
          fs.unlinkSync(path.join(KEY_DIR, f));
          pruned++;
        } catch (e) {
          /* ignore */
        }
      }
    }
  } catch (e) {
    /* dir missing */
  }
  return pruned;
}

// Status snapshot for tooling / "auto-tagging" visibility.
function status() {
  const k = currentKey();
  let others = 0;
  try {
    others = fs.readdirSync(KEY_DIR).filter((f) => f.endsWith('.key')).length - 1;
  } catch (e) {
    /* ignore */
  }
  return {
    boot_tag: k.bootTag,
    key_created_at: k.createdAt,
    regenerated_this_call: k.fresh,
    key_file: k.file,
    stale_keys_remaining: Math.max(0, others),
    note: 'Key rotates automatically on machine reboot (new boot tag -> new key).',
  };
}

module.exports = { bootTag, currentKey, status, pruneStale, KEY_DIR };

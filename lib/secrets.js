// lib/secrets.js — encrypts small secrets at rest (two-factor keys, Instagram and Facebook tokens) with
// AES-256-GCM.
// The key is APP_KEY from .env if set, otherwise a random key kept in .app-key next to data/
// (created on first use, readable only by the server's user). Neither is inside data/ or its
// backups, so a copied backup alone can't unlock anyone's two-factor login.
// Keep a copy of .app-key (or APP_KEY) with your .env: without it, two-factor logins must be reset and
// Instagram and Facebook connected again.
//
// Versioned keys (v15). Each sealed value names the key that sealed it:
//     k1.<key id>.<iv>.<tag>.<data>
// so the key can be changed without losing what the old one sealed:
//   - `node admin.js rotate-key` makes a new key, keeps the old one in .app-key.old (APP_KEY_OLD when
//     the key is in .env), and seals everything again with the new one;
//   - values sealed before v15 (three parts, no key id) are still read, with the current or an old key.
//
// The canary: data/key-canary.json holds a known value sealed with the key. At start the server reads
// it back; if it can't, the key doesn't match the data (a server restored without its .app-key, say),
// and you're told plainly, instead of logins and connections quietly failing one by one.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS, readJSON, writeJSON } from './paths.js';

export const keyFile = () => path.join(path.dirname(DIRS.data), '.app-key');
export const oldKeyFile = () => keyFile() + '.old';
const material = text => crypto.createHash('sha256').update(String(text).trim()).digest();
const idOf = m => crypto.createHash('sha256').update(m).update('agent-reels:key-id').digest('hex').slice(0, 8);

let cached = null;
// The key ring: the current master key first, then retired ones (newest first).
function ring() {
  if (cached && cached.env === (process.env.APP_KEY || '') + '|' + (process.env.APP_KEY_OLD || '')) return cached.keys;
  let current;
  if (process.env.APP_KEY) current = material(process.env.APP_KEY);
  else {
    const f = keyFile();
    if (!fs.existsSync(f)) { try { fs.writeFileSync(f, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    current = material(fs.readFileSync(f, 'utf8'));
  }
  const old = [];
  for (const t of String(process.env.APP_KEY_OLD || '').split(',').map(x => x.trim()).filter(Boolean)) old.push(material(t));
  try { for (const line of fs.readFileSync(oldKeyFile(), 'utf8').split('\n').map(x => x.trim()).filter(Boolean).reverse()) old.push(material(line)); } catch { /* none kept */ }
  const keys = [current, ...old].filter((m, i, a) => a.findIndex(x => x.equals(m)) === i).map(m => ({ id: idOf(m), m }));
  cached = { env: (process.env.APP_KEY || '') + '|' + (process.env.APP_KEY_OLD || ''), keys };
  return keys;
}
export const forgetKeys = () => { cached = null; };
export const currentKeyId = () => ring()[0].id;
const keyFor = (purpose, m = ring()[0].m) => crypto.createHmac('sha256', m).update('agent-reels:' + purpose).digest();

function open(parts, key) {
  const [iv, tag, enc] = parts.map(x => Buffer.from(x, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
export function seal(text, purpose = 'app') {
  const k = ring()[0], iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyFor(purpose, k.m), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['k1', k.id, ...[iv, c.getAuthTag(), enc].map(b => b.toString('base64url'))].join('.');
}
// The text, or null when it can't be opened. `legacy`: extra keys to try for a value sealed the old way
// (Instagram and Facebook tokens were sealed with a key from the app secret before v15).
export function unseal(sealed, purpose = 'app', { legacy = [] } = {}) {
  const parts = String(sealed ?? '').split('.');
  try {
    if (parts[0] === 'k1' && parts.length === 5) {
      let k = ring().find(x => x.id === parts[1]);
      // A key id this process doesn't know: the key may have just been changed (rotate-key while the
      // server runs). Read the key files again, once.
      if (!k) { forgetKeys(); k = ring().find(x => x.id === parts[1]); }
      return k ? open(parts.slice(2), keyFor(purpose, k.m)) : null;
    }
    if (parts.length !== 3) return null;
    for (const key of [...ring().map(k => keyFor(purpose, k.m)), ...legacy]) { try { return open(parts, key); } catch { /* next */ } }
  } catch { /* unreadable */ }
  return null;
}
// Sealed with the current key? (Anything else is sealed again by `rotate-key` or when it's next saved.)
export const isCurrent = sealed => String(sealed ?? '').startsWith(`k1.${currentKeyId()}.`);
// Sealed with a key this server doesn't have (it can't be opened, but it isn't damaged or wrong: the
// key is missing). Callers leave such a value alone instead of treating it as a broken connection.
export const keyMissing = sealed => { const p = String(sealed ?? '').split('.'); if (p[0] !== 'k1' || p.length !== 5) return false; if (ring().some(x => x.id === p[1])) return false; forgetKeys(); return !ring().some(x => x.id === p[1]); };
// A short signature for something the server vouches for (like a link verdict), so a copy that comes
// back from the browser can be told apart from one that was made up.
export const sign = (text, purpose = 'app') => crypto.createHmac('sha256', keyFor(purpose)).update(String(text)).digest('base64url').slice(0, 16);
// Is this a signature this server made, with its current key or an earlier one?
export const signedBy = (text, sig, purpose = 'app') => !!sig && ring().some(k => crypto.createHmac('sha256', keyFor(purpose, k.m)).update(String(text)).digest('base64url').slice(0, 16) === sig);

/* ---------------- The canary ---------------- */
const CANARY = () => path.join(DIRS.data, 'key-canary.json');
const CANARY_TEXT = 'agent-reels canary';
// { ok, fresh?, keyId } — fresh: there was no canary yet (one is written now).
let lastCanary = null;
export const canaryOk = () => lastCanary?.ok !== false;   // the health check (lib/monitor.js)
export function checkCanary() {
  const c = readJSON(CANARY(), null);
  if (!c?.sealed) { writeJSON(CANARY(), { sealed: seal(CANARY_TEXT, 'canary'), keyId: currentKeyId(), at: new Date().toISOString() }); return (lastCanary = { ok: true, fresh: true, keyId: currentKeyId() }); }
  const ok = unseal(c.sealed, 'canary') === CANARY_TEXT;
  // Readable with an old key only: sealed again with the current one.
  if (ok && !isCurrent(c.sealed)) writeJSON(CANARY(), { sealed: seal(CANARY_TEXT, 'canary'), keyId: currentKeyId(), at: new Date().toISOString() });
  return (lastCanary = { ok, keyId: currentKeyId(), sealedWith: c.keyId || '' });
}

/* ---------------- Changing the key ---------------- */
// A new key: the current one is kept in .app-key.old (so everything it sealed can still be read), the
// new one goes in .app-key. With APP_KEY in .env, the new value is returned to put there yourself.
export function newKey() {
  const fresh = crypto.randomBytes(32).toString('hex');
  if (process.env.APP_KEY) return { inEnv: true, value: fresh };
  const f = keyFile(), now = fs.readFileSync(f, 'utf8').trim();
  fs.appendFileSync(oldKeyFile(), now + '\n', { mode: 0o600 });
  fs.chmodSync(oldKeyFile(), 0o600);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, fresh + '\n', { mode: 0o600 });
  fs.renameSync(tmp, f);
  forgetKeys();
  return { inEnv: false, keyId: currentKeyId() };
}

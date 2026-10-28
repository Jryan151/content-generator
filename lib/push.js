// lib/push.js — "your video is ready" on the agent's phone or computer, even with the app closed.
// Standard Web Push, no outside packages: the message is encrypted for the browser (RFC 8291,
// aes128gcm) and the request is signed with this server's VAPID key (RFC 8292, ES256).
//
// The VAPID key pair is made once and kept in data/push-vapid.json (or set VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY, base64url, to keep the same key across servers). Subscriptions are per workspace
// (push.json), one per browser, tied to the account that turned them on.
//
// Only the browsers' own push services are ever contacted (Google, Mozilla, Apple, Microsoft), so a
// made-up "subscription" can't point the server at another address. PUSH_EXTRA_HOSTS adds hosts
// (for tests or a self-hosted push service).
import crypto from 'crypto';
import path from 'path';
import { DIRS, readJSON, writeJSON, updateJSON, randomId, localTime } from './paths.js';
import { wsDir, getAccount } from './store.js';
import { isMember, membership } from './roles.js';
import * as breaker from './breaker.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');
const KEY_FILE = () => path.join(DIRS.data, 'push-vapid.json');
const subsFile = ws => path.join(wsDir(ws), 'push.json');
export const MAX_PER_ACCOUNT = 10;

/* ---------------- VAPID keys ---------------- */
let cached = null;
export function vapid() {
  if (cached) return cached;
  let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const saved = readJSON(KEY_FILE(), null);
    if (saved?.publicKey && saved?.privateKey) ({ publicKey: pub, privateKey: priv } = saved);
    else {
      const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
      pub = b64u(ec.getPublicKey()); priv = b64u(ec.getPrivateKey());
      writeJSON(KEY_FILE(), { publicKey: pub, privateKey: priv, createdAt: new Date().toISOString() });
    }
  }
  const raw = unb64u(pub);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(unb64u(priv)), x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  cached = { publicKey: pub, key };
  return cached;
}
export const resetForTests = () => { cached = null; };

/* ---------------- Encryption (RFC 8291) ---------------- */
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
export function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length !== 16) throw new Error('Bad subscription keys');
  const as = ecdh || (() => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return e; })();
  const asPub = as.getPublicKey();
  const shared = as.computeSecret(ua);
  const ikm = hkdf(secret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head.writeUInt8(65, 20);
  return Buffer.concat([head, asPub, body]);
}

/* ---------------- VAPID signature (RFC 8292) ---------------- */
export function vapidHeader(endpoint, { now = Date.now(), sub = 'mailto:support@localhost' } = {}) {
  const v = vapid(), aud = new URL(endpoint).origin;
  const part = o => b64u(JSON.stringify(o));
  const data = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: v.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${v.publicKey}`;
}

/* ---------------- Subscriptions ---------------- */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;
export function okEndpoint(u) {
  let url;
  try { url = new URL(String(u)); } catch { return false; }
  const extra = String(process.env.PUSH_EXTRA_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(url.host.toLowerCase())) return ['https:', 'http:'].includes(url.protocol);
  return url.protocol === 'https:' && PUSH_HOSTS.test(url.hostname) && !url.username && !url.password;
}
export const list = ws => readJSON(subsFile(ws), []);
export function subscribe(ws, accountId, sub = {}, ua = '') {
  const endpoint = String(sub.endpoint || '').slice(0, 1000), p256dh = String(sub.keys?.p256dh || ''), auth = String(sub.keys?.auth || '');
  if (!okEndpoint(endpoint)) throw Object.assign(new Error('That browser’s notifications aren’t supported here.'), { status: 400 });
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) throw Object.assign(new Error('The browser sent incomplete notification keys. Try again.'), { status: 400 });
  const rec = { id: randomId('ps', 5), accountId, endpoint, p256dh, auth, ua: String(ua).slice(0, 120), at: new Date().toISOString() };
  updateJSON(subsFile(ws), [], all => {
    const rest = all.filter(s => s.endpoint !== endpoint);
    const mine = rest.filter(s => s.accountId === accountId);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - (MAX_PER_ACCOUNT - 1))).map(s => s.id));
    return [...rest.filter(s => !drop.has(s.id)), rec];
  });
  return rec;
}
export function unsubscribe(ws, accountId, endpoint) {
  let gone = false;
  updateJSON(subsFile(ws), [], all => { const rest = all.filter(s => !(s.accountId === accountId && (!endpoint || s.endpoint === endpoint))); gone = rest.length !== all.length; return rest; });
  return gone;
}
export const forAccount = (ws, accountId) => list(ws).filter(s => s.accountId === accountId);
export const removeAccount = (ws, accountId) => unsubscribe(ws, accountId);

/* ---------------- Sending ---------------- */
// Quiet hours (9pm to 7am the agent's time): nothing buzzes. The app still shows it when opened.
export const quietNow = (tz, now = new Date()) => { const h = localTime(tz, now).hour; return h >= 21 || h < 7; };

// Who the push services can contact about this server (RFC 8292 "sub"): the support address, else the
// site's address. Apple refuses a made-up one.
export function vapidSubject() {
  const mail = [process.env.SUPPORT_EMAIL].map(x => String(x || '').trim()).find(x => /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(x));
  if (mail) return `mailto:${mail}`;
  const site = String(process.env.PUBLIC_URL || '').trim();
  return /^https:\/\/[^\s]+$/.test(site) ? site.replace(/\/+$/, '') : 'mailto:admin@example.com';
}
// Only people who still belong to the workspace get its news: an account that was disabled, deleted or
// moved elsewhere (or an admin who once looked in) is skipped and its devices are dropped.
const member = (ws, accountId) => { const a = getAccount(accountId); return !!a && !a.disabled && isMember(a, ws); };
const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v);

// `quiet: false` (a test the agent asked for) ignores quiet hours. `now` is only for quiet hours.
// `daysOff` (weekdays, 0 = Sunday): those days stay quiet too.
// Sent once. If the push services keep failing, the breaker stops trying for a while.
export async function send(ws, message, opts = {}) {
  if (!breaker.allow('push')) return { sent: 0, skipped: true, failedSubs: [] };
  const r = await sendNow(ws, message, opts);
  if (r.failedSubs.length && r.sent === 0 && !r.rejected) breaker.failure('push', Object.assign(new Error('No push service answered.'), { unknown: true }));
  else if (r.sent) breaker.success('push');
  else breaker.release('push');
  return r;
}
async function sendNow(ws, message, { tz = 'America/Denver', now = new Date(), fetchImpl = fetch, accountIds = null, quiet = true, daysOff = [], subIds = null } = {}) {
  const all = list(ws), gone = all.filter(s => !member(ws, s.accountId)).map(s => s.id);
  const subs = all.filter(s => !gone.includes(s.id) && (!accountIds || accountIds.includes(s.accountId)) && (!subIds || subIds.includes(s.id)));
  if (gone.length) updateJSON(subsFile(ws), [], cur => cur.filter(s => !gone.includes(s.id)));
  const offToday = daysOff.includes(new Date(`${localTime(tz, now).date}T12:00:00Z`).getUTCDay());
  if (!subs.length || (quiet && (quietNow(tz, now) || offToday))) return { sent: 0, skipped: subs.length, removed: gone.length, failedSubs: [] };
  const body = JSON.stringify({ title: cut(message.title, 80), body: cut(message.body, 200), url: cut(message.url, 200), tag: cut(message.tag, 60), image: cut(message.image, 200), media: cut(message.media, 200) });
  let sent = 0, rejected = 0;
  const dead = [], refused = [], ok = [], failed = [];
  await Promise.all(subs.map(async s => {
    try {
      const res = await fetchImpl(s.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: vapidHeader(s.endpoint, { sub: vapidSubject() }), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
        body: encrypt(body, s),
      });
      if (res.status === 404 || res.status === 410) dead.push(s.id);   // the browser unsubscribed
      else if (res.status === 401 || res.status === 403) { rejected++; refused.push(s.id); }   // our signature or key was refused
      else if (res.ok) { sent++; ok.push(s.id); }
    } catch { failed.push(s.id); }
  }));
  // Gone browsers are dropped; refused ones are marked (Account shows it) until one gets through.
  if (dead.length || refused.length || ok.some(id => subs.find(x => x.id === id)?.problem)) updateJSON(subsFile(ws), [], cur => cur.filter(s => !dead.includes(s.id)).map(s => (refused.includes(s.id) ? { ...s, problem: 'refused' } : ok.includes(s.id) && s.problem ? { ...s, problem: '' } : s)));
  return { sent, rejected, removed: dead.length + gone.length, failedSubs: failed };
}

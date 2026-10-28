// lib/auth.js — passwords, sessions, invite and reset links, and login rate limits.
//   Passwords: scrypt with a random salt per account.
//   Sessions: a random token in an HttpOnly cookie; only its SHA-256 hash is stored. Each one
//     remembers the device (browser) and IP it started from, so people can see where they're
//     logged in and log out other devices. Sessions end after SESSION_DAYS (admins: ADMIN_SESSION_DAYS)
//     or after SESSION_IDLE_DAYS without use.
//   Invite / reset links: single use, expire after 7 days; only the hash is stored.
import crypto from 'crypto';
import path from 'path';
import { promisify } from 'util';
import { DIRS, readJSON, updateJSON } from './paths.js';

const scrypt = promisify(crypto.scrypt);
const SESSIONS = path.join(DIRS.data, 'sessions.json');
const TOKENS = path.join(DIRS.data, 'tokens.json');
export const SESSION_DAYS = 30;
const days = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const ADMIN_SESSION_DAYS = () => days(process.env.ADMIN_SESSION_DAYS, 7);
export const SESSION_IDLE_DAYS = () => days(process.env.SESSION_IDLE_DAYS, 14);
const SEEN_EVERY = 10 * 60000;   // lastSeenAt is written at most every 10 minutes
const LINK_DAYS = 7;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

/* ---------------- Passwords ---------------- */
export const PASSWORD_MIN = 10;
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (s.length > 200) return 'That password is too long.';
  return null;
}
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
// A fixed dummy hash, so a login for an unknown email takes as long as a real one.
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(KEYLEN).toString('base64');
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || DUMMY).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(got, want) && !!stored;
}
export const randomPassword = () => crypto.randomBytes(12).toString('base64url');

/* ---------------- Tokens ---------------- */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/* ---------------- Sessions ---------------- */
const idleOut = (s, now) => now - (s.lastSeenAt || s.createdAt) > SESSION_IDLE_DAYS() * 86400000;
// `days`: how long it can last at most. `device`: { ua, ip } shown in the session list.
export function createSession(accountId, { days: d = SESSION_DAYS, ua = '', ip = '' } = {}) {
  const token = newToken(), now = Date.now();
  updateJSON(SESSIONS, {}, all => {
    for (const [h, s] of Object.entries(all)) if (s.expiresAt < now || idleOut(s, now)) delete all[h];
    all[tokenHash(token)] = { accountId, createdAt: now, lastSeenAt: now, expiresAt: now + d * 86400000, ws: null, ua: String(ua || '').slice(0, 200), ip: String(ip || '').slice(0, 64) };
  });
  return token;
}
export function getSession(token) {
  if (!token) return null;
  const h = tokenHash(token), s = readJSON(SESSIONS, {})[h], now = Date.now();
  if (!s || s.expiresAt < now || idleOut(s, now)) return null;
  if (now - (s.lastSeenAt || 0) > SEEN_EVERY) updateSession(h, { lastSeenAt: now });
  return { ...s, hash: h };
}
// Where an account is logged in. `id` is a short, non-secret handle (the first 12 characters of the hash).
export function listSessions(accountId, currentHash = '') {
  const now = Date.now();
  return Object.entries(readJSON(SESSIONS, {})).filter(([, s]) => s.accountId === accountId && s.expiresAt > now && !idleOut(s, now))
    .map(([h, s]) => ({ id: h.slice(0, 12), current: h === currentHash, createdAt: new Date(s.createdAt).toISOString(), lastSeenAt: new Date(s.lastSeenAt || s.createdAt).toISOString(), device: deviceName(s.ua), ip: s.ip || '' }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}
export function deleteSessionById(accountId, id) {
  let gone = false;
  updateJSON(SESSIONS, {}, all => { for (const [h, s] of Object.entries(all)) if (s.accountId === accountId && h.slice(0, 12) === id) { delete all[h]; gone = true; } });
  return gone;
}
// "Chrome on Mac", "Safari on iPhone"… from the browser's user agent, roughly.
export function deviceName(ua = '') {
  const u = String(ua);
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  const br = /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /SamsungBrowser\//.test(u) ? 'Samsung Internet' : /FxiOS\/|Firefox\//.test(u) ? 'Firefox' : /CriOS\/|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}
export function updateSession(hash, patch) { updateJSON(SESSIONS, {}, all => { if (all[hash]) Object.assign(all[hash], patch); }); }
export function deleteSession(hash) { updateJSON(SESSIONS, {}, all => { delete all[hash]; }); }
export function deleteSessionsFor(accountId, exceptHash = null) {
  updateJSON(SESSIONS, {}, all => { for (const [h, s] of Object.entries(all)) if (s.accountId === accountId && h !== exceptHash) delete all[h]; });
}

/* ---------------- Invite and reset links ---------------- */
// invite: { email, role, workspaceId | newWorkspace: { name, comped } }
// reset:  { accountId }
export function createLink(kind, data, by = '') {
  const token = newToken(), now = Date.now();
  updateJSON(TOKENS, [], list => [
    ...list.filter(t => t.expiresAt > now - 30 * 86400000),
    { hash: tokenHash(token), kind, ...data, createdAt: now, createdBy: by, expiresAt: now + LINK_DAYS * 86400000, usedAt: 0 },
  ]);
  return token;
}
export function peekLink(token, kind) {
  const h = tokenHash(token || '');
  const t = readJSON(TOKENS, []).find(x => x.hash === h && x.kind === kind);
  return t && !t.usedAt && t.expiresAt > Date.now() ? t : null;
}
export function useLink(token, kind) {
  const h = tokenHash(token || '');
  let out = null;
  updateJSON(TOKENS, [], list => {
    const t = list.find(x => x.hash === h && x.kind === kind);
    if (t && !t.usedAt && t.expiresAt > Date.now()) { t.usedAt = Date.now(); out = t; }
  });
  return out;
}
export const listLinks = () => readJSON(TOKENS, []);
// Takes back unused invite links that match (an agent withdrawing an assistant's invite).
export function revokeInvites(match) { let n = 0; updateJSON(TOKENS, [], list => list.map(t => (t.kind === 'invite' && !t.usedAt && match(t) ? (n++, { ...t, usedAt: Date.now(), revoked: true }) : t))); return n; }

/* ---------------- Rate limits (in memory) ---------------- */
export function limiter({ max, windowMs }) {
  const hits = new Map();
  return {
    blocked(key) { const h = hits.get(key); return !!h && h.n >= max && Date.now() - h.at < windowMs; },
    fail(key) { const h = hits.get(key); const fresh = !h || Date.now() - h.at >= windowMs; hits.set(key, { n: fresh ? 1 : h.n + 1, at: fresh ? Date.now() : h.at }); },
    clear(key) { hits.delete(key); },
  };
}

/* ---------------- Cookies ---------------- */
// On https the cookie is "__Host-sid": the browser only sends it to this exact site, over https,
// for the whole site. On plain http (local testing) it's "sid". An old "sid" cookie still works on
// https until the person next logs in.
export const COOKIE = 'sid';
export const cookieName = secure => (secure ? '__Host-sid' : COOKIE);
export const sessionToken = (cookies, secure) => cookies[cookieName(secure)] || cookies[COOKIE] || '';
export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
export const sessionCookie = (token, secure, d = SESSION_DAYS) => `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(d * 86400)}${secure ? '; Secure' : ''}`;
export const clearCookie = secure => [...new Set([cookieName(secure), COOKIE])].map(n => `${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);

// Signed in on the team's site: your log saves to your leader's team (the server's lib/reels.js).
//
// The phone keeps the working copy, so tapping never waits on the network, and sends only what
// changed: new log entries, the clients that changed, and the small lists. No signal? It keeps
// everything and sends it when the signal is back. If another device saved in between, this phone
// takes the latest copy and says what it couldn't keep.
//
// Off the site (the preview page, or not signed in), none of this runs and the app keeps the log on
// the phone, as before.
import { migrate } from './src/store.js';

export const account = {
  on: false,          // signed in and on a team
  site: false,        // this page is on the team's site (it can sign in)
  role: null,         // 'leader' | 'agent'
  me: null, team: null,
  rev: 0, status: 'saved', error: '', lost: 0,
  importable: null,   // a log on this phone from before signing in: { acts, leads }
};
let doc = null;
/** The log the app should work on (it changes when another device's copy is taken). */
export const current = () => doc;
let synced = 0;                      // log entries the server has
let truncPending = null;              // an undo took back entries the server already has
const dirty = new Map();              // client id → change number (sent once the server has that number)
const removed = new Map();
let otherGen = 0, otherSent = 0;      // recruits, names, profile, backup date
let gen = 0;
let onUpdate = () => {};

const json = (r) => r.json().catch(() => ({}));
const cacheKey = () => `agent-reels-acct-${account.me.id}`;
function writeCache() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ rev: account.rev, doc, synced, truncPending, dirty: [...dirty], removed: [...removed], otherGen, otherSent }));
  } catch { /* the server still has everything it was sent */ }
}
function readCache() { try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch { return null; } }
const pendingIn = (c) => (c ? Math.max(0, c.doc.activities.length - c.synced) + (c.dirty?.length || 0) + (c.removed?.length || 0) + (c.otherGen > c.otherSent ? 1 : 0) + (c.truncPending !== null && c.truncPending !== undefined ? 1 : 0) : 0);
export const pending = () => pendingIn({ doc, synced, dirty: [...dirty], removed: [...removed], otherGen, otherSent, truncPending });

function adopt(serverDoc, rev) {
  doc = migrate(serverDoc);
  account.rev = rev; synced = doc.activities.length; truncPending = null;
  dirty.clear(); removed.clear(); otherGen = otherSent = 0;
  writeCache();
}

/**
 * Find out whether this person is signed in on a team. Returns their log (the object the app works
 * on), or null to keep working on the phone alone. `local` is the phone-only log, offered for import.
 */
export async function start({ local, onChange }) {
  onUpdate = onChange || onUpdate;
  let res;
  try { res = await fetch('/api/reels/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }); } catch { return null; }
  const type = res.headers.get('content-type') || '';
  account.site = type.includes('json');
  if (!res.ok || !account.site) return null;
  const d = await json(res);
  Object.assign(account, { on: true, role: d.role, me: d.account, team: d.team });
  const cache = readCache();
  if (cache && cache.rev === d.rev && pendingIn(cache)) {
    // Changes made on this phone that haven't reached the server yet: keep them and send them.
    doc = migrate(cache.doc); account.rev = cache.rev; synced = cache.synced; truncPending = cache.truncPending ?? null;
    cache.dirty.forEach(([k, v]) => dirty.set(k, v)); cache.removed.forEach(([k, v]) => removed.set(k, v));
    otherGen = cache.otherGen; otherSent = cache.otherSent; gen = Math.max(gen, otherGen, ...cache.dirty.map(([, v]) => v), 0);
    flush();
  } else {
    account.lost = cache && cache.rev !== d.rev ? pendingIn(cache) : 0;
    adopt(d.log, d.rev);
  }
  let imported = false;
  try { imported = localStorage.getItem(`${cacheKey()}-imported`) === '1'; } catch { /* no storage */ }
  if (!imported && account.rev === 0 && !doc.activities.length && !doc.leads.length && local && (local.activities.length || local.leads.length)) {
    account.importable = { acts: local.activities.length, leads: local.leads.length };
  }
  addEventListener('online', () => flush());
  return doc;
}

/** After any change: what changed in the clients, so only that is sent. */
export function noteChange(beforeLeads) {
  if (!account.on) return;
  gen++;
  const prev = new Map(beforeLeads.map((l) => [l.id, JSON.stringify(l)]));
  const now = new Set();
  for (const l of doc.leads) {
    now.add(l.id);
    if (prev.get(l.id) !== JSON.stringify(l)) { dirty.set(l.id, gen); removed.delete(l.id); }
  }
  for (const id of prev.keys()) if (!now.has(id)) { removed.set(id, gen); dirty.delete(id); }
  otherGen = gen;
  writeCache();
  schedule();
}
/** An undo took the log back to `length` entries. */
export function noteTruncate(length) {
  if (!account.on) return;
  if (length < synced) truncPending = truncPending === null ? length : Math.min(truncPending, length);
}

let timer = null, running = false, again = false;
function schedule(ms = 500) { clearTimeout(timer); timer = setTimeout(flush, ms); }
const setStatus = (s, err = '') => { if (account.status !== s || account.error !== err) { account.status = s; account.error = err; onUpdate('status'); } };

export async function flush() {
  if (!account.on) return;
  if (running) { again = true; return; }
  running = true;
  try {
    for (let guard = 0; guard < 200 && pending(); guard++) {
      const acts = doc.activities;
      const base = truncPending ?? synced;
      const add = acts.slice(base, base + 2000);
      const byId = new Map(doc.leads.map((l) => [l.id, l]));
      const up = [...dirty].slice(0, 1500), rm = [...removed].slice(0, 1500);
      const body = { rev: account.rev, acts: { base, add, ...(truncPending !== null ? { truncateTo: truncPending } : {}) }, leads: { upsert: up.map(([id]) => byId.get(id)).filter(Boolean), remove: rm.map(([id]) => id) } };
      const sendOther = otherGen > otherSent, otherAt = otherGen;
      if (sendOther) Object.assign(body, { recruits: doc.recruits, names: doc.names, profile: doc.profile, lastBackupAt: doc.lastBackupAt });
      setStatus('saving');
      const res = await fetch('/api/reels/sync', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      const d = await json(res);
      if (res.status === 409 && d.conflict) {
        account.lost = pending();
        adopt(d.doc, d.rev);
        onUpdate('replaced');
        break;
      }
      if (res.status === 409) {   // an undo the server won't allow: it keeps its copy
        const fresh = await fetch('/api/reels/me', { credentials: 'same-origin' }).then(json);
        account.lost = 1; adopt(fresh.log, fresh.rev); onUpdate('replaced');
        break;
      }
      if (res.status === 401) { account.on = false; setStatus('error', 'You were signed out. Sign in again to keep saving to your team.'); break; }
      if (!res.ok) throw Object.assign(new Error(d.error || 'Couldn’t save to your team.'), { hard: res.status < 500 });
      account.rev = d.rev;
      synced = base + add.length; truncPending = null;
      for (const [id, g] of up) if (dirty.get(id) === g) dirty.delete(id);
      for (const [id, g] of rm) if (removed.get(id) === g) removed.delete(id);
      if (sendOther) otherSent = otherAt;
      writeCache();
    }
    if (account.on) setStatus('saved');
  } catch (e) {
    const offline = navigator.onLine === false || e instanceof TypeError;
    setStatus(offline ? 'offline' : 'error', offline ? '' : e.message);
    if (!e.hard) schedule(15_000);
  } finally {
    running = false;
    if (again) { again = false; schedule(50); }
  }
}

/** Send the log that was on this phone before signing in, the first time only. */
export async function importLocal(local) {
  doc.activities.push(...local.activities);
  doc.leads.push(...local.leads.filter((l) => !doc.leads.some((x) => x.id === l.id)));
  doc.recruits = local.recruits; doc.names = local.names; doc.profile = { ...local.profile }; doc.lastBackupAt = local.lastBackupAt;
  gen++; for (const l of doc.leads) dirty.set(l.id, gen); otherGen = gen;
  account.importable = null;
  try { localStorage.setItem(`${cacheKey()}-imported`, '1'); } catch { /* fine */ }
  writeCache();
  await flush();
}
export function skipImport() { account.importable = null; try { localStorage.setItem(`${cacheKey()}-imported`, '1'); } catch { /* fine */ } }

/* ---------------- Signing in and out ---------------- */
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const d = await json(res);
  if (!res.ok) throw new Error(d.error || 'Something went wrong. Try again.');
  return d;
}
export async function login(email, password) {
  const d = await post('/api/login', { email, password });
  if (d.twofa) throw new Error('Your login uses two-step sign-in. Sign in on the main site first, then open this page again.');
  location.reload();
}
export async function logout() {
  if (pending()) await flush();
  try { await post('/api/logout', {}); } finally { location.reload(); }
}

/* ---------------- The leader's team ---------------- */
let team = null, teamAt = 0;
export const teamNow = () => team;
export async function loadTeam(tz, { force = false } = {}) {
  if (!account.on || account.role !== 'leader') return null;
  if (!force && team && Date.now() - teamAt < 60_000) return team;
  const res = await fetch(`/api/reels/team?tz=${encodeURIComponent(tz)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const d = await json(res);
  if (!res.ok) throw new Error(d.error || 'Couldn’t load your team.');
  team = d; teamAt = Date.now();
  return team;
}
export async function invite(email) { const d = await post('/api/reels/invite', { email }); if (team) team.invites = d.invites; return d; }
export async function revokeInvite(email) { const d = await post('/api/reels/invites/revoke', { email }); if (team) team.invites = d.invites; return d; }
export async function removeFromTeam(id) {
  const res = await fetch(`/api/reels/team/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const d = await json(res);
  if (!res.ok) throw new Error(d.error || 'Couldn’t take them off the team.');
  team = null;
  return d;
}

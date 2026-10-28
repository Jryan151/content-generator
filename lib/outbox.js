// lib/outbox.js — everything the app sends out on its own (emails, phone notifications) goes through
// one saved outbox, like a mail room: tried at once, and if the service isn't answering, kept and tried
// again (1, 5, 30 minutes, 2 and 6 hours), so a restart or an outage delays a message but never loses
// it. Each message has a one-time key: the same message is never sent twice, however often it's asked for.
//
//   deliver(kind, payload, { key, ttlMs })   send now if possible; otherwise keep it and say so
//   drain()                                   send what's due (every minute, from the scheduler)
//
// A message that's refused for good (a bad address, an unverified sender) isn't retried: you're alerted
// as before. One that's still undelivered at its expiry (3 days for email, 15 minutes for a phone
// notification, which is only useful when fresh) is given up on and listed in Admin.
// Kept in data/outbox.json: sent ones for 7 days, the newest 2,000.
import path from 'path';
import { DIRS, readJSON, updateJSON, randomId } from './paths.js';
import { notify } from './alerts.js';
import * as breaker from './breaker.js';
import { isOn } from './switches.js';
import { getWorkspace } from './store.js';

const FILE = path.join(DIRS.data, 'outbox.json');
const KEEP_DAYS = 7, KEEP = 2000;
const WAITS = [60000, 5 * 60000, 30 * 60000, 2 * 3600000, 6 * 3600000];
export const TTL = { email: 3 * 86400000, push: 15 * 60000 };
const handlers = {};
// `send(payload)` → resolves when it went out; throws with `permanent` when it never will.
export const register = (kind, send) => { handlers[kind] = send; };
const service = kind => (kind === 'email' ? 'email' : kind === 'push' ? 'push' : kind);
const iso = (t = Date.now()) => new Date(t).toISOString();
export const list = () => readJSON(FILE, []);
const change = fn => { let out; updateJSON(FILE, [], all => { out = fn(all); return all; }); return out; };

function prune(all, now = Date.now()) {
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    if (m.status === 'sent' && now - Date.parse(m.sentAt) > KEEP_DAYS * 86400000) all.splice(i, 1);
    else if (['expired', 'failed'].includes(m.status) && now - Date.parse(m.endedAt || m.createdAt) > KEEP_DAYS * 86400000) all.splice(i, 1);
  }
  // Over the limit: the oldest finished ones go; never one still waiting to be sent.
  for (let i = 0; all.length > KEEP && i < all.length;) { if (['sent', 'failed', 'expired'].includes(all[i].status)) all.splice(i, 1); else i++; }
}
// Its switch: emails or push, for everyone and for the workspace it's from (if any).
const switchedOn = m => isOn(m.kind === 'email' ? 'emails' : m.kind, m.ws ? (() => { try { return getWorkspace(m.ws); } catch { return null; } })() : null);
// What's kept of a sent message (the body is gone; who it went to and what it was about stay).
const slim = p => (p && typeof p === 'object' ? Object.fromEntries(Object.entries(p).filter(([k]) => !['html', 'text'].includes(k))) : p);

// Sends now (unless its switch is off or its service's breaker is open). Returns
//   { sent: true }                     it went out
//   { duplicate: true }                a message with this key was already sent or is waiting
//   { queued: true, why }              kept, and tried again later
// and throws (as before) when it's refused for good.
// `ws`: the workspace it's from, so that workspace's own switch applies.
export async function deliver(kind, payload, { key = '', ttlMs = TTL[kind] || 86400000, now = Date.now(), ws = '' } = {}) {
  if (!handlers[kind]) throw new Error(`Nothing sends "${kind}" messages.`);
  const k = key || randomId('m', 8);
  let item = null, dup = false;
  change(all => {
    const old = all.find(m => m.key === k && m.kind === kind && ['sent', 'queued', 'held', 'sending'].includes(m.status));
    if (old) { dup = true; return; }
    item = { id: randomId('ob', 6), kind, key: k, ws: ws || payload?.ws || '', payload, status: 'sending', sendingAt: iso(now), attempts: 0, createdAt: iso(now), expiresAt: iso(now + ttlMs), nextAt: iso(now) };
    all.push(item);
    prune(all, now);
  });
  if (dup) return { duplicate: true };
  return attempt(item, now);
}

// Keeps a message to send later without trying now (it just failed elsewhere). Same one-time key rules.
export function later(kind, payload, { key = '', ttlMs = TTL[kind] || 86400000, now = Date.now(), ws = '' } = {}) {
  const k = key || randomId('m', 8);
  let added = false;
  change(all => {
    if (all.some(m => m.key === k && m.kind === kind && ['sent', 'queued', 'held', 'sending'].includes(m.status))) return;
    all.push({ id: randomId('ob', 6), kind, key: k, ws: ws || payload?.ws || '', payload, status: 'queued', attempts: 1, createdAt: iso(now), expiresAt: iso(now + ttlMs), nextAt: iso(now + WAITS[0]) });
    added = true;
    prune(all, now);
  });
  return added;
}

async function attempt(item, now = Date.now()) {
  const kind = item.kind;
  if (!switchedOn(item)) { save(item.id, { status: 'held', why: 'switched off' }); return { queued: true, why: 'paused' }; }
  // Its service is paused (breaker): it waits a minute, without counting as a try.
  if (!breaker.allow(service(kind))) { save(item.id, { status: 'queued', error: 'isn’t answering right now', nextAt: iso(now + WAITS[0]) }); return { queued: true, why: 'not answering' }; }
  try {
    const result = await handlers[kind](item.payload);
    breaker.success(service(kind));
    save(item.id, { status: 'sent', sentAt: iso(), attempts: item.attempts + 1, error: '', payload: slim(item.payload) });
    return { sent: true, result };
  } catch (e) {
    breaker.failure(service(kind), e);
    if (e.permanent || !breaker.isServiceFailure(e)) {
      save(item.id, { status: 'failed', endedAt: iso(), attempts: item.attempts + 1, error: String(e.message).slice(0, 300) });
      throw e;
    }
    retryLater(item, now, String(e.message).slice(0, 200));
    return { queued: true, why: e.message };
  }
}
function retryLater(item, now, why) {
  const n = item.attempts + 1;
  save(item.id, { status: 'queued', attempts: n, error: why, nextAt: iso(now + WAITS[Math.min(n - 1, WAITS.length - 1)]) });
}
function save(id, patch) { change(all => { const m = all.find(x => x.id === id); if (m) Object.assign(m, patch); }); }

// Sends what's due. A message held while its switch was off goes when it's back on.
let draining = false;
export async function drain(now = Date.now()) {
  if (draining) return { sent: 0 };
  draining = true;
  let sent = 0, expired = 0;
  try {
    // Nothing waiting: nothing to write.
    if (!list().some(m => ['queued', 'held'].includes(m.status) || (m.status === 'sending' && now - Date.parse(m.sendingAt || m.createdAt) > 120000))) return { sent: 0, expired: 0 };
    const due = change(all => {
      const out = [];
      for (const m of all) {
        // Caught mid-send by a restart (or a send that never came back): waiting again after two minutes.
        if (m.status === 'sending' && now - Date.parse(m.sendingAt || m.createdAt) > 120000) { m.status = 'queued'; m.nextAt = iso(now); }
        if (!['queued', 'held'].includes(m.status)) continue;
        if (now > Date.parse(m.expiresAt)) { m.status = 'expired'; m.endedAt = iso(now); expired++; continue; }
        if (m.status === 'held' && !switchedOn(m)) continue;
        if (m.status === 'queued' && Date.parse(m.nextAt) > now) continue;
        m.status = 'sending'; m.sendingAt = iso(now); out.push({ ...m });
      }
      prune(all, now);
      return out;
    });
    for (const m of due) {
      try { const r = await attempt(m, now); if (r.sent) sent++; }
      catch (e) { if (m.kind === 'email') notify({ level: 'warning', kind: 'email', title: 'An email didn’t send', text: `${m.payload?.subject || 'An email'} → ${m.payload?.to || ''}: ${e.message}`, did: 'Stopped trying: the email service refused it for good (not an outage).', run: 'Check the address with the agent, or send the link from Admin by hand.' }, now); }
    }
    if (expired) notify({ level: 'warning', kind: 'email', title: `${expired} message${expired === 1 ? '' : 's'} couldn’t be sent in time`, text: 'Emails or notifications waited for their service until they were too old to be useful.', did: 'Kept trying for 3 days (emails) or 15 minutes (notifications), then stopped; they’re listed in Admin → Switchboard → Outbox.', run: 'If they mattered (an invite, a reset link), send them again from Admin.' }, now);
  } finally { draining = false; }
  return { sent, expired };
}
// After a restart: anything caught mid-send goes back to waiting (it may have gone out: the provider's
// own dedupe, and the one-time key here, keep it to once in almost every case).
// (Only ones stuck for two minutes: a separate worker may be sending one right now.)
export function recover(now = Date.now()) { change(all => { for (const m of all) if (m.status === 'sending' && now - Date.parse(m.sendingAt || m.createdAt) > 120000) { m.status = 'queued'; m.nextAt = iso(now); } }); }
export const summary = () => { const all = list(); const by = s => all.filter(m => m.status === s).length; return { waiting: by('queued') + by('held') + by('sending'), sent: by('sent'), failed: by('failed'), expired: by('expired'), recent: all.slice(-20).reverse().map(m => ({ id: m.id, kind: m.kind, status: m.status, to: m.payload?.to || '', subject: m.payload?.subject || m.payload?.message?.title || '', at: m.sentAt || m.endedAt || m.createdAt, error: m.error || '' })) }; };

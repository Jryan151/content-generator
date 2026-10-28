// lib/breaker.js — a breaker for each outside service, like the one on each circuit in a house.
//
// When a service keeps failing (it's down or overloaded, not "your request was wrong"), its breaker
// opens: for a while nothing calls it, so a dead service isn't hammered and work doesn't stall waiting
// on timeouts. The app runs on what's left (lib/ai.js moves to another company, footage comes from the
// other stock site or the agent's own clips, posts wait). After a cool-down one trial call is let
// through: if it works, the breaker closes; if not, it stays open for longer (up to 15 minutes).
//
//   allow(service)            may this service be called now?
//   success(service) / failure(service, error)   what happened (only outage-type failures count)
//   status()                  every breaker, for Admin and the portal's plain status line
//
// State changes are written to data/breakers.json, so a separate video worker and the website see the
// same breakers (each still counts its own calls).
import path from 'path';
import { DIRS, readJSON, updateJSON, docVersion } from './paths.js';
import { notify } from './alerts.js';
import { timed } from './flight.js';
import { count } from './gauges.js';

export const SERVICES = {
  openai: { label: 'OpenAI', affects: 'Writing and voiceovers' },
  anthropic: { label: 'Anthropic (Claude)', affects: 'Backup writing' },
  elevenlabs: { label: 'ElevenLabs', affects: 'Backup voiceovers' },
  pixabay: { label: 'Pixabay', affects: 'Stock footage' },
  pexels: { label: 'Pexels', affects: 'Stock footage' },
  instagram: { label: 'Instagram', affects: 'Posting to Instagram' },
  facebook: { label: 'Facebook', affects: 'Posting to Facebook' },
  stripe: { label: 'Stripe', affects: 'Payments' },
  email: { label: 'Email', affects: 'Emails' },
  push: { label: 'Notifications', affects: 'Phone notifications' },
};
const FILE = path.join(DIRS.data, 'breakers.json');
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const TRIP_AFTER = () => num(process.env.BREAKER_FAILURES, 5);   // failures in a row that open it
const COOL_MS = () => num(process.env.BREAKER_COOL_SECONDS, 60) * 1000;
const MAX_COOL_MS = 15 * 60000;

// The kind of failure that means the service is down (not that our request was wrong).
// (An account out of credit is a 429 too, but it isn't the service being down.)
export function isServiceFailure(e) {
  if (!e) return false;
  if (e.permanent || e.code === 'insufficient_quota' || e.code === 'config') return false;
  if (e.outage || e.timedOut || e.unknown) return true;
  if (e.name === 'TimeoutError' || (e.name === 'AbortError' && /timeout/i.test(String(e.message)))) return true;
  if (typeof e.status === 'number' && (e.status === 429 || e.status >= 500)) return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|no answer in time|didn’t answer|aborted due to timeout|TimeoutError/i.test(String(e.message || '') + ' ' + String(e.cause?.code || ''));
}

// Local counts of failures in a row; the shared part (open/closed, until when) is in breakers.json. A
// count from before the breaker last changed (in this or another process) starts again.
const fails = new Map();   // service → { n, since }
let shared = { ver: undefined, data: {} };
function read() {
  const ver = docVersion(FILE);
  if (ver !== null && ver === shared.ver) return shared.data;
  let data = {};
  try { data = readJSON(FILE, {}) || {}; } catch { data = {}; }
  shared = { ver, data };
  return data;
}
function write(service, patch) {
  try { updateJSON(FILE, {}, all => ({ ...all, [service]: { ...(all[service] || {}), ...patch } })); } catch (e) { console.error('[breaker]', e.message); }
  shared.ver = undefined;
}
const trial = new Map();   // service → time a trial call was let through (one at a time)

export function allow(service, now = Date.now()) {
  const b = read()[service];
  if (!b || b.state !== 'open') return true;
  if (now < Date.parse(b.until || 0)) return false;
  // Cooled down: one trial call at a time.
  const t = trial.get(service) || 0;
  if (now - t < 30000) return false;
  trial.set(service, now);
  return true;
}
export function success(service, now = Date.now()) {
  count(service, true, now);   // Engine bay: answered
  fails.delete(service);
  trial.delete(service);
  const b = read()[service];
  if (b?.state === 'open') {
    write(service, { state: 'closed', since: new Date(now).toISOString(), until: '', cool: 0 });
    notify({ level: 'info', kind: 'server', title: `${SERVICES[service]?.label || service} is answering again`, text: `${SERVICES[service]?.affects || 'It'} is back to normal. Anything that waited goes ahead by itself.` }, now);
  }
}
export function failure(service, e = null, now = Date.now()) {
  count(service, !!e && !isServiceFailure(e), now);   // Engine bay: a refusal still counts as answered
  const b = read()[service] || {};
  const wasTrial = b.state === 'open' && trial.has(service);
  trial.delete(service);
  // An answer that isn't "down" (a refused request) still shows the service is up.
  if (e && !isServiceFailure(e)) { if (wasTrial) success(service, now); return false; }
  // Already open: only a failed trial call keeps it open for longer; calls that were already on their
  // way when it opened change nothing.
  if (b.state === 'open' && !wasTrial) return false;
  const cur = fails.get(service);
  const n = (cur && cur.since === (b.since || '') ? cur.n : 0) + 1;
  fails.set(service, { n, since: b.since || '' });
  if (n < TRIP_AFTER() && !wasTrial) return false;
  const cool = Math.min(MAX_COOL_MS, b.state === 'open' ? (b.cool || COOL_MS()) * 2 : COOL_MS());
  const opening = b.state !== 'open';
  write(service, { state: 'open', since: opening ? new Date(now).toISOString() : b.since, until: new Date(now + cool).toISOString(), cool, last: String(e?.message || e || '').slice(0, 160) });
  if (opening) notify({ level: 'warning', kind: 'server', title: `${SERVICES[service]?.label || service} isn’t answering: paused for now`, text: `${n} failures in a row (latest: ${String(e?.message || e || 'no answer').slice(0, 140)}). ${SERVICES[service]?.affects || 'It'} runs on what's left meanwhile; it's tried again every few minutes and you're told when it's back.`, did: `Stopped calling it for now (no waiting on its timeouts); ${SERVICES[service]?.affects?.toLowerCase() || 'its work'} carries on without it or waits, and a trial call goes out every few minutes.`, run: '' }, now);
  return true;
}
// Wraps one call: refused at once while the breaker is open (as an outage), counted either way.
export async function guard(service, fn) {
  if (!allow(service)) throw Object.assign(new Error(`${SERVICES[service]?.label || service} isn’t answering right now (paused for a few minutes).`), { outage: true, retry: true, breaker: service });
  try { const out = await timed(service, fn); success(service); return out; }
  catch (e) { failure(service, e); throw e; }
}
// Gives back a trial call that was never made (nothing to send after all).
export const release = service => { trial.delete(service); };
export const isOpen = (service, now = Date.now()) => { const b = read()[service]; return b?.state === 'open' && now < Date.parse(b.until || 0) + 60000; };
export function status(now = Date.now()) {
  const all = read();
  return Object.entries(SERVICES).map(([id, s]) => ({ id, ...s, state: all[id]?.state === 'open' ? 'open' : 'closed', since: all[id]?.since || '', until: all[id]?.until || '', last: all[id]?.last || '', open: isOpen(id, now) }));
}
// For tests.
export function _reset() { fails.clear(); trial.clear(); try { updateJSON(FILE, {}, () => ({})); } catch {} shared.ver = undefined; }

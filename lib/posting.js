// lib/posting.js — the posting plan (Brand → Posting plan): on the chosen days at the chosen time (the
// agent's time zone), the oldest approved video that isn't posted or scheduled anywhere goes out to the
// chosen places: Instagram, the agent's Facebook Page, or both. Runs from both posting ticks; the
// workspace's autopostDay makes sure it acts once a day whichever runs first.
import * as store from './store.js';
import * as ig from './instagram.js';
import * as P from './platforms.js';   // the posting platforms, on their mount
import { planReady } from '../mixer-core.js';
import * as signoff from './signoff.js';

// Places in the plan that are set up on this server, connected and working for this workspace.
export function planPlaces(wsId, cfg = store.loadConfig(wsId)) {
  const want = cfg.schedule?.autopost?.platforms || ['instagram'];
  return want.filter(id => { const p = P.platform(id); if (!p?.on()) return false; const a = p.account(wsId); return a?.connected && !a.problem; });
}


// Is a plan post due now? The local date it's for (once per date, on a plan day, at or after the plan's
// time in the agent's zone), or null. `doneDay`: the date the plan last posted (workspace.autopostDay).
// On the day the clocks change, "9:00" is 9:00 on the wall clock: there's always exactly one.
export function planDue(cfg, doneDay, now = Date.now()) {
  const plan = cfg.schedule?.autopost;
  if (!plan?.on) return null;
  const c = ig.localClock(cfg.profile?.timezone || 'America/Denver', new Date(now));
  const [h, m] = String(plan.time || '09:00').split(':').map(Number);
  if (!(plan.days || []).includes(c.weekday) || c.minutes < h * 60 + m || doneDay === c.date) return null;
  return c.date;
}

export function planNext(ws, now = Date.now()) {
  const cfg = store.loadConfig(ws.id), plan = cfg.schedule?.autopost;
  const due = planDue(cfg, store.getWorkspace(ws.id)?.autopostDay, now);
  if (!due) return null;
  const c = { date: due };
  const places = planPlaces(ws.id, cfg);
  if (!places.length) return null;
  // (v15) Not one still waiting for the compliance reviewer: the plan posts what's signed off.
  const wsRec = store.getWorkspace(ws.id);
  const next = store.readVideos(ws.id).filter(v => planReady(v, plan.platforms) && !signoff.waiting(wsRec, v))
    .sort((a, b) => String(a.approval?.at || a.createdAt).localeCompare(String(b.approval?.at || b.createdAt)))[0];
  if (!next) { store.updateWorkspace(ws.id, { autopostDay: c.date }); return null; }
  // Each place on its own: one refusing (a limit, a problem) doesn't stop the other.
  let out = null;
  const errors = [];
  for (const p of places) {
    try { out = P.platform(p).schedulePost(ws.id, next.id, 'now', 'plan', now); } catch (e) { errors.push(`${p}: ${e.message}`); }
  }
  // The day is used up once something was scheduled; if every place refused, it tries again next tick.
  if (out) store.updateWorkspace(ws.id, { autopostDay: c.date });
  if (!out && errors.length) throw new Error(errors.join(' '));
  return out;
}

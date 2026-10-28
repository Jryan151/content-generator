// lib/chauffeur.js — the chauffeur who knows the agent (v15 Phase 8).
//
//   reviewHabit   when she usually reviews (learned from when she approves and rejects), so the morning's
//                 videos are ready just before, not at a fixed 1–6am
//   Away mode     "Away until Monday": nudges stop, approved videos cover the posting days while she's
//                 gone, the assistants are told, and a welcome back is waiting when she returns
//   Busy week     one tap makes what the week ahead needs and holds every "ready" notification for one:
//                 "Your week is ready: 5 videos to review in one sitting"
//   ahead         the few things that will run out in the coming weeks (Instagram, the card, facts)
//   valet         the morning report on the night's videos: what was made, what waited out an outage or
//                 tried again and still finished, what didn't (made again tonight)
import * as store from './store.js';
import { account as igAccount } from './instagram.js';
import * as desk from './desk.js';
import * as clients from './clients.js';
import * as queue from './queue.js';
import * as roles from './roles.js';
import { awayOn, backFrom } from './away.js';
import { weekAhead, planReady, insightStatus, FACT_REVIEW_DAYS } from '../mixer-core.js';
import * as signoff from './signoff.js';

export { awayOn, backFrom };
const DAY = 86400000;
const plural = (n, w, many = w + 's') => `${n} ${n === 1 ? w : many}`;
const tzOf = cfg => cfg?.profile?.timezone || 'America/Denver';

/* ---------------- Clock helpers (the agent's time zone) ---------------- */
// Local minutes past midnight, the local date and weekday of an instant.
export function clockOf(tz, t) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
  } catch { const d = new Date(t); return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() }; }
}
// The instant a local wall-clock time happens on a local date (on the day the clocks change, the first
// time it's that wall-clock time, or just after the gap).
export function instantAt(date, minutes, tz) {
  const want = Date.parse(`${date}T00:00:00Z`) + minutes * 60000;
  let t = want;
  for (let k = 0; k < 3; k++) { const c = clockOf(tz, t); const got = Date.parse(`${c.date}T00:00:00Z`) + c.minutes * 60000; if (got === want) break; t += want - got; }
  return t;
}
export const clockLabel = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

/* ---------------- When she usually reviews ---------------- */
// From the last 60 days of decisions (approved or rejected; a decision made offline counts when it was
// made): the busiest three hours of her day, and the early edge of it (when the first of them usually
// happen), rounded down to a quarter hour. Needs 5 decisions on 3 different days, with at least half of
// them in that window; otherwise there's no clear habit and the usual night window stays.
export function reviewHabit(videos, tz, now = Date.now()) {
  const times = [];
  for (const v of videos) {
    for (const t of [v.approval?.decidedOfflineAt || v.approval?.at, v.rejection?.at]) {
      const ms = Date.parse(t || '');
      if (Number.isFinite(ms) && ms <= now && now - ms < 60 * DAY) times.push(ms);
    }
  }
  if (times.length < 5) return null;
  const clocks = times.map(t => clockOf(tz, t));
  if (new Set(clocks.map(c => c.date)).size < 3) return null;
  // Around the clock: 11:40pm and 12:20am are 40 minutes apart, in the same stretch.
  const mins = clocks.map(c => c.minutes).sort((a, b) => a - b), after = (m, s) => (m - s + 1440) % 1440;
  let best = { start: 0, n: 0 };
  for (const s of mins) { const n = mins.filter(m => after(m, s) < 180).length; if (n > best.n) best = { start: s, n }; }
  if (best.n < Math.ceil(mins.length / 2)) return null;
  const inside = mins.map(m => after(m, best.start)).filter(d => d < 180).sort((a, b) => a - b);
  const early = (best.start + inside[Math.floor((inside.length - 1) * 0.2)]) % 1440;
  const minutes = Math.floor(early / 15) * 15;
  return { minutes, label: clockLabel(minutes), n: best.n, of: mins.length };
}
// When tonight's videos are made: ready 45 minutes before she usually reviews, starting early enough for
// how many there are (about 12 minutes a video with room to spare, 1½ to 5 hours). Without a habit, or
// when that would start before 12:30am (a habit in the small hours), the usual 1–6am. { start, readyBy }
// in local minutes.
export const DEFAULT_WINDOW = { start: 60, readyBy: 360, learned: false };
export function readyWindow(habit, want = 2) {
  if (!habit) return DEFAULT_WINDOW;
  const readyBy = habit.minutes - 45, lead = Math.min(300, Math.max(90, want * 12 + 30)), start = readyBy - lead;
  if (start < 30) return DEFAULT_WINDOW;
  return { start, readyBy, learned: true, usual: habit.label, readyLabel: clockLabel(readyBy) };
}
export const inWindow = (minutes, w) => minutes >= w.start && minutes < w.readyBy;

/* ---------------- Away mode ---------------- */
const MAX_AWAY_DAYS = 60;
const assistantsOf = wsId => store.listAccounts().filter(a => !a.disabled && roles.membership(a, wsId)?.role === 'assistant');
// The posting places that are set up and working for this workspace (the plan's, or Instagram).
async function placesFor(wsId, cfg) {
  const { planPlaces } = await import('./posting.js');
  const want = cfg.schedule?.autopost?.platforms?.length ? cfg.schedule.autopost.platforms : ['instagram'];
  const P = await import('./platforms.js');
  const set = want.filter(id => { const p = P.platform(id); if (!p?.on()) return false; const a = p.account(wsId); return a?.connected && !a.problem; });
  return cfg.schedule?.autopost?.on ? planPlaces(wsId, cfg) : set;
}
// How the posting days while she's away get covered. `mode`:
//   'plan'      the posting plan is on: it posts one approved video each plan day by itself
//   'schedule'  no plan, but a place is connected: approved videos are scheduled one per posting day
//               (the plan's days and time, weekdays at 9:00 if none was ever set)
//   'none'      nowhere to post from here: the summary says how to fix that
// days: [{ date, label, video: { id, hook } | null, how: 'plan' | 'scheduled' | 'will-schedule' | '' }]
export async function coverPlan(wsId, { from, until, now = Date.now() } = {}) {
  const cfg = store.loadConfig(wsId), tz = tzOf(cfg), ap = cfg.schedule?.autopost || {};
  const videos = store.readVideos(wsId), places = await placesFor(wsId, cfg);
  const mode = ap.on && ap.days?.length && places.length ? 'plan' : places.length ? 'schedule' : 'none';
  const days = (ap.days?.length ? ap.days : [1, 2, 3, 4, 5]);
  const [hh, mm] = String(ap.time || '09:00').split(':').map(Number), minutes = hh * 60 + (mm || 0);
  const hook = v => String(v.scenes?.[0]?.text || v.meta?.painPoint || '').slice(0, 100);
  // Already scheduled for a date inside the stay (by hand, or earlier): that date is covered.
  const schedOn = new Map();
  videos.forEach(v => [v.autopost, v.fbpost].filter(p => p?.status === 'scheduled').forEach(p => { const d = clockOf(tz, Date.parse(p.at)).date; if (d >= from && d <= until && !schedOn.has(d)) schedOn.set(d, v); }));
  const wsRec = store.getWorkspace(wsId);   // (v15) only signed-off videos when the reviewer signs off first
  const ready = videos.filter(v => planReady(v, places.length ? places : ['instagram']) && !signoff.waiting(wsRec, v)).sort((a, b) => String(a.approval?.at || a.createdAt).localeCompare(String(b.approval?.at || b.createdAt)));
  const out = [];
  const today = clockOf(tz, now);
  for (let d = from; d <= until; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    const past = d === today.date && today.minutes >= minutes;   // today's time has gone by
    if (schedOn.has(d)) { out.push({ date: d, label: dayLabel(d), video: { id: schedOn.get(d).id, hook: hook(schedOn.get(d)) }, how: 'scheduled' }); continue; }
    if (!days.includes(wd) || past) continue;
    const v = ready.shift();
    out.push({ date: d, label: dayLabel(d), video: v ? { id: v.id, hook: hook(v) } : null, how: v ? (mode === 'plan' ? 'plan' : mode === 'schedule' ? 'will-schedule' : '') : '' });
  }
  const covered = out.filter(x => x.video && x.how).length;
  // short: posting days not covered; empty: the ones with no approved video at all (the rest have one, but nowhere to post it from).
  return { mode, places, time: ap.time || '09:00', minutes, days: out, covered, short: out.length - covered, empty: out.filter(x => !x.video).length, approvedLeft: ready.length };
}
export function checkUntil(until, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(until || '')) || Number.isNaN(Date.parse(`${until}T12:00:00Z`))) throw Object.assign(new Error('Pick the day you’re back.'), { status: 400 });
  if (until < today) throw Object.assign(new Error('That day has already passed.'), { status: 400 });
  if (Date.parse(`${until}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) > MAX_AWAY_DAYS * DAY) throw Object.assign(new Error(`Away mode is for up to ${MAX_AWAY_DAYS} days.`), { status: 400 });
}
// Start Away mode: `until` is the last day away (the portal asks "Back on" and passes the day before).
// Schedules the approved videos when there's no plan, tells the assistants (a Desk note each), and
// returns the workspace's away record.
export async function startAway(wsId, { until, by = '', byName = '', now = Date.now(), notify = null } = {}) {
  const cfg = store.loadConfig(wsId), tz = tzOf(cfg), today = clockOf(tz, now).date;
  checkUntil(until, today);
  const plan = await coverPlan(wsId, { from: today, until, now });
  const scheduled = [];
  if (plan.mode === 'schedule') {
    const P = await import('./platforms.js');
    for (const d of plan.days.filter(x => x.how === 'will-schedule')) {
      const at = new Date(instantAt(d.date, plan.minutes, tz)).toISOString();
      let ok = false;
      for (const p of plan.places) { try { P.platform(p).schedulePost(wsId, d.video.id, at, by || 'away', now); ok = true; } catch { /* that place refused; the other may not */ } }
      if (ok) { scheduled.push(d.video.id); d.how = 'scheduled'; }
      else { d.how = ''; }
    }
  }
  const name = byName || cfg.look?.name || 'The agent';
  const backOn = addDays(until, 1);
  const covered = plan.days.filter(x => x.video && x.how).length;
  const summary = `${name} is away until ${dayLabel(backOn)}. Nothing needs approving until then; videos waiting for review will wait. ${plan.days.length ? `Posting: ${covered} of ${plural(plan.days.length, 'posting day')} covered${plan.empty ? `, ${plan.empty} with nothing approved` : ''}${plan.mode === 'none' ? ' (nothing is connected to post from)' : ''}.` : 'No posting days fall in that time.'}`;
  const told = [];
  for (const a of assistantsOf(wsId)) {
    try { desk.add(wsId, { kind: 'note', title: `${name} is away until ${dayLabel(backOn)}`, message: summary, to: a.id, by, byName: name }); told.push(a.id); } catch { /* the Desk is full: the push below still tells them */ }
  }
  const away = { from: today, until, since: new Date(now).toISOString(), by, byName: name, scheduled, told, covered, postingDays: plan.days.length, mode: plan.mode };
  store.updateWorkspace(wsId, { away });
  if (notify && told.length) notify(told, { title: `${name} is away until ${dayLabel(backOn)}`, body: summary.slice(0, 200), url: '/#/leads', tag: 'away' });
  return { away, plan };
}
// Back early (or the welcome back has been seen): ending it keeps a record for the welcome back.
export function endAway(wsId, now = Date.now()) {
  const ws = store.getWorkspace(wsId);
  if (!ws?.away) return null;
  if (!ws.away.endedAt) store.updateWorkspace(wsId, { away: { ...ws.away, endedAt: new Date(now).toISOString() } });
  return store.getWorkspace(wsId).away;
}
export function dismissWelcome(wsId, now = Date.now()) {
  const ws = store.getWorkspace(wsId);
  if (!ws?.away) return false;
  store.updateWorkspace(wsId, { away: null, awayLast: { ...ws.away, endedAt: ws.away.endedAt || new Date(now).toISOString(), welcomedAt: new Date(now).toISOString() } });
  return true;
}
// What happened while she was away: posted, clicks, new leads, what the assistants finished, and
// what's waiting now. Shown once, when she's back.
export function welcomeBack(wsId, now = Date.now()) {
  const ws = store.getWorkspace(wsId), cfg = store.loadConfig(wsId), tz = tzOf(cfg), today = clockOf(tz, now).date;
  if (!backFrom(ws, today)) return null;
  const a = ws.away, start = Date.parse(a.since), end = Date.parse(a.endedAt || '') || now;
  const inStay = t => { const ms = Date.parse(t || ''); return Number.isFinite(ms) && ms >= start && ms <= end; };
  const videos = store.readVideos(wsId);
  const posted = videos.filter(v => inStay(v.posted?.at) || inStay(v.autopost?.postedAt) || inStay(v.fbpost?.postedAt));
  const days = new Set(); for (let d = a.from; d <= (a.endedAt ? clockOf(tz, end).date : a.until); d = addDays(d, 1)) days.add(d);
  const clicks = videos.reduce((n, v) => n + Object.entries(v.clicks?.byDay || {}).filter(([d]) => days.has(d)).reduce((m, [, c]) => m + c, 0), 0);
  const leads = clients.list(wsId).filter(c => inStay(c.createdAt) && c.stage === 'lead').length;
  const done = desk.list(wsId).filter(h => inStay(h.doneAt)).length;
  const pending = videos.filter(v => v.status === 'pending').length;
  const ahead = videos.filter(v => [v.autopost, v.fbpost].some(p => p?.status === 'scheduled')).length;
  return { from: a.from, until: a.until, backEarly: !!a.endedAt && clockOf(tz, end).date <= a.until, posted: posted.length, clicks, leads, handoffsDone: done, pending, scheduledAhead: ahead };
}

/* ---------------- Busy week ---------------- */
// How many videos the week ahead still needs (the posting days with nothing ready, or the weekly goal),
// up to `max` at once.
export function busyNeed(cfg, videos, now = Date.now(), { goal = 3, max = 5, postedToday = false } = {}) {
  const w = weekAhead(cfg, videos, now, { postedToday, goal });
  return { need: Math.min(max, w.short), week: w };
}
// The batch is done when every job in it has finished (made or not). Returns the one notification to
// send, once: { made, failed } or null. `finishing`: { id, ok } for the job finishing right now (its
// status isn't saved yet when the worker asks).
export function busyFinished(wsId, finishing = null) {
  const ws = store.getWorkspace(wsId), b = ws?.busy;
  if (!b || b.notified || !b.jobs?.length) return null;
  const jobs = b.jobs.map(id => queue.getJob(id)).filter(Boolean).map(j => (finishing && j.id === finishing.id ? { ...j, status: finishing.ok ? 'done' : 'failed' } : j));
  if (jobs.some(j => j.status === 'queued' || j.status === 'running')) return null;
  // Canceled ones are neither made nor failed; a batch canceled entirely sends nothing.
  const made = jobs.filter(j => j.status === 'done').length, failed = jobs.filter(j => j.status === 'failed').length;
  store.updateWorkspace(wsId, { busy: { ...b, notified: new Date().toISOString(), made, failed } });
  return made || failed ? { made, failed } : null;
}
export const inBusyBatch = (ws, jobId) => !!ws?.busy && !ws.busy.notified && (ws.busy.jobs || []).includes(jobId);

/* ---------------- What runs out in the weeks ahead ---------------- */
// The few things that will run out in the next 6 weeks, soonest first: [{ id, what, date, days, go, action }].
// Things that look after themselves (an Instagram connection still renewing) aren't listed.
export const AHEAD_DAYS = 42;
export function ahead(wsId, { now = Date.now(), caps = [] } = {}) {
  const ws = store.getWorkspace(wsId), cfg = store.loadConfig(wsId), out = [];
  const daysTo = date => Math.ceil((Date.parse(`${date}T00:00:00Z`) - now) / DAY);
  const add = (id, what, date, go, action) => { const days = daysTo(date); if (days <= AHEAD_DAYS) out.push({ id, what, date, days, go, action }); };
  const ig = igAccount(wsId);
  if (ig.connected && ig.expiresAt && (caps.includes('post') || caps.includes('settings'))) {
    // It renews itself from 20 days out; one this close that hasn't is stuck.
    if (ig.problem) add('instagram', 'Instagram needs connecting again', new Date(now).toISOString().slice(0, 10), 'autopilot', 'Connect again in Setup → Autopilot.');
    else if (Date.parse(ig.expiresAt) - now < 15 * DAY) add('instagram', 'Your Instagram connection hasn’t renewed itself', ig.expiresAt.slice(0, 10), 'autopilot', 'Connect again in Setup → Autopilot before then.');
  }
  const card = ws?.billing?.card;
  if (card?.exp && ['active', 'trialing', 'past_due'].includes(ws.billing?.status) && caps.includes('billing')) {
    const [y, m] = card.exp.split('-').map(Number);
    add('card', `Your card ${card.brand ? `${card.brand} ` : ''}ending ${card.last4} expires`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), 'billing', 'Update it in Billing.');
  }
  // Facts confirmed long ago come due for a recheck (after that, videos stop teaching them).
  if (caps.includes('settings')) {
    const due = (cfg.story?.insights || []).filter(i => i.confirmed && i.confirmedAt && insightStatus(i, now) !== 'stale')
      .map(i => ({ i, date: new Date(Date.parse(i.confirmedAt) + FACT_REVIEW_DAYS * DAY).toISOString().slice(0, 10) }))
      .filter(x => daysTo(x.date) <= AHEAD_DAYS).sort((a, b) => a.date.localeCompare(b.date));
    if (due.length) add('facts', due.length === 1 ? 'A fact comes due for a recheck' : `${due.length} facts come due for a recheck`, due[0].date, 'library', 'Recheck them in Setup → Library → Facts, with their source.');
  }
  return out.sort((a, b) => a.days - b.days);
}

/* ---------------- The valet's morning report ---------------- */
// Last night's videos (made overnight since 6pm yesterday, her time): how many were made, and the ones
// that waited out an outage or tried again and still finished. Failures are said plainly, with what
// happens next. Null when there's nothing to report.
export function valet(wsId, { now = Date.now() } = {}) {
  const cfg = store.loadConfig(wsId), tz = tzOf(cfg), c = clockOf(tz, now);
  const since = instantAt(addDays(c.date, -1), 18 * 60, tz);
  const jobs = queue.listJobs(wsId).filter(j => j.source === 'overnight' && ['done', 'failed'].includes(j.status) && Date.parse(j.endedAt || 0) >= since);
  if (!jobs.length) return null;
  const done = jobs.filter(j => j.status === 'done'), failed = jobs.filter(j => j.status === 'failed');
  const waited = done.filter(j => (j.waits || 0) > 0), retried = done.filter(j => !(j.waits > 0) && (j.attempts || 0) > 1);
  const at = j => clockLabel(clockOf(tz, Date.parse(j.endedAt)).minutes);
  const lines = [];
  if (waited.length) lines.push(waited.length === 1 ? `One waited out a service that wasn’t answering, then finished at ${at(waited[0])}.` : `${waited.length} waited out a service that wasn’t answering, then finished.`);
  if (retried.length) lines.push(retried.length === 1 ? 'One needed a second try, and finished.' : `${retried.length} needed a second try, and finished.`);
  if (failed.length) lines.push(`${failed.length === 1 ? 'One' : failed.length} didn’t finish. ${cfg.schedule?.keepReady ? 'Tonight’s run makes up for it.' : 'Make another from Create when you like.'}`);
  return { date: c.date, made: done.length, failed: failed.length, recovered: waited.length + retried.length, text: `Overnight: ${plural(done.length, 'video')} made.${lines.length ? ` ${lines.join(' ')}` : ''}` };
}

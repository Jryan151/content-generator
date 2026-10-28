// lib/targets.js — the warning lights. Each target is a promise the app makes, measured from what it
// actually did (the flight recorder, the posting records, the outbox, the gauges):
//
//   Overnight videos ready by 7am (their time)   99%
//   Double posts                                  0 (no post left "unsure", the only way one can happen)
//   Videos made without failing                   98% (after their own retries)
//   Time to make a video (95th percentile)        15 minutes
//   Backup age                                    26 hours
//   Messages that gave up (7 days)                0
//   Days until the disk reserve                   60
//   Clock                                         within 2 seconds
//   Event-loop lag (99th percentile, worst hour)  100 ms
//
// Each gets a light: green (met), yellow (close), red (missed), or grey (not enough to measure yet).
// Every day, a red light sends one alert, written like the others: what, what was done, what's left.
import * as store from './store.js';
import * as flight from './flight.js';
import * as gauges from './gauges.js';
import * as outbox from './outbox.js';
import { lastCheck as clockCheck } from './clock.js';
import { maintenanceState, RESERVE_GB } from './scheduler.js';
import { offsiteOn } from './offsite.js';
import { notify } from './alerts.js';
import path from 'path';
import { DIRS, readJSON, writeJSON, localTime } from './paths.js';

const DAY = 86400000;
// `good(v)` → green; `near(v)` → yellow; else red. `value` null → grey.
const light = (value, good, near) => (value == null ? 'grey' : good(value) ? 'green' : near(value) ? 'yellow' : 'red');
const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function measure(now = Date.now()) {
  const runs = flight.runs();
  const tzOf = new Map();
  const tz = ws => { if (!tzOf.has(ws)) { let t = 'America/Denver'; try { t = store.loadConfig(ws).profile?.timezone || t; } catch { /* default */ } tzOf.set(ws, t); } return tzOf.get(ws); };

  // Overnight: finished (or failed for good) in the last 30 days; on time = done before 7am, local, the
  // same morning it was queued.
  const night = runs.filter(r => r.source === 'overnight' && ['done', 'failed'].includes(r.status) && now - Date.parse(r.endedAt) <= 30 * DAY);
  const onTime = night.filter(r => { if (r.status !== 'done') return false; const q = localTime(tz(r.ws), new Date(r.queuedAt || r.startedAt)), e = localTime(tz(r.ws), new Date(r.endedAt)); return e.date === q.date && e.hour < 7; }).length;
  const overnight = night.length >= 5 ? pctOf(onTime, night.length) : null;

  // Posts in doubt in the last 30 days (Instagram "unsure"): each one could be a double post.
  let unsure = 0, caught = 0;
  for (const ws of store.listWorkspaces()) {
    try {
      for (const v of store.readVideos(ws.id)) {
        const ap = v.autopost;
        if (ap?.status === 'unsure' && now - Date.parse(ap.unsureAt || v.updatedAt || 0) <= 30 * DAY) unsure++;
        if (ap?.note && /already on Instagram/i.test(ap.note) && now - Date.parse(ap.postedAt || 0) <= 30 * DAY) caught++;
      }
    } catch { /* an unreadable workspace is reported elsewhere */ }
  }

  const st = flight.stats({ since: now - 7 * DAY, list: runs });
  const finished = st.done + st.failed;
  const success = finished >= 5 ? pctOf(st.done, finished) : null;
  const p95min = st.done >= 5 && st.total.p95 != null ? Math.round((st.total.p95 / 60) * 10) / 10 : null;

  const m = maintenanceState();
  const backupH = m.backupAt ? Math.round(((now - Date.parse(m.backupAt)) / 3600000) * 10) / 10 : null;
  const restoreD = offsiteOn() && m.restoreTestAt ? Math.round(((now - Date.parse(m.restoreTestAt)) / DAY) * 10) / 10 : null;

  const gaveUp = outbox.list().filter(x => ['expired'].includes(x.status) && now - Date.parse(x.endedAt || x.createdAt) <= 7 * DAY).length;
  const disk = gauges.diskTrend(RESERVE_GB(), now);
  const clock = clockCheck();
  const peaks = gauges.processPeaks(24, now);
  const lag = Object.values(peaks).reduce((a, p) => (p.lagP99 == null ? a : Math.max(a ?? 0, p.lagP99)), null);

  return [
    { id: 'overnight', label: 'Overnight videos ready by 7am', goal: '99%', value: overnight, unit: '%', light: light(overnight, v => v >= 99, v => v >= 95), detail: night.length ? `${onTime} of ${night.length} in 30 days` : 'Not enough overnight videos yet' },
    { id: 'doublePosts', label: 'Double posts', goal: '0', value: unsure, unit: '', light: light(unsure, v => v === 0, () => false), detail: `${unsure} post${unsure === 1 ? '' : 's'} left “unsure” in 30 days${caught ? `; ${caught} repeat${caught === 1 ? '' : 's'} caught before posting` : ''}` },
    { id: 'success', label: 'Videos made without failing', goal: '98%', value: success, unit: '%', light: light(success, v => v >= 98, v => v >= 95), detail: finished ? `${st.done} of ${finished} in 7 days` : 'No videos in 7 days' },
    { id: 'speed', label: 'Time to make a video (95% within)', goal: '15 min', value: p95min, unit: ' min', light: light(p95min, v => v <= 15, v => v <= 25), detail: st.total.p50 != null ? `typical ${Math.round(st.total.p50 / 6) / 10} min` : '' },
    { id: 'backup', label: 'Backup age', goal: '26 h', value: backupH, unit: ' h', light: light(backupH, v => v <= 26, v => v <= 36), detail: m.backupFile || 'No backup yet' },
    ...(offsiteOn() ? [{ id: 'restore', label: 'Last restore test', goal: '8 days', value: restoreD, unit: ' days', light: light(restoreD, v => v <= 8, v => v <= 14), detail: m.restoreTestError ? `Failed: ${m.restoreTestError}` : '' }] : []),
    { id: 'outbox', label: 'Messages that gave up (7 days)', goal: '0', value: gaveUp, unit: '', light: light(gaveUp, v => v === 0, v => v <= 2), detail: 'Emails and notifications that waited past their expiry' },
    { id: 'disk', label: 'Days until the disk is full', goal: '60 days', value: disk.daysLeft, unit: ' days', light: disk.days < 3 ? 'grey' : disk.daysLeft == null ? 'green' : light(disk.daysLeft, v => v >= 60, v => v >= 14), detail: disk.perDay == null ? 'Measuring (a few days needed)' : disk.perDay < 0 ? `${Math.abs(disk.perDay)} GB a day used` : 'Not filling up' },
    // (A failed check keeps the last reading: a clock known to be off stays red until it's checked again.)
    { id: 'clock', label: 'Clock', goal: '±2 s', value: clock?.skewMs != null ? Math.round(Math.abs(clock.skewMs) / 100) / 10 : null, unit: ' s', light: clock?.skewMs != null ? light(clock.off ?? Math.abs(clock.skewMs), v => v <= 2000, v => v <= 10000) : 'grey', detail: [clock?.skewMs != null ? `checked against ${clock.source}` : 'Checked daily', clock?.error ? `the last check failed: ${clock.error}` : ''].filter(Boolean).join('; ') },
    { id: 'lag', label: 'Event-loop lag (worst hour)', goal: '100 ms', value: lag, unit: ' ms', light: light(lag, v => v <= 100, v => v <= 500), detail: 'How long a request can wait behind other work' },
  ];
}

const FIX = {
  overnight: { did: 'Videos that missed 7am were still made, just later.', run: 'Admin → Engine bay shows which step is slow. Add a worker (SETUP.md section AL) or a bigger server.' },
  doublePosts: { did: 'Each one was stopped and marked “unsure” instead of posted again.', run: 'Check those posts on Instagram (the agent sees them in Review).' },
  success: { did: 'Each failure was retried, and outages waited out, before it was counted.', run: 'Admin → Engine bay → recent runs shows where they fail; pm2 logs generator --lines 200' },
  speed: { did: 'Nothing: slow videos still finish.', run: 'Admin → Engine bay shows which step and which service is slow.' },
  backup: { did: 'The backup is tried at every check.', run: 'df -h / && node admin.js backup-now' },
  restore: { did: 'The weekly restore test is tried again tomorrow.', run: 'node admin.js restore-test' },
  outbox: { did: 'They were retried until they were too old to be useful.', run: 'Admin → Switchboard → Outbox lists them; send any that mattered again.' },
  disk: { did: 'Videos pause by themselves before the disk is full; old files are cleaned nightly.', run: 'Lower KEEP_VIDEO_FILES_DAYS in .env or add disk space.' },
  clock: { did: 'Nothing: the server can’t safely set its own clock.', run: 'timedatectl set-ntp true && timedatectl status' },
  lag: { did: 'Nothing: requests were slow, not lost.', run: 'pm2 monit (check CPU); WORKER_MODE=separate moves rendering off the website (SETUP.md section AL).' },
};
// Once a day: an alert for each red light that's new or has changed. One that stays red at the same
// value is repeated once a week, not every day (its alert already said what to do).
const SENT = path.join(DIRS.data, 'targets.json');
export function checkTargets(now = Date.now()) {
  const out = measure(now), sent = readJSON(SENT, {}) || {}, next = {};
  for (const t of out.filter(x => x.light === 'red')) {
    const prev = sent[t.id];
    next[t.id] = prev && prev.value === t.value && now - Date.parse(prev.at) < 7 * DAY ? prev : { value: t.value, at: new Date(now).toISOString() };
    if (next[t.id] === prev) continue;
    notify({ level: 'warning', kind: 'server', title: `Target missed: ${t.label}`, text: `${t.value}${t.unit} (target ${t.goal}). ${t.detail}.`, ...(FIX[t.id] || { did: '', run: '' }) }, now);
  }
  try { writeJSON(SENT, next); } catch { /* told again tomorrow */ }
  return out;
}

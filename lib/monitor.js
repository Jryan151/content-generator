// lib/monitor.js — knowing something is wrong before an agent tells you.
//   health():       what /api/health reports to an uptime checker (UptimeRobot, Better Stack…):
//                   200 when everything is fine, 503 when something needs you.
//   noteError():    unexpected server errors; a burst (5 in 10 minutes) sends you an alert.
//   checkBackups(): an alert when the nightly backup (or its off-site copy) is more than a day late.
import path from 'path';
import { DIRS, readJSON, writeJSON } from './paths.js';
import { maintenanceState, freeGB } from './scheduler.js';
import { listJobs, isBusy } from './queue.js';
import { offsiteOn } from './offsite.js';
import { notify } from './alerts.js';
import { canaryOk } from './secrets.js';
import { record as changeRecord } from './changes.js';
const changesProblem = () => { try { return !!changeRecord().failed; } catch { return false; } };

const HOUR = 3600000;
const STATE = path.join(DIRS.data, 'monitor.json');
const startedAt = Date.now();
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const BACKUP_LATE_H = () => num(process.env.BACKUP_LATE_HOURS, 36);
// The watchdog (lib/queue.js) stops a job long before this; this is the alarm if the watchdog itself fails.
const STUCK_MIN = () => num(process.env.JOB_STUCK_MINUTES, num(process.env.JOB_MAX_MINUTES, 40) + 15);

/* ---------------- Health ---------------- */
// Each check is true (fine) or false (needs you). Details only go to callers with HEALTH_TOKEN.
export function health(now = Date.now()) {
  const m = maintenanceState();
  const gb = freeGB(), lowGb = num(process.env.LOW_DISK_GB, 3);
  const up = now - startedAt;
  const age = iso => (iso ? now - Date.parse(iso) : Infinity);
  const backupAge = age(m.backupAt || (m.backupDay ? `${m.backupDay}T03:00:00` : ''));
  const running = listJobs().filter(j => j.status === 'running');
  const stuck = running.filter(j => now - Date.parse(j.startedAt || j.createdAt) > STUCK_MIN() * 60000);
  const checks = {
    disk: gb == null || gb >= lowGb,
    // A new server hasn't made its first backup yet: give it the same grace period.
    backup: backupAge <= BACKUP_LATE_H() * HOUR || up < BACKUP_LATE_H() * HOUR,
    queue: stuck.length === 0,
    keys: canaryOk(),   // the encryption key matches the data (lib/secrets.js)
    changes: !changesProblem(),   // every numbered data change ran (lib/changes.js)
  };
  if (offsiteOn()) checks.offsite = !m.offsiteError && (age(m.offsiteAt) <= BACKUP_LATE_H() * HOUR || up < BACKUP_LATE_H() * HOUR);
  const ok = Object.values(checks).every(Boolean);
  const detail = {
    freeGB: gb, lastBackup: m.backupAt || m.backupDay || '', lastOffsite: m.offsiteAt || '', offsiteError: m.offsiteError || '',
    lastRestoreTest: m.restoreTestAt || '', restoreTestError: m.restoreTestError || '',
    queue: { waiting: listJobs().filter(j => j.status === 'queued').length, running: running.length, busy: isBusy(), stuck: stuck.map(j => j.id) },
    uptimeMinutes: Math.round(up / 60000), errors: recentErrors(now).length,
  };
  return { ok, checks, detail };
}

/* ---------------- Error bursts ---------------- */
const errors = [];
const WINDOW = 10 * 60000;
const recentErrors = (now = Date.now()) => errors.filter(e => now - e.at < WINDOW);
let lastBurstAlert = 0;
// Called for every unexpected error (a bug or an outage, not a user mistake).
export function noteError(err, where = '', now = Date.now()) {
  errors.push({ at: now, msg: String(err?.message || err).slice(0, 200), where });
  while (errors.length && now - errors[0].at > WINDOW) errors.shift();
  const burst = num(process.env.ERROR_BURST, 5);
  if (errors.length >= burst && now - lastBurstAlert > 30 * 60000) {
    lastBurstAlert = now;
    const last = errors[errors.length - 1];
    notify({ level: 'error', kind: 'server', title: 'The server is throwing errors', text: `${errors.length} unexpected errors in the last 10 minutes. Latest${last.where ? ` (${last.where})` : ''}: ${last.msg}.`, did: 'Kept serving; agents saw a plain “try again” message. You won’t be told again for 30 minutes.', run: 'pm2 logs generator --lines 100' }, now);
    return true;
  }
  return false;
}
export const _resetErrors = () => { errors.length = 0; lastBurstAlert = 0; };

/* ---------------- Late backups ---------------- */
// Runs every 10 minutes from the scheduler; alerts at most once a day for each problem.
export function checkBackups(now = Date.now()) {
  const h = health(now), st = readJSON(STATE, {}), day = new Date(now).toISOString().slice(0, 10), sent = [];
  const alert = (key, a) => {
    if (st[key] === day) return;
    st[key] = day; sent.push(key);
    notify({ level: 'error', kind: 'server', ...a }, now);
  };
  if (!h.checks.backup) alert('backupLate', { title: 'The nightly backup is late', text: `The last backup was ${h.detail.lastBackup || 'never'}.`, did: 'Kept the earlier backups; the nightly backup is tried at every check.', run: 'df -h / && node admin.js backup-now' });
  if (h.checks.offsite === false) alert('offsiteLate', { title: 'The off-site backup is late', text: h.detail.offsiteError ? `The last upload failed: ${h.detail.offsiteError}` : `The last off-site upload was ${h.detail.lastOffsite || 'never'}.`, did: 'Kept the backups on the server (backups/); the upload is tried again tomorrow night.', run: 'node admin.js backup-now' });
  if (!h.checks.queue) alert('queueStuck', { title: 'A video has been rendering for too long', text: `Job ${h.detail.queue.stuck.join(', ')} has run more than ${STUCK_MIN()} minutes, and the watchdog that stops stuck jobs didn’t.`, did: 'Nothing (this is the alarm for when the watchdog itself fails).', run: 'pm2 restart generator (the job goes back in line and resumes from its last finished step)' });
  if (sent.length) writeJSON(STATE, st);
  return sent;
}

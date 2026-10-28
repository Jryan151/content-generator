// lib/scheduler.js — the jobs that run on their own:
//   Overnight keep-ready: between 1 and 6am in each agent's time zone, tops up the review queue.
//   Daily cleanup (about 3am server time): old rejected/stale videos, old video files, caches.
//   Nightly backup: a small archive of data/ (accounts, settings, records) in backups/, 14 kept.
import fs from 'fs';
import path from 'path';
import { runProc } from './proc.js';
import { isOn } from './switches.js';
import { DIRS, readJSON, writeJSON, localTime, dayKey, storageEngine, snapshotDb, SNAPSHOT_FILE } from './paths.js';
import * as store from './store.js';
import { prune, listJobs } from './queue.js';
import { notify } from './alerts.js';
import { prune as pruneAudit } from './audit.js';
import { prune as pruneAccess } from './access.js';
import * as offsite from './offsite.js';
import { reviewHabit, readyWindow, inWindow, clockOf } from './chauffeur.js';
import { awayOn } from './away.js';
import * as keepsakes from './keepsakes.js';

const STATE = path.join(DIRS.data, 'maintenance.json');
const days = n => n * 86400000;
const env = process.env;
export const KEEP = {
  rejected: Number(env.KEEP_REJECTED_DAYS || 14),     // rejected videos (file and record)
  pending: Number(env.KEEP_PENDING_DAYS || 30),       // never-reviewed videos (file and record)
  files: Number(env.KEEP_VIDEO_FILES_DAYS || 90),     // approved/posted video files; the record stays
  assets: Number(env.KEEP_ASSETS_DAYS || 30),         // what "fix a scene" needs
  backups: Number(env.KEEP_BACKUPS || 14),
};

/* ---------------- Overnight keep-ready ---------------- */
// `enqueueVideos(wsId, n, source)` is the server's own enqueue (checks plan and limits).
// When: ready just before the agent usually reviews (v15: learned from when she approves and rejects,
// lib/chauffeur.js), or 1–6am her time until there's a clear habit. Not while she's away (the last night
// away still runs, so fresh videos are waiting the morning she's back).
export function keepReady(enqueueVideos, now = new Date()) {
  const made = [];
  for (const ws of store.listWorkspaces()) { try {
    // (Switched off: skipped without using up tonight, so it runs when it's back on.)
    if (!ws.onboarded || ws.suspended || !isOn('overnight', ws) || !isOn('videos', ws)) continue;
    const cfg = store.loadConfig(ws.id);
    const want = cfg.schedule?.keepReady || 0;
    if (!want) continue;
    const tz = cfg.profile?.timezone || 'America/Denver', { date, minutes } = clockOf(tz, now.getTime());
    if (ws.keepReadyDay === date || awayOn(ws, date)) continue;
    const videos = store.readVideos(ws.id);
    if (!inWindow(minutes, readyWindow(reviewHabit(videos, tz, now.getTime()), want))) continue;
    store.updateWorkspace(ws.id, { keepReadyDay: date });
    const pending = videos.filter(v => v.status === 'pending').length;
    const n = Math.max(0, want - pending);
    if (!n) continue;
    try { const jobs = enqueueVideos(ws.id, n, 'overnight'); made.push({ ws: ws.id, n: jobs.length }); }
    catch (e) { made.push({ ws: ws.id, n: 0, error: e.message }); }
  } catch (e) { store.skipWorkspace(ws, e, 'overnight'); } }
  return made;
}

/* ---------------- Cleanup ---------------- */
function rmOld(dir, maxAgeMs, now) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { recursive: true, force: true }); n++; } } catch {}
  }
  return n;
}

export function cleanup(now = Date.now()) {
  const report = { videos: 0, files: 0, assets: 0, cache: 0 };
  for (const ws of store.listWorkspaces()) { try {
    // Collected first, then one save per workspace (years of videos: one write, not hundreds).
    const remove = [], expire = [];
    for (const v of store.readVideos(ws.id)) {
      const age = now - Date.parse(v.updatedAt || v.createdAt);
      if ((v.status === 'rejected' && age > days(KEEP.rejected)) || (v.status === 'pending' && age > days(KEEP.pending))) remove.push(v.id);
      else if (['approved', 'posted'].includes(v.status) && !v.fileDeleted && now - Date.parse(v.approval?.at || v.updatedAt || v.createdAt) > days(KEEP.files)) expire.push(v);
    }
    report.videos += store.removeVideos(ws.id, remove).length;
    report.keepsakes = (report.keepsakes || 0) + keepsakes.prune(ws.id, now);   // private client videos, after 60 days
    // The record says "file removed" first; then the files go.
    store.updateVideos(ws.id, expire.map(v => v.id), { fileDeleted: true });
    for (const v of expire) store.removeVideoFiles(ws.id, v);
    report.files += expire.length;
    // Finished videos over a year old move to their year's archive (lib/store.js).
    report.archived = (report.archived || 0) + store.archiveOld(ws.id, now);
    report.assets += rmOld(path.join(DIRS.assets, ws.id), days(KEEP.assets), now);
  } catch (e) { store.skipWorkspace(ws, e, 'cleanup'); } }
  report.cache += rmOld(path.join(DIRS.cache, 'pixabay'), days(1), now);
  report.cache += rmOld(path.join(DIRS.cache, 'clips'), days(1), now);
  rmOld(DIRS.work, days(1), now);
  prune();
  report.audit = pruneAudit(new Date(now));   // audit months older than AUDIT_KEEP_MONTHS
  report.access = pruneAccess(now);           // handled access requests older than ACCESS_KEEP_DAYS
  return report;
}

/* ---------------- Backup ---------------- */
// With SQLite, a consistent copy of the database goes in as app-snapshot.db (the live app.db
// and its -wal/-shm files are left out: copying them mid-write could catch them half-changed).
// `out`: write the archive there instead of the nightly name (the pre-update backup); old nightly
// archives are only pruned for a nightly backup.
export async function backup(now = new Date(), { out = null } = {}) {
  const sqlite = storageEngine() === 'sqlite';
  if (sqlite) snapshotDb(SNAPSHOT_FILE);
  const file = out || path.join(DIRS.backups, `data-${dayKey(now)}.tar.gz`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let r;
  try {
    r = await runProc('tar', ['-czf', file, '--exclude=./cache', '--exclude=./work', '--exclude=./assets', '--exclude=./damaged', '--exclude=./app.db', '--exclude=./app.db-wal', '--exclude=./app.db-shm', '-C', DIRS.data, '.'], { timeoutMs: 15 * 60000, signal: null });
  } finally { if (sqlite) fs.rmSync(SNAPSHOT_FILE, { force: true }); }
  // tar exits 1 when a file changed while reading it; the archive is still usable.
  if (r.code !== 0 && r.code !== 1) throw new Error('Backup failed: ' + String(r.stderr).slice(-300));
  if (!out) fs.readdirSync(DIRS.backups).filter(n => /^data-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(n)).sort().reverse()
    .slice(KEEP.backups).forEach(n => fs.rmSync(path.join(DIRS.backups, n), { force: true }));
  return file;
}

export const maintenanceState = () => readJSON(STATE, {});
export const saveMaintenance = patch => writeJSON(STATE, { ...maintenanceState(), ...patch });

// After the nightly backup: an encrypted copy goes off-site, and once a week the newest off-site copy
// is downloaded, decrypted and checked (a backup you've never restored isn't a backup).
export async function offsiteJobs(file, log = console.log, now = new Date()) {
  if (!offsite.offsiteOn()) return null;
  const out = {};
  try {
    const r = await offsite.upload(file);
    writeJSON(STATE, { ...maintenanceState(), offsiteAt: now.toISOString(), offsiteKey: r.key, offsiteError: '' });
    log(`[offsite] uploaded ${r.key} (${Math.round(r.bytes / 1024)} KB)${r.removed ? `, removed ${r.removed} old` : ''}`);
    out.upload = r;
  } catch (e) {
    writeJSON(STATE, { ...maintenanceState(), offsiteError: e.message, offsiteErrorAt: now.toISOString() });
    notify({ level: 'error', kind: 'server', title: 'The off-site backup didn’t upload', text: e.message, did: 'Kept tonight’s backup on the server (backups/); the upload is tried again tomorrow night.', run: 'Check BACKUP_S3_* in .env, then: node admin.js backup-now' });
    out.uploadError = e.message;
    return out;
  }
  const last = maintenanceState().restoreTestAt;
  if (!last || now - Date.parse(last) > days(6.5)) {
    try {
      const r = await offsite.restoreTest();
      writeJSON(STATE, { ...maintenanceState(), restoreTestAt: now.toISOString(), restoreTest: r, restoreTestError: '' });
      log(`[offsite] restore test passed: ${r.accounts} logins, ${r.workspaces} workspaces, ${r.videos} videos`);
      out.restoreTest = r;
    } catch (e) {
      writeJSON(STATE, { ...maintenanceState(), restoreTestError: e.message, restoreTestErrorAt: now.toISOString() });   // tried again tomorrow
      notify({ level: 'error', kind: 'server', title: 'The weekly backup restore test failed', text: e.message, did: 'Kept the backups as they are; the test is tried again tomorrow.', run: 'Check BACKUP_KEY and the bucket, then: node admin.js restore-test' });
      out.restoreTestError = e.message;
    }
  }
  return out;
}

// Free disk space where videos are written, in GB (null if the system can't say).
export function freeGB() {
  try { const s = fs.statfsSync(DIRS.videos); return Math.round((s.bavail * s.bsize) / 1e8) / 10; } catch { return null; }
}
const LOW_DISK_GB = Number(env.LOW_DISK_GB || 3);

/* ---------------- The disk reserve ---------------- */
// Below DISK_RESERVE_GB (default 1.5) no new video starts: the room left is kept for saving logins,
// settings and approvals, which must never fail for lack of space. Caches and old work folders are
// cleared at once (they're made again when needed), and you're alerted.
export const RESERVE_GB = () => (Number(env.DISK_RESERVE_GB) >= 0 && env.DISK_RESERVE_GB !== undefined && env.DISK_RESERVE_GB !== '' ? Number(env.DISK_RESERVE_GB) : 1.5);
let lastEmergency = 0;
// Search results go at once; downloaded clips and work folders from the last hour stay (a video being
// made may be using them), as do the saved stages of videos in line.
export function emergencyCleanup(now = Date.now()) {
  const freed = { cache: 0, work: 0 };
  for (const d of ['pixabay', 'pexels']) freed.cache += rmOld(path.join(DIRS.cache, d), 0, now);
  freed.cache += rmOld(path.join(DIRS.cache, 'clips'), 3600000, now);
  const inLine = new Set(listJobs().filter(j => j.status === 'queued' || j.status === 'running').map(j => `job-${j.id}`));
  if (fs.existsSync(DIRS.work)) {
    for (const n of fs.readdirSync(DIRS.work)) {
      if (inLine.has(n)) continue;
      const p = path.join(DIRS.work, n);
      try { if (now - fs.statSync(p).mtimeMs > 3600000) { fs.rmSync(p, { recursive: true, force: true }); freed.work++; } } catch { /* gone */ }
    }
  }
  return freed;
}
export function diskGate(now = Date.now(), free = freeGB) {
  const gb = free();
  if (gb == null || gb >= RESERVE_GB()) return { ok: true };
  if (now - lastEmergency > 10 * 60000) {
    lastEmergency = now;
    const freed = emergencyCleanup(now);
    notify({ level: 'error', kind: 'server', title: 'The server is nearly out of disk space: new videos are paused', text: `${gb} GB free (videos pause below ${RESERVE_GB()} GB, so logins and approvals can always be saved).`, did: `Paused new videos and cleared ${freed.cache} cached item(s) and ${freed.work} old work folder(s). Videos start again by themselves when there’s room.`, run: 'Free space (df -h /, du -sh /root/generator/videos /root/generator/backups) or lower KEEP_VIDEO_FILES_DAYS in .env.' }, now);
    const after = free();
    if (after != null && after >= RESERVE_GB()) return { ok: true };
  }
  return { ok: false, why: 'Paused: the server is nearly out of disk space. It starts again by itself.' };
}

/* ---------------- Night capacity ---------------- */
// Will tonight's overnight videos fit between 1 and 6am? Each agent's top-up, times how long a video
// takes here (the median of recent ones), against the five-hour window and the number of workers.
export function nightCapacity({ jobs = [], workers = Math.max(1, Number(env.WORKERS) || 1) * Math.max(1, Math.min(4, Math.round(Number(env.WORKER_JOBS) || 1))) } = {}) {
  let videos = 0;
  for (const ws of store.listWorkspaces()) {
    if (!ws.onboarded || ws.suspended) continue;
    try {
      const want = store.loadConfig(ws.id).schedule?.keepReady || 0;
      if (want) videos += Math.min(6, Math.max(0, want - store.videoCounts(ws.id).pending));
    } catch { /* skipped; it's reported elsewhere */ }
  }
  const took = jobs.filter(j => j.status === 'done' && j.kind !== 'fix' && j.startedAt && j.endedAt).slice(-30).map(j => (Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000).filter(x => x > 0).sort((a, b) => a - b);
  const each = took.length >= 3 ? took[Math.floor(took.length / 2)] : 240;
  const hours = Math.round(((videos * each) / 3600 / workers) * 10) / 10;
  return { videos, minutesEach: Math.round((each / 60) * 10) / 10, hours, window: 5, workers, tight: hours > 4 };
}

// Runs every 10 minutes. Daily jobs run once a day, around 3am server time (or if a day was missed).
// `extra.minute` runs every minute (Instagram posting); `extra.daily` once a day (token refresh);
// `extra.tick` every 10 minutes (emails that go out at a local time: trial ending, weekly review reminder).
// `extra.afterBackup` once a night, after the backup (the reference render).
export function startScheduler(enqueueVideos, log = console.log, extra = {}) {
  let ticking = false;
  const tick = async () => {
    // A tick still running (a long night: cleanup, checks, backup) isn't started twice: two backups
    // at once would fight over the same archive.
    if (ticking) return;
    ticking = true;
    try {
      keepReady(enqueueVideos).filter(m => m.n || m.error).forEach(m => log(`[overnight] ${m.ws}: ${m.error || `queued ${m.n} video(s)`}`));
      if (extra.tick) await Promise.resolve(extra.tick()).catch(e => log('[tick] ' + (e.message || e)));
      const st = maintenanceState(), today = dayKey(), hour = new Date().getHours();
      const due = last => last !== today && (hour === 3 || !last || Date.now() - Date.parse(last) > days(1.5));
      if (due(st.cleanupDay)) {
        const r = cleanup(); writeJSON(STATE, { ...maintenanceState(), cleanupDay: today, cleanup: r }); log(`[cleanup] ${JSON.stringify(r)}`);
        const gb = freeGB();
        if (gb != null && gb < LOW_DISK_GB) notify({ level: 'warning', kind: 'server', title: 'The server is low on disk space', text: `${gb} GB free.`, did: 'Ran tonight’s cleanup (old video files, caches); new videos pause by themselves before the disk is full.', run: 'If it keeps dropping, lower KEEP_VIDEO_FILES_DAYS in .env or add disk space (Admin → Engine bay shows the trend).' });
        if (extra.daily) await Promise.resolve(extra.daily()).catch(e => log('[daily] ' + e.message));
      }
      if (due(st.backupDay)) {
        let f;
        try { f = await backup(); writeJSON(STATE, { ...maintenanceState(), backupDay: today, backupFile: path.basename(f), backupAt: new Date().toISOString() }); log(`[backup] ${f}`); }
        catch (e) { notify({ level: 'error', kind: 'server', title: 'Last night’s backup failed', text: e.message, did: 'Kept the earlier backups; it’s tried again at the next check.', run: 'df -h / && node admin.js backup-now' }); throw e; }
        await offsiteJobs(f, log);
        if (extra.afterBackup) await Promise.resolve(extra.afterBackup()).catch(e => log('[after backup] ' + e.message));
      }
    } catch (e) { log('[scheduler] ' + (e.message || e)); } finally { ticking = false; }
  };
  setTimeout(tick, 30000);
  const timers = [setInterval(tick, 10 * 60000)];
  if (extra.minute) {
    let running = false;
    timers.push(setInterval(async () => {
      if (running) return;
      running = true;
      try { await extra.minute(); } catch (e) { log('[minute] ' + (e.message || e)); } finally { running = false; }
    }, 60000));
  }
  return timers[0];
}

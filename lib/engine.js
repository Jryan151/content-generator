// lib/engine.js — Admin → Engine bay: everything about how the engine is running, on one page.
//   The line          what's waiting, running and held, and each step's time (median and 95%)
//   Outside services  each breaker, and how often each service answered in the last 24 hours
//   Processes         memory and event-loop lag, now and the worst hour today
//   Disk and backups  free space, the trend and when it would be full, the last backup and restore test
//   Targets           the warning lights (lib/targets.js)
//   Recent runs       the last videos made, with their step times (each one's full timeline on tap)
import { spawnSync } from 'child_process';
import { listJobs, getJob, runningNow } from './queue.js';
import * as flight from './flight.js';
import * as gauges from './gauges.js';
import * as breaker from './breaker.js';
import { measure as targets } from './targets.js';
import { lastCheck as clockCheck } from './clock.js';
import { maintenanceState, freeGB, RESERVE_GB } from './scheduler.js';
import { storageEngine } from './paths.js';
import { calendar } from './expiry.js';

let ffmpegVersion = null;
const ffVersion = () => {
  if (ffmpegVersion === null) { try { ffmpegVersion = (/ffmpeg version (\S+)/.exec(spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 }).stdout || '') || [])[1] || ''; } catch { ffmpegVersion = ''; } }
  return ffmpegVersion;
};

export function engineBay(now = Date.now()) {
  const jobs = listJobs();
  const by = s => jobs.filter(j => j.status === s);
  const queued = by('queued');
  const runs = flight.runs();
  const st = flight.stats({ since: now - 7 * 86400000, list: runs });
  const totals = gauges.serviceTotals(24, now);
  const services = breaker.status(now).map(b => ({ ...b, day: totals[b.id] || { ok: 0, failed: 0 }, inJobs: st.services[b.id] || null }));
  // Programs and services that only show up in jobs (FFmpeg, ffprobe).
  for (const [k, v] of Object.entries(st.services)) if (!services.some(s => s.id === k)) services.push({ id: k, label: k, affects: 'Used while making videos', state: 'closed', open: false, day: null, inJobs: v });
  const disk = { freeGB: freeGB(), reserveGB: RESERVE_GB(), ...gauges.diskTrend(RESERVE_GB(), now) };
  const m = maintenanceState();
  const here = gauges.sample(now, { reset: false });
  return {
    at: new Date(now).toISOString(),
    line: {
      waiting: queued.filter(j => !j.notBefore && !j.waitReason).length,
      waitingOutage: queued.filter(j => j.notBefore).length,
      held: queued.filter(j => !j.notBefore && j.waitReason).length,
      running: by('running').map(j => ({ id: j.id, ws: j.ws, kind: j.kind, source: j.source, startedAt: j.startedAt, last: (j.log || []).at(-1) || '', worker: j.lease?.worker || '' })),
      here: runningNow(),
      failed24h: jobs.filter(j => j.status === 'failed' && now - Date.parse(j.endedAt || j.createdAt) < 86400000).length,
      week: st,
    },
    services,
    processes: { ...gauges.processPeaks(24, now), here: { ...here, role: 'this process' } },
    disk,
    backups: { at: m.backupAt || '', file: m.backupFile || '', offsiteAt: m.offsiteAt || '', offsiteError: m.offsiteError || '', restoreTestAt: m.restoreTestAt || '', restoreTestError: m.restoreTestError || '', inspection: m.inspection ? { at: m.inspection.at, fixed: (m.inspection.fixed || []).length, problems: (m.inspection.problems || []).length } : null, reference: m.reference || null },
    targets: targets(now),
    calendar: calendar(now),
    clock: clockCheck(),
    build: { node: process.version, ffmpeg: ffVersion(), storage: storageEngine(), workerMode: /^separate$/i.test(String(process.env.WORKER_MODE || '')) ? 'separate' : 'here' },
    recent: runs.slice(-15).reverse().map(r => ({ id: r.id, attempt: r.attempt || 1, ws: r.ws, kind: r.kind, source: r.source, status: r.status, endedAt: r.endedAt, ms: r.ms, steps: r.steps, error: r.error || '' })),
  };
}
// One job's flight timelines (one per run; the newest 300 runs are kept).
export function jobTimeline(id) {
  const runs = flight.timelinesOf(id), j = getJob(id);
  if (!runs.length && !j) return null;
  const last = runs.at(-1) || null;
  return { id, ws: j?.ws || '', kind: j?.kind || '', source: j?.source || '', status: j?.status || last?.status || '', attempts: j?.attempts || runs.length, error: j?.error || '', runs, timeline: last };
}

// lib/queue.js — the job queue. Agents take turns fairly, jobs survive a restart, a failed job gets one
// more try, and an outage is waited out.
//
// The line lives in jobs.json (one document; with SQLite, one row changed in a transaction), and a
// worker takes a job by claiming it on a lease: "mine until <time>", renewed every few seconds while it
// runs. So the worker can be this process (the default) or separate processes (worker.js, SQLite only,
// SETUP.md section AL), and:
//   - a worker that crashes or is killed loses its lease, and the job goes back in line by itself;
//   - a worker that stops cleanly (an update) hands its job back without using up a try;
//   - two workers can never run the same job.
// Each worker runs one video at a time (WORKER_JOBS to change it: renders use every CPU).
import os from 'os';
import path from 'path';
import { DIRS, readJSON, updateJSON, removeJSON, randomId, docVersion } from './paths.js';
import { jobContext, stopAll } from './proc.js';
import { startFlight, finish as finishFlight, save as saveFlight } from './flight.js';

const FILE = path.join(DIRS.data, 'jobs.json');
export const MAX_ATTEMPTS = 2;
// An outage (OpenAI or the footage sites not answering, after their own retries) doesn't use up a try:
// the job waits and goes again, every OUTAGE_WAIT_MIN minutes, up to MAX_OUTAGE_WAITS times.
export const MAX_OUTAGE_WAITS = 6;
const OUTAGE_WAIT_MIN = () => Math.max(0.01, Number(process.env.OUTAGE_WAIT_MIN) || 10);
export function isOutage(e) {
  if (!e || e.permanent || e.code === 'config' || e.code === 'insufficient_quota') return false;
  if (e.outage) return true;   // lib/openai.js marks OpenAI not answering (after its own retries)
  if (e.retry === true && (e.status === 429 || e.status >= 500)) return true;
  if (e.name === 'TimeoutError') return true;
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|no answer in time|aborted due to timeout/i.test(String(e.message || ''));
}
export const MAX_WAITING_PER_WS = 6;
const KEEP_DAYS = 7;
const KEEP_LOG = 300;

// The watchdog: a job that stops making progress (no log line and no FFmpeg output for JOB_IDLE_MINUTES),
// or runs longer than JOB_MAX_MINUTES in all, is stopped, its programs are killed, and it goes back in
// line like any other failure (one more try). Nobody has to restart the server.
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
export const IDLE_MS = () => num(process.env.JOB_IDLE_MINUTES, 12) * 60000;
export const MAX_RUN_MS = () => num(process.env.JOB_MAX_MINUTES, 40) * 60000;
const WATCH_MS = () => num(process.env.WATCHDOG_EVERY_MS, 30000);
// Leases: renewed every LEASE/4; a lease not renewed for LEASE_SECONDS means its worker is gone.
const LEASE_MS = () => num(process.env.LEASE_SECONDS, 90) * 1000;
const POLL_MS = () => num(process.env.QUEUE_POLL_MS, 2000);
const SLOTS = () => Math.max(1, Math.min(4, Math.round(num(process.env.WORKER_JOBS, 1))));
export const WORKER_ID = `${os.hostname()}:${process.pid}:${randomId('', 2)}`;
const iso = (t = Date.now()) => new Date(t).toISOString();

/* ---------------- Reading the line (cached until jobs.json changes) ---------------- */
// A damaged jobs.json that couldn't be repaired doesn't stop the server (or admin.js) from starting:
// the line reads as empty (the damaged copy is kept in data/damaged/) and the server alerts you; the
// next change to the line starts it afresh.
export let loadProblem = '';
let cache = { ver: undefined, jobs: [] };
function all() {
  const ver = docVersion(FILE);
  if (ver !== null && ver === cache.ver) return cache.jobs;
  let jobs;
  try { jobs = readJSON(FILE, []); }
  catch (e) { if (!e.damaged) throw e; loadProblem = e.message; jobs = []; }
  if (!Array.isArray(jobs)) jobs = [];
  cache = { ver, jobs };
  return jobs;
}
// Changes the line in one step (one transaction with SQLite). `fn(jobs)` changes the array in place.
function change(fn) {
  let out;
  const run = jobs => { if (!Array.isArray(jobs)) jobs = []; out = fn(jobs); return jobs; };
  try { updateJSON(FILE, [], run); }
  catch (e) {
    if (!e.damaged) throw e;
    // Unrepairable (its copy is already kept in data/damaged/): the line starts afresh.
    loadProblem = e.message;
    removeJSON(FILE);
    updateJSON(FILE, [], run);
  }
  cache.ver = undefined;
  return out;
}
const copy = j => (j ? JSON.parse(JSON.stringify(j)) : null);

export const listJobs = ws => all().filter(j => !ws || j.ws === ws);
export const getJob = id => all().find(j => j.id === id) || null;
export const waiting = ws => all().filter(j => j.ws === ws && (j.status === 'queued' || j.status === 'running'));
export const position = job => { const a = all(); return a.filter(j => j.status === 'queued' && j.createdAt < job.createdAt).length + a.filter(j => j.status === 'running').length; };

export function enqueue({ ws, kind = 'video', opts = {}, by = '', source = 'manual' }) {
  const job = { id: randomId('j', 5), ws, kind, opts, by, source, status: 'queued', attempts: 0, createdAt: iso(), log: [] };
  let full = false;
  change(jobs => {
    if (jobs.filter(j => j.ws === ws && (j.status === 'queued' || j.status === 'running')).length >= MAX_WAITING_PER_WS) { full = true; return; }
    jobs.push(job);
  });
  if (full) throw new Error(`You already have ${MAX_WAITING_PER_WS} videos in line. Wait for some to finish.`);
  if (runner) setImmediate(kick);
  return copy(job);
}

export function cancel(ws, id) {
  return !!change(jobs => {
    const j = jobs.find(x => x.id === id && x.ws === ws);
    if (!j || j.status !== 'queued') return false;
    j.status = 'canceled'; j.endedAt = iso();
    return true;
  });
}

// Cancels waiting jobs that match (the nightly inspection: workspaces that were deleted). Returns how many.
export function cancelWhere(fn) {
  return change(jobs => { let n = 0; for (const j of jobs) if (j.status === 'queued' && fn(j)) { j.status = 'canceled'; j.endedAt = iso(); n++; } return n; }) || 0;
}

const pruneIn = (jobs, now = Date.now()) => {
  const cutoff = now - KEEP_DAYS * 86400000;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (!['queued', 'running'].includes(j.status) && Date.parse(j.endedAt || j.createdAt) <= cutoff) jobs.splice(i, 1);
  }
};
export function prune() { change(jobs => pruneIn(jobs)); }

// Is this lease's worker gone? Expired, or (same machine) its process isn't running any more.
function leaseGone(j, now = Date.now()) {
  const l = j.lease;
  if (!l?.until) return true;   // running from before leases (v14): its server is gone
  // This worker's own job: gone only if it isn't running it any more (a paused machine or a clock jump
  // can make its own lease look expired while the video is still being made).
  if (l.worker === WORKER_ID) return !running.has(j.id);
  if (Date.parse(l.until) < now) return true;
  const [host, pid] = String(l.worker || '').split(':');
  if (host === os.hostname() && Number(pid) && Number(pid) !== process.pid) { try { process.kill(Number(pid), 0); } catch { return true; } }
  return false;
}
// After a restart: jobs whose worker is gone go back in line (or fail, out of tries). Also runs before
// every claim, so a separate worker's crash is noticed by the next one.
function reclaimIn(jobs, now = Date.now()) {
  const failedNow = [];
  for (const j of jobs) {
    if (j.status !== 'running' || !leaseGone(j, now)) continue;
    j.log = [...(j.log || []), 'The server restarted during this job.'].slice(-KEEP_LOG);
    delete j.lease;
    if (j.attempts < MAX_ATTEMPTS) j.status = 'queued';
    else { j.status = 'failed'; j.error = 'The server restarted during this job.'; j.endedAt = iso(now); failedNow.push(copy(j)); }
  }
  return failedNow;
}
// `failed`: what to call for a job that ran out of tries (the website calls recover() even when a
// separate worker makes the videos, so it passes its own).
export function recover({ failed = null } = {}) {
  const failedNow = change(jobs => { const f = reclaimIn(jobs); pruneIn(jobs); return f; });
  failedNow.forEach(j => { try { (failed || onFail)?.(j, new Error(j.error)); } catch {} });
}

/* ---------------- The worker ---------------- */
let runner = null, onFail = null, onStuck = null, canStart = null, canRun = null, poll = null, accepting = false;
const running = new Map();   // job id → { job, ctl, startedAt, progressAt, flush }

// Fair order: the workspace that has waited longest since its last job started goes first.
function pick(jobs, now) {
  const lastStart = new Map();
  for (const j of jobs) if (j.startedAt) lastStart.set(j.ws, Math.max(lastStart.get(j.ws) || 0, Date.parse(j.startedAt)));
  return jobs.filter(j => j.status === 'queued' && !(j.notBefore && Date.parse(j.notBefore) > now) && (!canRun || canRun(j)))
    .sort((a, b) => (lastStart.get(a.ws) || 0) - (lastStart.get(b.ws) || 0) || a.createdAt.localeCompare(b.createdAt))[0] || null;
}
function claim() {
  const now = Date.now();
  let failedNow = [];
  const job = change(jobs => {
    failedNow = reclaimIn(jobs, now);
    const j = pick(jobs, now);
    if (!j) return null;
    j.status = 'running'; j.attempts++; j.startedAt = iso(now);
    delete j.error; delete j.notBefore; delete j.waitReason;
    // `claim`: this run's own token. Only the run holding it can write back (a reclaimed and restarted
    // job is a new claim, even in the same worker).
    j.lease = { worker: WORKER_ID, until: iso(now + LEASE_MS()), claim: randomId('c', 4) };
    return copy(j);
  });
  failedNow.forEach(j => { try { onFail?.(j, new Error(j.error)); } catch {} });
  return job;
}
// Writes a running job's fields back, only while this run still holds it (same claim, still running).
function writeBack(id, claimId, patch) {
  return change(jobs => {
    const j = jobs.find(x => x.id === id);
    if (!j || j.status !== 'running' || j.lease?.worker !== WORKER_ID || j.lease?.claim !== claimId) return false;
    Object.assign(j, typeof patch === 'function' ? patch(j) : patch);
    return true;
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The last write of a run (its result) is tried a few times: a busy database must not leave a finished
// video looking unfinished (it would be made again).
async function writeBackSurely(id, claimId, patch) {
  for (let i = 0; ; i++) {
    try { return writeBack(id, claimId, patch); }
    catch (e) { if (i >= 3) { console.error('[queue] couldn’t save a job’s result:', e.message); return false; } await sleep(250 * 3 ** i); }
  }
}

let gateWhy = '';
async function kick() {
  if (!runner || !accepting || running.size >= SLOTS()) return;
  // A reason not to start anything now (the disk is nearly full): videos wait in line, saying why
  // (not over an outage's own reason), and the reason goes once it's over.
  const gate = canStart?.();
  if (gate && !gate.ok) {
    if (gate.why !== gateWhy) { gateWhy = gate.why; try { change(jobs => { for (const j of jobs) if (j.status === 'queued' && !j.notBefore) j.waitReason = gate.why; }); } catch { /* shown next time */ } }
    return;
  }
  if (gateWhy) { const was = gateWhy; gateWhy = ''; try { change(jobs => { for (const j of jobs) if (j.waitReason === was) delete j.waitReason; }); } catch { /* cleared next time */ } }
  while (running.size < SLOTS()) {
    let job;
    try { job = claim(); } catch (e) { console.error('[queue]', e.message); return; }
    if (!job) return;
    runOne(job);
  }
}

async function runOne(job) {
  const ctl = new AbortController(), claimId = job.lease.claim;
  const r = { job, ctl, claimId, startedAt: Date.now(), progressAt: Date.now(), pending: [], renewedAt: Date.now() };
  running.set(job.id, r);
  const alive = () => { r.progressAt = Date.now(); };
  // New log lines are written every 1.5 seconds (the portal shows them as progress); the lease is
  // renewed with them, or on its own every quarter of its length when there's nothing new.
  const flush = (force = false) => {
    if (!r.pending.length && !force && Date.now() - r.renewedAt < LEASE_MS() / 4) return;
    const lines = r.pending.splice(0);
    r.renewedAt = Date.now();
    const ok = writeBack(job.id, claimId, j => ({ lease: { ...j.lease, until: iso(Date.now() + LEASE_MS()) }, ...(lines.length ? { log: [...(j.log || []), ...lines].slice(-KEEP_LOG) } : {}) }));
    if (!ok && !ctl.signal.aborted) ctl.abort(Object.assign(new Error('Another worker took over this job.'), { aborted: true, code: 'aborted', lost: true }));
  };
  const log = line => {
    alive();
    job.log.push(String(line));
    if (job.log.length > KEEP_LOG) job.log.splice(0, job.log.length - KEEP_LOG);
    r.pending.push(String(line));
    if (process.env.NODE_ENV !== 'test') console.log(`[job ${job.id}] ${line}`);
  };
  r.flush = flush;
  const renew = setInterval(() => { try { flush(); } catch (e) { console.error('[queue]', e.message); } }, Math.min(1500, LEASE_MS() / 8));
  renew.unref?.();
  // Stops the job if it's stuck. The stop is a rejection the queue sees at once, even if the job
  // itself is waiting on something that never answers.
  let stopped;
  const stoppedP = new Promise((_, reject) => { stopped = reject; });
  stoppedP.catch(() => {});
  ctl.signal.addEventListener('abort', () => stopped(ctl.signal.reason), { once: true });
  const watch = setInterval(() => {
    const now = Date.now(), idle = now - r.progressAt, total = now - r.startedAt;
    if (idle < IDLE_MS() && total < MAX_RUN_MS()) return;
    const why = idle >= IDLE_MS() ? `nothing happened for ${Math.round(idle / 60000)} minutes` : `it ran for more than ${Math.round(MAX_RUN_MS() / 60000)} minutes`;
    ctl.abort(Object.assign(new Error(`This video got stuck (${why}), so it was stopped.`), { stuck: true, aborted: true, code: 'aborted' }));
  }, WATCH_MS());
  watch.unref?.();
  let outcome;
  // The flight recorder (lib/flight.js) rides along with the job: its steps and the services it calls.
  const flight = startFlight();
  try {
    const result = await Promise.race([jobContext.run({ signal: ctl.signal, jobId: job.id, progress: alive, flight }, () => runner(job, log, { signal: ctl.signal })), stoppedP]);
    outcome = { status: 'done', result };
  } catch (e) {
    outcome = { error: e };
  } finally {
    clearInterval(watch); clearInterval(renew);
  }
  const e = outcome.error;
  let stuckErr = null;
  // Handed back by a clean shutdown (an update): back in line, no try used up.
  if (e?.handBack) {
    saveFlight(finishFlight(flight, job, { status: 'handed back' }));
    r.pending.push('The server restarted; it picks up from its last finished step.');
    try { writeBack(job.id, claimId, j => ({ status: 'queued', attempts: Math.max(0, j.attempts - 1), lease: null, log: [...(j.log || []), ...r.pending.splice(0)].slice(-KEEP_LOG) })); } catch { /* shutdown already handed it back */ }
    running.delete(job.id);
    return;
  }
  if (e?.lost) { running.delete(job.id); setImmediate(kick); return; }   // someone else has it now
  const patch = { lease: null };
  if (!e) Object.assign(patch, { status: 'done', result: outcome.result, endedAt: iso() });
  else {
    const msg = e.message || String(e);
    log('Failed: ' + msg);
    if (e.stuck) stuckErr = e;
    if (isOutage(e) && (job.waits || 0) < MAX_OUTAGE_WAITS) {
      const waitReason = /openai/i.test(msg) ? 'OpenAI isn’t answering right now.' : 'A service it needs isn’t answering right now.';
      Object.assign(patch, { status: 'queued', waits: (job.waits || 0) + 1, attempts: Math.max(0, job.attempts - 1), notBefore: iso(Date.now() + OUTAGE_WAIT_MIN() * 60000), waitReason });
      log(`${waitReason} Waiting a few minutes, then going again.`);
    } else if (!e.permanent && job.attempts < MAX_ATTEMPTS) { patch.status = 'queued'; log('Trying once more…'); }
    else Object.assign(patch, { status: 'failed', error: msg, endedAt: iso() });
  }
  if (!ctl.signal.aborted) ctl.abort(Object.assign(new Error('The job finished.'), { aborted: true, code: 'aborted' }));   // anything it left running stops
  // (A run that lost its job to another worker records nothing; it returned above.)
  const fl = finishFlight(flight, job, { status: patch.status === 'queued' ? (patch.notBefore ? 'waiting' : 'retry') : patch.status, error: e ? e.message || String(e) : '' });
  if (fl) patch.steps = fl.steps;   // the job keeps its step times; the full timeline is kept apart
  const lines = r.pending.splice(0);
  // Only the run that still holds the job reports on it (a worker that lost it says nothing).
  const mine = await writeBackSurely(job.id, claimId, j => ({ ...patch, log: [...(j.log || []), ...lines].slice(-KEEP_LOG) }));
  if (mine) saveFlight(fl);   // a run that lost its job to another worker isn't counted
  try { change(jobs => pruneIn(jobs)); } catch (err) { console.error('[queue]', err.message); }
  running.delete(job.id);
  if (mine && stuckErr) { try { onStuck?.({ ...job }, stuckErr); } catch {} }
  if (mine && patch.status === 'failed') { try { onFail?.({ ...job, ...patch }, e); } catch {} }
  setImmediate(kick);
}

// `failed(job, error)` is called once when a job fails for good (after its last try).
// `stuck(job, error)` is called when the watchdog stops a job (it goes back in line if it has a try left).
// `gate()` → { ok, why }: checked before each job starts.
// `eligible(job)`: may this job start now (its workspace's videos switched off: it waits)?
export function startWorker(run, { failed = null, stuck = null, gate = null, eligible = null } = {}) {
  runner = run; onFail = failed; onStuck = stuck; canStart = gate; canRun = eligible; accepting = !!run;
  clearInterval(poll);
  if (!run) return;
  // Polling picks up jobs added by another process, and ones whose outage wait is over.
  poll = setInterval(kick, POLL_MS());
  poll.unref?.();
  setImmediate(kick);
}
export const isBusy = () => running.size > 0;
// The job running here now and how long since it last showed progress (for health and Admin).
export const runningNow = () => { const r = [...running.values()][0]; return r ? { id: r.job.id, ws: r.job.ws, startedAt: r.job.startedAt, idleMs: Date.now() - r.progressAt } : null; };

// A clean stop (an update or a restart): take no new jobs, hand the running ones back (no try used
// up; they resume from their saved stages), stop the programs they started, and save the line. Fast
// enough for pm2's default 1.6 seconds.
export function shutdown() {
  accepting = false;
  clearInterval(poll);
  for (const r of running.values()) {
    try { r.ctl.abort(Object.assign(new Error('The server is restarting.'), { aborted: true, code: 'aborted', handBack: true })); } catch {}
    try {
      const lines = [...r.pending.splice(0), 'The server restarted; it picks up from its last finished step.'];
      writeBack(r.job.id, r.claimId, j => ({ status: 'queued', attempts: Math.max(0, j.attempts - 1), lease: null, log: [...(j.log || []), ...lines].slice(-KEEP_LOG) }));
    } catch (e) { console.error('[queue]', e.message); }
  }
  running.clear();
  return stopAll();
}

// For tests: change a job directly (a running job, a stale start time).
export function _patch(id, patch) { change(jobs => { const j = jobs.find(x => x.id === id); if (j) Object.assign(j, patch); }); }

// For tests: wait until nothing is queued or running.
export async function idle(timeoutMs = 60000) {
  const t0 = Date.now();
  while (all().some(j => j.status === 'queued' || j.status === 'running') || running.size) {
    if (Date.now() - t0 > timeoutMs) throw new Error('Queue did not finish in time');
    await new Promise(r => setTimeout(r, 50));
  }
}

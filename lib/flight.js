// lib/flight.js — the flight recorder. Every video job keeps a timeline: each step it went through
// (writing, voice and footage, render, saving) with how long it took, and every outside service it called
// (which AI company and model, the stock sites, FFmpeg) with how long and whether it worked.
//
//   - The full timeline goes to data/timelines.json (the newest 300 runs; Admin → Engine bay → a run →
//     Timeline), so "why did this one take 20 minutes?" has an answer: 14 of them were Pixabay timing
//     out, say. The job itself only keeps its step times (the line is saved often; it stays small).
//   - A one-line summary of every run goes to data/flight.json (the newest 2,000), which the Engine bay
//     and the targets read: step times, success rate, overnight videos ready by 7am.
//
// Nothing has to pass the recorder along: it travels with the job (lib/proc.js jobContext), so a
// service call deep inside a stage lands on the right job. Outside a job, the calls do nothing.
import path from 'path';
import { DIRS, readJSON, updateJSON } from './paths.js';
import { currentJob } from './proc.js';

const FILE = path.join(DIRS.data, 'flight.json');
const TIMELINES = path.join(DIRS.data, 'timelines.json');
const KEEP = 2000, KEEP_TIMELINES = 300;
const MAX_EVENTS = 120;

export const startFlight = (now = Date.now()) => ({ t0: now, steps: [], events: [], services: {} });
const rec = () => currentJob()?.flight || null;
function push(f, ev) { if (f.events.length < MAX_EVENTS) f.events.push(ev); else f.dropped = (f.dropped || 0) + 1; }

// A new step starts (the one before it ends).
export function step(name, now = Date.now()) {
  const f = rec();
  if (!f) return;
  const last = f.steps[f.steps.length - 1];
  if (last && last.ms == null) last.ms = now - last.at;
  f.steps.push({ name, at: now });
  push(f, { t: now - f.t0, step: name });
}
// An outside service was called. `ok`: it answered (even with a refusal); `detail`: the model, say.
export function service(name, { ms = 0, ok = true, detail = '' } = {}) {
  const f = rec();
  if (!f) return;
  const s = (f.services[name] ||= { calls: 0, fails: 0, ms: 0 });
  s.calls++; if (!ok) s.fails++; s.ms += Math.round(ms);
  push(f, { t: Date.now() - f.t0 - Math.round(ms), service: name, ms: Math.round(ms), ok, ...(detail ? { detail: String(detail).slice(0, 60) } : {}) });
}
// Times a call to a service (records it either way; the error goes on).
export async function timed(name, fn, detail = '') {
  if (!rec()) return fn();
  const t = Date.now();
  try { const out = await fn(); service(name, { ms: Date.now() - t, ok: true, detail }); return out; }
  catch (e) { service(name, { ms: Date.now() - t, ok: false, detail }); throw e; }
}

// The run is over: its timeline and summary (nothing is saved yet: `save` does that, once the run knows
// the job is still its own).
export function finish(f, job, { status, error = '' } = {}, now = Date.now()) {
  if (!f) return null;
  const last = f.steps[f.steps.length - 1];
  if (last && last.ms == null) last.ms = now - last.at;
  const steps = {};
  for (const s of f.steps) steps[s.name] = (steps[s.name] || 0) + (s.ms || 0);
  const summary = {
    id: job.id, ws: job.ws, kind: job.kind, source: job.source || '', attempt: job.attempts || 1,
    queuedAt: job.createdAt, startedAt: new Date(f.t0).toISOString(), endedAt: new Date(now).toISOString(),
    ms: now - f.t0, status, ...(error ? { error: String(error).slice(0, 160) } : {}), steps, services: f.services,
  };
  return { steps: f.steps.map(s => ({ name: s.name, ms: s.ms || 0 })), events: f.events, ...(f.dropped ? { dropped: f.dropped } : {}), summary };
}
// Keeps a finished run: its summary in flight.json, its timeline in timelines.json.
export function save(fl) {
  if (!fl) return;
  const { summary, ...timeline } = fl;
  try { updateJSON(FILE, [], all => { const a = Array.isArray(all) ? all : []; a.push(summary); return a.slice(-KEEP); }); } catch (e) { console.error('[flight]', e.message); }
  try { updateJSON(TIMELINES, [], all => { const a = Array.isArray(all) ? all : []; a.push({ id: summary.id, attempt: summary.attempt, status: summary.status, endedAt: summary.endedAt, ...timeline }); return a.slice(-KEEP_TIMELINES); }); } catch (e) { console.error('[flight]', e.message); }
}
// Every kept timeline of one job (one per run: a retry is a second run).
export const timelinesOf = id => { const a = readJSON(TIMELINES, []); return (Array.isArray(a) ? a : []).filter(t => t.id === id); };

export const runs = () => { const a = readJSON(FILE, []); return Array.isArray(a) ? a : []; };
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
// Step and total times (median and 95th percentile, seconds) and outcomes since `since`.
export function stats({ since = Date.now() - 7 * 86400000, list = runs() } = {}) {
  const recent = list.filter(r => Date.parse(r.endedAt) >= since && ['video', 'studio'].includes(r.kind));
  const done = recent.filter(r => r.status === 'done'), failed = recent.filter(r => r.status === 'failed');
  const secs = xs => xs.map(x => Math.round(x / 1000)).sort((a, b) => a - b);
  const names = [...new Set(done.flatMap(r => Object.keys(r.steps || {})))];
  const steps = Object.fromEntries(names.map(n => { const xs = secs(done.map(r => r.steps?.[n]).filter(x => x != null)); return [n, { p50: pct(xs, 50), p95: pct(xs, 95) }]; }));
  const total = secs(done.map(r => r.ms));
  const services = {};
  for (const r of recent) for (const [k, v] of Object.entries(r.services || {})) { const s = (services[k] ||= { calls: 0, fails: 0, ms: 0 }); s.calls += v.calls; s.fails += v.fails; s.ms += v.ms; }
  return { runs: recent.length, done: done.length, failed: failed.length, waited: recent.filter(r => r.status === 'waiting').length, retried: recent.filter(r => r.status === 'retry').length, total: { p50: pct(total, 50), p95: pct(total, 95) }, steps, services };
}

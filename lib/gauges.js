// lib/gauges.js — the gauges behind Admin → Engine bay:
//   - how often each outside service answered or didn't, by hour (every call that goes through its
//     breaker, lib/breaker.js);
//   - memory and event-loop lag of each process (the website, and any separate worker);
//   - free disk, once a day's lowest reading, for the trend ("full in about 40 days").
// Each process counts in memory and adds its counts to data/gauges.json once a minute, so a separate
// worker's numbers land in the same place as the website's. Kept: 14 days by hour, 120 days of disk.
import path from 'path';
import { monitorEventLoopDelay } from 'perf_hooks';
import { DIRS, readJSON, updateJSON } from './paths.js';

const FILE = path.join(DIRS.data, 'gauges.json');
const HOURS_KEPT = 24 * 14, DAYS_KEPT = 120;
const hourKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 13);
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const trim = (obj, keep) => { const ks = Object.keys(obj).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - keep))) delete obj[k]; return obj; };
const maxOf = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

/* ---------------- Counting ---------------- */
let pending = {};   // hour → service → [answered, failed]
export function count(service, ok, now = Date.now()) {
  const h = (pending[hourKey(now)] ||= {});
  const c = (h[service] ||= [0, 0]);
  c[ok ? 0 : 1]++;
}

/* ---------------- This process ---------------- */
let lag = null, role = 'server', timer = null;
export function sample(now = Date.now(), { reset = true } = {}) {
  const m = process.memoryUsage();
  const ms = q => (lag && lag.count ? Math.round(lag.percentile(q) / 1e6) : null);
  const s = { at: new Date(now).toISOString(), pid: process.pid, rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6), lagP50: ms(50), lagP99: ms(99), lagMax: lag && lag.count ? Math.round(lag.max / 1e6) : null, uptimeMin: Math.round(process.uptime() / 60) };
  if (reset) try { lag?.reset(); } catch { /* fine */ }
  return s;
}

// Adds this process's counts and a sample to gauges.json. A failed save keeps the counts for next time.
export function flush(now = Date.now()) {
  const svc = pending; pending = {};
  const s = sample(now);
  try {
    updateJSON(FILE, {}, raw => {
      const g = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const services = g.services || {};
      for (const [h, by] of Object.entries(svc)) { const dst = (services[h] ||= {}); for (const [k, [a, b]] of Object.entries(by)) { const c = (dst[k] ||= [0, 0]); c[0] += a; c[1] += b; } }
      const proc = g.process || {}, mine = (proc[role] ||= {}), hk = hourKey(now), cur = mine[hk] || {};
      mine[hk] = { rssMB: maxOf(cur.rssMB, s.rssMB), heapMB: maxOf(cur.heapMB, s.heapMB), lagP99: maxOf(cur.lagP99, s.lagP99) };
      trim(mine, HOURS_KEPT);
      return { ...g, services: trim(services, HOURS_KEPT), process: proc, now: { ...(g.now || {}), [role]: s } };
    });
  } catch (e) {
    for (const [h, by] of Object.entries(svc)) for (const [k, [a, b]] of Object.entries(by)) { const c = ((pending[h] ||= {})[k] ||= [0, 0]); c[0] += a; c[1] += b; }
    console.error('[gauges]', e.message);
  }
  return s;
}
// Starts measuring this process (`who`: 'server' or 'worker').
export function start(who = 'server') {
  role = who;
  if (!lag) { lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable(); }
  clearInterval(timer);
  timer = setInterval(() => flush(), 60000);
  timer.unref?.();
}

/* ---------------- Disk ---------------- */
export function noteDisk(gb, now = Date.now()) {
  if (gb == null) return;
  try { updateJSON(FILE, {}, g => { const disk = { ...(g?.disk || {}) }; const d = dayKey(now); disk[d] = disk[d] == null ? gb : Math.min(disk[d], gb); return { ...(g || {}), disk: trim(disk, DAYS_KEPT) }; }); } catch (e) { console.error('[gauges]', e.message); }
}
// The last 30 days' trend: GB per day (negative = filling up) and days until `floorGB` at that rate.
export function diskTrend(floorGB = 0, now = Date.now(), g = read()) {
  const pts = Object.entries(g.disk || {}).filter(([d]) => now - Date.parse(`${d}T12:00:00Z`) <= 30 * 86400000).map(([d, gb]) => [Date.parse(`${d}T12:00:00Z`) / 86400000, gb]);
  if (pts.length < 3) return { days: pts.length, perDay: null, daysLeft: null, latest: pts.at(-1)?.[1] ?? null };
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / (pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0) || 1);
  const latest = pts.sort((a, b) => a[0] - b[0]).at(-1)[1];
  return { days: n, perDay: Math.round(slope * 100) / 100, latest, daysLeft: slope < -0.001 ? Math.max(0, Math.round((latest - floorGB) / -slope)) : null };
}

/* ---------------- Reading ---------------- */
export const read = () => { const g = readJSON(FILE, {}); return g && typeof g === 'object' && !Array.isArray(g) ? g : {}; };
// Each service over the last `hours`: [answered, failed].
export function serviceTotals(hours = 24, now = Date.now(), g = read()) {
  const from = hourKey(now - hours * 3600000), out = {};
  for (const [h, by] of Object.entries(g.services || {})) { if (h < from) continue; for (const [k, [a, b]] of Object.entries(by)) { const c = (out[k] ||= { ok: 0, failed: 0 }); c.ok += a; c.failed += b; } }
  return out;
}
// The worst hour of each process in the last `hours` (memory and event-loop lag).
export function processPeaks(hours = 24, now = Date.now(), g = read()) {
  const from = hourKey(now - hours * 3600000), out = {};
  for (const [who, byHour] of Object.entries(g.process || {})) {
    const p = { rssMB: null, heapMB: null, lagP99: null };
    for (const [h, x] of Object.entries(byHour)) if (h >= from) { p.rssMB = maxOf(p.rssMB, x.rssMB); p.heapMB = maxOf(p.heapMB, x.heapMB); p.lagP99 = maxOf(p.lagP99, x.lagP99); }
    out[who] = { ...p, now: g.now?.[who] || null };
  }
  return out;
}
export const _reset = () => { pending = {}; };

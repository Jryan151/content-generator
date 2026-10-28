// lib/clock.js — the clock check. Two-factor codes (30-second windows), Stripe's webhook signatures
// (5 minutes) and phone notifications (VAPID tokens) all depend on the server's clock being right. A
// server whose clock drifts fails them quietly: "wrong code" at login, refused webhooks, silent pushes.
//
// Once a day (and a minute after start) the server's time is compared with an outside source: by
// default Cloudflare's trace page, which states the time to the millisecond (CLOCK_CHECK_URL to change
// it; any page works, using its Date header, to the second). Off by more than 5 seconds: a warning; by
// more than 30 (two-factor codes start failing): an error. The fix is one command (in the alert).
import { readJSON, writeJSON, DIRS } from './paths.js';
import path from 'path';
import { notify } from './alerts.js';

const FILE = path.join(DIRS.data, 'clock.json');
const URL_DEFAULT = 'https://www.cloudflare.com/cdn-cgi/trace';
export const WARN_MS = 5000, ERROR_MS = 30000;
export const lastCheck = () => readJSON(FILE, null);

// One reading: { skewMs (positive = this server is ahead), plusMinusMs, source }.
export async function measure({ url = process.env.CLOCK_CHECK_URL || URL_DEFAULT, fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
  const t1 = Date.now();
  const body = await res.text().catch(() => '');
  const mid = (t0 + t1) / 2, half = (t1 - t0) / 2;
  const ts = /(?:^|\n)ts=(\d+(?:\.\d+)?)/.exec(body);
  if (ts) return { skewMs: Math.round(mid - Number(ts[1]) * 1000), plusMinusMs: Math.round(half), source: new URL(url).host };
  const d = Date.parse(res.headers.get('date') || '');
  if (!Number.isFinite(d)) throw new Error(`${new URL(url).host} gave no time to compare with.`);
  // A Date header is to the second (rounded down): its true time is somewhere in the next second.
  return { skewMs: Math.round(mid - (d + 500)), plusMinusMs: Math.round(half + 500), source: new URL(url).host };
}

// The daily check: saves the reading and alerts if the clock is off (beyond what the reading can tell).
export async function check({ now = Date.now(), ...opts } = {}) {
  let r;
  try { r = await measure(opts); }
  catch (e) { const out = { at: new Date(now).toISOString(), error: String(e.message).slice(0, 160) }; writeJSON(FILE, { ...(lastCheck() || {}), ...out }); return out; }
  const off = Math.max(0, Math.abs(r.skewMs) - r.plusMinusMs);
  const level = off > ERROR_MS ? 'error' : off > WARN_MS ? 'warning' : '';
  const out = { at: new Date(now).toISOString(), ...r, off, level, error: '' };
  writeJSON(FILE, out);
  if (level) {
    const secs = Math.round(Math.abs(r.skewMs) / 1000);
    notify({ level, kind: 'server', title: `The server’s clock is ${secs} seconds ${r.skewMs > 0 ? 'fast' : 'slow'}`,
      text: `Compared with ${r.source}. ${level === 'error' ? 'Two-factor codes are failing now (they allow 30 seconds), and Stripe webhooks and phone notifications fail beyond a few minutes.' : 'Two-factor codes fail beyond 30 seconds, Stripe webhooks and phone notifications beyond a few minutes.'}`,
      did: 'Nothing: the server can’t safely set its own clock.',
      run: 'timedatectl set-ntp true && systemctl restart systemd-timesyncd && timedatectl status' }, now);
  }
  return out;
}

// lib/links.js — a tracking link for each video: https://<site>/r/<code> sends the viewer on to the
// agent's booking page (Brand → Booking link) and counts the click on that video. Clicks show in
// Review and Admin, and count toward what the app learns works (half a message each).
// The code is random (not the video id), so links can't be guessed or walked. One click per person per
// 6 hours is counted, and link previews (Facebook, Slack, iMessage…) and bots aren't counted.
import crypto from 'crypto';
import path from 'path';
import { DIRS, readJSON, updateJSON, randomId } from './paths.js';
import * as store from './store.js';

const FILE = () => path.join(DIRS.data, 'links.json');
const BASE = () => String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
export const CODE_RE = /^[a-f0-9]{10}$/;
const KEEP_DAYS = 90;
const SAME_PERSON_MS = 6 * 3600000;
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|meta-externalagent|whatsapp|telegram|discord|slack|skype|embedly|vkshare|pinterest|bitly|curl|wget|python|node-fetch|axios|go-http|headless|lighthouse|monitor|uptime|scan/i;

export const urlFor = code => (code && BASE() ? `${BASE()}/r/${code}` : '');

// The video's code, made the first time it's asked for.
export function codeFor(ws, vid) {
  const v = store.getVideo(ws, vid);
  if (!v) return '';
  if (v.link && CODE_RE.test(v.link)) return v.link;
  let code = '';
  updateJSON(FILE(), {}, all => { do code = randomId('', 5); while (all[code]); all[code] = { ws, v: vid }; return all; });
  store.updateVideo(ws, vid, { link: code });
  return code;
}
export const resolve = code => (CODE_RE.test(String(code || '')) ? readJSON(FILE(), {})[code] || null : null);
export function forgetWorkspace(ws) { updateJSON(FILE(), {}, all => Object.fromEntries(Object.entries(all).filter(([, x]) => x.ws !== ws))); }
export function forgetVideo(ws, vid) { updateJSON(FILE(), {}, all => Object.fromEntries(Object.entries(all).filter(([, x]) => !(x.ws === ws && x.v === vid)))); }

// Approved and posted videos from before tracking links get theirs once, at startup (new ones get
// theirs when they're approved; pending and rejected videos don't need one).
export function backfill() {
  let n = 0;
  for (const w of store.listWorkspaces()) for (const v of store.readVideos(w.id)) if (!v.link && ['approved', 'posted'].includes(v.status)) { codeFor(w.id, v.id); n++; }
  return n;
}

const seen = new Map(), perIp = new Map(), pending = new Map();
const IP_HOURLY = 20;        // counted clicks from one address per hour, across all links
const VIDEO_DAILY = 200;     // counted clicks per video per day
export const isBot = ua => !ua || BOTS.test(String(ua));
const hash = x => crypto.createHash('sha256').update(x).digest('base64url').slice(0, 16);
// A click. Returns where to send the viewer (the booking page), or null when the link isn't live.
// `count: false` (a HEAD request) checks the link without counting.
export function click(code, { ip = '', ua = '', count = true } = {}, now = Date.now()) {
  const hit = resolve(code);
  if (!hit) return null;
  const ws = store.getWorkspace(hit.ws);
  if (!ws || ws.suspended) return null;
  const url = store.loadConfig(hit.ws).look?.bookingUrl || '';
  if (!url || !store.getVideo(hit.ws, hit.v)) return null;
  if (count) tally(code, { ip, ua }, now);
  return url;
}
// Counts one visit to a link (v15: the personal page, lib/landing.js) or, with kind 'book', a tap on its
// Pick a time button. The same address on the same link counts once per 6 hours (each kind on its own),
// any one address at most 20 times an hour, and bots never.
export function tally(code, { ip = '', ua = '', kind = 'view' } = {}, now = Date.now()) {
  const hit = resolve(code);
  if (!hit || isBot(ua)) return false;
  const who = hash(`${ip}|${code}|${kind}`), last = seen.get(who), ipKey = hash(ip), hour = perIp.get(ipKey);
  if (last && now - last < SAME_PERSON_MS) return false;
  if (hour && now - hour.at < 3600000 && hour.n >= IP_HOURLY) return false;
  seen.set(who, now);
  perIp.set(ipKey, hour && now - hour.at < 3600000 ? { at: hour.at, n: hour.n + 1 } : { at: now, n: 1 });
  if (seen.size > 20000) for (const [k, t] of seen) if (now - t > SAME_PERSON_MS || seen.size > 15000) seen.delete(k);
  if (perIp.size > 20000) for (const [k, x] of perIp) if (now - x.at > 3600000 || perIp.size > 15000) perIp.delete(k);
  // Counts are added up here and written every few seconds, not once per click.
  const key = `${hit.ws}/${hit.v}`, p = pending.get(key) || { ws: hit.ws, v: hit.v, days: {}, last: '', book: 0 };
  if (kind === 'book') p.book = (p.book || 0) + 1;
  else { const day = new Date(now).toISOString().slice(0, 10); p.days[day] = (p.days[day] || 0) + 1; p.last = new Date(now).toISOString(); }
  pending.set(key, p);
  if (!flushTimer) { flushTimer = setTimeout(flush, 5000); flushTimer.unref?.(); }
  return true;
}
let flushTimer = null;
// Writes the counted clicks to their videos (also called on shutdown and by tests).
export function flush(now = Date.now()) {
  clearTimeout(flushTimer); flushTimer = null;
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  for (const [key, p] of pending) {
    pending.delete(key);
    try {
      store.updateVideo(p.ws, p.v, v => {
        const byDay = Object.fromEntries(Object.entries({ ...(v.clicks?.byDay || {}) }).filter(([d]) => d >= cutoff));
        let added = 0;
        for (const [d, n] of Object.entries(p.days)) { const room = Math.max(0, VIDEO_DAILY - (byDay[d] || 0)), k = Math.min(room, n); byDay[d] = (byDay[d] || 0) + k; added += k; }
        return { clicks: { total: (v.clicks?.total || 0) + added, last: p.last || v.clicks?.last || '', byDay, ...(p.book || v.clicks?.book ? { book: (v.clicks?.book || 0) + (p.book || 0) } : {}) } };
      });
    } catch (e) { console.error('[links]', e.message); }
  }
}
// Clicks on a workspace's links since a date (YYYY-MM-DD), for Admin.
export const clicksSince = (videos, since) => videos.reduce((a, v) => a + Object.entries(v.clicks?.byDay || {}).filter(([d]) => d >= since).reduce((x, [, n]) => x + n, 0), 0);
export const _resetSeen = () => { seen.clear(); perIp.clear(); };

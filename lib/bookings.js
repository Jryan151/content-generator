// lib/bookings.js — bookings traced to the video that brought them (v15 Phase 9).
//
// The Pick a time button on a video's page (/r/<code>/book) sends the viewer to the agent's booking page
// with the video's code in the link (utm_content=<code>, the way booking tools pass tracking along).
// When someone books, the booking tool tells this server at a private address (Brand → Booking link →
// Booking confirmations): https://<site>/hooks/booking/<token>. Calendly, Cal.com, or anything that
// can send a webhook (Zapier, Make) with { name, email, phone, start, ref }.
//
// A booking: the person on the Desk is moved to "Appointment booked" (or added), tied to the video, and
// the video counts the booking in its results (a booking counts like three messages in what the app
// learns works). The agent's phone hears about it. A canceled booking is noted and moves them back to
// "Talking". Moving a lead from a video to "Appointment booked" by hand counts the same way.
//
// workspace.bookingHook: { token, key (sealed, optional signing key), createdAt, last }
// video.bookings: { total, canceled, last }   client.bookedAt
import crypto from 'crypto';
import path from 'path';
import { DIRS, readJSON, updateJSON } from './paths.js';
import * as store from './store.js';
import * as clients from './clients.js';
import * as links from './links.js';
import * as secrets from './secrets.js';

const HOOKS = () => path.join(DIRS.data, 'booking-hooks.json');   // token → workspace id
const seenFile = ws => path.join(store.wsDir(ws), 'bookings-seen.json');
const BASE = () => String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
const err = (status, message) => Object.assign(new Error(message), { status });
export const KEEP_FREE = 200, PER_DAY = 50, PER_HOUR = 120;
// Calls an address takes in an hour (a leaked one can't be used to flood the server).
const hourly = new Map();
export function allow(token, now = Date.now()) {
  const h = hourly.get(token);
  if (h && now - h.at < 3600000 && h.n >= PER_HOUR) return false;
  hourly.set(token, h && now - h.at < 3600000 ? { at: h.at, n: h.n + 1 } : { at: now, n: 1 });
  if (hourly.size > 5000) for (const [k, x] of hourly) if (now - x.at > 3600000) hourly.delete(k);
  return true;
}
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------------- The link out: the video's code rides along to the booking page ---------------- */
export function bookingUrlFor(url, code) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if (!links.CODE_RE.test(String(code || ''))) return url;
  u.searchParams.set('utm_source', 'agentreels'); u.searchParams.set('utm_medium', 'video'); u.searchParams.set('utm_content', code);
  if (/(^|\.)cal\.com$/i.test(u.hostname)) u.searchParams.set('metadata[ref]', code);   // Cal.com hands metadata back in its webhook
  return u.toString();
}

/* ---------------- The private address the booking tool calls ---------------- */
export function hookFor(wsId, { rotate = false } = {}) {
  const ws = store.getWorkspace(wsId);
  let h = ws.bookingHook;
  if (!h?.token || rotate) {
    const token = crypto.randomBytes(18).toString('base64url');
    updateJSON(HOOKS(), {}, all => { for (const [k, v] of Object.entries(all)) if (v === wsId) delete all[k]; all[token] = wsId; return all; });
    h = { ...(h || {}), token, createdAt: new Date().toISOString() };
    store.updateWorkspace(wsId, { bookingHook: h });
  }
  return { url: `${BASE()}/hooks/booking/${h.token}`, hasKey: !!h.key, last: h.last || null };
}
// An optional signing key (Calendly's webhook signing key, Cal.com's secret): with one, every call must be signed.
export function setKey(wsId, key) {
  const k = t(key, 200);
  hookFor(wsId);
  store.updateWorkspace(wsId, w => ({ bookingHook: { ...w.bookingHook, key: k ? secrets.seal(k, 'booking') : '' } }));
  return hookFor(wsId);
}
export function forgetWorkspace(wsId) { updateJSON(HOOKS(), {}, all => { for (const [k, v] of Object.entries(all)) if (v === wsId) delete all[k]; return all; }); }
export const wsForToken = token => (/^[\w-]{20,40}$/.test(String(token || '')) ? readJSON(HOOKS(), {})[token] || null : null);

// Is the call genuine? With no key set, the private address is the secret. With one: Calendly signs
// "t=<time>,v1=<hmac of time.body>", Cal.com sends the hmac of the body in X-Cal-Signature-256.
export function verify(wsId, raw, headers = {}, now = Date.now()) {
  const sealed = store.getWorkspace(wsId)?.bookingHook?.key;
  if (!sealed) return true;
  const key = secrets.unseal(sealed, 'booking');
  if (!key) return false;
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const cal = headers['calendly-webhook-signature'];
  if (cal) {
    const parts = Object.fromEntries(String(cal).split(',').map(p => p.split('=').map(s => s.trim())));
    if (!parts.t || !parts.v1 || Math.abs(now / 1000 - Number(parts.t)) > 15 * 60) return false;
    return same(crypto.createHmac('sha256', key).update(`${parts.t}.${raw}`).digest('hex'), parts.v1);
  }
  const calcom = headers['x-cal-signature-256'];
  if (calcom) return same(crypto.createHmac('sha256', key).update(raw).digest('hex'), String(calcom).replace(/^sha256=/, ''));
  const generic = headers['x-signature'];
  if (generic) return same(crypto.createHmac('sha256', key).update(raw).digest('hex'), String(generic).replace(/^sha256=/, ''));
  return false;
}

/* ---------------- Reading what the booking tool sent ---------------- */
// { kind: 'booked' | 'canceled' | null, id, name, email, phone, start, ref }
export function parse(body) {
  const b = body && typeof body === 'object' ? body : {};
  // Calendly: { event: 'invitee.created' | 'invitee.canceled', payload: { name, email, uri, tracking, scheduled_event, text_reminder_number } }
  if (/^invitee\./.test(String(b.event || ''))) {
    const p = b.payload || {};
    // A reschedule cancels the old time and books the new one: the cancel isn't a real one.
    return { kind: b.event === 'invitee.created' ? 'booked' : b.event === 'invitee.canceled' && !p.rescheduled ? 'canceled' : null, id: t(p.uri || p.uuid, 200), name: t(p.name || [p.first_name, p.last_name].filter(Boolean).join(' '), 80), email: t(p.email, 120), phone: t(p.text_reminder_number, 40), start: t(p.scheduled_event?.start_time, 40), ref: t(p.tracking?.utm_content, 40) };
  }
  // Cal.com: { triggerEvent: 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'BOOKING_RESCHEDULED', payload: { uid, attendees, startTime, metadata, responses } }
  if (b.triggerEvent) {
    const p = b.payload || {}, a = (p.attendees || [])[0] || {}, r = p.responses || {};
    const kind = /CREATED|RESCHEDULED/.test(b.triggerEvent) ? 'booked' : /CANCEL/.test(b.triggerEvent) ? 'canceled' : null;
    return { kind, id: t(p.uid || p.bookingId, 200), name: t(a.name || r.name?.value, 80), email: t(a.email || r.email?.value, 120), phone: t(a.phoneNumber || r.attendeePhoneNumber?.value, 40), start: t(p.startTime, 40), ref: t(p.metadata?.ref || p.metadata?.utm_content || p.utm_content, 40) };
  }
  // Anything else (Zapier, Make): { event: 'booked' | 'canceled', id, name, email, phone, start, ref }
  const ev = String(b.event || b.status || 'booked').toLowerCase();
  return { kind: /cancel/.test(ev) ? 'canceled' : /book|creat|schedul/.test(ev) ? 'booked' : null, id: t(b.id, 200), name: t(b.name, 80), email: t(b.email, 120), phone: t(b.phone, 40), start: t(b.start || b.start_time, 40), ref: t(b.ref || b.utm_content, 40) };
}
const digits = x => String(x || '').replace(/\D/g, '');
const findClient = (ws, { email, phone, videoId }) => {
  const all = clients.list(ws);
  const same = c => (email && c.email && c.email.toLowerCase() === email.toLowerCase()) || (digits(phone).length >= 7 && digits(c.phone) === digits(phone));
  return all.find(c => same(c) && videoId && c.videoId === videoId) || all.find(same) || null;
};
const whenLabel = (start, tz) => { const ms = Date.parse(start); return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };

// One booking on a video, counted once per person (a reschedule or a repeat doesn't count twice).
export function count(wsId, videoId, clientId, now = Date.now()) {
  if (!videoId || !store.getVideo(wsId, videoId)) return false;
  const c = clients.get(wsId, clientId);
  if (!c || c.bookedAt) return false;
  clients.save(wsId, clientId, { bookedAt: new Date(now).toISOString() });
  store.updateVideo(wsId, videoId, v => ({ bookings: { total: (v.bookings?.total || 0) + 1, canceled: v.bookings?.canceled || 0, last: new Date(now).toISOString() } }));
  return true;
}

// A call from the booking tool. Returns { ok, kind, client, video, duplicate } (nothing is thrown for a
// call that isn't a booking: it's answered and left).
export function receive(wsId, body, { now = Date.now() } = {}) {
  const b = parse(body);
  if (!b.kind) return { ok: true, ignored: true };
  if (!b.name && !b.email && !b.phone) return { ok: true, ignored: true };
  // The same call again (booking tools retry): done once.
  if (b.id) {
    let dup = false;
    updateJSON(seenFile(wsId), [], list => { const key = `${b.kind}:${b.id}`; if (list.includes(key)) { dup = true; return list; } return [...list, key].slice(-500); });
    if (dup) return { ok: true, duplicate: true };
  }
  const hit = links.resolve(b.ref), video = hit && hit.ws === wsId ? store.getVideo(wsId, hit.v) : null;
  const cfg = store.loadConfig(wsId), tz = cfg.profile?.timezone || 'America/Denver', at = whenLabel(b.start, tz);
  store.updateWorkspace(wsId, w => ({ bookingHook: { ...(w.bookingHook || {}), last: new Date(now).toISOString() } }));
  let c = findClient(wsId, { email: b.email, phone: b.phone, videoId: video?.id });
  if (b.kind === 'canceled') {
    if (!c) return { ok: true, kind: 'canceled', client: null };
    const wasBooked = c.stage === 'booked';   // counted once: a second cancel, or one after they moved on, isn't
    c = clients.save(wsId, c.id, { ...(wasBooked ? { stage: 'talking' } : {}), notes: t(`${c.notes ? `${c.notes}\n` : ''}Canceled their booked time${at ? ` (${at})` : ''}.`, 1000) });
    if (wasBooked && c.videoId && c.bookedAt) store.updateVideo(wsId, c.videoId, v => ({ bookings: { ...(v.bookings || { total: 0 }), canceled: (v.bookings?.canceled || 0) + 1 } }));
    return { ok: true, kind: 'canceled', client: c };
  }
  const note = `Booked a time${at ? ` for ${at}` : ''}${video ? ' from a video' : ''}.`;
  if (c) {
    c = clients.save(wsId, c.id, { ...(c.stage !== 'client' ? { stage: 'booked' } : {}), ...(!c.videoId && video ? { videoId: video.id } : {}), ...(!c.email && b.email ? { email: b.email } : {}), ...(!c.phone && b.phone ? { phone: b.phone } : {}), notes: t(`${c.notes ? `${c.notes}\n` : ''}${note}`, 1000) });
  } else {
    // Someone new. The last places in the list stay the agent's own, and a day takes at most PER_DAY
    // new people this way (a leaked address can't fill the list).
    const all = clients.list(wsId);
    if (all.length >= clients.MAX_CLIENTS - KEEP_FREE || all.filter(x => x.source.startsWith('Booking') && now - Date.parse(x.createdAt) < 86400000).length >= PER_DAY) return { ok: true, kind: 'booked', full: true, client: null };
    const hook = t(video?.scenes?.[0]?.text, 80);
    c = clients.add(wsId, { name: b.name || b.email || b.phone, email: b.email, phone: b.phone, stage: 'booked', source: video ? `Booking: “${hook}”`.slice(0, 120) : 'Booking page', notes: note, videoId: video?.id || '' });
  }
  if (c.videoId) count(wsId, c.videoId, c.id, now);
  return { ok: true, kind: 'booked', client: clients.get(wsId, c.id), video: c.videoId ? store.getVideo(wsId, c.videoId) : null, at };
}

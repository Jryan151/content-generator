// lib/landing.js — the personal page behind each tracking link (v15 Phase 8, "the rear seat").
//
// https://<site>/r/<code> used to send the viewer straight to the booking page. Now it opens a small page
// that's about them: "You watched: …" with the video's opening line, the agent's photo, name and town, a
// Pick a time button (the booking page, when there is one) and one short form (first name, a phone number
// or email, an optional question). A sent form is a new lead on the Desk, tied to the video that brought
// it, and the agent's phone hears about it.
//
// Brand → Booking link can still send people straight to the booking page (look.landing = 'direct').
// The page has no scripts, no outside requests, and a strict security policy; the form is checked in code
// (a hidden field catches bots, and each address can send a few an hour).
import fs from 'fs';
import * as store from './store.js';
import * as clients from './clients.js';
import * as links from './links.js';
import { okBookingUrl } from '../mixer-core.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------------- The agent's photo (Brand → Your photo) ---------------- */
export const photoPath = ws => `${store.wsDir(ws)}/photo.jpg`;
export const hasPhoto = ws => fs.existsSync(photoPath(ws));

/* ---------------- Which page ---------------- */
// The link's workspace and video, when it's live: the workspace isn't suspended and the video is still
// there, approved or posted. null otherwise.
export function pageFor(code) {
  const hit = links.resolve(code);
  if (!hit) return null;
  const ws = store.getWorkspace(hit.ws);
  if (!ws || ws.suspended) return null;
  const video = store.getVideo(hit.ws, hit.v);
  if (!video || !['approved', 'posted'].includes(video.status)) return null;
  const cfg = store.loadConfig(hit.ws), booking = cfg.look?.bookingUrl || '';
  return { code, ws, cfg, video, booking: okBookingUrl(booking) ? booking : '', direct: cfg.look?.landing === 'direct' };
}

/* ---------------- The page ---------------- */
const CSS = `:root{color-scheme:light dark;--bg:#faf8f4;--fg:#1d1c1a;--muted:#5f5b54;--line:#e3ded4;--card:#fff;--accent:#b97800}
@media (prefers-color-scheme:dark){:root{--bg:#17181b;--fg:#ecebe8;--muted:#a19d95;--line:#33353a;--card:#202226;--accent:#f2b51d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;margin:0 auto;padding:28px 16px 40px;display:grid;gap:18px}
.me{display:flex;gap:14px;align-items:center}.me img{width:72px;height:72px;border-radius:50%;object-fit:cover;flex:none}
.me b{display:block;font-size:19px}.muted{color:var(--muted);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:10px}
.watched{font-size:15px;color:var(--muted)}.watched q{display:block;color:var(--fg);font-size:19px;font-weight:600;margin-top:4px}
.btn{display:block;text-align:center;text-decoration:none;font:inherit;font-weight:600;border-radius:10px;padding:13px 16px;border:0;cursor:pointer;background:var(--accent);color:#1d1c1a;width:100%}
.btn.alt{background:transparent;color:var(--fg);border:1px solid var(--line)}
label{display:grid;gap:4px;font-size:14px;color:var(--muted)}input,textarea{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;width:100%}
textarea{min-height:76px;resize:vertical}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.err{color:#b3261e;font-size:15px}.small{font-size:13px;color:var(--muted)}`;
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

// state: 'form' (the page), 'thanks' (sent), with `error` and the `values` typed when a send was refused.
export function render(p, { state = 'form', error = '', values = {} } = {}) {
  const L = p.cfg.look || {}, name = t(L.name, 80) || 'Your agent', first = name.split(' ')[0];
  const who = `<div class="me">${hasPhoto(p.ws.id) ? `<img src="/r/${esc(p.code)}/photo" alt="${esc(name)}">` : ''}<div><b>${esc(name)}</b><span class="muted">${esc([t(L.title, 80), t(L.location, 80)].filter(Boolean).join(' · '))}</span></div></div>`;
  const small = t(L.disclaimer, 300) ? `<p class="small">${esc(L.disclaimer)}</p>` : '';
  if (state === 'thanks') return page(`Thanks, from ${name}`, `${who}<div class="card"><b>Thanks${values.name ? `, ${esc(t(values.name, 40))}` : ''}.</b><span>${esc(first)} will get back to you soon.</span>${p.booking ? `<a class="btn alt" href="/r/${esc(p.code)}/book">Or pick a time now</a>` : ''}</div>${small}`);
  const hook = t(p.video.scenes?.[0]?.text, 160);
  return page(`${name}`, `${who}
    ${hook ? `<div class="watched">You watched:<q>${esc(hook)}</q></div>` : ''}
    <div class="card"><span>Questions about this? I’m happy to help, with no pressure.</span>
      ${p.booking ? `<a class="btn" href="/r/${esc(p.code)}/book">Pick a time to talk</a>` : ''}</div>
    <form class="card" method="post" action="/r/${esc(p.code)}" autocomplete="on">
      <b>${p.booking ? 'Or leave your number' : 'Leave your number'}</b>
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
      <label>Your first name<input name="name" maxlength="60" required autocomplete="given-name" value="${esc(values.name || '')}"></label>
      <label>Phone or email<input name="contact" maxlength="120" required autocomplete="tel" value="${esc(values.contact || '')}"></label>
      <label>What would you like to know? (optional)<textarea name="message" maxlength="300">${esc(values.message || '')}</textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn" type="submit">Send to ${esc(first)}</button>
      <span class="small">This goes to ${esc(first)}, only to get back to you.</span>
    </form>${small}`);
}
export function notActive() {
  return page('Link not active', '<div class="card"><b>This link isn’t active right now</b><span>Send the agent a message instead and they’ll get back to you.</span></div>');
}

/* ---------------- The form ---------------- */
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const PHONE = /^[+()\-.\s\d]{7,25}$/;
const recent = new Map();   // address (an IPv6 network) → { n, at }: a few sends an hour from one place
export const PER_HOUR = 5;
export const PER_DAY = 30;    // page leads a workspace takes in 24 hours, from everyone together
export const KEEP_FREE = 200; // client-list places page leads leave for the agent's own entries
// One IPv6 network (/64) counts as one address: a phone or a script gets a whole block of them.
export function netOf(ip) {
  const a = String(ip || '').replace(/^::ffff:(?=\d+\.)/i, '').replace(/%.*$/, '');
  if (!a.includes(':')) return a;
  const [l, r = ''] = a.split('::'), L = l ? l.split(':') : [], R = a.includes('::') && r ? r.split(':') : [];
  const all = a.includes('::') ? [...L, ...Array(Math.max(0, 8 - L.length - R.length)).fill('0'), ...R] : L;
  return all.slice(0, 4).map(x => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
const DUP_MS = 3600000;
// A sent form: { ok, client, values } (`dup` when the same person sent it again, a refresh of the
// thank-you page, and nothing new was kept) or an error with `status` (and the values to show again).
export function addLead(p, form, { ip = '', now = Date.now() } = {}) {
  const values = { name: t(form.name, 60), contact: t(form.contact, 120), message: t(form.message, 300) };
  const fail = (status, message) => Object.assign(new Error(message), { status, values });
  if (t(form.website, 200)) return { ok: true, bot: true, values };   // a bot filled the hidden field: thanked, not kept
  const key = `${p.ws.id}|${netOf(ip)}`, h = recent.get(key);
  if (h && now - h.at < 3600000 && h.n >= PER_HOUR) throw fail(429, 'That’s a few already. Try again in a little while.');
  if (!values.name) throw fail(400, 'Add your first name.');
  const email = EMAIL.test(values.contact) ? values.contact : '', phone = !email && PHONE.test(values.contact) && values.contact.replace(/\D/g, '').length >= 7 ? values.contact : '';
  if (!email && !phone) throw fail(400, 'Add a phone number or an email address, so they can reach you.');
  const all = clients.list(p.ws.id), digits = x => String(x || '').replace(/\D/g, '');
  const same = all.find(c => c.videoId === p.video.id && now - Date.parse(c.createdAt) < DUP_MS && (email ? c.email.toLowerCase() === email.toLowerCase() : digits(c.phone) === digits(phone)));
  if (same) return { ok: true, dup: true, client: same, values };
  const busy = p.booking ? ' Use Pick a time instead.' : ' Send a message instead.';
  const today = all.filter(c => c.source.startsWith('Video: ') && now - Date.parse(c.createdAt) < 86400000).length;
  if (today >= PER_DAY || all.length >= clients.MAX_CLIENTS - KEEP_FREE) throw fail(429, `This page can’t take more messages today.${busy}`);
  recent.set(key, h && now - h.at < 3600000 ? { n: h.n + 1, at: h.at } : { n: 1, at: now });
  if (recent.size > 10000) for (const [k, x] of recent) if (now - x.at > 3600000) recent.delete(k);
  const hook = t(p.video.scenes?.[0]?.text, 80);
  const client = clients.add(p.ws.id, { name: values.name, email, phone, stage: 'lead', source: `Video: “${hook}”`.slice(0, 120), notes: values.message ? `Asked: ${values.message}` : '', videoId: p.video.id });
  store.updateVideo(p.ws.id, p.video.id, v => ({ leads: { total: (v.leads?.total || 0) + 1, last: new Date(now).toISOString() } }));
  return { ok: true, client, values };
}
export const _resetLeads = () => recent.clear();

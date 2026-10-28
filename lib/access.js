// lib/access.js — "Request access" from the public page (/welcome). Invite-only: a request never
// creates an account. It's saved in data/access-requests.json, you get an alert, and you invite the
// people you want from Admin. Handled requests are removed after ACCESS_KEEP_DAYS (180).
import path from 'path';
import { DIRS, readJSON, updateJSON, randomId } from './paths.js';
import { notify } from './alerts.js';

const FILE = path.join(DIRS.data, 'access-requests.json');
const KEEP = 500;
const DAY = 86400000;
const keepDays = () => { const n = Number(process.env.ACCESS_KEEP_DAYS); return Number.isFinite(n) && n > 0 ? n : 180; };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const PRODUCTS = { final_expense: 'Final expense', mortgage: 'Mortgage protection', family: 'Family protection', other: 'Something else' };
const okEmail = e => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e);

export const listRequests = () => readJSON(FILE, []);

// Returns { request, fresh }. fresh = false when the same email asked in the last day (no new alert).
export function addRequest(body, { ip = '', now = Date.now() } = {}) {
  const email = clip(body.email, 120).toLowerCase();
  const name = clip(body.name, 80);
  if (!name) throw Object.assign(new Error('Add your name.'), { status: 400 });
  if (!okEmail(email)) throw Object.assign(new Error('That email address doesn’t look right.'), { status: 400 });
  if (body.consent !== true) throw Object.assign(new Error('Tick the box so we can contact you about access.'), { status: 400 });
  const req = {
    id: randomId('ar', 5), at: new Date(now).toISOString(), status: 'new',
    name, email, phone: clip(body.phone, 30), business: clip(body.business, 100), states: clip(body.states, 120),
    products: (Array.isArray(body.products) ? body.products : []).filter(p => PRODUCTS[p]).slice(0, 4),
    heard: clip(body.heard, 120), message: clip(body.message, 800), ip: clip(ip, 64),
    ref: /^[A-Za-z]{2,6}-[2-9A-Za-z]{4}$/.test(String(body.ref || '').trim()) ? String(body.ref).trim().toUpperCase() : '',   // a referral code
  };
  let fresh = true, out = req;
  updateJSON(FILE, [], list => {
    const recent = list.find(r => r.email === email && now - Date.parse(r.at) < DAY);
    if (recent) { fresh = false; Object.assign(recent, { ...req, id: recent.id, at: recent.at, status: recent.status }); out = recent; return list; }
    return [req, ...list].slice(0, KEEP);
  });
  if (fresh) notify({ level: 'info', kind: 'access', title: 'New access request', text: `${name} <${email}>${req.business ? `, ${req.business}` : ''}${req.states ? ` (${req.states})` : ''}. Invite them from Admin → Access requests.` });
  return { request: out, fresh };
}

export function setStatus(id, status) {
  if (!['new', 'invited', 'dismissed'].includes(status)) throw Object.assign(new Error('Unknown status.'), { status: 400 });
  let out = null;
  updateJSON(FILE, [], list => { const r = list.find(x => x.id === id); if (r) { r.status = status; r.handledAt = new Date().toISOString(); out = r; } return list; });
  return out;
}
// When you invite someone who asked, their request is marked invited.
export function markInvited(email) {
  const e = String(email || '').toLowerCase();
  updateJSON(FILE, [], list => { list.filter(r => r.email === e && r.status === 'new').forEach(r => { r.status = 'invited'; r.handledAt = new Date().toISOString(); }); return list; });
}
// Nightly: handled requests older than ACCESS_KEEP_DAYS go.
export function prune(now = Date.now()) {
  let n = 0;
  updateJSON(FILE, [], list => list.filter(r => { const old = r.status !== 'new' && now - Date.parse(r.handledAt || r.at) > keepDays() * DAY; if (old) n++; return !old; }));
  return n;
}

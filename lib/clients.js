// lib/clients.js — the agent's people: clients (Mindset → Relationship notes) and leads (the Desk).
// What matters to each person, so every conversation starts with them; where a lead stands; when to
// reach out next; and the dates that make good reasons to (a birthday, the policy's anniversary).
// One list per workspace (clients.json), included in the data download and deleted with the workspace.
//
// stage: lead → talking → booked → client (or lost). `assignee`: who follows up (an account id).
import path from 'path';
import { readJSON, updateJSON, randomId } from './paths.js';
import { check } from './shapes.js';
import { wsDir } from './store.js';

const file = ws => path.join(wsDir(ws), 'clients.json');
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const okDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
export const MAX_CLIENTS = 2000;

export const STAGES = { lead: 'New lead', talking: 'Talking', booked: 'Appointment booked', client: 'Client', lost: 'Not now' };
// A real month and day (Feb 29 allowed: in other years it's remembered on Mar 1).
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const okMonthDay = d => { const m = /^(0[1-9]|1[0-2])-(\d{2})$/.exec(String(d)); return !!m && Number(m[2]) >= 1 && Number(m[2]) <= DAYS_IN[Number(m[1]) - 1]; };
// Only these fields, trimmed. `next`: when to reach out next (YYYY-MM-DD). `birthday`: MM-DD.
// `since`: when their policy started (YYYY-MM-DD), for anniversary check-ins.
export function cleanClient(c = {}, base = {}) {
  const pick = k => (k in c ? c[k] : base[k]);
  return {
    id: base.id || randomId('cl', 5), createdAt: base.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    name: t(pick('name'), 80), family: t(pick('family'), 300), interests: t(pick('interests'), 300), wins: t(pick('wins'), 300), notes: t(pick('notes'), 1000),
    next: okDay(pick('next')) ? pick('next') : '', last: okDay(pick('last')) ? pick('last') : '',
    stage: Object.hasOwn(STAGES, String(pick('stage'))) ? pick('stage') : 'client',
    phone: t(pick('phone'), 40), email: t(pick('email'), 120), source: t(pick('source'), 120),
    birthday: okMonthDay(pick('birthday')) ? pick('birthday') : '', since: okDay(pick('since')) ? pick('since') : '',
    assignee: /^[\w-]{1,40}$/.test(String(pick('assignee') || '')) ? pick('assignee') : '',
    // The video whose page they came from (v15), and when their stage last changed (for the welcome and
    // thank-you items). Only a real change counts: someone added as a client (the default) has none, so
    // they're never "welcomed as a new client"; someone added as a lead or booked starts from then.
    videoId: /^[\w-]{1,40}$/.test(String(pick('videoId') || '')) ? pick('videoId') : '',
    stageAt: stageAtFor(c, base),
    // When they first booked a time from a video (v15, lib/bookings.js): the booking is counted once.
    // Their Instagram id, when they came from a keyword reply (v15, lib/replies.js): the same person isn't added twice.
    igsid: /^[\w-]{1,40}$/.test(String(pick('igsid') || '')) ? pick('igsid') : '',
    bookedAt: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(String(pick('bookedAt') || '')) ? pick('bookedAt') : '',
    careDone: (Array.isArray(pick('careDone')) ? pick('careDone') : []).filter(k => /^(birthday|anniversary|quiet|thanks|welcome):\d{4}-\d{2}-\d{2}$/.test(String(k))).slice(-20),
  };
}
function stageAtFor(c, base) {
  const stage = Object.hasOwn(STAGES, String(c.stage)) ? c.stage : null;
  if (base.id) return stage && stage !== base.stage ? new Date().toISOString() : base.stageAt || '';
  return stage && stage !== 'client' ? new Date().toISOString() : '';
}
export const list = ws => readJSON(file(ws), []);
export const get = (ws, id) => list(ws).find(c => c.id === id) || null;
export function add(ws, data) {
  const c = cleanClient(data);
  if (!c.name) throw Object.assign(new Error('Add their name.'), { status: 400 });
  let full = false;
  check('client', c, 'clients.add');
  updateJSON(file(ws), [], all => { if (all.length >= MAX_CLIENTS) { full = true; return all; } return [c, ...all]; });
  if (full) throw Object.assign(new Error(`That’s ${MAX_CLIENTS} clients, the most one list holds.`), { status: 409 });
  return c;
}
export function save(ws, id, data) {
  if ('name' in data && !t(data.name, 80)) throw Object.assign(new Error('A client needs a name.'), { status: 400 });
  let out = null;
  updateJSON(file(ws), [], all => all.map(c => (c.id === id ? (out = { ...c, ...cleanClient(data, c) }) : c)));
  if (out) check('client', out, 'clients.save');
  return out;
}
export function remove(ws, id) {
  let gone = false;
  updateJSON(file(ws), [], all => { const rest = all.filter(c => c.id !== id); gone = rest.length !== all.length; return rest; });
  return gone;
}
// Who to reach out to today (or overdue), with one thing to ask about: "Ask about Mia's graduation."
export function dueToday(ws, today) {
  return list(ws).filter(c => c.next && c.next <= today).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 10)
    .map(c => ({ id: c.id, name: c.name, next: c.next, ask: firstThing(c) }));
}
const firstThing = c => { const x = [c.wins, c.family, c.interests].map(s => String(s || '').split(/[,;.]/)[0].trim()).find(Boolean); return x ? `Ask about ${x.charAt(0).toLowerCase()}${x.slice(1)}.` : ''; };

// Client care: reasons to reach out that come from the calendar, within the next `days` days.
//   birthday · policy anniversary (from `since`) · quiet for six months (no contact logged)
const DAY = 86400000;
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const nextOccurrence = (mmdd, today) => {
  const y = Number(today.slice(0, 4));
  for (const yy of [y, y + 1]) { const d = `${yy}-${mmdd === '02-29' && !leap(yy) ? '03-01' : mmdd}`; if (d >= today) return d; }
  return '';
};
// Each item has a `key` (kind:date); one marked done (markCare) doesn't come back until next time.
// Dated items come first; at most 5 "gone quiet" ones, so they never crowd out a birthday.
export function careDue(ws, today, days = 14) {
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10), dated = [], quiet = [];
  for (const c of list(ws).filter(x => x.stage === 'client' || !x.stage)) {
    const done = new Set(c.careDone || []);
    if (c.birthday) { const d = nextOccurrence(c.birthday, today); if (d && d <= until && !done.has(`birthday:${d}`)) dated.push({ id: c.id, name: c.name, kind: 'birthday', date: d, key: `birthday:${d}`, text: `${c.name}’s birthday` }); }
    if (c.since) {
      const d = nextOccurrence(c.since.slice(5), today), years = d ? Number(d.slice(0, 4)) - Number(c.since.slice(0, 4)) : 0;
      if (d && years >= 1 && d <= until && !done.has(`anniversary:${d}`)) dated.push({ id: c.id, name: c.name, kind: 'anniversary', date: d, key: `anniversary:${d}`, text: `${c.name}’s policy turns ${years} (a good time for a review)` });
    }
    const last = c.last || c.createdAt?.slice(0, 10);
    if (last && Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`) > 182 * DAY && !done.has(`quiet:${today}`)) quiet.push({ id: c.id, name: c.name, kind: 'quiet', date: today, key: `quiet:${today}`, text: `No contact with ${c.name} in six months`, last });
  }
  // v15: a new client gets a welcome (for 30 days after they became one), and a booked appointment a
  // thank-you (for 5 days). Both from when their stage changed.
  const fresh = [];
  for (const c of list(ws)) {
    const since = String(c.stageAt || '').slice(0, 10), age = since ? (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / DAY : Infinity;
    if (c.stage === 'client' && age <= 30 && !(c.careDone || []).includes(`welcome:${since}`)) fresh.push({ id: c.id, name: c.name, kind: 'welcome', date: since, key: `welcome:${since}`, text: `Welcome ${c.name} as a new client` });
    if (c.stage === 'booked' && age <= 5 && !(c.careDone || []).includes(`thanks:${since}`)) fresh.push({ id: c.id, name: c.name, kind: 'thanks', date: since, key: `thanks:${since}`, text: `Thank ${c.name} for booking a time` });
  }
  return [...fresh.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10), ...dated.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 25), ...quiet.sort((a, b) => a.last.localeCompare(b.last)).slice(0, 5)];
}
// A care item handled: remembered so it leaves the list; reaching out also counts as contact.
export function markCare(ws, id, key, today) {
  let out = null;
  updateJSON(file(ws), [], all => all.map(c => (c.id === id ? (out = { ...c, ...cleanClient({ careDone: [...(c.careDone || []), key], last: today }, c) }) : c)));
  return out;
}
// Leads by stage, for the Desk's pipeline.
export const pipeline = ws => Object.fromEntries(Object.keys(STAGES).map(k => [k, list(ws).filter(c => (c.stage || 'client') === k).length]));


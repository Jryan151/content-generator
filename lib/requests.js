// lib/requests.js — change requests from agents in done-for-you (managed) workspaces. The team runs
// their content, brand and settings, so instead of editing, the agent asks: "Add a worry about
// Medicare supplements", "Use my new headshot". Each request is kept in the workspace (requests.json),
// you see open ones in Admin → Done-for-you clients, and marking one done (with a short reply) tells
// the agent.
import path from 'path';
import { readJSON, updateJSON, randomId } from './paths.js';
import { wsDir } from './store.js';

const file = ws => path.join(wsDir(ws), 'requests.json');
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const AREAS = { content: 'Topics and facts', voice: 'How it sounds', brand: 'Look and end card', posting: 'Posting and schedule', other: 'Something else' };
export const MAX_OPEN = 20;

export const list = ws => readJSON(file(ws), []);
export function add(ws, { text, area = 'other', by = '', byName = '' }) {
  const r = { id: randomId('rq', 4), text: t(text, 800), area: Object.hasOwn(AREAS, String(area)) ? area : 'other', at: new Date().toISOString(), by, byName: t(byName, 80), status: 'open', doneAt: '', reply: '' };
  if (!r.text) throw Object.assign(new Error('Say what you’d like changed.'), { status: 400 });
  let full = false;
  updateJSON(file(ws), [], all => { if (all.filter(x => x.status === 'open').length >= MAX_OPEN) { full = true; return all; } return [r, ...all].slice(0, 200); });
  if (full) throw Object.assign(new Error(`You have ${MAX_OPEN} open requests. Your team will get to them; add more once some are done.`), { status: 409 });
  return r;
}
export function finish(ws, id, reply = '') {
  let out = null;
  updateJSON(file(ws), [], all => all.map(r => (r.id === id && r.status === 'open' ? (out = { ...r, status: 'done', doneAt: new Date().toISOString(), reply: t(reply, 500) }) : r)));
  return out;
}
export const open = ws => list(ws).filter(r => r.status === 'open');

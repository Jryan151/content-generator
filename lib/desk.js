// lib/desk.js — the Assistant Desk: what needs doing today in a workspace, and handoffs between an
// assistant and the agent.
//
// A handoff is something one person prepared for the other to finish: a reply drafted to a message
// (the agent sends it; replies come from the licensed agent), a video fixed and ready to watch, a
// lead to call. Kept per workspace (handoffs.json), in the data download, deleted with the workspace.
import path from 'path';
import { readJSON, updateJSON, randomId } from './paths.js';
import { check } from './shapes.js';
import { wsDir, readVideos, getAccount } from './store.js';
import * as clients from './clients.js';
import { needsResults } from '../mixer-core.js';

const file = ws => path.join(wsDir(ws), 'handoffs.json');
const t = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
export const KINDS = { reply: 'Reply to send', video: 'Video to watch', lead: 'Lead to call', note: 'Note', changes: 'Changes to make' };
// A "Needs changes" from Review (v15): what to change in each scene of a Studio video. Each item is
// { k: 'scene:what' (or 'music'), i, what, label, done }.
export const CHANGE_WHAT = { caption: 'Caption', say: 'Spoken line', accent: 'Highlighted word', footage: 'Footage', music: 'Music' };
export function cleanChecklist(items = []) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(items) ? items : []) {
    const what = Object.hasOwn(CHANGE_WHAT, String(x?.what)) ? x.what : '';
    const i = what === 'music' ? null : Number.isInteger(x?.i) && x.i >= 0 && x.i < 12 ? x.i : NaN;
    if (!what || Number.isNaN(i)) continue;
    const k = what === 'music' ? 'music' : `${i}:${what}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ k, i, what, label: what === 'music' ? 'Music' : `Scene ${i + 1}: ${CHANGE_WHAT[what].toLowerCase()}`, done: !!x.done });
  }
  return out.slice(0, 60);
}
export const MAX_OPEN = 50;

export const list = ws => readJSON(file(ws), []);
// replaces: an open handoff this one takes the place of (closed in the same save, so it makes room).
export function add(ws, { kind = 'note', title = '', message = '', draft = '', clientId = '', videoId = '', to = '', by = '', byName = '', draftId = '', checklist = null, replaces = '' }) {
  const h = {
    id: randomId('h', 5), kind: Object.hasOwn(KINDS, String(kind)) ? kind : 'note', title: t(title, 140), message: t(message, 1200), draft: t(draft, 1500),
    clientId: /^[\w-]{1,40}$/.test(clientId) ? clientId : '', videoId: /^[\w-]{1,40}$/.test(videoId) ? videoId : '', to: /^[\w-]{1,40}$/.test(to) ? to : '',
    by, byName: t(byName, 80), at: new Date().toISOString(), status: 'open', doneAt: '', doneBy: '',
    ...(/^[\w-]{1,40}$/.test(draftId) ? { draftId } : {}), ...(checklist ? { checklist: cleanChecklist(checklist) } : {}),
  };
  if (!h.title && !h.message && !h.draft) throw Object.assign(new Error('Add what needs doing.'), { status: 400 });
  check('handoff', h, 'desk.add');
  let full = false;
  updateJSON(file(ws), [], all => {
    const next = replaces ? all.map(x => (x.id === replaces && x.status === 'open' ? { ...x, status: 'done', doneAt: h.at, doneBy: by } : x)) : all;
    if (next.filter(x => x.status === 'open').length >= MAX_OPEN) { full = true; return all; }   // (nothing changed, the old one stays open)
    return [h, ...next].slice(0, 300);
  });
  if (full) throw Object.assign(new Error(`There are ${MAX_OPEN} open handoffs. Finish some first.`), { status: 409 });
  return h;
}
// Ticks (or unticks) one item of a "changes" checklist. Returns the handoff, or null.
export function tick(ws, id, k, done) {
  let out = null;
  updateJSON(file(ws), [], all => all.map(h => {
    if (h.id !== id || h.status !== 'open' || !Array.isArray(h.checklist)) return h;
    const checklist = h.checklist.map(x => (x.k === k ? { ...x, done: !!done } : x));
    if (!checklist.some(x => x.k === k)) return h;
    return (out = { ...h, checklist });
  }));
  return out;
}
export function finish(ws, id, by) {
  let out = null;
  updateJSON(file(ws), [], all => all.map(h => (h.id === id && h.status === 'open' ? (out = { ...h, status: 'done', doneAt: new Date().toISOString(), doneBy: by }) : h)));
  return out;
}
export const remove = (ws, id) => { let gone = false; updateJSON(file(ws), [], all => { const rest = all.filter(h => h.id !== id); gone = rest.length !== all.length; return rest; }); return gone; };

// Today's list for one person: the few things worth doing now, most useful first. `caps` decides
// what's theirs (only the agent approves; anyone with client access follows up).
//   { id, kind, text, count?, go }  go = where the portal takes them
export function todayList(ws, { today, caps = [], accountId = '' }) {
  const vids = readVideos(ws), out = [];
  const pending = vids.filter(v => v.status === 'pending').length;
  if (pending && caps.includes('approve')) out.push({ id: 'review', kind: 'review', text: `${pending} video${pending === 1 ? '' : 's'} to watch and approve`, go: 'review' });
  else if (pending) out.push({ id: 'review', kind: 'review', text: `${pending} video${pending === 1 ? ' is' : 's are'} waiting for the agent to approve`, go: 'review' });
  const open = list(ws).filter(h => h.status === 'open' && (!h.to || h.to === accountId));
  const mine = open.filter(h => h.by !== accountId);
  if (mine.length) out.push({ id: 'handoffs', kind: 'handoff', text: `${mine.length} handoff${mine.length === 1 ? '' : 's'} for you`, go: 'leads' });
  if (caps.includes('clients')) {
    const due = clients.dueToday(ws, today);
    if (due.length) out.push({ id: 'followups', kind: 'followup', text: `${due.length} follow-up${due.length === 1 ? '' : 's'} due: ${due.slice(0, 3).map(c => c.name).join(', ')}${due.length > 3 ? '…' : ''}`, go: 'leads' });
    const care = clients.careDue(ws, today, 7);
    if (care.length) out.push({ id: 'care', kind: 'care', text: care.slice(0, 2).map(c => c.text).join(' · ') + (care.length > 2 ? ` and ${care.length - 2} more` : ''), go: 'leads' });
  }
  if (caps.includes('results')) {
    const n = needsResults(vids).length;
    if (n) out.push({ id: 'results', kind: 'results', text: `${n} posted video${n === 1 ? '' : 's'} ready for views and messages`, go: 'review' });
  }
  return out;
}
// Readable names for who did what (the activity feed).
export const nameOf = id => { const a = getAccount(id); return a ? a.name || a.email : 'Someone'; };

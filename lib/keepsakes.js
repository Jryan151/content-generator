// lib/keepsakes.js — private videos for one client (v15 Phase 8, "the rear seat"): a birthday video with
// their first name and the agent's end card, and a welcome video for a new client made from the agent's
// own clips. They're for texting, never posted: kept apart from the agent's videos (their own list, not
// in Review, posting, results, milestones or the month's count), and removed after KEEP_DAYS.
//
// workspaces/<ws>/keepsakes.json: [{ id, kind, clientId, name, lines, status, file, cover, createdAt,
// by, jobId, error }] with status 'making' | 'ready' | 'failed'. Files live with the videos
// (video_<id>.mp4), so the portal plays and downloads them like any video.
import fs from 'fs';
import path from 'path';
import { readJSON, updateJSON } from './paths.js';
import * as store from './store.js';
import * as clients from './clients.js';
import * as library from './library.js';
import { keepsakeLines } from '../mixer-core.js';
import { replyProblems } from './coach.js';

export const KINDS = { birthday: 'Birthday video', welcome: 'Welcome video' };
export const KEEP_DAYS = 60;
export const PER_MONTH = 12;
export const MAX_LINES = 4, MAX_CHARS = 60;
const file = ws => path.join(store.wsDir(ws), 'keepsakes.json');
const first = name => String(name || '').trim().split(/\s+/)[0].slice(0, 30);
export const list = ws => readJSON(file(ws), []);
export const get = (ws, id) => list(ws).find(k => k.id === id) || null;

// The lines each kind starts with (the agent can change them before it's made).
export const defaultLines = (kind, client) => keepsakeLines(kind, client?.name);
// Personal, not an ad, but held to the same rules as a reply to a client (lib/coach.js replyProblems:
// prices, government wording, absolute claims, promises, the never-use words), and no guarantees.
const PROBLEMS = [
  [/\bguarantee\w*|\bpromise\w*|\byou(?:'|’)?ll (?:qualify|be approved|be covered)\b/i, 'Leave out promises about coverage.'],
];
const WHY = { 'price or percentage': 'Leave prices and percentages out.', 'government wording': 'Leave out government program wording.', promise: 'Leave out promises about coverage.', 'banned word': 'That line uses a word on your never-use list (Setup → Voice and rules).' };
export function checkLines(lines, cfg) {
  const clean = (Array.isArray(lines) ? lines : []).map(l => String(l ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (clean.length < 2 || clean.length > MAX_LINES) throw Object.assign(new Error(`Use 2 to ${MAX_LINES} lines.`), { status: 400 });
  const long = clean.find(l => l.length > MAX_CHARS);
  if (long) throw Object.assign(new Error(`Keep each line under ${MAX_CHARS} characters (“${long.slice(0, 30)}…”).`), { status: 400 });
  for (const l of clean) {
    for (const [re, why] of PROBLEMS) if (re.test(l)) throw Object.assign(new Error(why), { status: 400 });
    const found = replyProblems(l, cfg || {});
    if (found.length) throw Object.assign(new Error(WHY[found[0]] || 'Take that line out.'), { status: 400 });
  }
  return clean;
}
// The footage for each line: the agent's own clips (a welcome needs at least one; they repeat if there
// are fewer clips than lines), or for a birthday without clips, warm stock footage.
export const STOCK = { birthday: ['birthday cake candles', 'colorful balloons celebration', 'flowers bouquet sunlight', 'friends celebrating outdoors'] };
export function footageFor(ws, kind, n) {
  const own = library.list(ws).filter(c => library.fileOf(ws, c.id)).sort((a, b) => (a.uses || 0) - (b.uses || 0));
  if (kind === 'welcome' && !own.length) throw Object.assign(new Error('A welcome video is made from your own clips. Add a few in Setup → Library → Your own clips first.'), { status: 409 });
  if (own.length) return Array.from({ length: n }, (_, i) => ({ own: own[i % own.length] }));
  return Array.from({ length: n }, (_, i) => ({ keyword: STOCK.birthday[i % STOCK.birthday.length] }));
}
// The month's count is kept on its own (keepsakes-count.json: { month, n }), so deleting keepsakes
// doesn't make room for more renders.
const countFile = ws => path.join(store.wsDir(ws), 'keepsakes-count.json');
const monthOf = now => new Date(now).toISOString().slice(0, 7);
const thisMonth = (ws, now) => {
  const c = readJSON(countFile(ws), {}), listed = list(ws).filter(k => String(k.createdAt).slice(0, 7) === monthOf(now)).length;
  return Math.max(c.month === monthOf(now) ? c.n || 0 : 0, listed);
};
const count = (ws, now, by) => updateJSON(countFile(ws), {}, c => ({ month: monthOf(now), n: Math.max(0, (c.month === monthOf(now) ? c.n || 0 : 0) + by) }));
// Taken back when one couldn't even be queued (it never cost anything).
export const refund = (ws, now = Date.now()) => count(ws, now, -1);

// A new keepsake for a client, waiting to be made (the server queues the job). Returns the record.
export function create(ws, { kind, clientId, lines, by = '', id, now = Date.now() }) {
  if (!Object.hasOwn(KINDS, kind)) throw Object.assign(new Error('Which kind of video?'), { status: 400 });
  const client = clients.get(ws, clientId);
  if (!client) throw Object.assign(new Error('Client not found.'), { status: 404 });
  if (thisMonth(ws, now) >= PER_MONTH) throw Object.assign(new Error(`That’s ${PER_MONTH} this month. More next month.`), { status: 429 });
  const clean = checkLines(lines?.length ? lines : defaultLines(kind, client), store.loadConfig(ws));
  footageFor(ws, kind, clean.length);   // a welcome without own clips is refused now, not after waiting
  const k = { id, kind, clientId, name: first(client.name), lines: clean, status: 'making', file: '', cover: '', createdAt: new Date(now).toISOString(), by, jobId: '', error: '' };
  updateJSON(file(ws), [], all => [k, ...all].slice(0, 100));
  count(ws, now, 1);
  return k;
}
export function save(ws, id, patch) {
  let out = null;
  updateJSON(file(ws), [], all => all.map(k => (k.id === id ? (out = { ...k, ...patch }) : k)));
  return out;
}
export function remove(ws, id) {
  const k = get(ws, id);
  if (!k) return false;
  for (const f of [k.file, k.cover]) if (f) fs.rmSync(store.videoPath(ws, f), { force: true });
  updateJSON(file(ws), [], all => all.filter(x => x.id !== id));
  return true;
}
// A client deleted: their keepsakes go too (files and all). Returns the jobs still to cancel.
export function removeFor(ws, clientId) {
  const theirs = list(ws).filter(k => k.clientId === clientId);
  theirs.forEach(k => remove(ws, k.id));
  return theirs.filter(k => k.status === 'making' && k.jobId).map(k => k.jobId);
}
// Nightly: keepsakes older than KEEP_DAYS go (they were for sending, not keeping). Returns how many.
export function prune(ws, now = Date.now()) {
  const old = list(ws).filter(k => now - Date.parse(k.createdAt) > KEEP_DAYS * 86400000);
  old.forEach(k => remove(ws, k.id));
  return old.length;
}
// The ids the nightly inspection should treat as known (so it never removes a keepsake's file).
export const ids = ws => list(ws).map(k => k.id);

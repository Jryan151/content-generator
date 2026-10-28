// lib/store.js — accounts, workspaces and each workspace's own files.
//
//   data/accounts.json
//   data/workspaces/<id>/workspace.json   name, billing, limits, setup status
//   data/workspaces/<id>/config.json      the agent's mixer settings (+ history/)
//   data/workspaces/<id>/videos.json      review queue and approval records
//   data/workspaces/<id>/recent.json      recent scripts, so new ones don't repeat
//   data/workspaces/<id>/used-clips.json  stock clips already used
//   videos/<id>/                          finished videos and covers
//
// Every function takes the workspace id, so one agent can never read another's files.
import fs from 'fs';
import path from 'path';
import * as renderRules from './rules.js';
import { DIRS, ROOT, readJSON, writeJSON, updateJSON, randomId, jsonExists, docVersion } from './paths.js';
import { DEFAULT_CONFIG, migrate } from '../mixer-core.js';
import { membershipsOf } from './roles.js';
import { check } from './shapes.js';

const KEEP_VERSIONS = 30;
const KEEP_RECENT = 50;   // (Admin → Render rules decides how many count for “too close”; 30 by default)
const KEEP_USED_CLIPS = 400;
const WS_RE = /^w[0-9a-f]{12}$/;
const ACCOUNTS = path.join(DIRS.data, 'accounts.json');

export const validWs = id => WS_RE.test(String(id || ''));
export function wsDir(id) {
  if (!validWs(id)) throw new Error('Bad workspace id');
  return path.join(DIRS.workspaces, id);
}
const wsFile = (id, name) => path.join(wsDir(id), name);
export function videoDir(id) {
  if (!validWs(id)) throw new Error('Bad workspace id');
  const d = path.join(DIRS.videos, id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// The agent's logo for the end card (a small PNG, re-encoded on upload). Lives with the workspace data.
export const logoPath = id => path.join(wsDir(id), 'logo.png');
export const hasLogo = id => fs.existsSync(logoPath(id));
export const videoPath = (id, name) => {
  if (!/^[\w.-]+$/.test(String(name || '')) || name.startsWith('.')) throw new Error('Bad file name');
  return path.join(videoDir(id), name);
};

/* ---------------- Accounts ---------------- */
export const listAccounts = () => readJSON(ACCOUNTS, []);
export const getAccount = id => listAccounts().find(a => a.id === id) || null;
export const normEmail = e => String(e || '').trim().toLowerCase();
export const findAccountByEmail = email => listAccounts().find(a => a.email === normEmail(email)) || null;

export function createAccount({ email, name = '', role = 'agent', workspaceId = null, hash }) {
  const e = normEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('That email address doesn’t look right.');
  if (findAccountByEmail(e)) throw new Error('An account with that email already exists.');
  const acc = { id: randomId('u'), email: e, name: String(name).trim().slice(0, 80), role: role === 'admin' ? 'admin' : 'agent', workspaceId, hash, createdAt: new Date().toISOString(), lastLoginAt: '', disabled: false };
  check('account', acc, 'createAccount');
  updateJSON(ACCOUNTS, [], list => { list.push(acc); });
  return acc;
}
export function updateAccount(id, patch) {
  let out = null;
  updateJSON(ACCOUNTS, [], list => { const a = list.find(x => x.id === id); if (a) { Object.assign(a, patch); check('account', a, 'updateAccount'); out = a; } });
  return out;
}
// Removes every login in a workspace (when the workspace is deleted). Returns the removed accounts.
// Someone who also belongs to another workspace (an assistant helping two agents) keeps their login
// and loses only this membership.
export function removeAccountsIn(wsId) {
  let gone = [];
  updateJSON(ACCOUNTS, [], list => {
    const out = [];
    for (const a of list) {
      const mine = membershipsOf(a), here = mine.some(m => m.ws === wsId);
      if (!here) { out.push(a); continue; }
      const rest = mine.filter(m => m.ws !== wsId);
      if (!rest.length) { gone.push(a); continue; }
      out.push({ ...a, memberships: rest, workspaceId: rest.some(m => m.ws === a.workspaceId) ? a.workspaceId : rest[0].ws });
    }
    return out;
  });
  return gone;
}
// Removes a login entirely (an assistant removed from their only workspace). Its audit entries stay.
export function deleteAccount(id) { let gone = false; updateJSON(ACCOUNTS, [], list => { const rest = list.filter(a => a.id !== id); gone = rest.length !== list.length; return rest; }); return gone; }
// Adds or changes a membership (role and options) for an account.
export function setMembership(accountId, wsId, patch) {
  let out = null;
  updateJSON(ACCOUNTS, [], list => {
    const a = list.find(x => x.id === accountId);
    if (!a) return;
    const mine = membershipsOf(a), i = mine.findIndex(m => m.ws === wsId);
    if (patch === null) mine.splice(i, i < 0 ? 0 : 1); else if (i < 0) mine.push({ ws: wsId, ...patch }); else mine[i] = { ...mine[i], ...patch };
    a.memberships = mine;
    if (!mine.some(m => m.ws === a.workspaceId)) a.workspaceId = mine[0]?.ws || null;
    out = a;
  });
  return out;
}
// What the browser may see about an account.
// termsVersion / acceptedAt: the Terms of Service and Privacy Policy version the person accepted, and when.
// twofa: whether two-factor login is on (never the key or backup codes).
export const publicAccount = a => a && ({ id: a.id, email: a.email, name: a.name, role: a.role, workspaceId: a.workspaceId, termsVersion: a.termsVersion || '', acceptedAt: a.acceptedAt || '', weeklyEmail: a.weeklyEmail !== false, twofa: !!a.twofa?.enabledAt });

/* ---------------- Workspaces ---------------- */
// A workspace whose record is damaged beyond repair is left out (you've been alerted about it), so one
// bad file never stops the overnight jobs, posting or Admin for everyone else.
export function listWorkspaces() {
  return fs.readdirSync(DIRS.workspaces).filter(validWs).map(id => { try { return getWorkspace(id); } catch (e) { skipWorkspace({ id }, e, 'workspaces'); return null; } }).filter(Boolean)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export const getWorkspace = id => (validWs(id) ? readJSON(wsFile(id, 'workspace.json'), null) : null);
// Loops over every workspace (posting, overnight jobs, emails) wrap each workspace in skipWorkspace: one
// workspace's problem (a damaged file, a bug) is logged and reported, and the others carry on.
let wsErrorHook = null;
export const onWorkspaceError = fn => { wsErrorHook = fn; };
export function skipWorkspace(ws, e, where = '') {
  if (process.env.NODE_ENV !== 'test') console.error(`[${where}] ${ws?.id || '?'}: ${e?.message || e}`);
  try { wsErrorHook?.(e, `${where} (${ws?.id || '?'})`); } catch { /* reporting must not stop the loop */ }
}

export function createWorkspace({ name, comped = false, timezone = 'America/Denver' }) {
  const id = randomId('w');
  const ws = {
    id, name: String(name || 'New workspace').trim().slice(0, 80), createdAt: new Date().toISOString(),
    onboarded: false, acceptedAt: '', acceptedBy: '',
    comped: !!comped, suspended: false, limits: { videosPerMonth: null },
    billing: { status: '', plan: '', customerId: '', subscriptionId: '', periodEnd: '', cancelAtPeriodEnd: false, trialUsed: false, updatedAt: '' },
    keepReadyDay: '', lastActiveAt: '',
  };
  check('workspace', ws, 'createWorkspace');
  fs.mkdirSync(path.join(wsDir(id), 'history'), { recursive: true });
  writeJSON(wsFile(id, 'workspace.json'), ws);
  const cfg = migrate(DEFAULT_CONFIG);
  cfg.profile.timezone = timezone;
  writeJSON(wsFile(id, 'config.json'), cfg);
  return ws;
}
export function updateWorkspace(id, patch) {
  const file = wsFile(id, 'workspace.json');
  if (!jsonExists(file)) return null;
  return updateJSON(file, {}, ws => {
    const p = typeof patch === 'function' ? patch(ws) : patch;
    if (p && p !== ws) {
      for (const [k, v] of Object.entries(p)) ws[k] = v && typeof v === 'object' && !Array.isArray(v) && ws[k] && typeof ws[k] === 'object' ? { ...ws[k], ...v } : v;
    }
    check('workspace', ws, 'updateWorkspace');
    return ws;
  });
}

/* ---------------- Config (with saved versions) ---------------- */
// The config as saved, plus the render rules in force for this workspace (Admin → Render rules, v15),
// so every check reads the same ones. The rules are never saved with the config.
export function loadConfig(id) {
  const raw = readJSON(wsFile(id, 'config.json'), null);
  const cfg = migrate(raw || DEFAULT_CONFIG);
  cfg.rules = renderRules.effective(id);
  return cfg;
}
// `history: false`: a background update (like link verdicts) that isn't a version of its own.
export function saveConfig(id, cfg, { history = true } = {}) {
  const { rules: _inForce, ...own } = cfg || {};
  const clean = migrate(own);
  const file = wsFile(id, 'config.json'), hist = path.join(wsDir(id), 'history');
  fs.mkdirSync(hist, { recursive: true });
  if (history && jsonExists(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(hist, `config-${stamp}.json`), JSON.stringify(readJSON(file, {}), null, 2));
    listHistory(id).slice(KEEP_VERSIONS).forEach(h => fs.rmSync(path.join(hist, h.name), { force: true }));
  }
  writeJSON(file, clean);
  return { ...clean, rules: renderRules.effective(id) };
}
export function listHistory(id) {
  const hist = path.join(wsDir(id), 'history');
  if (!fs.existsSync(hist)) return [];
  return fs.readdirSync(hist).filter(n => /^config-[\w-]+\.json$/.test(n))
    .map(name => ({ name, savedAt: fs.statSync(path.join(hist, name)).mtime.toISOString() }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function readHistory(id, name) {
  if (!/^config-[\w-]+\.json$/.test(name)) throw new Error('Unknown version');
  return migrate(JSON.parse(fs.readFileSync(path.join(wsDir(id), 'history', name), 'utf8')));
}

/* ---------------- Videos (review queue + approval records) ---------------- */
// videos.json holds every video: waiting for review, approved, posted and rejected.
//
// Reads are cached until the file changes (docVersion), so the minute ticks don't parse every agent's
// list every minute. The cached list is shared: callers must not change it (in the checks it's frozen, so
// a change throws there).
const vcache = new Map();   // file → { ver, list }, the most recently used last
const VCACHE_MAX = () => Math.max(20, Number(process.env.VIDEO_CACHE_FILES) || 300);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
function cachedList(file) {
  const ver = docVersion(file);
  if (ver === null) { vcache.delete(file); return []; }
  const hit = vcache.get(file);
  if (hit && hit.ver === ver) { vcache.delete(file); vcache.set(file, hit); return hit.list; }
  let list = readJSON(file, []);
  if (!Array.isArray(list)) list = [];
  if (process.env.NODE_ENV === 'test') deepFreeze(list);
  vcache.delete(file);
  vcache.set(file, { ver, list });
  // Bounded: the least recently read lists go (a deleted workspace's).
  while (vcache.size > VCACHE_MAX()) vcache.delete(vcache.keys().next().value);
  return list;
}
export const readVideos = id => cachedList(wsFile(id, 'videos.json'));
// How many videos are in each status, without re-reading videos.json when it hasn't changed.
// (docVersion changes on every write: the file's inode/mtime/size, or the database row's version.) Shown on
// every page load and in Admin for each workspace, so it's worth not parsing the whole list each time.
const countCache = new Map();
export function videoCounts(id) {
  const file = wsFile(id, 'videos.json');
  const key = docVersion(file), hit = countCache.get(id);
  if (!key) return { total: 0, pending: 0, approved: 0, posted: 0, rejected: 0 };
  if (hit?.key === key) return { ...hit.counts };
  const counts = { total: 0, pending: 0, approved: 0, posted: 0, rejected: 0 };
  for (const v of readVideos(id)) { counts.total++; if (v.status in counts) counts[v.status]++; }
  countCache.set(id, { key, counts });
  return { ...counts };
}
// A copy the caller may change (the cached lists are shared).
const own = v => (v ? JSON.parse(JSON.stringify(v)) : null);
export const getVideo = (id, vid) => own(readVideos(id).find(x => x.id === vid));
export function addVideo(id, rec) { updateJSON(wsFile(id, 'videos.json'), [], list => { check('video', rec, 'addVideo'); list.unshift(rec); }); return rec; }
export function updateVideo(id, vid, patch) {
  let out = null;
  const apply = list => {
    const v = list.find(x => x.id === vid);
    if (v) { Object.assign(v, typeof patch === 'function' ? patch(v) : patch, { updatedAt: new Date().toISOString() }); check('video', v, 'updateVideo'); out = v; }
  };
  updateJSON(wsFile(id, 'videos.json'), [], apply);
  return out;
}
// Several videos changed in one save (the nightly cleanup: one write per workspace, not one per video).
export function updateVideos(id, vids, patch) {
  const set = new Set(vids), out = [];
  if (!set.size) return out;
  updateJSON(wsFile(id, 'videos.json'), [], list => {
    const at = new Date().toISOString();
    for (const v of list) if (set.has(v.id)) { Object.assign(v, typeof patch === 'function' ? patch(v) : patch, { updatedAt: at }); check('video', v, 'updateVideos'); out.push(v); }
  });
  return out;
}
export function removeVideoFiles(id, v) {
  [v.file, v.cover].filter(Boolean).forEach(n => { try { fs.rmSync(videoPath(id, n), { force: true }); } catch {} });
}
// Removes videos (records first, in one save; then their files: a cut-off in between leaves only stray
// files, which the nightly inspection clears). Returns the removed records.
export function removeVideos(id, vids) {
  const set = new Set(vids);
  let gone = [];
  if (!set.size) return gone;
  updateJSON(wsFile(id, 'videos.json'), [], list => { gone = list.filter(x => set.has(x.id)); return list.filter(x => !set.has(x.id)); });
  // Their tracking links stop working (lib/links.js keeps the codes in data/links.json).
  const links = gone.map(v => v.link).filter(Boolean);
  if (links.length) updateJSON(path.join(DIRS.data, 'links.json'), {}, all => { for (const l of links) delete all[l]; return all; });
  for (const v of gone) { removeVideoFiles(id, v); try { fs.rmSync(path.join(DIRS.assets, id, v.id), { recursive: true, force: true }); } catch (e) { console.error('[store] assets not removed:', e.message); } }
  return gone;
}
export const removeVideo = (id, vid) => removeVideos(id, [vid]).length > 0;

/* ---------------- Recent scripts and used clips ---------------- */
export const readRecent = id => readJSON(wsFile(id, 'recent.json'), []);
// A new version of a video replaces its entry (v15), so a resubmitted draft is one recent video, not two.
export function addRecent(id, entry) {
  updateJSON(wsFile(id, 'recent.json'), [], list => [{ ...entry, at: new Date().toISOString() }, ...list.filter(r => !entry.videoId || r.videoId !== entry.videoId)].slice(0, KEEP_RECENT));
}
export function markRecent(id, videoId, patch) {
  updateJSON(wsFile(id, 'recent.json'), [], list => { list.filter(r => r.videoId === videoId).forEach(r => Object.assign(r, patch)); });
}
export const readUsedClips = id => readJSON(wsFile(id, 'used-clips.json'), []);
export function addUsedClips(id, ids) {
  updateJSON(wsFile(id, 'used-clips.json'), [], list => [...list, ...ids].slice(-KEEP_USED_CLIPS));
  addServerClips(id, ids);
}
// Stock clips used by any agent on this server, so two agents don't post the same clip. A clip
// another workspace used in the last SHARED_CLIP_DAYS (default 120; 0 = off) is avoided, the same
// way an agent's own recent clips are. Only clip ids, workspace ids and dates are kept.
const SERVER_CLIPS = path.join(DIRS.data, 'used-clips-all.json');
export const sharedClipDays = () => Math.max(0, Number(process.env.SHARED_CLIP_DAYS ?? 120) || 0);
function addServerClips(id, ids) {
  if (!ids.length || !sharedClipDays()) return;
  const now = Date.now(), keep = sharedClipDays() * 86400000, at = new Date(now).toISOString().slice(0, 10);
  updateJSON(SERVER_CLIPS, {}, all => {
    for (const c of ids) all[c] = [{ ws: id, at }, ...(all[c] || []).filter(x => x.ws !== id)].slice(0, 20);
    for (const [c, uses] of Object.entries(all)) { const fresh = uses.filter(x => now - Date.parse(x.at) <= Math.max(keep, 86400000)); if (fresh.length) all[c] = fresh; else delete all[c]; }
    return all;
  });
}
// A deleted workspace leaves nothing behind in the shared list.
export function forgetServerClips(id) {
  updateJSON(SERVER_CLIPS, {}, all => { for (const [c, uses] of Object.entries(all)) { const rest = uses.filter(x => x.ws !== id); if (rest.length) all[c] = rest; else delete all[c]; } return all; });
}
// Clip ids other workspaces used recently.
export function clipsUsedElsewhere(id, now = Date.now()) {
  const days = sharedClipDays();
  if (!days) return [];
  return Object.entries(readJSON(SERVER_CLIPS, {})).filter(([, uses]) => uses.some(x => x.ws !== id && now - Date.parse(x.at) <= days * 86400000)).map(([c]) => (/^\d+$/.test(c) ? Number(c) : c));
}
// Every clip this workspace should steer clear of: its own recent ones and other agents'.
export const clipsToAvoid = id => [...readUsedClips(id), ...clipsUsedElsewhere(id)];

/* ---------------- Approved scripts (style examples for new ones) ---------------- */
const KEEP_EXAMPLES = 12;
export const readExamples = id => readJSON(wsFile(id, 'examples.json'), []);
export function addExample(id, v) {
  const lines = (v.scenes || []).map(sc => String(sc.say || sc.text || '').trim()).filter(Boolean);
  if (!lines.length) return;
  updateJSON(wsFile(id, 'examples.json'), [], list => [{ videoId: v.id, format: v.meta?.format || '', painId: v.meta?.painId || '', lines, at: new Date().toISOString() }, ...list.filter(e => e.videoId !== v.id)].slice(0, KEEP_EXAMPLES));
}
export function removeExample(id, videoId) { updateJSON(wsFile(id, 'examples.json'), [], list => list.filter(e => e.videoId !== videoId)); }

/* ---------------- Coach notes and the weekly check-in ---------------- */
// Notes: what the coach should remember about how this agent works (their words, or changes
// they applied). Kept short so they always fit in the coach's context.
const KEEP_NOTES = 20;
export const readNotes = id => readJSON(wsFile(id, 'coach-notes.json'), []);
export function addNote(id, text, kind = 'note') {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!t) return null;
  const note = { id: randomId('n'), text: t, kind: kind === 'applied' ? 'applied' : 'note', at: new Date().toISOString() };
  updateJSON(wsFile(id, 'coach-notes.json'), [], list => {
    const rest = list.filter(n => n.text.toLowerCase() !== t.toLowerCase());
    // Applied changes are a log: keep the newest 8 so they never crowd out the agent's own notes.
    const applied = rest.filter(n => n.kind === 'applied'), own = rest.filter(n => n.kind !== 'applied');
    const next = note.kind === 'applied' ? [note, ...applied].slice(0, 8).concat(own) : [note, ...own].concat(applied.slice(0, 8));
    return next.slice(0, KEEP_NOTES);
  });
  return note;
}
export function removeNote(id, noteId) { updateJSON(wsFile(id, 'coach-notes.json'), [], list => list.filter(n => n.id !== noteId)); }
/* ---------------- Style reads: how real messages from each audience read (DISC) ---------------- */
// Each time the reply helper reads a message's communication style and the sender's audience is
// picked, it's kept here. After enough of them, Communicate shows which style each audience's real
// messages lean (mixer-core.js styleCalibration). Only the audience id, the style letter and the time.
const KEEP_READS = 300;
export const readStyleReads = id => readJSON(wsFile(id, 'style-reads.json'), []);
export function addStyleRead(id, { audienceId, style }) {
  const k = String(style || '').toUpperCase().replace(/[^DISC]/g, '').slice(0, 1);
  if (!k || !/^[\w-]{1,40}$/.test(String(audienceId || ''))) return null;
  const entry = { audienceId, style: k, at: new Date().toISOString() };
  updateJSON(wsFile(id, 'style-reads.json'), [], list => [entry, ...list].slice(0, KEEP_READS));
  return entry;
}
export const readWeekly = id => readJSON(wsFile(id, 'weekly.json'), null);
export const saveWeekly = (id, w) => { writeJSON(wsFile(id, 'weekly.json'), w); return w; };

/* ---------------- One-time move from the single-agent version ---------------- */
// Earlier versions kept one agent's files in prompts/ and data/. On first start they become
// one comped workspace. Facts start unconfirmed: the agent confirms them once in setup.
export function migrateLegacy(log = console.log) {
  if (listWorkspaces().length) return null;
  // Next to the data folder, so tests (which use a temp data folder) never touch the real files.
  const legacyRoot = path.dirname(DIRS.data);
  const oldCfgFile = path.join(legacyRoot, 'prompts', 'config.json');
  const oldVideosFile = path.join(DIRS.data, 'videos.json');
  if (!fs.existsSync(oldCfgFile) && !fs.existsSync(oldVideosFile)) return null;

  const cfg = migrate(readJSON(oldCfgFile, null) || DEFAULT_CONFIG);
  const ws = createWorkspace({ name: cfg.look?.name || 'My workspace', comped: true });
  writeJSON(wsFile(ws.id, 'config.json'), cfg);

  const oldHist = path.join(legacyRoot, 'prompts', 'history');
  if (fs.existsSync(oldHist)) fs.readdirSync(oldHist).filter(n => /^config-[\w-]+\.json$/.test(n))
    .forEach(n => fs.copyFileSync(path.join(oldHist, n), path.join(wsDir(ws.id), 'history', n)));

  const oldVideos = readJSON(oldVideosFile, []);
  const moved = [];
  for (const v of oldVideos) {
    const from = path.join(DIRS.videos, v.file || '');
    const exists = v.file && fs.existsSync(from);
    if (exists) fs.renameSync(from, videoPath(ws.id, v.file));
    moved.push({ ...v, status: ['pending', 'approved', 'rejected'].includes(v.status) ? v.status : 'pending', fileDeleted: !exists, legacy: true });
  }
  writeJSON(wsFile(ws.id, 'videos.json'), moved);
  const recent = readJSON(path.join(DIRS.data, 'recent.json'), null);
  if (recent) writeJSON(wsFile(ws.id, 'recent.json'), recent);
  const used = readJSON(path.join(DIRS.data, 'used-clips.json'), null);
  if (used) writeJSON(wsFile(ws.id, 'used-clips.json'), used);

  [oldCfgFile, oldVideosFile, path.join(DIRS.data, 'recent.json'), path.join(DIRS.data, 'used-clips.json')]
    .filter(f => fs.existsSync(f)).forEach(f => fs.renameSync(f, f + '.migrated'));
  log(`Moved the single-agent setup into workspace "${ws.name}" (${ws.id}), with ${moved.length} video(s). Its facts need confirming once in setup.`);
  return getWorkspace(ws.id);
}

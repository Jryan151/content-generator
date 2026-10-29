// lib/reels.js — Agent Reels on this site: each person's log, and the leader's view of their team.
//
// A team is a workspace. Its owner is the leader; the agents and recruits on it are members with the
// `teammate` role (lib/roles.js), which opens Agent Reels and nothing else in the workspace.
//
// Each person's log is one document per workspace: data/workspaces/<ws>/reels/<account>.json. The
// phone keeps a copy and sends only what changed (sync), so a log that grows for months never travels
// whole. Rules the server holds to, whatever a phone sends:
//   • the log only grows: entries can be taken back only in the minutes right after they were made
//     (the app's 10-second undo), never older ones;
//   • every entry is checked against the kinds of entries Agent Reels has;
//   • two phones can't overwrite each other: every change names the revision it was made on, and
//     when another phone saved in between, the new entries are added on (the log only grows),
//     never dropped. Each phone says which entries the server already has, so a retry never doubles them.
//   • taking someone off a team archives their log (their sales stay in the team's history);
//     inviting them again brings it back.
// The leader sees their people's activity, never their clients' names.
import fs from 'fs';
import path from 'path';
import { readJSON, updateJSON, removeJSON, jsonExists } from './paths.js';
import * as store from './store.js';
import { membershipsOf } from './roles.js';
import { ACTIVITY_TYPES } from '../agent-system/src/metrics.js';
import { LEAD_STAGES } from '../agent-system/src/pipeline.js';
import { RECRUIT_STAGES } from '../agent-system/src/ladder.js';
import { teamSummary } from '../agent-system/src/attention.js';
import { duplication } from '../agent-system/src/ladder.js';
import { whereItBroke } from '../agent-system/src/timeframes.js';

export const DOC_VERSION = 2;
export const LIMITS = Object.freeze({ addPerSync: 3000, activities: 120_000, leads: 25_000, recruits: 2000, names: 2000, undoMinutes: 30 });
const TYPES = new Set(ACTIVITY_TYPES);
const LEAD_IDS = new Set(LEAD_STAGES.map((s) => s.id));
const RECRUIT_IDS = new Set([...RECRUIT_STAGES.map((s) => s.id), 'dropped']);
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, ID = /^[\w.-]{1,60}$/;

export class ReelsError extends Error {
  constructor(status, message, data = {}) { super(message); this.status = status; this.data = data; }
}
const fail = (status, msg, data) => { throw new ReelsError(status, msg, data); };

const fileFor = (wsId, accountId) => path.join(store.wsDir(wsId), 'reels', `${accountId}.json`);
const archiveDir = (wsId) => path.join(store.wsDir(wsId), 'reels', 'archived');
const archiveFor = (wsId, accountId) => path.join(archiveDir(wsId), `${accountId}.json`);
export const emptyDoc = () => ({ version: DOC_VERSION, rev: 0, updatedAt: '', profile: { licensed: null }, activities: [], leads: [], recruits: [], names: [], lastBackupAt: null });
export function getDoc(wsId, accountId) {
  const d = readJSON(fileFor(wsId, accountId), null);
  return d ? { ...emptyDoc(), ...d } : emptyDoc();
}
export const hasDoc = (wsId, accountId) => jsonExists(fileFor(wsId, accountId));
export const removeDoc = (wsId, accountId) => removeJSON(fileFor(wsId, accountId));
/** The log as a phone sees it (the server's bookkeeping stays here). */
export function publicDoc(d) { const { clients, recentAdds, ...rest } = d; return rest; }

/** Off the team: the log moves to the archive with who it was, instead of being deleted. */
export function archiveDoc(wsId, account, now = Date.now()) {
  const doc = getDoc(wsId, account.id);
  fs.mkdirSync(archiveDir(wsId), { recursive: true });
  updateJSON(archiveFor(wsId, account.id), null, () => ({ ...publicDoc(doc), archived: { name: account.name || account.email.split('@')[0], email: account.email, at: new Date(now).toISOString() } }));
  removeDoc(wsId, account.id);
}
export function archivedList(wsId) {
  let files = [];
  try { files = fs.readdirSync(archiveDir(wsId)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => ({ id: f.slice(0, -5), ...(readJSON(path.join(archiveDir(wsId), f), null)?.archived || {}) }))
    .filter((a) => a.at).sort((a, b) => b.at.localeCompare(a.at));
}
/** Invited again: their archived log comes back under their (possibly new) login. */
export function restoreArchived(wsId, account) {
  const hit = archivedList(wsId).find((a) => store.normEmail(a.email || '') === store.normEmail(account.email));
  if (!hit || hasDoc(wsId, account.id)) return false;
  const { archived, ...doc } = readJSON(archiveFor(wsId, hit.id), null) || {};
  if (!doc.activities) return false;
  const owned = { ...emptyDoc(), ...doc, activities: doc.activities, rev: (doc.rev || 0) + 1 };
  updateJSON(fileFor(wsId, account.id), null, () => owned);
  removeJSON(archiveFor(wsId, hit.id));
  return true;
}

/* ---------------- Checking what a phone sends ---------------- */
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const optDay = (v) => (typeof v === 'string' && DAY.test(v) ? v : undefined);
const CLIENT = /^[\w-]{6,40}$/;
function cleanProfile(p) {
  const out = { licensed: [true, false].includes(p.licensed) ? p.licensed : null };
  if (Number.isInteger(p.dayCalls) && p.dayCalls >= 1 && p.dayCalls <= 500) out.dayCalls = p.dayCalls;
  if (typeof p.stopAt === 'string' && TIME.test(p.stopAt)) out.stopAt = p.stopAt;
  return out;
}
const isoOk = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
function cleanMeta(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const s = JSON.stringify(m);
  return s.length <= 1000 ? JSON.parse(s) : undefined;
}
export function cleanActivity(a, now = Date.now()) {
  if (!a || typeof a !== 'object' || !TYPES.has(a.type) || !isoOk(a.occurred_at)) fail(400, 'One of the log entries isn’t something Agent Reels records.');
  const t = Date.parse(a.occurred_at);
  if (t < Date.parse('2020-01-01') || t > now + 36 * 3600_000) fail(400, 'One of the log entries has a date that can’t be right.');
  const out = { agent_id: str(a.agent_id, 60) || 'me', type: a.type, occurred_at: new Date(t).toISOString() };
  if (a.lead_id !== undefined) { if (!ID.test(String(a.lead_id))) fail(400, 'A log entry points at a client that doesn’t look right.'); out.lead_id = String(a.lead_id); }
  if (a.value !== undefined && a.value !== null) { const v = Number(a.value); if (!Number.isFinite(v) || Math.abs(v) > 10_000_000) fail(400, 'A log entry has an amount that can’t be right.'); out.value = v; }
  const meta = cleanMeta(a.meta);
  if (meta) out.meta = meta;
  return out;
}
export function cleanLead(l) {
  if (!l || typeof l !== 'object' || !ID.test(String(l.id || '')) || !LEAD_IDS.has(l.stage)) fail(400, 'One of the clients doesn’t look right.');
  const out = { id: String(l.id), agent_id: str(l.agent_id, 60) || 'me', name: str(l.name, 120), stage: l.stage, premium: Number.isFinite(Number(l.premium)) && l.premium !== null ? Math.max(0, Math.min(10_000_000, Number(l.premium))) : null };
  for (const k of ['nextOn', 'meetingOn', 'approvedOn', 'draftOn', 'graceEndsOn']) { const d = optDay(l[k]); if (d) out[k] = d; }
  for (const k of ['callbackAt', 'meetingAt']) if (typeof l[k] === 'string' && TIME.test(l[k])) out[k] = l[k];
  if (Number.isInteger(l.tries) && l.tries >= 0 && l.tries < 1000) out.tries = l.tries;
  if (l.lostReason === 'bad_number') out.lostReason = 'bad_number';
  if (l.care && typeof l.care === 'object') { const c = {}; for (const k of ['welcome', 'pre_draft', 'save']) { const d = optDay(l.care[k]); if (d) c[k] = d; } out.care = c; }
  return out;
}
const cleanRecruit = (r) => {
  if (!r || typeof r !== 'object' || !ID.test(String(r.id || '')) || !RECRUIT_IDS.has(r.stage)) fail(400, 'One of the recruits doesn’t look right.');
  const out = { id: String(r.id), name: str(r.name, 120), stage: r.stage };
  if (isoOk(r.since)) out.since = new Date(Date.parse(r.since)).toISOString();
  if (RECRUIT_IDS.has(r.droppedFrom)) out.droppedFrom = r.droppedFrom;
  return out;
};
const cleanName = (n) => { if (!n || !ID.test(String(n.id || ''))) fail(400, 'One of the names doesn’t look right.'); return { id: String(n.id), name: str(n.name, 120) }; };
const cleanList = (list, fn, max, what) => {
  if (!Array.isArray(list)) fail(400, `Send ${what} as a list.`);
  if (list.length > max) fail(413, `That’s more ${what} than one person can keep here (${max.toLocaleString('en-US')}).`);
  return list.map(fn);
};

/* ---------------- Sync: what changed on the phone since the last save ---------------- */
// body: { rev, acts: { base, add: [...], truncateTo? }, leads: { upsert: [...], remove: [ids] },
//         recruits?: [...], names?: [...], profile?: { licensed }, lastBackupAt? }
export function sync(wsId, accountId, body, now = Date.now()) {
  if (!body || typeof body !== 'object') fail(400, 'Nothing to save.');
  const acts = body.acts || {};
  const add = cleanList(acts.add || [], (a) => cleanActivity(a, now), LIMITS.addPerSync, 'log entries in one save');
  const upsert = cleanList(body.leads?.upsert || [], cleanLead, LIMITS.leads, 'clients');
  const remove = cleanList(body.leads?.remove || [], (id) => { if (!ID.test(String(id))) fail(400, 'A removed client doesn’t look right.'); return String(id); }, LIMITS.leads, 'clients');
  const recruits = body.recruits === undefined ? undefined : cleanList(body.recruits, cleanRecruit, LIMITS.recruits, 'recruits');
  const names = body.names === undefined ? undefined : cleanList(body.names, cleanName, LIMITS.names, 'names');
  const client = typeof body.client === 'string' && CLIENT.test(body.client) ? body.client : null;
  const base = Number(acts.base);
  let out;
  updateJSON(fileFor(wsId, accountId), null, (stored) => {
    const doc = stored ? { ...emptyDoc(), ...stored } : emptyDoc();
    doc.clients = { ...(doc.clients || {}) };
    const cutoffAt = new Date(now - LIMITS.undoMinutes * 60_000).toISOString();
    doc.recentAdds = (doc.recentAdds || []).filter((r) => r.at >= cutoffAt);
    const undo = acts.truncateTo !== undefined && acts.truncateTo !== null;
    const afterUndo = undo ? Number(acts.truncateTo) : doc.activities.length;
    const behind = Number(body.rev) !== doc.rev || (Number.isInteger(base) && base !== afterUndo);
    // An undo is only safe on the copy it was made on: another phone saved in between, so this one takes the latest.
    if (behind && undo) fail(409, 'Your log changed on another device. This phone has the latest copy now.', { conflict: true, rev: doc.rev, doc: publicDoc(doc) });
    if (undo) {
      const to = Number(acts.truncateTo);
      if (!Number.isInteger(to) || to < 0 || to > doc.activities.length) fail(400, 'That undo doesn’t match your log.');
      // Only entries this server received in the last few minutes (by its own clock, so logging
      // yesterday's calls after midnight can still be undone).
      const fresh = doc.recentAdds.length ? Math.min(...doc.recentAdds.map((r) => r.from)) : doc.activities.length;
      if (to < fresh) fail(409, 'Older log entries can’t be taken back, only the ones you just made.');
      doc.activities = doc.activities.slice(0, to);
      doc.recentAdds = doc.recentAdds.filter((r) => r.from < to).map((r) => ({ ...r }));
    }
    // A retry of entries the server already has (the reply got lost): skip those.
    let adding = add;
    if (behind && client && Number.isInteger(base) && (doc.clients[client] ?? 0) > base) adding = add.slice(doc.clients[client] - base);
    if (doc.activities.length + adding.length > LIMITS.activities) fail(413, 'This log is full. Ask your admin to archive older entries.');
    if (adding.length) doc.recentAdds.push({ from: doc.activities.length, at: new Date(now).toISOString() });
    doc.activities.push(...adding);
    if (upsert.length || remove.length) {
      const byId = new Map(doc.leads.map((l) => [l.id, l]));
      for (const id of remove) byId.delete(id);
      for (const l of upsert) byId.set(l.id, l);
      if (byId.size > LIMITS.leads) fail(413, 'That’s more clients than one person can keep here.');
      doc.leads = [...byId.values()];
    }
    if (recruits) doc.recruits = recruits;
    if (names) doc.names = names;
    if (body.profile && typeof body.profile === 'object' && [true, false, null].includes(body.profile.licensed)) doc.profile = cleanProfile(body.profile);
    if (body.lastBackupAt === null || isoOk(body.lastBackupAt)) doc.lastBackupAt = body.lastBackupAt;
    doc.rev += 1; doc.updatedAt = new Date(now).toISOString(); doc.version = DOC_VERSION;
    if (client) doc.clients[client] = behind ? doc.activities.length : (Number.isInteger(base) ? base : doc.activities.length - add.length) + add.length;
    // Behind: this phone's entries were added after another phone's. It gets the whole log back to catch up.
    out = behind ? { rev: doc.rev, count: doc.activities.length, leads: doc.leads.length, merged: true, doc: publicDoc(doc) } : { rev: doc.rev, count: doc.activities.length, leads: doc.leads.length };
    return doc;
  });
  return out;
}

/* ---------------- The leader's view ---------------- */
// Everyone on the team: members of the workspace with the teammate role.
export function teammates(wsId) {
  return store.listAccounts().filter((a) => !a.disabled && membershipsOf(a).some((m) => m.ws === wsId && m.role === 'teammate'))
    .map((a) => ({ account: a, since: membershipsOf(a).find((m) => m.ws === wsId).since || a.createdAt || '' }));
}

// What the ranking needs from a person's log: their activity (not their clients), for the last
// 120 days, plus every sale, approval, lapse and exam result ever (rare, and needed for quality).
const KEEP_ALWAYS = new Set(['app_written', 'policy_issued', 'chargeback', 'practice_test', 'license_passed']);
function memberRows(doc, accountId, now) {
  const cutoff = new Date(now - 120 * 86_400_000).toISOString();
  // Plus their very first entry, so "when did they start" stays true after months.
  const first = doc.activities.reduce((mn, a) => (!mn || a.occurred_at < mn.occurred_at ? a : mn), null);
  const kept = doc.activities.filter((a) => a.occurred_at >= cutoff || KEEP_ALWAYS.has(a.type));
  if (first && !kept.includes(first)) kept.unshift(first);
  return kept.map((a) => ({ ...a, agent_id: accountId }));
}

function localNow(tz, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { dayKey: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

export function teamView(wsId, { tz = 'America/Phoenix', now = Date.now() } = {}) {
  const { dayKey, hhmm } = localNow(tz, now);
  const members = teammates(wsId).map(({ account, since }) => {
    const doc = getDoc(wsId, account.id);
    return { id: account.id, name: account.name || account.email.split('@')[0], startedOn: since ? since.slice(0, 10) : null, licensed: doc.profile?.licensed ?? true, activities: memberRows(doc, account.id, now) };
  });
  const summary = teamSummary({ members, dayKey, now: hhmm, tz, plan: null });
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  // Worked out here, so months of everyone's rows never travel to the leader's phone.
  const all = members.flatMap((m) => m.activities);
  const licensed = members.filter((m) => m.licensed !== false);
  const dup = duplication({ team: licensed.map((m) => ({ id: m.id, name: m.name, startedOn: m.startedOn || dayKey })), activities: all, dayKey, tz });
  const broke = licensed.length ? whereItBroke(all, { tf: '1M', key: dayKey.slice(0, 7), tz, agentIds: licensed.map((m) => m.id) }) : { down: false };
  return {
    ...summary,
    people: summary.people.map((p) => ({ ...p, joinedOn: byId[p.id].startedOn, email: store.getAccount(p.id)?.email || '' })),
    stages: summary.stages,
    archived: archivedList(wsId).map((a) => ({ id: a.id, name: a.name, at: a.at })),
    duplication: { producingAgents: dup.producingAgents, licensedAgents: licensed.length, daysToFirstSale: dup.daysToFirstSale },
    monthBroke: broke.down && broke.agent ? { name: byId[broke.agent.agent_id]?.name || '', current: broke.trail[0].current, previous: broke.trail[0].previous, perDay: broke.agent.perDayInWeakBucket, usualPerDay: broke.agent.usualPerDay } : null,
  };
}

/* ---------------- Export (Account → download data, and the admin's export) ---------------- */
export function exportWorkspace(wsId) {
  const people = store.listAccounts().filter((a) => membershipsOf(a).some((m) => m.ws === wsId) || a.role === 'admin')
    .filter((a) => hasDoc(wsId, a.id))
    .map((a) => ({ accountId: a.id, name: a.name || '', email: a.email, role: membershipsOf(a).find((m) => m.ws === wsId)?.role || (a.role === 'admin' ? 'admin' : ''), log: publicDoc(getDoc(wsId, a.id)) }));
  const archived = archivedList(wsId).map((a) => { const { archived: info, ...log } = readJSON(archiveFor(wsId, a.id), null) || {}; return { accountId: a.id, name: info?.name || '', email: info?.email || '', role: 'former', leftAt: info?.at || '', log }; });
  return { format: 'agent-reels-team-1', people: [...people, ...archived] };
}

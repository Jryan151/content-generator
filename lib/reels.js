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
//   • two phones can't overwrite each other: every change names the revision it was made on.
// The leader sees their people's activity, never their clients' names.
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
export const emptyDoc = () => ({ version: DOC_VERSION, rev: 0, updatedAt: '', profile: { licensed: null }, activities: [], leads: [], recruits: [], names: [], lastBackupAt: null });
export function getDoc(wsId, accountId) {
  const d = readJSON(fileFor(wsId, accountId), null);
  return d ? { ...emptyDoc(), ...d } : emptyDoc();
}
export const hasDoc = (wsId, accountId) => jsonExists(fileFor(wsId, accountId));
export const removeDoc = (wsId, accountId) => removeJSON(fileFor(wsId, accountId));

/* ---------------- Checking what a phone sends ---------------- */
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const optDay = (v) => (typeof v === 'string' && DAY.test(v) ? v : undefined);
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
  let out;
  updateJSON(fileFor(wsId, accountId), null, (stored) => {
    const doc = stored ? { ...emptyDoc(), ...stored } : emptyDoc();
    // Another phone saved since this one last heard: it gets the latest copy instead.
    if (Number(body.rev) !== doc.rev) fail(409, 'Your log changed on another device. This phone has the latest copy now.', { conflict: true, rev: doc.rev, doc });
    if (acts.truncateTo !== undefined && acts.truncateTo !== null) {
      const to = Number(acts.truncateTo);
      if (!Number.isInteger(to) || to < 0 || to > doc.activities.length) fail(400, 'That undo doesn’t match your log.');
      const cutoff = new Date(now - LIMITS.undoMinutes * 60_000).toISOString();
      if (doc.activities.slice(to).some((a) => a.occurred_at < cutoff)) fail(409, 'Older log entries can’t be taken back, only the ones you just made.');
      doc.activities = doc.activities.slice(0, to);
    }
    if (Number(acts.base ?? doc.activities.length) !== doc.activities.length) fail(409, 'Your log changed on another device. This phone has the latest copy now.', { conflict: true, rev: doc.rev, doc });
    if (doc.activities.length + add.length > LIMITS.activities) fail(413, 'This log is full. Ask your admin to archive older entries.');
    doc.activities.push(...add);
    if (upsert.length || remove.length) {
      const byId = new Map(doc.leads.map((l) => [l.id, l]));
      for (const id of remove) byId.delete(id);
      for (const l of upsert) byId.set(l.id, l);
      if (byId.size > LIMITS.leads) fail(413, 'That’s more clients than one person can keep here.');
      doc.leads = [...byId.values()];
    }
    if (recruits) doc.recruits = recruits;
    if (names) doc.names = names;
    if (body.profile && typeof body.profile === 'object' && [true, false, null].includes(body.profile.licensed)) doc.profile = { licensed: body.profile.licensed };
    if (body.lastBackupAt === null || isoOk(body.lastBackupAt)) doc.lastBackupAt = body.lastBackupAt;
    doc.rev += 1; doc.updatedAt = new Date(now).toISOString(); doc.version = DOC_VERSION;
    out = { rev: doc.rev, count: doc.activities.length, leads: doc.leads.length };
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
  return doc.activities.filter((a) => a.occurred_at >= cutoff || KEEP_ALWAYS.has(a.type)).map((a) => ({ ...a, agent_id: accountId }));
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
    duplication: { producingAgents: dup.producingAgents, licensedAgents: licensed.length, daysToFirstSale: dup.daysToFirstSale },
    monthBroke: broke.down && broke.agent ? { name: byId[broke.agent.agent_id]?.name || '', current: broke.trail[0].current, previous: broke.trail[0].previous, perDay: broke.agent.perDayInWeakBucket, usualPerDay: broke.agent.usualPerDay } : null,
  };
}

/* ---------------- Export (Account → download data, and the admin's export) ---------------- */
export function exportWorkspace(wsId) {
  const people = store.listAccounts().filter((a) => membershipsOf(a).some((m) => m.ws === wsId) || a.role === 'admin')
    .filter((a) => hasDoc(wsId, a.id))
    .map((a) => ({ accountId: a.id, name: a.name || '', email: a.email, role: membershipsOf(a).find((m) => m.ws === wsId)?.role || (a.role === 'admin' ? 'admin' : ''), log: getDoc(wsId, a.id) }));
  return { format: 'agent-reels-team-1', people };
}

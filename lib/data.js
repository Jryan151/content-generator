// lib/data.js — an agent's own data: download all of it as one JSON file, ask for it to be deleted,
// and (after an admin confirms) delete it. The public page /data-deletion explains the same steps
// for people who can't log in, and is the "data deletion instructions URL" Meta's App Review asks for.
//
// Deleting removes the workspace's logins, sessions, settings and their history, videos and covers,
// approval records, coach notes, usage, the Instagram connection and any videos waiting in line.
// Nightly backups in backups/ still hold a copy until they rotate out (KEEP_BACKUPS, 14 by default).
// Stripe keeps its own billing records; cancel any subscription in Stripe before deleting.
import fs from 'fs';
import path from 'path';
import { DIRS, PRODUCT_NAME, updateJSON, removeTree, readJSON } from './paths.js';
import * as store from './store.js';
import { isMember, membership } from './roles.js';
import * as auth from './auth.js';
import * as queue from './queue.js';
import * as usage from './usage.js';
import * as ig from './instagram.js';
import * as fb from './facebook.js';
import * as links from './links.js';
import { notify } from './alerts.js';
import * as audit from './audit.js';

export const EXPORT_FORMAT = 'agent-reels-export-1';
const TOKENS = path.join(DIRS.data, 'tokens.json');   // invite and reset links (lib/auth.js)
const nowIso = () => new Date().toISOString();
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------------- Export ---------------- */
// One approval record per approved video: who approved it, what they checked, the fact it used,
// the words, and the file fingerprint. The same fields as the CSV and HTML downloads in Review.
export const approvalRecords = wsId => store.readAllVideos(wsId).filter(v => v.approval).map(v => ({
  videoId: v.id, madeAt: v.createdAt, approvedAt: v.approval.at, approvedBy: v.approval.byName, checklist: v.approval.checklist || [],
  notice: v.approval.notice || '', postedAt: v.posted?.at || '', instagramUrl: v.posted?.url || '',
  topic: v.meta?.painPoint || '', fact: v.meta?.insight || '', factSource: v.meta?.insightSource || '', factConfirmedAt: v.meta?.insightConfirmedAt || '',
  script: (v.scenes || []).map(s => s.say || s.text), postText: v.post || '', file: v.approval.file || v.file || '', sha256: v.approval.sha256 || '',
}));

const member = a => ({ ...store.publicAccount(a), createdAt: a.createdAt || '', lastLoginAt: a.lastLoginAt || '', disabled: !!a.disabled });

// Everything stored for one workspace, minus secrets (password hashes, sessions, the Instagram token).
// What a download held, in plain counts: kept as a receipt (Account shows it; it's emailed too).
export function exportCounts(out) {
  const n = x => (Array.isArray(x) ? x.length : 0);
  return { videos: n(out.videos), approvalRecords: n(out.approvalRecords), facts: n(out.settings?.story?.insights), settingsVersions: n(out.settingsHistory), coachNotes: n(out.coachNotes), keywordReplies: n(out.keywordReplies?.rules) };
}
// Video files aren't inside: they're large, and approved ones download from Review while they're kept.
export function exportWorkspace(wsId) {
  const ws = store.getWorkspace(wsId);
  if (!ws) throw new Error('Workspace not found.');
  const history = store.listHistory(wsId).map(h => { try { return { savedAt: h.savedAt, settings: store.readHistory(wsId, h.name) }; } catch { return null; } }).filter(Boolean);
  const b = ws.billing || {};
  return {
    format: EXPORT_FORMAT, product: PRODUCT_NAME, exportedAt: nowIso(),
    about: 'Everything this app stores for your workspace. Video files aren’t included: download approved videos from Review while they’re kept.',
    workspace: {
      id: ws.id, name: ws.name, createdAt: ws.createdAt, onboarded: !!ws.onboarded, setupAcceptedAt: ws.acceptedAt || '',
      plan: b.plan || '', planStatus: b.status || '', periodEnd: b.periodEnd || '', trialEnd: b.trialEnd || '', comped: !!ws.comped,
      deletionRequest: ws.deletionRequest || null,
    },
    people: store.listAccounts().filter(a => isMember(a, wsId)).map(a => ({ ...member(a), roleHere: membership(a, wsId)?.role || '' })),
    settings: store.loadConfig(wsId),
    settingsHistory: history,
    approvalRecords: approvalRecords(wsId),
    videos: store.readAllVideos(wsId),   // every year, the archive too
    coachNotes: store.readNotes(wsId),
    messageStyleReads: store.readStyleReads(wsId),
    weeklyCheckin: store.readWeekly(wsId),
    usage: usage.allUsage(wsId),
    instagram: ig.account(wsId),
    facebook: (({ connected, pageName, connectedAt }) => ({ connected, pageName, connectedAt }))(fb.account(wsId)),
    logo: store.hasLogo(wsId),
    ownClips: readJSON(path.join(store.wsDir(wsId), 'library.json'), []).map(({ id, description, duration, addedAt, uses }) => ({ id, description, duration, addedAt, uses })),
    mindset: readJSON(path.join(store.wsDir(wsId), 'mindset.json'), {}),
    memory: readJSON(path.join(store.wsDir(wsId), 'memory.json'), {}),
    notifications: { devices: readJSON(path.join(store.wsDir(wsId), 'push.json'), []).length },
    // v15 Phase 9: keyword replies (the wording and what was sent).
    keywordReplies: readJSON(path.join(store.wsDir(wsId), 'replies.json'), { on: false, rules: [] }),
    keywordRepliesLog: readJSON(path.join(store.wsDir(wsId), 'replies-log.json'), []).map(({ at, keyword, where, who, ok, why, videoId }) => ({ at, keyword, where, who, ok, why, videoId })),
    complianceSignoff: { on: !!ws.signoff?.on, since: ws.signoff?.since || '' },
    studioDrafts: readJSON(path.join(store.wsDir(wsId), 'studio.json'), []).map(({ id, title, createdAt, updatedAt, brief, scenes, status, videoId }) => ({ id, title, createdAt, updatedAt, brief, scenes, status, videoId })),
    // What was done in the workspace and by its people (logins, approvals, exports…). Admins appear as "admin".
    activity: audit.list({ ws: wsId, limit: 5000 }).map(e => (e.role === 'admin' ? { ...e, by: '', email: 'admin', ip: '' } : e)),
  };
}

/* ---------------- Deletion requests ---------------- */
// The agent asks; an admin confirms in Admin (or declines). Nothing is deleted until then.
export function requestDeletion(wsId, account, note = '') {
  const ws = store.getWorkspace(wsId);
  if (!ws) throw new Error('Workspace not found.');
  if (ws.deletionRequest) return ws.deletionRequest;
  const req = { at: nowIso(), by: account.id, byName: account.name || account.email, email: account.email, note: clip(note, 500) };
  store.updateWorkspace(wsId, { deletionRequest: req });
  notify({ level: 'warning', kind: 'deletion', title: 'Data deletion requested', text: `${req.byName} asked for this workspace and its data to be deleted.${req.note ? ` Note: ${req.note}` : ''}`, did: 'Nothing is deleted until you confirm.', run: 'Confirm or decline in Admin (its workspace card).', ws: wsId, workspaceName: ws.name });
  return req;
}
export function cancelDeletion(wsId) {
  if (!store.getWorkspace(wsId)) throw new Error('Workspace not found.');
  store.updateWorkspace(wsId, { deletionRequest: null });
  return null;
}

/* ---------------- Deleting ---------------- */
// Removes the workspace and everyone in it. Refuses while a video is rendering for it, so no file is
// written back after the folder is gone. Returns what was removed (counts only).
export function deleteWorkspace(wsId, { by = '' } = {}) {
  const ws = store.getWorkspace(wsId);
  if (!ws) throw new Error('Workspace not found.');
  if (queue.waiting(wsId).some(j => j.status === 'running')) throw Object.assign(new Error('A video is being made for this workspace right now. Try again in a few minutes.'), { busy: true });
  queue.listJobs(wsId).filter(j => j.status === 'queued').forEach(j => queue.cancel(wsId, j.id));
  const members = store.removeAccountsIn(wsId);
  members.forEach(a => auth.deleteSessionsFor(a.id));
  const videos = store.readAllVideos(wsId).length;
  removeTree(store.wsDir(wsId));   // its folder and, with SQLite, its documents
  store.forgetServerClips(wsId);
  links.forgetWorkspace(wsId);
  [path.join(DIRS.videos, wsId), path.join(DIRS.assets, wsId)].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  // Cover-picker frames cached for it.
  try { const fr = path.join(DIRS.work, 'frames'); for (const n of fs.readdirSync(fr)) if (n.startsWith(`${wsId}-`)) fs.rmSync(path.join(fr, n), { force: true }); } catch { /* none */ }
  // Unused invite links for this workspace stop working (the server also checks the workspace exists).
  updateJSON(TOKENS, [], list => list.map(t => (t.kind === 'invite' && t.workspaceId === wsId && !t.usedAt ? { ...t, usedAt: Date.now(), revoked: true } : t)));
  notify({ level: 'info', kind: 'deletion', title: 'Workspace deleted', text: `Removed ${members.length} login(s), ${videos} video record(s) and all settings. Backups keep a copy until they rotate out.${ws.billing?.subscriptionId ? ' Check its Stripe subscription is canceled.' : ''}`, ws: wsId, workspaceName: ws.name });
  return { id: wsId, name: ws.name, logins: members.length, videos, by };
}

// A subscription that will still charge the card: cancel it in Stripe before deleting.

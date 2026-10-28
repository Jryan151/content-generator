// lib/signoff.js — the compliance reviewer (v15 Phase 9): an optional second pair of eyes before anything
// posts. Many agents' carriers or marketing organizations ask that a compliance person approve their ads.
//
// The agent invites a reviewer under People (they get their own login, with nothing but the Sign-off
// page) and turns on "Videos wait for sign-off". From then on, every approved video that isn't posted
// waits for the reviewer: Instagram and Facebook hold it (a scheduled post goes out once it's signed
// off), the posting plan skips it, and it can't be downloaded or marked posted. The reviewer watches it,
// reads the script, the post text and the checks it passed, and signs off or sends it back with a note
// (it goes back to the agent's Review). A sign-off is for one version of the video: a fixed scene or a
// new version needs signing off again. Every decision is on the video's compliance receipt.
//
// video.signoff: { status: 'ok' | 'back', by, byName, at, version, file, note }
// workspace.signoff: { on, since, by }
import * as store from './store.js';
import * as roles from './roles.js';
import { signedOff } from '../mixer-core.js';
import * as push from './push.js';
import * as mail from './email.js';
export { signedOff };

export const MAX_REVIEWERS = 3;
const iso = () => new Date().toISOString();
const err = (status, message) => Object.assign(new Error(message), { status });

export const reviewersOf = wsId => store.listAccounts().filter(a => !a.disabled && roles.membership(a, wsId)?.role === 'reviewer');
// On, and someone there to sign off (with no reviewer, nothing would ever post).
export const required = ws => !!ws?.signoff?.on && reviewersOf(ws.id).length > 0;
// Approved, not posted, and not signed off while sign-off is on.
export const waiting = (ws, v) => required(ws) && v?.status === 'approved' && !signedOff(v);
const nameOf = wsId => reviewersOf(wsId).map(a => a.name || a.email)[0] || 'your reviewer';
export const waitText = wsId => `Waiting for ${nameOf(wsId)} to sign off. It can be posted once they have.`;
// Videos as the week ahead and "running low" should count them: one waiting for the reviewer is still
// in review, not ready to post.
export const asPlanned = (ws, videos) => (required(ws) ? videos.map(v => (waiting(ws, v) ? { ...v, status: 'pending' } : v)) : videos);
// Throws when the video can't leave the app yet (download, mark posted).
export function gate(ws, v) {
  if (waiting(ws, v)) throw err(409, waitText(ws.id));
}

// The reviewers hear that something is waiting: on their phone, and by email (once per video version).
// `video`: the one just approved; without it (sign-off just turned on), everything already waiting.
export function tellReviewers(wsId, video = null) {
  const ws = store.getWorkspace(wsId), people = reviewersOf(wsId), cfg = store.loadConfig(wsId), agent = cfg.look?.name || ws?.name || '';
  const wait = store.readVideos(wsId).filter(x => waiting(ws, x));
  if (!people.length || !wait.length) return 0;
  const what = video ? `approved “${String(video.meta?.painPoint || video.scenes?.[0]?.text || 'a video').slice(0, 80)}”` : `has ${wait.length} approved video${wait.length === 1 ? '' : 's'} waiting`;
  push.send(wsId, { title: video ? 'A video is waiting for your sign-off' : 'Videos are waiting for your sign-off', body: `${agent || 'The agent'} ${what}.`, url: '/#/signoff', tag: 'signoff' }, { tz: cfg.profile?.timezone || 'America/Denver', accountIds: people.map(a => a.id) }).catch(() => {});
  const key = video ? `${video.id}:${video.version || 1}` : `on:${ws?.signoff?.since || ''}`;
  for (const a of people) mail.send({ to: a.email, ...mail.signoffEmail({ count: wait.length, agent }) }, { key: `signoff:${a.id}:${key}`, ws: wsId }).catch(() => {});
  return wait.length;
}
// Turned on or off by the agent (People). On needs a reviewer who has joined.
export function setOn(wsId, on, by = '') {
  if (on && !reviewersOf(wsId).length) throw err(409, 'Invite your reviewer first. Sign-off turns on once they’ve joined.');
  return store.updateWorkspace(wsId, { signoff: on ? { on: true, since: iso(), by } : { on: false, since: iso(), by } });
}
// The last reviewer removed: sign-off goes off (videos waiting can post again). Returns true if it did.
export function reviewerLeft(wsId) {
  const ws = store.getWorkspace(wsId);
  if (ws?.signoff?.on && !reviewersOf(wsId).length) { store.updateWorkspace(wsId, { signoff: { on: false, since: iso(), by: 'no reviewer left' } }); return true; }
  return false;
}

// What a reviewer sees: what's waiting (oldest first) and the last decisions.
const brief = v => ({
  id: v.id, version: v.version || 1, file: v.file, cover: v.cover && !v.fileDeleted ? `/media/${v.cover}` : null, media: v.file && !v.fileDeleted ? `/media/${v.file}` : null,
  createdAt: v.createdAt, approval: v.approval ? { at: v.approval.at, byName: v.approval.byName || '' } : null,
  topic: v.meta?.painPoint || '', scenes: (v.scenes || []).map(s => ({ text: s.text || '', say: s.say || '' })), post: v.post || '',
  checks: (v.preflight || []).map(c => ({ ok: !!c.ok, label: c.label || '' })), notes: (v.meta?.notes || []).slice(0, 20),
  locked: v.meta?.locked || [], signoff: v.signoff || null, status: v.status, posted: v.posted?.at || '',
});
export function listFor(wsId) {
  const ws = store.getWorkspace(wsId), vids = store.readVideos(wsId);
  const wait = vids.filter(v => waiting(ws, v)).sort((a, b) => String(a.approval?.at || '').localeCompare(String(b.approval?.at || '')));
  const recent = vids.filter(v => v.signoff?.at).sort((a, b) => b.signoff.at.localeCompare(a.signoff.at)).slice(0, 30);
  const cfg = store.loadConfig(wsId);
  return { on: required(ws), agent: cfg.look?.name || ws.name, disclaimer: cfg.look?.disclaimer || '', waiting: wait.map(brief), recent: recent.map(brief) };
}

// The reviewer's decision on the version they watched. ok: signed off. Otherwise sent back to the
// agent's Review with the note (a note is needed: the agent needs to know what to change).
export function decide(wsId, videoId, { ok, note = '', version, by, byName }) {
  const ws = store.getWorkspace(wsId), v = store.getVideo(wsId, videoId);
  if (!v) throw err(404, 'Video not found.');
  if (!waiting(ws, v)) throw err(409, v.status === 'approved' ? 'This video is already signed off.' : 'This video isn’t waiting for sign-off any more.');
  if (version != null && Number(version) !== (v.version || 1)) throw err(409, 'A new version of this video arrived since you opened it. Watch it, then decide.');
  if (v.autopost?.status === 'processing' || v.fbpost?.status === 'processing') throw err(409, 'This video is posting right now.');
  const text = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const record = { status: ok ? 'ok' : 'back', by, byName, at: iso(), version: v.version || 1, file: v.file, note: text };
  if (ok) return store.updateVideo(wsId, v.id, x => ({ signoff: record, signoffs: [...(x.signoffs || []), record].slice(-20) }));
  if (!text) throw err(400, 'Say what needs to change, so the agent knows.');
  return store.updateVideo(wsId, v.id, x => ({
    status: 'pending', approval: null, signoff: record, signoffs: [...(x.signoffs || []), record].slice(-20),
    ...(x.autopost?.status === 'scheduled' ? { autopost: null } : {}), ...(x.fbpost?.status === 'scheduled' ? { fbpost: null } : {}),
  }));
}

// routes/reels.js — Agent Reels on this site (lib/reels.js): your own log, and the leader's team.
//
//   GET    /api/reels/me              who you are here, your role, and your log      (team)
//   POST   /api/reels/sync            save what changed on your phone                 (team)
//   GET    /api/reels/team            the leader's ranked team ("who needs you")      (teamlead)
//   POST   /api/reels/invite          invite an agent or recruit to the team          (teamlead)
//   POST   /api/reels/invites/revoke  take back an invite                             (teamlead)
//   DELETE /api/reels/team/:id        take someone off the team (their log is archived) (teamlead)
//   GET    /api/reels/lessons         the team's lessons: published ones for agents, all for the leader (team)
//   GET    /api/reels/lessons/:id/video|thumb   a lesson's video and picture             (team)
//   POST   /api/reels/lessons         a new lesson from a short video (the body is the file) (teamlead)
//   POST   /api/reels/lessons/uploads             a big video, in pieces: start     (teamlead)
//   PUT    /api/reels/lessons/uploads/:id?offset= one piece (the body)              (teamlead)
//   GET    /api/reels/lessons/uploads/:id         how much arrived (to carry on)    (teamlead)
//   POST   /api/reels/lessons/uploads/:id/finish  every piece is in: make the lesson (teamlead)
//   PUT    /api/reels/lessons/:id     edit, publish or unpublish                        (teamlead)
//   POST   /api/reels/lessons/:id/move  its place in the course                         (teamlead)
//   DELETE /api/reels/lessons/:id     delete it and its video                           (teamlead)
// Accepting an invite goes through the site's own invite links (routes/public.js, routes/people.js).
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as roles from '../lib/roles.js';
import * as reels from '../lib/reels.js';
import * as lessons from '../lib/lessons.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS } from '../lib/paths.js';

export default function mount(ctx) {
const { HttpError, bad, baseUrl, pendingInvites, route, spendGate, streamFile, validTz } = ctx;
const run = (fn) => { try { return fn(); } catch (e) { if (e instanceof reels.ReelsError) bad(e.status, e.message, e.data); throw e; } };
const roleHere = (me, wsId) => (me.account.role === 'admin' ? 'admin' : roles.membership(me.account, wsId)?.role || '');
const invitesView = (wsId) => pendingInvites(wsId, 'teammate').map((t) => ({ email: t.email, at: new Date(t.createdAt).toISOString() }));

route('GET', '/api/reels/me', 'ws', ({ me, wsId, ws }) => {
  const role = roleHere(me, wsId);
  const leader = store.listAccounts().find((a) => roles.membership(a, wsId)?.role === 'owner');
  const doc = reels.getDoc(wsId, me.account.id);
  return {
    account: { id: me.account.id, name: me.account.name || '', email: me.account.email },
    role: role === 'teammate' ? 'agent' : 'leader',
    team: { id: wsId, name: ws.name, leaderName: leader?.name || ws.name },
    rev: doc.rev, log: reels.publicDoc(doc),
  };
});

route('POST', '/api/reels/sync', 'ws', ({ me, wsId, body }) => run(() => reels.sync(wsId, me.account.id, body)));

route('GET', '/api/reels/team', 'ws', ({ wsId, url }) => {
  const tz = validTz(url.searchParams.get('tz') || 'America/Phoenix');
  return { ...run(() => reels.teamView(wsId, { tz })), invites: invitesView(wsId) };
});

const inviteLimit = auth.limiter({ max: 30, windowMs: 60 * 60000 });
// Like the reviewer invite: a single-use link, sent by the leader however they like. Nobody joins
// a team without saying yes.
route('POST', '/api/reels/invite', 'ws', ({ req, wsId, me, body }) => {
  const email = store.normEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(400, 'That email address doesn’t look right.');
  if (email === store.normEmail(me.account.email)) bad(400, 'That’s you.');
  const existing = store.findAccountByEmail(email);
  if (existing?.role === 'admin') bad(409, 'That’s an admin login. Invite a different email.');
  if (roles.isMember(existing, wsId)) bad(409, roles.membership(existing, wsId).role === 'teammate' ? 'That person is already on your team.' : 'That person already has another role in this workspace.');
  if (inviteLimit.blocked(wsId)) bad(429, 'That’s a lot of invites in an hour. Try again later.');
  inviteLimit.fail(wsId);
  auth.revokeInvites((t) => t.wsRole === 'teammate' && t.workspaceId === wsId && t.email === email);
  const token = auth.createLink('invite', { email, role: 'agent', wsRole: 'teammate', workspaceId: wsId }, me.account.id);
  return { link: `${baseUrl(req)}/#/invite/${token}`, invites: invitesView(wsId) };
});

route('POST', '/api/reels/invites/revoke', 'ws', ({ wsId, body }) => {
  const email = store.normEmail(body.email);
  auth.revokeInvites((t) => t.wsRole === 'teammate' && t.workspaceId === wsId && t.email === email);
  return { invites: invitesView(wsId) };
});

// Off the team: their log is archived, so their sales stay in the team's history; inviting them
// again brings it back. A login that has nowhere else to go is removed (they can be invited again).
route('DELETE', '/api/reels/team/:id', 'ws', ({ wsId, params }) => {
  const a = store.getAccount(params.id);
  if (!a || roles.membership(a, wsId)?.role !== 'teammate') bad(404, 'That person isn’t on your team.');
  reels.archiveDoc(wsId, a);
  const left = store.setMembership(a.id, wsId, null);
  if (!roles.membershipsOf(left).length) { auth.deleteSessionsFor(a.id); store.deleteAccount(a.id); }
  return { ok: true, invites: invitesView(wsId) };
});

/* ---------------- Lessons (lib/lessons.js) ---------------- */
const lessonRun = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof lessons.LessonError) bad(e.status, e.message, e.received !== undefined ? { received: e.received } : undefined); throw e; } };
const isLeader = (me, wsId) => roleHere(me, wsId) !== 'teammate';
// How many of her people tried each lesson, from their own logs.
function leaderLessons(wsId) {
  const team = reels.teammates(wsId);
  const rows = Object.fromEntries(team.map(({ account }) => [account.id, reels.getDoc(wsId, account.id).activities || []]));
  return lessons.leaderView(wsId, { tried: lessons.triedBy(rows), struggled: lessons.struggledBy(rows), teamSize: team.length });
}
const lessonsFor = (me, wsId) => (isLeader(me, wsId) ? { role: 'leader', lessons: leaderLessons(wsId) } : { role: 'agent', lessons: lessons.agentView(wsId) });

route('GET', '/api/reels/lessons', 'ws', ({ me, wsId }) => ({ ...lessonsFor(me, wsId), steps: lessons.STEPS, maxMB: lessons.MAX_UPLOAD_MB(), maxMinutes: lessons.LIMITS.maxMinutes }));
// An agent only ever gets a published lesson's files.
const lessonFile = (kind, type) => ({ req, res, me, wsId, params }) => {
  const l = lessons.get(wsId, params.id);
  if (!l || (!isLeader(me, wsId) && !(l.published && l.status === 'ready'))) bad(404, 'That lesson isn’t here anymore.');
  const f = lessons.fileOf(wsId, l.id, kind);
  if (!f) bad(404, 'This lesson has no video yet.');
  streamFile(req, res, f, type);
};
route('GET', '/api/reels/lessons/:id/video', 'ws', lessonFile('video', 'video/mp4'));
route('GET', '/api/reels/lessons/:id/thumb', 'ws', lessonFile('thumb', 'image/jpeg'));

// The video file itself is the request body (Content-Type: video/…); ?step= is optional.
route('POST', '/api/reels/lessons', 'ws', async ({ req, me, wsId, ws, url }) => {
  if (!/^video\//.test(req.headers['content-type'] || '')) bad(415, 'Choose a video file.');
  spendGate(ws); // the transcript and the draft use the AI allowance
  const mb = lessons.MAX_UPLOAD_MB(), limit = mb * 1024 * 1024;
  const tooBig = `That video is too large. Keep it under ${mb} MB (a 2 to 5 minute lesson is plenty).`;
  if (Number(req.headers['content-length']) > limit) bad(413, tooBig);
  const tmp = path.join(DIRS.work, `lesson-upload-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await new Promise((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(tmp);
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, tooBig)); req.destroy(); out.destroy(); } });
      req.pipe(out);
      out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
    });
    const { ready, ...lesson } = await lessonRun(() => lessons.create(wsId, tmp, { step: url.searchParams.get('step') || null }));
    return { lesson, ...lessonsFor(me, wsId) };
  } finally { fs.rmSync(tmp, { force: true }); }
}, { raw: true });

// A big video, in pieces: no single request is big enough for nginx or Cloudflare to refuse.
route('POST', '/api/reels/lessons/uploads', 'ws', ({ wsId, ws, body }) => { spendGate(ws); return lessonRun(() => lessons.startUpload(wsId, { size: body.size, type: body.type })); });
route('GET', '/api/reels/lessons/uploads/:id', 'ws', ({ wsId, params }) => lessonRun(() => lessons.uploadStatus(wsId, params.id)));
route('PUT', '/api/reels/lessons/uploads/:id', 'ws', ({ req, wsId, params, url }) =>
  lessonRun(() => lessons.addPiece(wsId, params.id, url.searchParams.get('offset'), req, req.headers['content-length'])), { raw: true });
route('POST', '/api/reels/lessons/uploads/:id/finish', 'ws', ({ me, wsId, params, body }) => lessonRun(async () => {
  const { ready, ...lesson } = await lessons.finishUpload(wsId, params.id, { step: body.step || null });
  return { lesson, ...lessonsFor(me, wsId) };
}));

route('PUT', '/api/reels/lessons/:id', 'ws', ({ me, wsId, params, body }) => lessonRun(() => { lessons.edit(wsId, params.id, body); return lessonsFor(me, wsId); }));
route('POST', '/api/reels/lessons/:id/move', 'ws', ({ me, wsId, params, body }) => lessonRun(() => { lessons.move(wsId, params.id, body.to); return lessonsFor(me, wsId); }));
route('DELETE', '/api/reels/lessons/:id', 'ws', ({ me, wsId, params }) => lessonRun(() => { lessons.remove(wsId, params.id); return lessonsFor(me, wsId); }));
}

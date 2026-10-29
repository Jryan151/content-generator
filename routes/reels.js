// routes/reels.js — Agent Reels on this site (lib/reels.js): your own log, and the leader's team.
//
//   GET    /api/reels/me              who you are here, your role, and your log      (team)
//   POST   /api/reels/sync            save what changed on your phone                 (team)
//   GET    /api/reels/team            the leader's ranked team ("who needs you")      (teamlead)
//   POST   /api/reels/invite          invite an agent or recruit to the team          (teamlead)
//   POST   /api/reels/invites/revoke  take back an invite                             (teamlead)
//   DELETE /api/reels/team/:id        take someone off the team                       (teamlead)
// Accepting an invite goes through the site's own invite links (routes/public.js, routes/people.js).
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as roles from '../lib/roles.js';
import * as reels from '../lib/reels.js';

export default function mount(ctx) {
const { bad, baseUrl, pendingInvites, route, validTz } = ctx;
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
    rev: doc.rev, log: doc,
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

// Off the team: their log here is deleted with their place on it. A login that has nowhere else to
// go is removed too (they can be invited again).
route('DELETE', '/api/reels/team/:id', 'ws', ({ wsId, params }) => {
  const a = store.getAccount(params.id);
  if (!a || roles.membership(a, wsId)?.role !== 'teammate') bad(404, 'That person isn’t on your team.');
  reels.removeDoc(wsId, a.id);
  const left = store.setMembership(a.id, wsId, null);
  if (!roles.membershipsOf(left).length) { auth.deleteSessionsFor(a.id); store.deleteAccount(a.id); }
  return { ok: true, invites: invitesView(wsId) };
});
}

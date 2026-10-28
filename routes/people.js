// routes/people.js — People: the compliance reviewer (invite, remove, and whether videos wait for them).
// server.js mounts it, passing in the helpers these routes share with the rest of the server; the
// capability each route needs is listed in one place (server.js ROUTE_CAPS).
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as mail from '../lib/email.js';
import * as audit from '../lib/audit.js';
import * as roles from '../lib/roles.js';
import * as push from '../lib/push.js';
import * as signoff from '../lib/signoff.js';

export default function mount(ctx) {
const { bad, baseUrl, linkError, mailLink, nowIso, orphanInvite, pendingInvites, reviewerRoom, route } = ctx;
function peopleView(wsId) {
  const ws = store.getWorkspace(wsId);
  const people = store.listAccounts().filter(a => roles.isMember(a, wsId) && !a.disabled).map(a => {
    const m = roles.membership(a, wsId);
    return { id: a.id, name: a.name, email: a.email, role: m.role, lastLoginAt: a.lastLoginAt || '', twofa: !!a.twofa?.enabledAt };
  });
  const reviewerInvites = pendingInvites(wsId).map(t => ({ email: t.email, at: new Date(t.createdAt).toISOString(), role: 'reviewer' }));
  // Up to MAX_REVIEWERS, and whether videos wait for their sign-off.
  const reviewers = { max: signoff.MAX_REVIEWERS, invites: reviewerInvites, on: !!ws.signoff?.on, required: signoff.required(ws), since: ws.signoff?.since || '' };
  return { people, reviewers };
}
route('GET', '/api/people', 'ws', ({ wsId }) => peopleView(wsId));
const inviteLimit = auth.limiter({ max: 15, windowMs: 60 * 60000 });
// Everyone gets an invite link, even people who already have a login: nobody is added to a workspace
// without saying yes. The reply is the same either way.
route('POST', '/api/people/invite', 'ws', async ({ req, wsId, ws, body, me }) => {
  const email = store.normEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(400, 'That email address doesn’t look right.');
  if (email === store.normEmail(me.account.email)) bad(400, 'That’s you.');
  if (inviteLimit.blocked(wsId)) bad(429, 'That’s a lot of invites in an hour. Try again later.');
  if (roles.isMember(store.findAccountByEmail(email), wsId)) bad(409, 'That person is already in this workspace.');
  if (!reviewerRoom(wsId, email)) bad(409, `That’s ${signoff.MAX_REVIEWERS} reviewers, the most a workspace has.`);
  inviteLimit.fail(wsId);
  auth.revokeInvites(t => t.wsRole === 'reviewer' && t.workspaceId === wsId && t.email === email);
  const token = auth.createLink('invite', { email, role: 'agent', wsRole: 'reviewer', workspaceId: wsId }, me.account.id);
  const link = `${baseUrl(req)}/#/invite/${token}`;
  const sent = await mailLink(email, mail.reviewerInviteEmail({ link, workspace: ws.name, by: me.account.name || me.account.email, days: 7 }));
  return { ...peopleView(wsId), link, ...sent };
});
// Someone who already has a login accepts while logged in as that email.
route('POST', '/api/link/join', 'user', ({ me, body }) => {
  const t = auth.peekLink(body.token, 'invite');
  if (!t || t.wsRole !== 'reviewer' || orphanInvite(t)) bad(410, linkError);
  if (store.normEmail(me.account.email) !== t.email) bad(403, `This invite is for ${t.email}. Log in with that email to accept it.`);
  if (me.account.role === 'admin') bad(409, 'Admins can already open every workspace.');
  if (roles.isMember(me.account, t.workspaceId)) { auth.useLink(body.token, 'invite'); return { ok: true, already: true }; }
  if (signoff.reviewersOf(t.workspaceId).length >= signoff.MAX_REVIEWERS) bad(409, 'This workspace has all the reviewers it can have. Ask the agent.');
  if (!auth.useLink(body.token, 'invite')) bad(410, linkError);
  store.setMembership(me.account.id, t.workspaceId, { role: 'reviewer', since: nowIso() });
  auth.updateSession(me.session.hash, { ws: t.workspaceId });
  audit.record({ action: 'invite.accepted', who: me.account, ws: t.workspaceId, detail: t.wsRole, ip: '' });
  return { ok: true };
});
route('DELETE', '/api/people/:id', 'ws', ({ wsId, params }) => {
  const a = store.getAccount(params.id);
  if (!a || roles.membership(a, wsId)?.role !== 'reviewer') bad(404, 'Reviewer not found.');
  const left = store.setMembership(a.id, wsId, null);
  push.removeAccount(wsId, a.id);
  signoff.reviewerLeft(wsId);   // the last reviewer gone: videos no longer wait for a sign-off
  // Nowhere else to work: the login is removed (they can be invited again later). Otherwise they keep
  // it for their other workspaces.
  if (!roles.membershipsOf(left).length) { auth.deleteSessionsFor(a.id); store.deleteAccount(a.id); }
  return peopleView(wsId);
});
route('POST', '/api/people/invites/revoke', 'ws', ({ wsId, body }) => {
  const email = store.normEmail(body.email);
  auth.revokeInvites(t => t.wsRole === 'reviewer' && t.workspaceId === wsId && t.email === email);
  return peopleView(wsId);
});
// Videos wait for the reviewer's sign-off before they post, or not.
route('POST', '/api/people/signoff', 'ws', ({ wsId, body, me }) => {
  try { signoff.setOn(wsId, !!body.on, me.account.id); } catch (e) { bad(e.status || 400, e.message); }
  if (body.on) signoff.tellReviewers(wsId);   // videos approved before it was on wait now too: the reviewer hears
  return peopleView(wsId);
});
}

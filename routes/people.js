// routes/people.js — People: assistant seats, invites, who can post.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as billing from '../lib/billing.js';
import * as mail from '../lib/email.js';
import * as twofa from '../lib/twofa.js';
import * as audit from '../lib/audit.js';
import * as roles from '../lib/roles.js';
import * as push from '../lib/push.js';
import * as signoff from '../lib/signoff.js';

export default function mount(ctx) {
const { api, bad, baseUrl, hasSeat, linkError, mailLink, nowIso, orphanInvite, pendingAssistantInvites, pendingInvites, peopleRoom, reviewerRoom, route, who } = ctx;
function peopleView(wsId) {
  const ws = store.getWorkspace(wsId), seats = billing.seatsFor(ws), given = Math.max(0, Number(ws.limits?.assistantSeats) || 0);
  const people = store.listAccounts().filter(a => roles.isMember(a, wsId) && !a.disabled).map(a => {
    const m = roles.membership(a, wsId);
    return { id: a.id, name: a.name, email: a.email, role: m.role, canPost: !!m.canPost, canEdit: !!m.canEdit, lastLoginAt: a.lastLoginAt || '', twofa: !!a.twofa?.enabledAt, paused: m.role === 'assistant' && !hasSeat(a, wsId) };
  });
  const invites = pendingAssistantInvites(wsId).map(t => ({ email: t.email, at: new Date(t.createdAt).toISOString(), canPost: !!t.canPost, role: 'assistant' }));
  const reviewerInvites = pendingInvites(wsId, 'reviewer').map(t => ({ email: t.email, at: new Date(t.createdAt).toISOString(), role: 'reviewer' }));
  const used = people.filter(p => p.role === 'assistant').length + invites.length;
  const paid = billing.billingOn() && !ws.comped ? Math.max(0, seats - given) : 0;
  // The compliance reviewer (v15): free, up to MAX_REVIEWERS, and whether videos wait for their sign-off.
  const reviewers = { max: signoff.MAX_REVIEWERS, invites: reviewerInvites, on: !!ws.signoff?.on, required: signoff.required(ws), since: ws.signoff?.since || '' };
  return { people, invites, reviewers, seats: { total: seats, used, free: Math.max(0, seats - used), paid, given, minPaid: Math.max(0, used - given), canBuy: billing.canBuySeats(ws), max: billing.MAX_SEATS, managedBy: billing.canBuySeats(ws) || (billing.billingOn() && !ws.comped && billing.SEAT_PRICE(ws.billing?.interval)) ? 'billing' : 'admin' } };
}
route('GET', '/api/people', 'ws', async ({ wsId }) => ({ ...peopleView(wsId), price: await billing.seatPrice(store.getWorkspace(wsId)).catch(() => null) }));
const inviteLimit = auth.limiter({ max: 15, windowMs: 60 * 60000 });
// Everyone gets an invite link, even people who already have a login (helping another agent): nobody
// is added to a workspace without saying yes. The reply is the same either way.
route('POST', '/api/people/invite', 'ws', async ({ req, wsId, ws, body, me }) => {
  const email = store.normEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(400, 'That email address doesn’t look right.');
  if (email === store.normEmail(me.account.email)) bad(400, 'That’s you.');
  if (inviteLimit.blocked(wsId)) bad(429, 'That’s a lot of invites in an hour. Try again later.');
  // A compliance reviewer (v15): no seat, a few at most.
  if (body.role === 'reviewer') {
    if (roles.isMember(store.findAccountByEmail(email), wsId)) bad(409, 'That person is already in this workspace.');
    if (!reviewerRoom(wsId, email)) bad(409, `That’s ${signoff.MAX_REVIEWERS} reviewers, the most a workspace has.`);
    inviteLimit.fail(wsId);
    auth.revokeInvites(t => t.wsRole === 'reviewer' && t.workspaceId === wsId && t.email === email);
    const token = auth.createLink('invite', { email, role: 'agent', wsRole: 'reviewer', workspaceId: wsId }, me.account.id);
    const link = `${baseUrl(req)}/#/invite/${token}`;
    const sent = await mailLink(email, mail.reviewerInviteEmail({ link, workspace: ws.name, by: me.account.name || me.account.email, days: 7 }));
    return { ...peopleView(wsId), link, ...sent };
  }
  if (!peopleRoom(wsId, email)) bad(409, billing.canBuySeats(ws) ? 'Every assistant seat is taken. Add a seat first.' : 'Every assistant seat is taken. Ask your admin for another seat.');
  inviteLimit.fail(wsId);
  const canPost = !!body.canPost;
  // A new invite replaces any earlier one for the same email.
  auth.revokeInvites(t => t.wsRole === 'assistant' && t.workspaceId === wsId && t.email === email);
  const token = auth.createLink('invite', { email, role: 'agent', wsRole: 'assistant', canPost, workspaceId: wsId }, me.account.id);
  const link = `${baseUrl(req)}/#/invite/${token}`;
  const sent = await mailLink(email, mail.assistantInviteEmail({ link, workspace: ws.name, by: me.account.name || me.account.email, days: 7 }));
  return { ...peopleView(wsId), link, ...sent };
});
// Someone who already has a login accepts while logged in as that email.
route('POST', '/api/link/join', 'user', ({ me, body }) => {
  const t = auth.peekLink(body.token, 'invite');
  if (!t || !['assistant', 'reviewer'].includes(t.wsRole) || orphanInvite(t)) bad(410, linkError);
  if (store.normEmail(me.account.email) !== t.email) bad(403, `This invite is for ${t.email}. Log in with that email to accept it.`);
  if (me.account.role === 'admin') bad(409, 'Admins can already open every workspace.');
  if (roles.isMember(me.account, t.workspaceId)) { auth.useLink(body.token, 'invite'); return { ok: true, already: true }; }
  if (t.wsRole === 'assistant' && !peopleRoom(t.workspaceId, t.email)) bad(409, 'This workspace has no free assistant seat right now. Ask the agent to add one.');
  if (t.wsRole === 'reviewer' && signoff.reviewersOf(t.workspaceId).length >= signoff.MAX_REVIEWERS) bad(409, 'This workspace has all the reviewers it can have. Ask the agent.');
  if (!auth.useLink(body.token, 'invite')) bad(410, linkError);
  store.setMembership(me.account.id, t.workspaceId, t.wsRole === 'reviewer' ? { role: 'reviewer', since: nowIso() } : { role: 'assistant', canPost: !!t.canPost, since: nowIso() });
  auth.updateSession(me.session.hash, { ws: t.workspaceId });
  audit.record({ action: 'invite.accepted', who: me.account, ws: t.workspaceId, detail: t.wsRole, ip: '' });
  return { ok: true };
});
route('PUT', '/api/people/:id', 'ws', ({ wsId, ws, params, body }) => {
  const a = store.getAccount(params.id);
  if (!a || roles.membership(a, wsId)?.role !== 'assistant') bad(404, 'Assistant not found.');
  const patch = {};
  if ('canPost' in body) patch.canPost = !!body.canPost;
  if ('canEdit' in body) { if (billing.isManaged(ws) && body.canEdit) bad(409, 'In a done-for-you workspace your team runs the settings.'); patch.canEdit = !!body.canEdit; }
  store.setMembership(a.id, wsId, patch);
  return peopleView(wsId);
});
route('DELETE', '/api/people/:id', 'ws', ({ wsId, params }) => {
  const a = store.getAccount(params.id);
  if (!a || !['assistant', 'reviewer'].includes(roles.membership(a, wsId)?.role)) bad(404, 'Assistant not found.');
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
  auth.revokeInvites(t => ['assistant', 'reviewer'].includes(t.wsRole) && t.workspaceId === wsId && t.email === email);
  return peopleView(wsId);
});
// Videos wait for the reviewer's sign-off before they post (v15), or not.
route('POST', '/api/people/signoff', 'ws', ({ wsId, body, me }) => {
  try { signoff.setOn(wsId, !!body.on, me.account.id); } catch (e) { bad(e.status || 400, e.message); }
  if (body.on) signoff.tellReviewers(wsId);   // videos approved before it was on wait now too: the reviewer hears
  return peopleView(wsId);
});
route('POST', '/api/billing/seats', 'ws', async ({ ws, body }) => {
  // Paid seats can't go below the assistants (and invites) using them: remove someone first.
  const v = peopleView(ws.id);
  if (!Number.isFinite(Number(body.seats)) || body.seats === null || body.seats === '') bad(400, 'How many seats?');
  if (Number(body.seats) < v.seats.minPaid) bad(409, 'Those seats are in use. Remove an assistant (or take back an invite) first.');
  try { await billing.setSeats(ws, body.seats); } catch (e) { bad(e.status || 502, e.message); }
  return peopleView(ws.id);
});
}

// routes/public.js — health, who's asking (/api/me), logins, two-factor, password resets and invite links.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import crypto from 'crypto';
import { PRODUCT_NAME } from '../lib/paths.js';
import * as reels from '../lib/reels.js';
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as alerts from '../lib/alerts.js';
import * as ig from '../lib/instagram.js';
import * as fb from '../lib/facebook.js';
import * as twofa from '../lib/twofa.js';
import * as audit from '../lib/audit.js';
import * as monitor from '../lib/monitor.js';
import * as roles from '../lib/roles.js';
import * as signoff from '../lib/signoff.js';

export default function mount(ctx) {
const { isStarting, APPROVAL_NOTE, CHECKLIST, REJECT_REASONS, SECURE, TERMS_TEXT, VERSION, api, bad, baseUrl, clientIp, clip, emailLimit, ipLimit, linkError, needsTerms, newTicket, noticesFor, nowIso, orphanInvite, route, send, startSession, supportEmail, terms, termsStamp, tickets, twofaLimit, validTz, who, wsSummary } = ctx;
// For an uptime checker: 200 when all is well, 503 when something needs you (disk, backups, a stuck
// video). Point UptimeRobot or Better Stack at https://yourdomain.com/api/health. Numbers and the
// version only with ?token=HEALTH_TOKEN, so strangers learn nothing useful.
const tokenOk = (given, want) => { const a = Buffer.from(String(given || '')), b = Buffer.from(String(want || '')); return b.length >= 16 && a.length === b.length && crypto.timingSafeEqual(a, b); };
route('GET', '/api/health', 'public', ({ res, url }) => {
  const h = monitor.health();
  const full = tokenOk(url.searchParams.get('token'), process.env.HEALTH_TOKEN);
  // `starting`: the server is up but still running its data changes (update.sh's try-out waits for it).
  send(res, h.ok ? 200 : 503, { ok: h.ok, checks: h.checks, ...(isStarting() ? { starting: true } : {}), ...(full ? { version: VERSION, detail: h.detail } : {}) });
});

route('GET', '/api/me', 'public', ({ me }) => {
  const t = terms();
  const base = { product: PRODUCT_NAME, version: VERSION, support: supportEmail(), instagram: ig.igOn(), facebook: fb.fbOn(), checklist: CHECKLIST, approvalNote: APPROVAL_NOTE, rejectReasons: REJECT_REASONS, terms: { on: t.on, version: t.version, termsUrl: t.termsUrl, privacyUrl: t.privacyUrl } };
  if (!me) return { ...base, account: null };
  const admin = me.account.role === 'admin', ws = me.wsId ? store.getWorkspace(me.wsId) : null;
  // What this person can do here, which portal they see, and the other workspaces they belong to.
  const caps = roles.capsFor(me.account, ws);
  const workspaces = roles.membershipsOf(me.account).map(m => ({ id: m.ws, name: store.getWorkspace(m.ws)?.name || '', role: m.role, current: m.ws === me.wsId })).filter(x => x.name);
  const teammate = roles.membership(me.account, me.wsId)?.role === 'teammate';
  return { ...base, account: store.publicAccount(me.account), termsRequired: needsTerms(me.account), twofaSetupRequired: twofa.needsSetup(me.account), workspace: me.wsId ? (teammate ? { id: ws.id, name: ws.name, onboarded: true } : wsSummary(me.wsId, caps)) : null, acting: admin && !!me.wsId, alerts: admin ? alerts.unreadCount() : 0,
    caps, portal: roles.portalFor(me.account, ws), role: admin ? 'admin' : roles.membership(me.account, me.wsId)?.role || '', workspaces, notices: noticesFor(ws, caps) };
});
// Someone in more than one workspace (a reviewer for two agents) switches between them.
route('POST', '/api/workspaces/switch', 'user', ({ me, body }) => {
  const id = clip(body.workspaceId, 40);
  if (!roles.isMember(me.account, id) || !store.getWorkspace(id)) bad(404, 'You’re not in that workspace.');
  auth.updateSession(me.session.hash, { ws: id });
  return { ok: true };
});

route('POST', '/api/login', 'public', async ({ req, res, body }) => {
  const ip = clientIp(req), email = store.normEmail(body.email);
  if (ipLimit.blocked(ip) || emailLimit.blocked(email)) bad(429, 'Too many tries. Wait 15 minutes and try again.');
  const acc = store.findAccountByEmail(email);
  const ok = await auth.verifyPassword(String(body.password || ''), acc?.hash);
  if (!ok || !acc || acc.disabled) {
    ipLimit.fail(ip); emailLimit.fail(email);
    audit.record({ action: 'login.failed', who: acc || clip(email, 120), ws: acc?.workspaceId || '', detail: acc?.disabled ? 'account disabled' : 'wrong email or password', ip });
    bad(401, 'That email and password don’t match.');
  }
  emailLimit.clear(email);
  // Two-factor on: the password was right; the session starts once the code is checked.
  if (twofa.isOn(acc)) return { twofa: true, ticket: newTicket(acc.id) };
  startSession(req, res, acc);
  return { ok: true };
});
// The second step: a code from the authenticator app, or a backup code.
route('POST', '/api/login/2fa', 'public', ({ req, res, body }) => {
  const t = tickets.get(String(body.ticket || ''));
  if (!t || t.exp < Date.now() || t.tries >= 5) { tickets.delete(String(body.ticket || '')); bad(401, 'That took too long. Log in again.'); }
  const acc = store.getAccount(t.accountId);
  if (!acc || acc.disabled) bad(401, 'Log in again.');
  if (twofaLimit.blocked(acc.id)) bad(429, 'Too many tries. Wait 15 minutes and try again.');
  const how = twofa.verify(acc, body.code);
  if (!how) { t.tries++; twofaLimit.fail(acc.id); audit.record({ action: 'login.2fa_failed', who: acc, ws: acc.workspaceId || '', ip: clientIp(req) }); bad(401, 'That code isn’t right. Use the newest code from your app, or a backup code.'); }
  tickets.delete(String(body.ticket));
  twofaLimit.clear(acc.id);
  startSession(req, res, store.getAccount(acc.id), how === 'backup' ? 'password + backup code' : 'password + app code');
  const left = store.getAccount(acc.id).twofa?.backup?.length || 0;
  return { ok: true, usedBackup: how === 'backup', backupLeft: left };
});

route('POST', '/api/logout', 'public', ({ res, me }) => {
  if (me) auth.deleteSession(me.session.hash);
  res.setHeader('Set-Cookie', auth.clearCookie(SECURE));
  return { ok: true };
});

const linkKind = k => (k === 'reset' || k === 'signin' ? k : 'invite');
// Links are 256-bit and can't be guessed, but a run of wrong ones from one address is still cut off.
const linkGuard = req => { const ip = clientIp(req); if (ipLimit.blocked(ip)) bad(429, 'Too many tries. Wait a few minutes and try again.'); return ip; };
const linkMiss = ip => { ipLimit.fail(ip); bad(410, linkError); };
route('POST', '/api/link/check', 'public', ({ req, body }) => {
  const ip = linkGuard(req);
  const kind = linkKind(body.kind);
  const t = auth.peekLink(body.token, kind);
  if (!t || orphanInvite(t)) linkMiss(ip);
  if (kind === 'reset' || kind === 'signin') return { kind, email: store.getAccount(t.accountId)?.email || '' };
  // A reviewer invite for someone who already has a login is accepted after logging in (/api/link/join).
  return { kind, email: t.email, role: roles.JOINABLE.includes(t.wsRole) ? t.wsRole : t.role, workspace: t.workspaceId ? store.getWorkspace(t.workspaceId)?.name || '' : '', existing: roles.JOINABLE.includes(t.wsRole) && !!store.findAccountByEmail(t.email) };
});

// A sign-in link: one tap, no password. Single use, so a forwarded copy is dead once it's used.
// Two-factor, if on, is still asked. Never for admins (an admin made it, but it would open everything).
route('POST', '/api/link/signin', 'public', ({ req, res, body }) => {
  const ip = linkGuard(req);
  const t = auth.peekLink(body.token, 'signin');
  const acc = t && store.getAccount(t.accountId);
  if (!acc || acc.disabled || acc.role === 'admin') linkMiss(ip);
  if (!auth.useLink(body.token, 'signin')) bad(410, linkError);
  if (twofa.isOn(acc)) return { ok: true, twofa: true, ticket: newTicket(acc.id) };
  startSession(req, res, acc, 'sign-in link');
  return { ok: true };
});

route('POST', '/api/link/accept', 'public', async ({ req, res, body }) => {
  const ip = linkGuard(req);
  const kind = body.kind === 'reset' ? 'reset' : 'invite';
  const problem = auth.passwordProblem(body.password);
  if (problem) bad(400, problem);
  const t = auth.peekLink(body.token, kind);
  if (!t || orphanInvite(t)) linkMiss(ip);
  let acc;
  if (kind === 'invite') {
    if (store.findAccountByEmail(t.email)) bad(409, roles.JOINABLE.includes(t.wsRole) ? 'You already have a login. Log in, then open this link again to accept.' : 'An account with this email already exists. Log in, or ask your admin for a reset link.');
    if (t.wsRole === 'reviewer' && signoff.reviewersOf(t.workspaceId).length >= signoff.MAX_REVIEWERS) bad(409, 'This workspace has all the reviewers it can have. Ask the agent.');
    const askTerms = t.role !== 'admin' && terms().on;
    if (askTerms && body.acceptTerms !== true) bad(400, TERMS_TEXT);
    const hash = await auth.hashPassword(body.password);
    if (!auth.useLink(body.token, kind)) bad(410, linkError);
    if (t.role !== 'admin' && !roles.JOINABLE.includes(t.wsRole) && t.workspaceId && body.timezone) {
      const cfg = store.loadConfig(t.workspaceId);
      if (!cfg.look.name && !store.getWorkspace(t.workspaceId).onboarded) { cfg.profile.timezone = validTz(body.timezone); store.saveConfig(t.workspaceId, cfg); }
    }
    acc = store.createAccount({ email: t.email, name: clip(body.name, 80), role: t.role === 'admin' ? 'admin' : 'agent', workspaceId: t.role === 'admin' ? null : t.workspaceId, hash });
    if (t.wsRole === 'reviewer' || t.wsRole === 'assistant') acc = store.setMembership(acc.id, t.workspaceId, { role: t.wsRole, since: nowIso() });
    // An agent or recruit joining a leader's team in Agent Reels: that, and nothing else in the workspace.
    if (t.wsRole === 'teammate') { acc = store.setMembership(acc.id, t.workspaceId, { role: 'teammate', since: nowIso() }); reels.restoreArchived(t.workspaceId, acc); }
    if (askTerms) acc = store.updateAccount(acc.id, termsStamp());
  } else {
    acc = store.getAccount(t.accountId);
    if (!acc) bad(404, 'Account not found.');
    const hash = await auth.hashPassword(body.password);
    if (!auth.useLink(body.token, kind)) bad(410, linkError);
    store.updateAccount(acc.id, { hash });
    auth.deleteSessionsFor(acc.id);
    // A reset link proves the email, not the phone: two-factor is still asked.
    audit.record({ action: 'password.reset', who: acc, ws: acc.workspaceId || '', ip: clientIp(req) });
    if (twofa.isOn(acc)) return { ok: true, twofa: true, ticket: newTicket(acc.id) };
  }
  if (kind === 'invite') audit.record({ action: 'invite.accepted', who: acc, ws: acc.workspaceId || '', detail: acc.termsVersion ? `accepted terms version ${acc.termsVersion}` : '', ip: clientIp(req) });
  startSession(req, res, acc, kind === 'invite' ? 'invite link' : 'reset link');
  return { ok: true };
});
}

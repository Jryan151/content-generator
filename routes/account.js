// routes/account.js — Account; Two-factor login; Your data: download it, or ask for it to be deleted.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as data from '../lib/data.js';
import * as twofa from '../lib/twofa.js';

export default function mount(ctx) {
const { BASE_HEADERS, TERMS_FREE, TERMS_TEXT, api, bad, clip, nowIso, route, slug, terms, termsStamp, twofaLimit, who, wsSummary } = ctx;
/* ----- Account ----- */
// Accepting the current terms (first time, or after TERMS_VERSION changed).
route('POST', '/api/terms/accept', 'user', ({ body, me }) => {
  if (!terms().on) return { account: store.publicAccount(me.account), termsRequired: false };
  if (body.accept !== true) bad(400, TERMS_TEXT);
  const acc = store.updateAccount(me.account.id, termsStamp());
  return { account: store.publicAccount(acc), termsRequired: false };
});
route('POST', '/api/account', 'user', ({ body, me }) => {
  const patch = {};
  if ('name' in body) patch.name = clip(body.name, 80);
  return { account: store.publicAccount(store.updateAccount(me.account.id, patch)) };
});
route('POST', '/api/account/password', 'user', async ({ body, me }) => {
  if (!(await auth.verifyPassword(String(body.current || ''), me.account.hash))) bad(400, 'Your current password isn’t right.');
  const problem = auth.passwordProblem(body.next);
  if (problem) bad(400, problem);
  store.updateAccount(me.account.id, { hash: await auth.hashPassword(body.next) });
  auth.deleteSessionsFor(me.account.id, me.session.hash);
  return { ok: true };
});

/* ----- Two-factor login ----- */
const twofaErr = e => bad(e.status || 400, e.message);
route('GET', '/api/2fa', 'user', ({ me }) => twofa.state(me.account));
route('POST', '/api/2fa/setup', 'user', ({ me }) => {
  if (twofa.isOn(me.account)) bad(409, 'Two-factor login is already on.');
  return twofa.begin(me.account);
});
route('POST', '/api/2fa/enable', 'user', ({ me, body }) => {
  if (twofaLimit.blocked(me.account.id)) bad(429, 'Too many tries. Wait 15 minutes and try again.');
  try {
    const codes = twofa.enable(me.account, body.code);
    auth.deleteSessionsFor(me.account.id, me.session.hash);   // other devices log in again, with a code
    return { ...twofa.state(store.getAccount(me.account.id)), backupCodes: codes };
  } catch (e) { twofaLimit.fail(me.account.id); twofaErr(e); }
});
// New backup codes or turning it off both need a current code (and turning off needs the password).
function confirmCode(me, code) {
  if (twofaLimit.blocked(me.account.id)) bad(429, 'Too many tries. Wait 15 minutes and try again.');
  if (!twofa.verify(me.account, code)) { twofaLimit.fail(me.account.id); bad(400, 'That code isn’t right.'); }
}
route('POST', '/api/2fa/backup-codes', 'user', ({ me, body }) => {
  confirmCode(me, body.code);
  const acc = store.getAccount(me.account.id);
  return { ...twofa.state(acc), backupCodes: twofa.newBackupCodes(acc) };
});
route('POST', '/api/2fa/disable', 'user', async ({ me, body }) => {
  if (twofa.required(me.account)) bad(400, me.account.role === 'admin' ? 'Two-factor login is required for admins.' : 'Two-factor login is required on this server.');
  if (!(await auth.verifyPassword(String(body.password || ''), me.account.hash))) bad(400, 'Your password isn’t right.');
  confirmCode(me, body.code);
  try { twofa.disable(store.getAccount(me.account.id)); } catch (e) { twofaErr(e); }
  return twofa.state(store.getAccount(me.account.id));
});

// Where you're logged in, and logging out other devices.
route('GET', '/api/account/sessions', 'user', ({ me }) => ({ sessions: auth.listSessions(me.account.id, me.session.hash) }));
route('POST', '/api/account/sessions/logout-others', 'user', ({ me }) => {
  auth.deleteSessionsFor(me.account.id, me.session.hash);
  return { sessions: auth.listSessions(me.account.id, me.session.hash) };
});
route('DELETE', '/api/account/sessions/:id', 'user', ({ me, params }) => {
  if (me.session.hash.slice(0, 12) === params.id) bad(400, 'To end this session, log out.');
  if (!auth.deleteSessionById(me.account.id, params.id)) bad(404, 'That session already ended.');
  return { sessions: auth.listSessions(me.account.id, me.session.hash) };
});

/* ----- Your data: download it, or ask for it to be deleted ----- */
// Works before accepting new terms (TERMS_FREE), so someone who won't accept can still take their data and go.
route('GET', '/api/data/export', 'ws', ({ req, res, wsId, ws, me }) => {
  const x = data.exportWorkspace(wsId), counts = data.exportCounts(x), at = nowIso(), device = auth.deviceName(req.headers['user-agent']);
  x.receipt = { exportedAt: at, by: me.account.email, device, counts };
  const out = JSON.stringify(x, null, 2);
  // A receipt: kept on the workspace (Account shows the last one) so a download nobody expected
  // doesn't go unnoticed.
  store.updateWorkspace(wsId, { lastExport: { at, by: me.account.role === 'admin' ? 'admin' : me.account.name || me.account.email, device, counts } });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug(ws.name)}-data-${nowIso().slice(0, 10)}.json"`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
  res.end(out);
});
route('POST', '/api/data/delete-request', 'ws', async ({ wsId, ws, body, me }) => {
  if (me.account.role === 'admin') bad(400, 'This is for the agent. To delete a workspace, use node admin.js delete-workspace.');
  if (body.confirm !== true) bad(400, 'Tick the box to confirm you want everything deleted.');
  const req = data.requestDeletion(wsId, me.account, body.note);
  return { deletionRequest: req, workspace: wsSummary(wsId) };
});
route('DELETE', '/api/data/delete-request', 'ws', ({ wsId }) => { data.cancelDeletion(wsId); return { deletionRequest: null, workspace: wsSummary(wsId) }; });
}

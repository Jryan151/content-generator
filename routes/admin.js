// routes/admin.js — Admin: workspaces and logins, alerts, the Engine bay, the audit log, invites and deletions.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import { spawnSync } from 'child_process';
import { PUBLIC_URL, monthKey, storageEngine } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as allowance from '../lib/allowance.js';
import * as usage from '../lib/usage.js';
import * as queue from '../lib/queue.js';
import { maintenanceState, KEEP, freeGB } from '../lib/scheduler.js';
import * as alerts from '../lib/alerts.js';
import * as ig from '../lib/instagram.js';
import * as fb from '../lib/facebook.js';
import * as trackLinks from '../lib/links.js';
import * as mail from '../lib/email.js';
import * as data from '../lib/data.js';
import * as twofa from '../lib/twofa.js';
import * as audit from '../lib/audit.js';
import * as offsite from '../lib/offsite.js';
import * as monitor from '../lib/monitor.js';
import * as switches from '../lib/switches.js';
import * as breaker from '../lib/breaker.js';
import * as outbox from '../lib/outbox.js';
import * as roles from '../lib/roles.js';
import * as push from '../lib/push.js';
import * as renderRules from '../lib/rules.js';
import * as mixer from '../mixer-core.js';
import { nicheOf } from '../niches/index.js';
import * as clock from '../lib/clock.js';
import * as targets from '../lib/targets.js';
import { engineBay, jobTimeline } from '../lib/engine.js';
import { stampFacts, confirmedCount } from '../lib/onboarding.js';
import { migrate, rejectionSummary, insightStatus, checkInsightText } from '../mixer-core.js';

export default function mount(ctx) {
const { BASE_HEADERS, MAX_PER_REQUEST, VERSION, api, bad, baseUrl, clip, enqueueVideos, keyProblem, mailLink, needsTerms, nowIso, route, terms, usedThisMonth, who } = ctx;
/* ----- Admin ----- */
let ffmpegOk = null;
function systemInfo() {
  if (ffmpegOk === null) ffmpegOk = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0;
  const m = maintenanceState();
  return {
    version: VERSION, publicUrl: PUBLIC_URL, freeGB: freeGB(), ffmpeg: ffmpegOk,
    keys: { openai: !!process.env.OPENAI_API_KEY, pixabay: !!process.env.PIXABAY_API_KEY, instagram: ig.igOn(), facebook: fb.fbOn(), alerts: !!process.env.ALERT_WEBHOOK_URL, email: mail.emailOn() },
    emailProvider: mail.emailOn() ? mail.emailConfig().provider : '',
    aiCap: usage.defaultCap(),
    instagram: { ready: ig.publicOk(), redirect: ig.igOn() ? ig.redirectUri() : '' },
    facebook: { ready: ig.publicOk(), redirect: fb.fbOn() ? fb.redirectUri() : '' },
    lastBackup: m.backupFile || '', lastCleanup: m.cleanupDay || '', cleanup: m.cleanup || null,
    health: monitor.health().checks, healthToken: !!process.env.HEALTH_TOKEN, storage: storageEngine(),
    offsite: { on: offsite.offsiteOn(), keyProblem: process.env.BACKUP_S3_BUCKET ? offsite.keyProblem() : '', at: m.offsiteAt || '', key: m.offsiteKey || '', error: m.offsiteError || '', testAt: m.restoreTestAt || '', test: m.restoreTest || null, testError: m.restoreTestError || '' },
    queue: { waiting: queue.listJobs().filter(j => j.status === 'queued').length, running: queue.listJobs().some(j => j.status === 'running') },
  };
}
route('GET', '/api/admin/overview', 'admin', async ({ me }) => {
  const accounts = store.listAccounts();
  const member = a => ({ ...store.publicAccount(a), lastLoginAt: a.lastLoginAt, disabled: !!a.disabled, termsCurrent: !needsTerms(a), twofaRequired: twofa.required(a) });
  const month = monthKey();
  const links = auth.listLinks().filter(t => t.kind === 'invite' && !t.usedAt && t.expiresAt > Date.now());
  const workspaces = store.listWorkspaces().map(ws => {
    const counts = store.videoCounts(ws.id), igAcc = ig.account(ws.id);
    return {
      id: ws.id, name: ws.name, createdAt: ws.createdAt, onboarded: ws.onboarded, suspended: ws.suspended,
      limits: ws.limits, access: allowance.access(ws), lastActiveAt: ws.lastActiveAt,
      usage: usage.monthUsage(ws.id), used: usedThisMonth(ws.id), spend: usage.spend(ws),
      instagram: igAcc.connected ? igAcc.username || 'connected' : '',
      facebook: (fbA => (fbA.connected ? fbA.pageName || 'connected' : ''))(fb.account(ws.id)),
      clicks: trackLinks.clicksSince(store.readVideos(ws.id), month + '-01'),
      pending: counts.pending, posted: counts.posted,
      facts: confirmedCount(store.loadConfig(ws.id)),
      members: accounts.filter(a => roles.isMember(a, ws.id)).map(a => ({ ...member(a), roleHere: roles.membership(a, ws.id)?.role || 'owner' })),
      invited: links.filter(t => t.workspaceId === ws.id).map(t => t.email),
      deletionRequest: ws.deletionRequest || null,
      switches: Object.fromEntries(Object.entries(ws.switches || {}).filter(([, x]) => x?.off)),
    };
  });
  return { workspaces, admins: accounts.filter(a => a.role === 'admin').map(member), you: me.account.id, openWorkspace: me.wsId, system: systemInfo(), alerts: alerts.listAlerts().slice(0, 30), unread: alerts.unreadCount() };
});
route('POST', '/api/admin/alerts/read', 'admin', () => { alerts.markAllRead(); return { unread: 0 }; });
// The switchboard (lib/switches.js), each service's breaker (lib/breaker.js) and the outbox (lib/outbox.js).
/* ----- Render rules (v15): change the checks without new code ----- */
// Everything the editor needs: every rule (locked ones shown, not editable), the settings and their safe
// ranges, the built-in lists, what's set for everyone and for the chosen workspace, and the history.
const rulesState = (wsId = '') => ({
  rules: Object.entries(mixer.RULES).map(([id, r]) => ({ id, ...r })), settings: Object.entries(mixer.RULE_SETTINGS).map(([id, x]) => ({ id, ...x })),
  lists: Object.entries(mixer.RULE_LISTS).map(([id, x]) => ({ id, label: x.label, base: x.base(nicheOf(null)) })),
  scope: wsId || 'global', global: renderRules.scopeOf('global'), workspace: wsId ? renderRules.scopeOf(wsId) : null, effective: renderRules.effective(wsId),
  history: renderRules.read().history.slice(0, 40).map(h => ({ id: h.id, at: h.at, byName: h.byName, scope: h.scope, scopeName: h.scope === 'global' ? 'Everyone' : store.getWorkspace(h.scope)?.name || 'A workspace', changes: renderRules.describe(h.before, h.after) })),
  workspaces: store.listWorkspaces().map(w => ({ id: w.id, name: w.name })),
});
const rulesScope = s => (s === 'global' || !s ? 'global' : store.getWorkspace(clip(s, 40)) ? clip(s, 40) : bad(404, 'Workspace not found.'));
route('GET', '/api/admin/rules', 'admin', ({ url }) => { const w = clip(url.searchParams.get('ws'), 40); return rulesState(w && store.getWorkspace(w) ? w : ''); });
route('POST', '/api/admin/rules', 'admin', ({ me, body }) => {
  const scope = rulesScope(body.scope);
  const entry = renderRules.save(scope, body.rules || {}, { by: me.account.id, byName: me.account.name || me.account.email });
  const changes = renderRules.describe(entry.before, entry.after);
  audit.record({ action: 'settings.saved', who: me.account, detail: `render rules for ${scope === 'global' ? 'everyone' : store.getWorkspace(scope)?.name}: ${changes.join('; ').slice(0, 300) || 'no change'}` });
  return rulesState(scope === 'global' ? '' : scope);
});
route('POST', '/api/admin/rules/restore', 'admin', ({ me, body }) => {
  const entry = renderRules.restore(clip(body.id, 20), body.which === 'before' ? 'before' : 'after', { by: me.account.id, byName: me.account.name || me.account.email });
  if (!entry) bad(404, 'That version isn’t in the history.');
  audit.record({ action: 'settings.saved', who: me.account, detail: `render rules restored to an earlier version (${entry.scope === 'global' ? 'everyone' : store.getWorkspace(entry.scope)?.name})` });
  return rulesState(entry.scope === 'global' ? '' : entry.scope);
});
// Try it first: a pasted script (one line per scene) or a recent video, checked with the rules as they'd
// be (not yet saved), as a draft and as an automatic video.
route('POST', '/api/admin/rules/try', 'admin', async ({ body }) => {
  const scope = rulesScope(body.scope);
  const wsId = scope !== 'global' ? scope : store.getWorkspace(clip(body.ws, 40))?.id || store.listWorkspaces().find(w => w.onboarded)?.id || '';
  if (!wsId) bad(409, 'There’s no workspace to try it on yet.');
  const cfg = { ...store.loadConfig(wsId), rules: renderRules.effectiveWith(wsId, scope, body.rules || {}) };
  let scenes, picks;
  if (body.videoId) {
    const v = store.getVideo(wsId, clip(body.videoId, 40)) || bad(404, 'Video not found.');
    const { readPicks } = await import('../pipeline.js');
    scenes = (v.scenes || []).map(s => ({ ...s })); picks = readPicks(wsId, v.id) || {};
  } else {
    const lines = String(body.script || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12);
    if (!lines.length) bad(400, 'Paste a script (one line per scene), or pick a video.');
    scenes = lines.map(text => ({ text, say: text, accent: mixer.suggestAccent(text, cfg), keyword: 'older couple at home' }));
    const U = mixer.usableRoutes(cfg), pain = U.pains[0];
    picks = pain ? mixer.studioPicks(cfg, { painId: pain.id, scenes: lines.length }) : { insights: [] };
  }
  const c = { ...cfg, output: { ...cfg.output, scenes: scenes.length } };
  const draft = mixer.studioChecks(scenes, c, { ...picks, scenes: scenes.length, problems: [] }).findings;
  const auto = mixer.validateScript({ scenes }, c, { ...picks, recent: store.readRecent(wsId), manualFootage: true }).findings;
  const view = list => list.map(f => ({ rule: f.rule, label: mixer.RULES[f.rule]?.label || f.rule, kind: f.kind, scene: f.scene, text: f.text }));
  return { workspace: store.getWorkspace(wsId)?.name || '', scenes: scenes.map(s => s.text), draft: view(draft), auto: view(auto), videos: store.readVideos(wsId).slice(0, 12).map(v => ({ id: v.id, label: `${v.meta?.painPoint || 'Video'} · ${String(v.createdAt || '').slice(0, 10)}` })) };
});
route('GET', '/api/admin/switches', 'admin', () => ({ switches: switches.board(), breakers: breaker.status(), outbox: outbox.summary(), workspaces: store.listWorkspaces().filter(w => Object.values(w.switches || {}).some(x => x?.off)).map(w => ({ id: w.id, name: w.name, off: Object.entries(w.switches).filter(([, x]) => x?.off).map(([k, x]) => ({ id: k, label: switches.SWITCHES[k]?.label || k, at: x.at, why: x.why || '' })) })) }));
route('POST', '/api/admin/switches', 'admin', ({ me, body }) => {
  const name = clip(body.name, 20);
  if (!switches.SWITCHES[name]) bad(400, 'Unknown switch.');
  const s = switches.setGlobal(name, !!body.off, { by: me.account.email, why: clip(body.why, 200) });
  audit.record({ action: 'settings.saved', who: me.account, detail: `switch ${name} ${body.off ? 'off' : 'on'} for everyone${body.why ? `: ${clip(body.why, 200)}` : ''}` });
  return { switch: s, switches: switches.board() };
});
route('POST', '/api/admin/workspaces/:id/switch', 'admin', ({ me, params, body }) => {
  const ws = store.getWorkspace(params.id) || bad(404, 'Workspace not found.');
  const name = clip(body.name, 20);
  if (!switches.SWITCHES[name]) bad(400, 'Unknown switch.');
  store.updateWorkspace(ws.id, switches.workspacePatch(ws, name, !!body.off, { by: me.account.email, why: clip(body.why, 200) }));
  audit.record({ action: 'workspace.changed', who: me.account, ws: ws.id, detail: `switch ${name} ${body.off ? 'off' : 'on'}${body.why ? `: ${clip(body.why, 200)}` : ''}` });
  return { switches: store.getWorkspace(ws.id).switches };
});
// The Engine bay (lib/engine.js): the line, the services, the processes, the disk, the targets.
route('GET', '/api/admin/engine', 'admin', () => engineBay());
route('GET', '/api/admin/engine/job/:id', 'admin', ({ params }) => jobTimeline(params.id) || bad(404, 'That job isn’t in the line any more (jobs are kept 7 days).'));
route('POST', '/api/admin/clock', 'admin', async () => ({ clock: await clock.check() }));
route('POST', '/api/admin/outbox/drain', 'admin', async () => ({ ...(await outbox.drain()), outbox: outbox.summary() }));
// The audit log: newest first, filtered by workspace and kind of action.
const AUDIT_KINDS = { logins: ['login', 'logout', 'password', 'twofa', 'session'], videos: ['video', 'records'], admin: ['admin', 'invite', 'reset', 'account', 'workspace', 'access'], data: ['data', 'deletion', 'workspace.deleted', 'terms', 'setup', 'settings', 'instagram', 'facebook', 'facts'] };
function auditQuery(url) {
  const ws = clip(url.searchParams.get('ws'), 20), kind = url.searchParams.get('kind') || '', limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit')) || 100));
  const prefixes = AUDIT_KINDS[kind] || [''];
  const all = prefixes.flatMap(p => audit.list({ ws, action: p, limit })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  return [...new Map(all.map(e => [e.at + e.action + e.by + e.target, e])).values()];
}
const wsName = id => store.getWorkspace(id)?.name || `${id} (deleted)`;
route('GET', '/api/admin/audit', 'admin', ({ url }) => ({ entries: auditQuery(url).map(e => ({ ...e, label: audit.LABELS[e.action] || e.action, workspace: e.ws ? wsName(e.ws) : '' })), labels: audit.LABELS }));
route('GET', '/api/admin/audit.csv', 'admin', ({ res, url }) => {
  url.searchParams.set('limit', '5000');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="audit-log-${nowIso().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
  res.end(audit.toCsv(auditQuery(url), wsName));
});
route('POST', '/api/admin/alerts/test', 'admin', async () => {
  const a = { id: 'test', at: nowIso(), level: 'info', kind: 'test', title: 'Test alert', text: 'Alerts from your server reach you here.', ws: '', workspaceName: '' };
  if (!process.env.ALERT_WEBHOOK_URL) bad(400, 'Add ALERT_WEBHOOK_URL to .env first (for example an ntfy.sh topic), then restart.');
  try { await alerts.sendWebhook(a); } catch (e) { bad(502, e.message); }
  return { ok: true };
});
route('POST', '/api/admin/invite', 'admin', async ({ req, body, me }) => {
  const email = store.normEmail(body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad(400, 'Enter a valid email address.');
  if (store.findAccountByEmail(email)) bad(409, 'That email already has an account. Send a reset link instead.');
  const role = body.role === 'admin' ? 'admin' : 'agent';
  let workspaceId = null;
  if (role === 'agent') {
    if (body.workspaceId) { if (!store.getWorkspace(body.workspaceId)) bad(404, 'Workspace not found.'); workspaceId = body.workspaceId; }
    else workspaceId = store.createWorkspace({ name: clip(body.workspaceName, 80) || email }).id;
  }
  const token = auth.createLink('invite', { email, role, workspaceId }, me.account.id);
  const link = `${baseUrl(req)}/#/invite/${token}`;
  const sent = await mailLink(email, mail.inviteEmail({ link, workspace: workspaceId ? store.getWorkspace(workspaceId)?.name : '', days: 7 }));
  return { link, workspaceId, days: 7, ...sent };
});
route('POST', '/api/admin/workspaces/:id', 'admin', ({ params, body }) => {
  if (!store.getWorkspace(params.id)) bad(404, 'Workspace not found.');
  const patch = {};
  if ('name' in body) patch.name = clip(body.name, 80) || 'Workspace';
  if ('suspended' in body) patch.suspended = !!body.suspended;
  if ('videosPerMonth' in body) patch.limits = { videosPerMonth: Math.max(0, Math.min(500, Math.round(Number(body.videosPerMonth) || 0))) || null };
  // Monthly AI cost cap in USD for this workspace: blank/null = the default (AI_COST_CAP_USD), 0 = no cap.
  if ('aiCostUsd' in body) {
    const raw = body.aiCostUsd, blank = raw === null || raw === undefined || String(raw).trim() === '';
    const n = blank ? null : Number(String(raw).replace(/[$,\s]/g, ''));
    if (!blank && !(Number.isFinite(n) && n >= 0 && n <= 10000)) bad(400, 'Enter a dollar amount from 0 to 10000, or leave it blank for the default.');
    patch.limits = { ...(patch.limits || {}), aiCostUsd: blank ? null : Math.round(n * 100) / 100 };
  }
  return { workspace: store.updateWorkspace(params.id, patch) };
});
// Data deletion an agent asked for: confirm (type the workspace name) or decline. Workspaces that
// didn't ask are deleted from the terminal instead (node admin.js delete-workspace).
route('POST', '/api/admin/workspaces/:id/delete', 'admin', async ({ params, body, me }) => {
  const ws = store.getWorkspace(params.id);
  if (!ws) bad(404, 'Workspace not found.');
  if (!ws.deletionRequest) bad(409, 'This workspace hasn’t asked to be deleted. To delete it anyway, use node admin.js delete-workspace on the server.');
  const typed = String(body.confirm || '').trim().toLowerCase();
  if (!typed || (typed !== ws.name.trim().toLowerCase() && typed !== ws.id)) bad(400, 'Type the workspace name exactly to confirm.');
  let out;
  try { out = data.deleteWorkspace(ws.id, { by: me.account.id }); } catch (e) { bad(e.busy ? 409 : 400, e.message); }
  if (me.wsId === ws.id) auth.updateSession(me.session.hash, { ws: null });
  const sent = await mailLink(ws.deletionRequest.email, mail.deletedEmail({ workspace: ws.name, backupDays: KEEP.backups }));
  return { deleted: out, ...sent };
});
route('DELETE', '/api/admin/workspaces/:id/delete-request', 'admin', ({ params }) => {
  if (!store.getWorkspace(params.id)) bad(404, 'Workspace not found.');
  data.cancelDeletion(params.id);
  return { ok: true };
});
route('POST', '/api/admin/reset', 'admin', async ({ req, body, me }) => {
  const acc = store.getAccount(body.accountId);
  if (!acc) bad(404, 'Account not found.');
  const link = `${baseUrl(req)}/#/reset/${auth.createLink('reset', { accountId: acc.id }, me.account.id)}`;
  return { link, days: 7, email: acc.email, ...(await mailLink(acc.email, mail.resetEmail({ link, days: 7 }))) };
});
route('POST', '/api/admin/accounts/:id', 'admin', ({ params, body, me }) => {
  const acc = store.getAccount(params.id);
  if (!acc) bad(404, 'Account not found.');
  if (acc.id === me.account.id) bad(400, 'You can’t disable your own account.');
  store.updateAccount(acc.id, { disabled: !!body.disabled });
  if (body.disabled) { auth.deleteSessionsFor(acc.id); if (acc.workspaceId) push.removeAccount(acc.workspaceId, acc.id); }
  return { ok: true };
});
// Lost phone and backup codes: clear their two-factor login (they're logged out and set it up again).
route('POST', '/api/admin/accounts/:id/reset-2fa', 'admin', ({ params, me }) => {
  const acc = store.getAccount(params.id);
  if (!acc) bad(404, 'Account not found.');
  if (acc.id === me.account.id) bad(400, 'Another admin, or node admin.js reset-2fa on the server, can reset your own.');
  twofa.reset(acc);
  auth.deleteSessionsFor(acc.id);
  return { ok: true };
});
route('POST', '/api/admin/open', 'admin', ({ body, me }) => {
  const id = body.workspaceId || null;
  if (id && !store.getWorkspace(id)) bad(404, 'Workspace not found.');
  auth.updateSession(me.session.hash, { ws: id });
  return { ok: true };
});
}

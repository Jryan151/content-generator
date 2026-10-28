// public/screens/admin.js — Admin.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { S, actions, ago, api, app, day, esc, main, outage, page, plural, render, status, toast, when } from '../app.js';

/* ================= Admin ================= */
async function viewAdmin() { S.admin = await api('/api/admin/overview'); drawAdmin(); loadEngine(); loadAudit(); }
// The Engine bay: the line, outside services, processes, disk and backups, the targets, recent runs.
async function loadEngine() { try { S.engine = await api('/api/admin/engine'); } catch { S.engine = null; } drawEngine(); }
const LIGHT = { green: 'ok', yellow: 'warn', red: 'err', grey: '' };
const secs = n => (n == null ? '–' : n >= 90 ? `${Math.round(n / 6) / 10} min` : `${n} s`);
function drawEngine() {
  const box = document.getElementById('enginePanel'), E = S.engine;
  if (!box) return;
  if (!E) { box.innerHTML = '<h2>Engine bay</h2><p class="small muted">Couldn’t load the Engine bay. <button class="btn sm ghost" data-act="engine-retry">Try again</button></p>'; return; }
  const L = E.line, W = L.week, D = E.disk, B = E.backups, red = E.targets.filter(t => t.light === 'red').length;
  const procRow = (name, now, worst = null) => `<tr><td>${esc(name)}</td><td class="mono">${now?.rssMB ?? '–'} MB</td><td class="mono">${now?.lagP99 ?? '–'} ms</td><td class="mono small muted">${worst?.rssMB != null ? `${worst.rssMB} MB · ${worst.lagP99 ?? '–'} ms` : ''}</td></tr>`;
  box.innerHTML = `<div class="row between"><h2>Engine bay${red ? ` <span class="badge">${red}</span>` : ''}</h2><button class="btn sm ghost" data-act="engine-retry">Refresh</button></div>
    <h3>Targets</h3>
    <div class="stack" style="gap:6px">${E.targets.map(t => `<div class="row between small"><span><span class="pill ${LIGHT[t.light] || ''}" title="${esc(t.light)}">${t.light === 'grey' ? '–' : esc(t.value)}${t.light === 'grey' ? '' : esc(t.unit)}</span> <b>${esc(t.label)}</b> <span class="muted">${esc(t.detail || '')}</span></span><span class="muted">target ${esc(t.goal)}</span></div>`).join('')}</div>
    <h3>The line</h3>
    <p class="small" style="margin:0">${L.running.length} making now · ${L.waiting} waiting${L.waitingOutage ? ` · ${L.waitingOutage} waiting out an outage` : ''}${L.held ? ` · ${L.held} held (${esc('paused')})` : ''}${L.failed24h ? ` · <b class="err">${L.failed24h} failed today</b>` : ''}</p>
    ${L.running.map(j => `<p class="small muted" style="margin:0">${esc(j.kind)}${j.source ? ` (${esc(j.source)})` : ''} since ${esc(when(j.startedAt))}: ${esc(j.last)}</p>`).join('')}
    <p class="small" style="margin:0">Last 7 days: <b>${W.done}</b> made, ${W.failed} failed${W.retried ? `, ${W.retried} retried` : ''}${W.waited ? `, ${W.waited} waited out an outage` : ''} · typical ${secs(W.total.p50)}, 95% within ${secs(W.total.p95)}</p>
    ${Object.keys(W.steps).length ? `<table class="t"><thead><tr><th>Step</th><th>Typical</th><th>95% within</th></tr></thead><tbody>${Object.entries(W.steps).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${secs(v.p50)}</td><td class="mono">${secs(v.p95)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Outside services <span class="small muted">(24 hours)</span></h3>
    <table class="t"><tbody>${E.services.map(sv => `<tr><td>${esc(sv.label)}</td><td>${sv.open ? '<span class="pill err">Not answering</span>' : '<span class="pill ok">OK</span>'}</td><td class="small mono">${sv.day ? `${sv.day.ok} ok${sv.day.failed ? ` · <b class="err">${sv.day.failed} failed</b>` : ''}` : ''}${sv.inJobs ? ` <span class="muted">· in videos: ${sv.inJobs.calls} calls, ${Math.round(sv.inJobs.ms / Math.max(1, sv.inJobs.calls) / 100) / 10} s each</span>` : ''}</td></tr>`).join('')}</tbody></table>
    <h3>Processes</h3>
    <table class="t"><thead><tr><th></th><th>Memory</th><th>Lag (99%)</th><th>Worst hour today</th></tr></thead><tbody>${procRow('This process (now)', E.processes.here)}${Object.entries(E.processes).filter(([k]) => k !== 'here').map(([k, p]) => procRow(k === 'server' ? 'Website' : k === 'worker' ? 'Video worker' : k, p.now, p)).join('')}</tbody></table>
    <h3>Disk and backups</h3>
    <p class="small" style="margin:0">${D.freeGB ?? '?'} GB free (videos pause below ${D.reserveGB} GB)${D.perDay != null ? ` · ${D.perDay < 0 ? `${Math.abs(D.perDay)} GB used a day` : 'not filling up'}` : ' · trend after a few days'}${D.daysLeft != null ? ` · <b>full in about ${D.daysLeft} days</b>` : ''}</p>
    <p class="small" style="margin:0">Backup: ${B.at ? esc(when(B.at)) : 'not yet'}${B.offsiteAt ? ` · off-site ${esc(when(B.offsiteAt))}` : ''}${B.offsiteError ? ` · <b class="err">off-site failed</b>` : ''}${B.restoreTestAt ? ` · restore test ${esc(when(B.restoreTestAt))}` : ''}</p>
    <h3>Build</h3>
    <p class="small" style="margin:0">Node ${esc(E.build.node)} · FFmpeg ${esc(E.build.ffmpeg || '?')} · ${E.build.storage === 'sqlite' ? 'SQLite' : 'JSON files'}</p>
    ${E.recent.length ? `<details><summary class="small">Recent runs</summary><div class="stack" style="gap:6px;margin-top:6px">${E.recent.map((r, i) => `<div class="small" style="border-top:1px solid var(--line);padding-top:6px"><div class="row between"><span><span class="pill ${r.status === 'done' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}">${esc(r.status)}</span> ${esc(r.kind)}${r.source ? ` (${esc(r.source)})` : ''} · ${secs(Math.round(r.ms / 1000))}</span><span class="muted">${esc(when(r.endedAt))}</span></div>
      <span class="muted">${Object.entries(r.steps || {}).map(([k, v]) => `${esc(k)} ${secs(Math.round(v / 1000))}`).join(' · ')}${r.error ? ` · ${esc(r.error)}` : ''}</span> <button class="btn sm ghost" data-act="engine-job" data-id="${esc(r.id)}" data-attempt="${esc(r.attempt)}" data-i="${i}">Timeline</button><div data-tl="${i}"></div></div>`).join('')}</div></details>` : ''}`;
}
async function loadAudit() {
  const box = document.getElementById('auditPanel');
  if (!box) return;
  const q = new URLSearchParams({ ws: S.auditF.ws, kind: S.auditF.kind, limit: String(S.auditF.limit) });
  try { S.audit = (await api('/api/admin/audit?' + q)).entries; } catch { S.audit = null; }
  drawAudit();
}
function drawAudit() {
  const box = document.getElementById('auditPanel');
  if (!box) return;
  if (S.audit === null) { box.innerHTML = '<h2>Activity log</h2><p class="small muted">Couldn’t load the activity log. <button class="btn sm ghost" data-act="audit-retry">Try again</button></p>'; return; }
  const F = S.auditF, list = S.audit || [];
  const q = new URLSearchParams({ ws: F.ws, kind: F.kind });
  box.innerHTML = `<div class="row between"><h2>Activity log</h2><a class="btn sm" href="/api/admin/audit.csv?${q}">Download (CSV)</a></div>
    <div class="row"><select class="ctl sm" data-audit="ws" aria-label="Workspace" style="flex:1 1 160px"><option value="">All workspaces</option>${S.admin.workspaces.map(w => `<option value="${w.id}"${F.ws === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <select class="ctl sm" data-audit="kind" aria-label="Kind" style="flex:1 1 140px">${[['', 'Everything'], ['logins', 'Logins and security'], ['videos', 'Approvals and records'], ['admin', 'Admin actions'], ['data', 'Data, terms and settings']].map(([k, l]) => `<option value="${k}"${F.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    ${list.length ? `<div class="stack" style="gap:6px">${list.map(e => `<div class="small" style="border-top:1px solid var(--line);padding-top:6px"><div class="row between"><b class="${/failed/.test(e.action) ? 'err' : ''}">${esc(e.label)}</b><span class="muted">${esc(when(e.at))}</span></div>
      <span class="muted">${esc(e.email || 'system')}${e.role === 'admin' ? ' (admin)' : ''}${e.workspace ? ' · ' + esc(e.workspace) : ''}${e.target ? ' · ' + esc(e.target) : ''}${e.detail ? ' · ' + esc(e.detail) : ''}${e.ip ? ' · ' + esc(e.ip) : ''}</span></div>`).join('')}</div>
      ${list.length >= F.limit ? '<button class="btn sm ghost" data-act="audit-more">Show more</button>' : ''}` : '<p class="empty">Nothing recorded yet for this filter.</p>'}
    <p class="small muted" style="margin:0">Kept 24 months (AUDIT_KEEP_MONTHS). Logins, failed logins, two-factor changes, approvals, exports, deletions and admin actions are all recorded.</p>`;
}
function drawAdmin() {
  const A = S.admin, sys = A.system;
  const yes = ok => `<span class="pill ${ok ? 'ok' : 'err'}">${ok ? 'OK' : 'Missing'}</span>`;
  const statusOf = w => (w.suspended ? ['err', 'Paused'] : ['ok', 'Active']);
  const al = A.alerts || [];
  main.innerHTML = `<div class="head"><h1>Admin</h1><p class="lede">Workspaces, alerts and the server.</p></div>
    <section class="panel"><div class="row between"><h2>Alerts${A.unread ? `<span class="badge">${A.unread}</span>` : ''}</h2><div class="row">${A.unread ? '<button class="btn sm" data-act="alerts-read">Mark all read</button>' : ''}<button class="btn sm ghost" data-act="alerts-test">Send a test</button></div></div>
      ${al.length ? `<ul class="alerts">${al.slice(0, S.allAlerts ? 30 : 5).map(a => `<li class="al-${esc(a.level)}${a.readAt ? '' : ' unread'}"><div class="row between"><b class="small">${esc(a.title)}</b><span class="small muted">${esc(when(a.at))}</span></div><span class="small">${a.workspaceName ? `<b>${esc(a.workspaceName)}:</b> ` : ''}${esc(a.text)}</span>${a.did ? `<span class="small muted" style="display:block">Already done: ${esc(a.did)}</span>` : ''}${a.did || a.run ? `<span class="small" style="display:block">Left for you: ${a.run ? `<code class="mono" style="overflow-wrap:anywhere">${esc(a.run)}</code>` : 'nothing.'}</span>` : ''}</li>`).join('')}</ul>${al.length > 5 && !S.allAlerts ? `<button class="btn sm ghost" data-act="all-alerts">Show all ${al.length}</button>` : ''}`
        : '<p class="empty">Nothing to report. Failed videos, failed backups, low disk and Instagram problems show up here.</p>'}
      <p class="small muted" style="margin:0">${sys.keys.alerts ? 'Alerts are also sent to your phone.' : 'To get alerts on your phone, set ALERT_WEBHOOK_URL in .env (a free ntfy.sh topic works). See SETUP.md.'}</p></section>
    <section class="panel"><div class="row between"><div class="head"><h2>Render rules</h2><p>Every check Studio, Fix a scene and automatic videos run: set style checks to block, warn or off, adjust the numbers and word lists, for everyone or one workspace. Compliance rules are locked.</p></div><a class="btn" href="#/rules">Open render rules</a></div></section>
    <section class="panel" id="enginePanel"><h2>Engine bay</h2><p class="small muted"><span class="spin"></span> Loading…</p></section>
    <section class="panel" id="auditPanel"><h2>Activity log</h2><p class="small muted"><span class="spin"></span> Loading the activity log…</p></section>
    <section class="panel"><h2>Invite</h2><form class="stack" data-form="invite">
      <div class="fields"><label class="field"><span>Email</span><input class="ctl" name="email" type="email" required></label>
        <label class="field"><span>Workspace</span><select class="ctl" name="workspaceId"><option value="">New workspace</option>${A.workspaces.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}<option value="__admin">No workspace (another admin)</option></select></label>
        <label class="field"><span>New workspace name</span><input class="ctl" name="workspaceName" placeholder="e.g. Jane Smith Insurance"></label></div>
      <div class="row"><button class="btn primary">Create invite link</button></div><div id="inviteOut"></div></form></section>
    <section class="stack"><h2>Workspaces</h2>${A.workspaces.map(w => { const [cls, label] = statusOf(w); return `<div class="panel" style="gap:12px">
      <div class="row between"><div class="head"><h3>${esc(w.name)}</h3><span class="small muted mono">${w.id} · since ${esc(day(w.createdAt))}${w.lastActiveAt ? ' · active ' + esc(when(w.lastActiveAt)) : ''}</span></div><div class="row"><span class="pill ${cls}">${esc(label)}</span>${w.onboarded ? '' : '<span class="pill warn">Setup not finished</span>'}${w.spend.over ? '<span class="pill err">AI cap reached</span>' : w.spend.warn ? `<span class="pill warn">AI ${w.spend.pct}%</span>` : ''}</div></div>
      <div class="stats"><div class="stat"><b>${w.used}/${w.access.limit || 0}</b><span>videos this month</span></div><div class="stat"><b>$${w.usage.cost.toFixed(2)}</b><span>AI cost this month${w.spend.cap ? ` of $${w.spend.cap.toFixed(2)} cap` : ', no cap'}</span></div><div class="stat"><b>${w.pending}</b><span>to review</span></div><div class="stat"><b>${w.posted}</b><span>posted</span></div><div class="stat"><b>${w.facts}</b><span>confirmed facts</span></div></div>
      <div class="stack" style="gap:6px">${w.members.map(m => `<div class="row between small"><span>${esc(m.name || m.email)}${m.roleHere === 'reviewer' ? ' <span class="pill">Reviewer</span>' : ''} <span class="muted">${esc(m.email)}${m.lastLoginAt ? ' · last in ' + esc(when(m.lastLoginAt)) : ' · never logged in'}${m.disabled ? ' · disabled' : ''}${S.me.terms?.on ? (m.termsCurrent ? ` · terms v${esc(m.termsVersion)} accepted` : ' · terms not accepted yet') : ''} · 2FA ${m.twofa ? 'on' : 'off'}</span></span><span class="row">${m.twofa ? `<button class="btn sm ghost" data-act="reset-2fa" data-id="${m.id}" data-email="${esc(m.email)}">Reset 2FA</button>` : ''}<button class="btn sm ghost" data-act="reset-link" data-id="${m.id}">Reset link</button><button class="btn sm ghost${m.disabled ? '' : ' danger'}" data-act="disable" data-id="${m.id}" data-v="${m.disabled ? '0' : '1'}">${m.disabled ? 'Enable' : 'Disable'}</button></span></div>`).join('')}
        ${w.instagram ? `<div class="small muted">Instagram: ${w.instagram === 'connected' ? 'connected' : '@' + esc(w.instagram)}</div>` : ''}
        ${w.facebook ? `<div class="small muted">Facebook: ${esc(w.facebook)}</div>` : ''}
        ${w.clicks ? `<div class="small muted">${plural(w.clicks, 'link visit')} this month</div>` : ''}
        ${w.invited.map(e => `<div class="small muted">Invited: ${esc(e)} (link not used yet)</div>`).join('')}${!w.members.length && !w.invited.length ? '<div class="small muted">No members yet.</div>' : ''}</div>
      ${w.deletionRequest ? `<div class="note warn"><b>Deletion requested</b> by ${esc(w.deletionRequest.byName)} (${esc(w.deletionRequest.email)}) on ${esc(day(w.deletionRequest.at))}.${w.deletionRequest.note ? ` “${esc(w.deletionRequest.note)}”` : ''}
        <div class="row" style="margin-top:8px"><button class="btn sm danger" data-act="ws-delete" data-id="${w.id}" data-name="${esc(w.name)}">Delete everything</button><button class="btn sm ghost" data-act="ws-keep" data-id="${w.id}">Decline</button></div></div>` : ''}
      <div class="row"><button class="btn sm${A.openWorkspace === w.id ? ' primary' : ''}" data-act="open-ws" data-id="${w.id}">${A.openWorkspace === w.id ? 'Open now' : 'Open'}</button>
        <button class="btn sm" data-act="ws-set" data-id="${w.id}" data-k="suspended" data-v="${w.suspended ? '0' : '1'}">${w.suspended ? 'Resume' : 'Pause'}</button>
        <button class="btn sm" data-act="ws-limit" data-id="${w.id}">Monthly limit${w.limits?.videosPerMonth ? ': ' + w.limits.videosPerMonth : ''}</button>
        <button class="btn sm" data-act="ws-cap" data-id="${w.id}" data-v="${w.spend.custom ? w.spend.cap : ''}">AI cap: ${w.spend.cap ? '$' + w.spend.cap.toFixed(2) : 'none'}${w.spend.custom ? '' : ' (default)'}</button>
      <div data-out="${w.id}"></div></div>`; }).join('') || '<p class="empty">No workspaces yet. Invite your first agent above.</p>'}</section>
    <section class="panel"><h2>Server</h2><table class="t"><tbody>
      <tr><td>Version</td><td class="mono">${esc(sys.version)}</td></tr>
      <tr><td>Site address</td><td class="mono">${esc(sys.publicUrl || 'PUBLIC_URL not set')}</td></tr>
      <tr><td>OpenAI key</td><td>${yes(sys.keys.openai)}</td></tr><tr><td>Pixabay key</td><td>${yes(sys.keys.pixabay)}</td></tr>
      <tr><td>FFmpeg</td><td>${yes(sys.ffmpeg)}</td></tr>
      <tr><td>Facebook posting</td><td>${sys.keys.facebook ? `${yes(sys.facebook.ready)}${sys.facebook.ready ? '' : ' <span class="small muted">needs an https PUBLIC_URL</span>'}<br><span class="small muted">Redirect URI for Facebook Login:</span><br><code class="mono small" style="overflow-wrap:anywhere">${esc(sys.facebook.redirect)}</code>` : '<span class="pill">Off</span> <span class="small muted">see SETUP.md</span>'}</td></tr>
      <tr><td>Instagram posting</td><td>${sys.keys.instagram ? `${yes(sys.instagram.ready)}${sys.instagram.ready ? '' : ' <span class="small muted">needs an https PUBLIC_URL</span>'}<br><span class="small muted">Redirect URI for your Meta app:</span><br><code class="mono small" style="overflow-wrap:anywhere">${esc(sys.instagram.redirect)}</code>` : '<span class="pill">Off</span> <span class="small muted">see SETUP.md</span>'}</td></tr>
      <tr><td>AI cost cap</td><td>${sys.aiCap ? `$${sys.aiCap.toFixed(2)} per workspace per month <span class="small muted">(AI_COST_CAP_USD; alert at 80%, paused at 100%)</span>` : '<span class="pill">Off</span> <span class="small muted">AI_COST_CAP_USD=0</span>'}</td></tr>
      <tr><td>Phone alerts</td><td>${sys.keys.alerts ? yes(true) : '<span class="pill">Off</span>'}</td></tr>
      <tr><td>Email</td><td>${sys.keys.email ? `${yes(true)} <span class="small muted">${esc(sys.emailProvider)}</span>` : '<span class="pill">Off</span> <span class="small muted">invite and reset links are copied by hand; see SETUP.md</span>'}</td></tr>
      <tr><td>Free disk</td><td class="mono">${sys.freeGB == null ? '?' : sys.freeGB + ' GB'}${sys.freeGB != null && sys.freeGB < 5 ? ' <span class="pill warn">low</span>' : ''}</td></tr>
      <tr><td>Queue</td><td>${sys.queue.running ? 'Rendering · ' : ''}${sys.queue.waiting} waiting</td></tr>
      <tr><td>Last backup</td><td class="mono">${esc(sys.lastBackup || 'not yet')}</td></tr>
      <tr><td>Storage</td><td>${sys.storage === 'sqlite' ? 'SQLite <span class="small muted">(data/app.db)</span>' : 'JSON files <span class="small muted">(move to SQLite: SETUP.md section T)</span>'}</td></tr>
      <tr><td>Health check</td><td>${Object.values(sys.health).every(Boolean) ? yes(true) : '<span class="pill err">Problem</span>'} <span class="small muted">${Object.entries(sys.health).map(([k, v]) => `${esc(k)} ${v ? '✓' : '✗'}`).join(' · ')}</span><br><span class="small muted">Point an uptime checker at <code class="mono">/api/health</code> (SETUP.md section R)${sys.healthToken ? '' : '; set HEALTH_TOKEN for details'}.</span></td></tr>
      <tr><td>Off-site backup</td><td>${sys.offsite.on ? `${sys.offsite.error ? `<span class="pill err">Failed</span> <span class="small">${esc(sys.offsite.error)}</span>` : sys.offsite.at ? `${yes(true)} <span class="small muted">${esc(when(sys.offsite.at))}, encrypted</span>` : '<span class="pill">Waiting for tonight</span>'}
        <br><span class="small muted">Restore test: ${sys.offsite.testError ? `<b class="err">failed</b> (${esc(sys.offsite.testError)})` : sys.offsite.testAt ? `passed ${esc(when(sys.offsite.testAt))}${sys.offsite.test ? ` · ${sys.offsite.test.accounts} logins, ${sys.offsite.test.workspaces} workspaces, ${sys.offsite.test.videos} videos` : ''}` : 'weekly, after the first upload'}</span>`
        : `<span class="pill warn">Off</span> <span class="small muted">${sys.offsite.keyProblem ? esc(sys.offsite.keyProblem) : 'backups only live on this server; see SETUP.md section Q'}</span>`}</td></tr>
      <tr><td>Last cleanup</td><td class="mono">${esc(sys.lastCleanup || 'not yet')}</td></tr></tbody></table></section>
    <section class="panel"><h2>Admins</h2>${A.admins.map(m => `<div class="row between small"><span>${esc(m.name || m.email)} <span class="muted">${esc(m.email)} · 2FA ${m.twofa ? 'on' : 'not set up'}</span></span>${m.id === A.you ? '<span class="muted">you</span>' : `<span class="row">${m.twofa ? `<button class="btn sm ghost" data-act="reset-2fa" data-id="${m.id}" data-email="${esc(m.email)}">Reset 2FA</button>` : ''}<button class="btn sm ghost" data-act="reset-link" data-id="${m.id}">Reset link</button></span>`}</div>`).join('')}</section>`;
  if (S.audit) drawAudit();
}

/* ================= Render rules (v15): change the checks without new code ================= */
// For everyone or one workspace: each style check's level (Block, Warn, Off) in drafts people write and
// in automatic videos, the adjustable numbers, and words added to or taken off the built-in lists. Locked
// compliance rules are shown but can't be changed. Try it on a script first; every change is kept, with
// a one-tap way back.
async function viewRules() { S.rr = { scope: 'global', state: await api('/api/admin/rules'), tryOut: { script: '', videoId: '' } }; S.rr.draft = JSON.parse(JSON.stringify(S.rr.state.global || {})); drawRules(); }
async function loadRulesScope(scope) {
  S.rr.scope = scope;
  S.rr.state = await api('/api/admin/rules' + (scope === 'global' ? '' : `?ws=${encodeURIComponent(scope)}`));
  S.rr.draft = JSON.parse(JSON.stringify((scope === 'global' ? S.rr.state.global : S.rr.state.workspace) || {}));
  S.rr.tryOut.result = null;
  drawRules();
}
const rrDirty = () => JSON.stringify(S.rr.draft || {}) !== JSON.stringify((S.rr.scope === 'global' ? S.rr.state.global : S.rr.state.workspace) || {});
const LEVEL_WORDS = { block: 'Block', warn: 'Warn', off: 'Off' };
function drawRules() {
  const R = S.rr, st = R.state, d = R.draft, ws = R.scope !== 'global';
  const inherited = (id, ctx) => (st.global.levels?.[id]?.[ctx]) || st.rules.find(r => r.id === id)[ctx];
  const levelSel = (r, ctx) => `<select class="ctl sm" data-rr-level="${r.id}" data-ctx="${ctx}" aria-label="${esc(r.label)}: ${ctx === 'draft' ? 'drafts' : 'automatic videos'}">${ws ? `<option value="">Same as everyone (${LEVEL_WORDS[inherited(r.id, ctx)]})</option>` : ''}${['block', 'warn', 'off'].map(l => `<option value="${l}"${(d.levels?.[r.id]?.[ctx] || (ws ? '' : r[ctx])) === l ? ' selected' : ''}>${LEVEL_WORDS[l]}${!ws && r[ctx] === l ? ' (built-in)' : ''}</option>`).join('')}</select>`;
  const locked = st.rules.filter(r => r.locked), style = st.rules.filter(r => !r.locked);
  const listWords = L => { const add = d.lists?.[L.id]?.add || [], remove = new Set(d.lists?.[L.id]?.remove || []); return [...L.base.map(w => ({ w, base: true, off: remove.has(w) })), ...add.filter(w => !L.base.includes(w)).map(w => ({ w, base: false, off: false }))]; };
  const res = R.tryOut.result;
  const findingsList = list => (list.length ? `<ul class="list">${list.map(f => `<li class="${f.kind === 'stop' ? 'bad' : f.kind === 'warn' ? 'note-warn' : 'fixed'}"><i>${f.kind === 'stop' ? '!' : f.kind === 'warn' ? '·' : '✓'}</i><span><b>${f.kind === 'stop' ? 'Blocks' : f.kind === 'warn' ? 'Warns' : 'Fixed'}</b> · ${esc(f.label)}: ${esc(f.text)}</span></li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">Nothing: it passes.</p>');
  main.innerHTML = `<div class="head"><a class="small" href="#/admin">← Admin</a><h1>Render rules</h1><p class="lede">Every check Studio, Fix a scene and automatic videos run. Style checks can block, warn or be off; compliance rules are locked.</p></div>
    <section class="panel"><label class="field"><span>Rules for</span><select class="ctl" data-rr-scope><option value="global">Everyone</option>${st.workspaces.map(w => `<option value="${esc(w.id)}"${R.scope === w.id ? ' selected' : ''}>${esc(w.name)} (only this workspace)</option>`).join('')}</select><small>${ws ? 'Settings here override everyone’s for this workspace only. Blank means the same as everyone.' : 'These apply to every workspace, unless a workspace has its own.'}</small></label></section>
    <section class="panel"><h2>Locked: compliance</h2><p class="small muted">Claims that could mislead a client or break advertising rules. They always stop a render (each comes with a one-tap fix) and can’t be turned down.</p>
      <ul class="list">${locked.map(r => `<li><i aria-hidden="true">🔒</i><span><b>${esc(r.label)}</b> · ${esc(r.about)} <span class="muted">Catches: ${esc(r.example)}</span></span></li>`).join('')}</ul></section>
    <section class="panel"><h2>Style and craft</h2><p class="small muted">Block: must be fixed (in automatic videos the writer rewrites). Warn: a yellow note that never stops a render. Off: not checked.</p>
      <div class="stack" style="gap:10px">${style.map(r => `<div class="box" style="gap:6px"><div class="row between" style="align-items:flex-start"><span class="small" style="flex:1 1 260px"><b>${esc(r.label)}</b><br>${esc(r.about)} <span class="muted">Catches: ${esc(r.example)}</span></span>
        <span class="fields" style="flex:0 1 auto"><label class="field"><span class="small">Studio and Fix a scene</span>${levelSel(r, 'draft')}</label><label class="field"><span class="small">Automatic videos</span>${levelSel(r, 'auto')}</label></span></div></div>`).join('')}</div></section>
    <section class="panel"><h2>Settings</h2><div class="fields">${st.settings.map(x => `<label class="field"><span>${esc(x.label)}</span><input class="ctl" type="number" data-rr-setting="${x.id}" min="${x.min}" max="${x.max}" step="${x.step}" value="${d.settings?.[x.id] ?? ''}" placeholder="${ws ? `everyone: ${st.global.settings?.[x.id] ?? x.def ?? 'workspace'}` : x.def ?? 'workspace setting'}"><small>${x.min}–${x.max} ${esc(x.unit)}</small></label>`).join('')}</div></section>
    <section class="panel"><h2>Word lists</h2>${st.lists.map(L => `<div class="field"><span>${esc(L.label)}</span><div class="chips">${listWords(L).map(x => `<button class="toggle${x.off ? ' off' : ''}" data-act="rr-word" data-list="${L.id}" data-w="${esc(x.w)}" aria-pressed="${!x.off}" title="${x.off ? 'Taken off: tap to put back' : x.base ? 'Built in: tap to take off' : 'Added: tap to remove'}">${esc(x.w)}${x.base ? '' : ' +'}${x.off ? ' (off)' : ''}</button>`).join('')}</div>
      <div class="row"><input class="ctl sm" data-rr-add="${L.id}" maxlength="60" placeholder="Add a word or phrase" style="flex:1 1 200px"><button class="btn sm" data-act="rr-add" data-list="${L.id}">Add</button></div></div>`).join('')}</section>
    <section class="panel"><h2>Try it first</h2><p class="small muted">Paste a script (one line per scene), or pick a recent video${ws ? '' : ' (from the first workspace)'}. It’s checked with the rules above as they are now, saved or not.</p>
      <textarea class="ctl" rows="4" data-rr-script placeholder="Who pays for your funeral someday?&#10;Final expense can give you peace of mind.">${esc(R.tryOut.script)}</textarea>
      ${res?.videos?.length ? `<label class="field"><span>Or a recent video</span><select class="ctl" data-rr-video><option value="">The pasted script</option>${res.videos.map(v => `<option value="${esc(v.id)}"${R.tryOut.videoId === v.id ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>` : ''}
      <div class="row"><button class="btn" data-act="rr-try">Try it</button></div>
      ${res ? `<div class="fields"><div class="stack" style="gap:6px"><b class="small">As a draft (Studio, Fix a scene)</b>${findingsList(res.draft)}</div><div class="stack" style="gap:6px"><b class="small">As an automatic video</b>${findingsList(res.auto)}</div></div>` : ''}</section>
    <div class="row"><button class="btn primary" data-act="rr-save" ${rrDirty() ? '' : 'disabled'}>Save the rules</button><button class="btn ghost" data-act="rr-discard" ${rrDirty() ? '' : 'disabled'}>Discard</button></div>
    <section class="panel"><h2>Every change</h2>${st.history.length ? `<div class="stack" style="gap:8px">${st.history.map(h => `<div class="box" style="gap:4px"><span class="small"><b>${esc(h.scopeName)}</b> · ${esc(h.byName || 'Someone')} · <span class="muted">${esc(when(h.at))}</span></span><span class="small">${h.changes.length ? h.changes.map(esc).join('<br>') : 'No change'}</span>
      <div class="row"><button class="btn sm ghost" data-act="rr-restore" data-id="${esc(h.id)}" data-which="before">Undo this change</button><button class="btn sm ghost" data-act="rr-restore" data-id="${esc(h.id)}" data-which="after">Back to this version</button></div></div>`).join('')}</div>` : '<p class="empty">No changes yet: the built-in rules apply.</p>'}</section>`;
}
// (Added to the portal's actions by app.js: a screen can't use app.js's parts while it's first loading.)
const rulesActions = {
  'rr-word'(el) {
    const d = S.rr.draft, k = el.dataset.list, w = el.dataset.w, L = S.rr.state.lists.find(x => x.id === k);
    d.lists ||= {}; d.lists[k] ||= { add: [], remove: [] };
    const x = d.lists[k];
    if (L.base.includes(w)) x.remove = x.remove.includes(w) ? x.remove.filter(y => y !== w) : [...x.remove, w];
    else x.add = x.add.filter(y => y !== w);
    drawRules();
  },
  'rr-add'(el) {
    const k = el.dataset.list, input = main.querySelector(`[data-rr-add="${k}"]`), w = String(input?.value || '').trim().toLowerCase();
    if (!w) return;
    const d = S.rr.draft; d.lists ||= {}; d.lists[k] ||= { add: [], remove: [] };
    if (!d.lists[k].add.includes(w)) d.lists[k].add.push(w);
    d.lists[k].remove = d.lists[k].remove.filter(y => y !== w);
    drawRules();
  },
  async 'rr-try'() {
    S.rr.tryOut.script = main.querySelector('[data-rr-script]')?.value || '';
    try { S.rr.tryOut.result = await api('/api/admin/rules/try', { method: 'POST', body: { scope: S.rr.scope, rules: S.rr.draft, script: S.rr.tryOut.script, videoId: S.rr.tryOut.videoId } }); } catch (e) { toastErr(e); }
    drawRules();
  },
  async 'rr-save'() {
    try { S.rr.state = await api('/api/admin/rules', { method: 'POST', body: { scope: S.rr.scope, rules: S.rr.draft } }); S.rr.draft = JSON.parse(JSON.stringify((S.rr.scope === 'global' ? S.rr.state.global : S.rr.state.workspace) || {})); drawRules(); toastOk('Saved. New checks use these rules.'); } catch (e) { toastErr(e); }
  },
  'rr-discard'() { S.rr.draft = JSON.parse(JSON.stringify((S.rr.scope === 'global' ? S.rr.state.global : S.rr.state.workspace) || {})); drawRules(); },
  async 'rr-restore'(el) {
    try { S.rr.state = await api('/api/admin/rules/restore', { method: 'POST', body: { id: el.dataset.id, which: el.dataset.which } }); S.rr.scope = S.rr.state.scope || 'global'; /* the restored version's own scope (it may be another workspace's) */ S.rr.draft = JSON.parse(JSON.stringify((S.rr.scope === 'global' ? S.rr.state.global : S.rr.state.workspace) || {})); drawRules(); toastOk('Done. That version is in force.'); } catch (e) { toastErr(e); }
  },
};
const toastOk = m => toast(m), toastErr = e => toast(e.message);
// Changes in the editor (scope, levels, settings, the script and video picked to try).
document.addEventListener('change', e => {
  const t = e.target;
  if (S.view !== 'rules' || !S.rr) return;
  if (t.dataset.rrScope !== undefined) return void loadRulesScope(t.value);
  const d = S.rr.draft;
  if (t.dataset.rrLevel) { d.levels ||= {}; const x = { ...(d.levels[t.dataset.rrLevel] || {}) }; if (t.value) x[t.dataset.ctx] = t.value; else delete x[t.dataset.ctx]; if (Object.keys(x).length) d.levels[t.dataset.rrLevel] = x; else delete d.levels[t.dataset.rrLevel]; drawRules(); }
  if (t.dataset.rrSetting) { d.settings ||= {}; if (t.value === '') delete d.settings[t.dataset.rrSetting]; else d.settings[t.dataset.rrSetting] = Number(t.value); drawRules(); }
  if (t.dataset.rrVideo !== undefined) S.rr.tryOut.videoId = t.value;
});

export { drawAdmin, drawRules, loadAudit, loadEngine, rulesActions, secs, viewAdmin, viewRules };

// public/screens/account.js — Login, invite and reset; Two-factor login; Terms of service and privacy; Account.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { S, ago, api, app, can, copy, day, esc, go, loadPush, main, plural, pushInner, status, when } from '../app.js';

/* ================= Login, invite and reset ================= */
function authPage(inner) {
  app.innerHTML = `<div class="auth"><div class="panel">
    <div class="logo"><img src="/icon.svg" alt=""><h1>${esc(S.product)}</h1></div>${inner}</div></div>`;
}
function viewLogin() {
  authPage(`<p class="lede">Short, compliance-checked Reels for life insurance agents.</p>
    <form class="stack" data-form="login">
      <label class="field"><span>Email</span><input class="ctl" name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span>Password</span><input class="ctl" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary big">Log in</button>
      <div class="status" data-st></div>
    </form>
    <p class="small muted">Forgot your password? Ask your admin for a reset link.</p><p class="small muted">${S.me?.terms?.on ? `${termsLinks()} · ` : ''}<a href="/data-deletion" target="_blank" rel="noopener">Delete your data</a></p>`);
}
async function viewLink(kind, token) {
  authPage('<p class="empty"><span class="spin"></span> Checking your link…</p>');
  let info;
  try { info = await api('/api/link/check', { method: 'POST', body: { token, kind } }); }
  catch (e) { return authPage(`<div class="note err">${esc(e.message)}</div><a class="btn" href="#/login">Go to log in</a>`); }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  // Someone who already has a login accepts a reviewer invite while logged in as that email.
  if (kind === 'invite' && info.existing) {
    const mine = S.me?.account && S.me.account.email === info.email, other = S.me?.account && !mine;
    if (!S.me?.account) { try { sessionStorage.setItem('joinToken', token); } catch { /* they can open the link again */ } }
    return authPage(`<p class="lede">${info.role === 'teammate' ? `You’re invited to join <b>${esc(info.workspace)}</b>’s team on Agent Reels. Your calls and progress will save to the team.` : `You’re invited to <b>${esc(info.workspace)}</b> as their compliance reviewer. You’ll sign off each video they approve before it posts, or send it back with a note.`}</p>
      ${mine ? `<div class="row"><button class="btn primary big" data-act="join-accept" data-token="${esc(token)}">Join ${esc(info.workspace)}</button><a class="btn ghost" href="#/">Not now</a></div><p class="small muted">You’ll be asked to set up two-factor login if it isn’t on yet.</p>`
        : other ? `<p class="small">You’re logged in as <b>${esc(S.me.account.email)}</b>. This invite is for <b>${esc(info.email)}</b>: log out, then open the link again and log in with that email.</p><div class="row"><button class="btn primary" data-act="logout">Log out</button><a class="btn ghost" href="#/">Not now</a></div>`
        : `<p class="small">You already have a login with <b>${esc(info.email)}</b>. Log in with it to accept.</p><a class="btn primary" href="#/login">Log in</a>`}<div class="status" data-st></div>`);
  }
  authPage(`<p class="lede">${kind === 'invite' ? `You’re invited${info.role === 'reviewer' ? ' as a compliance reviewer' : info.role === 'teammate' ? ' to join the team on Agent Reels' : ''}${info.workspace ? ` ${info.role === 'teammate' ? 'of' : 'to'} <b>${esc(info.workspace)}</b>` : ''}. Set a password to get started.${info.role === 'reviewer' ? ' Next you’ll set up two-factor login with an app on your phone.' : ''}` : 'Choose a new password.'}</p>
    <form class="stack" data-form="link" data-kind="${kind}" data-token="${esc(token)}" data-tz="${esc(tz)}">
      <label class="field"><span>Email</span><input class="ctl" value="${esc(info.email)}" autocomplete="username" readonly></label>
      ${kind === 'invite' ? '<label class="field"><span>Your name</span><input class="ctl" name="name" autocomplete="name" required maxlength="80"></label>' : ''}
      <label class="field"><span>Password</span><input class="ctl" name="password" type="password" autocomplete="new-password" minlength="10" required><small>At least 10 characters.</small></label>
      <label class="field"><span>Password again</span><input class="ctl" name="password2" type="password" autocomplete="new-password" minlength="10" required></label>
      ${kind === 'invite' && info.role !== 'admin' && S.me?.terms?.on ? termsCheck('acceptTerms') : ''}
      <button class="btn primary big">${kind === 'invite' ? 'Create my account' : 'Save new password'}</button>
      <div class="status" data-st></div>
    </form>`);
}

/* ================= Two-factor login ================= */
function viewTwofaLogin(msg = S.ticketMsg || '') {
  authPage(`<p class="lede">${esc(msg || 'Enter the 6-digit code from your authenticator app.')}</p>
    <form class="stack" data-form="login2fa">
      <label class="field"><span>Code</span><input class="ctl" name="code" inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="12" required autofocus><small>Lost your phone? Enter one of your backup codes instead.</small></label>
      <button class="btn primary big">Log in</button>
      <div class="status" data-st></div>
    </form>
    <p class="small muted"><a href="#/login" data-act="twofa-cancel">Start over</a> · No phone and no backup codes? Ask your admin to reset your two-factor login.</p>`);
}
function viewTwofaRequired() {
  main.innerHTML = `<div class="head"><h1>Set up two-factor login</h1><p class="lede">${S.me.account.role === 'admin' ? 'Your admin account can open every workspace and see billing, so it needs a second step at login: a code from an app on your phone.' : 'This server asks everyone for a second step at login: a code from an app on your phone.'} It takes about a minute.</p></div>
    <section class="panel" id="twofaPanel">${twofaInner()}</section>
    <div class="row"><button class="btn ghost" data-act="logout">Log out</button></div>`;
}
// The panel's contents: off, setting up (QR + key + code), backup codes (once), or on.
function twofaInner() {
  const a = S.me.account, req = S.me.twofaSetupRequired || a.role === 'admin';
  if (S.twofaCodes) return `<h2>Save your backup codes</h2>
    <p class="small" style="margin:0">Each one works once, if you lose your phone. Keep them somewhere safe, like your password manager. They won’t be shown again.</p>
    <pre class="preview mono" style="font-size:15px">${S.twofaCodes.map(esc).join('\n')}</pre>
    <div class="row"><button class="btn" data-act="twofa-copy">Copy codes</button><button class="btn primary" data-act="twofa-done">I’ve saved them</button></div>`;
  if (S.twofa) return `<h2>Scan this with your authenticator app</h2>
    <p class="small" style="margin:0">Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar: add an account and scan the code.</p>
    ${S.twofa.qr ? `<div class="qr" style="background:#fff;padding:8px;border-radius:10px;width:max-content;max-width:100%">${S.twofa.qr}</div>` : ''}
    <details><summary>Can’t scan? Type this key instead</summary><p class="mono" style="font-size:15px;overflow-wrap:anywhere">${esc(S.twofa.secret)}</p></details>
    <form class="stack" data-form="twofa-enable"><label class="field"><span>Then enter the 6-digit code it shows</span><input class="ctl" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="max-width:200px"></label>
      <div class="row"><button class="btn primary">Turn on</button><button class="btn ghost" type="button" data-act="twofa-cancel-setup">Cancel</button></div><div class="status" data-st></div></form>`;
  if (!a.twofa) return `<h2>Two-factor login</h2>
    <p class="small" style="margin:0">${req ? 'Required for your account.' : 'Recommended.'} After your password, you’ll enter a 6-digit code from an app on your phone, so a stolen password alone can’t get in.</p>
    <div class="row"><button class="btn primary" data-act="twofa-setup">Set up two-factor login</button></div>`;
  return `<h2>Two-factor login</h2><p class="small" style="margin:0"><span class="pill ok">On</span> You’ll be asked for a code from your authenticator app when you log in on a new device.</p>
    <details><summary>New backup codes</summary><form class="row" data-form="twofa-newcodes" style="margin-top:8px"><input class="ctl sm" name="code" inputmode="numeric" placeholder="Code from your app" required style="width:180px" aria-label="Code from your app"><button class="btn sm">Make new codes</button><span class="status" data-st></span></form><p class="small muted">Your old backup codes stop working.</p></details>
    ${req ? '' : `<details><summary>Turn off</summary><form class="stack" data-form="twofa-disable" style="margin-top:8px"><label class="field"><span>Password</span><input class="ctl" type="password" name="password" autocomplete="current-password" required></label><label class="field"><span>Code from your app</span><input class="ctl" name="code" inputmode="numeric" autocomplete="one-time-code" required style="max-width:200px"></label><div class="row"><button class="btn danger">Turn off two-factor login</button></div><div class="status" data-st></div></form></details>`}`;
}
function drawTwofa() {
  const box = document.getElementById('twofaPanel');
  if (box) box.innerHTML = twofaInner();
}

/* ================= Terms of service and privacy ================= */
// Links to the Terms of Service and Privacy Policy, when the server has them set.
const termsLinks = () => { const t = S.me?.terms; return t?.on ? `<a href="${esc(t.termsUrl)}" target="_blank" rel="noopener">Terms of Service</a> and <a href="${esc(t.privacyUrl)}" target="_blank" rel="noopener">Privacy Policy</a>` : ''; };
const termsCheck = (name, act = '') => `<label class="check"><input type="checkbox" ${name ? `name="${name}"` : ''} ${act ? `data-act="${act}"` : ''} required> <span>I’ve read and accept the ${termsLinks()}.</span></label>`;
async function viewTerms() {
  const a = S.me.account;
  main.innerHTML = `<div class="head"><h1>${a.termsVersion ? 'Updated terms' : 'Terms and privacy'}</h1><p class="lede">${a.termsVersion ? 'The Terms of Service or Privacy Policy changed since you last accepted them. Please read them and accept to keep using the app.' : 'Please read the Terms of Service and Privacy Policy and accept them to keep using the app.'}</p></div>
    <section class="panel"><form class="stack" data-form="terms">${termsCheck('accept')}
      <div class="row"><button class="btn primary">Accept and continue</button><a class="btn ghost" href="#/account">Account</a></div><div class="status" data-st></div></form></section>
    <p class="small muted">Don’t want to accept? You can still download your data or ask for it to be deleted under <a href="#/account">Account → Your data</a>.</p>`;
}

/* ================= Account ================= */
async function viewAccount() {
  const a = S.me.account;
  setTimeout(loadSessions, 0);
  S.push = null; setTimeout(loadPush, 0);
  main.innerHTML = `<div class="head"><h1>Account</h1><p class="lede">${esc(a.email)}${a.role === 'admin' ? ' · admin' : ''}</p></div>
    ${!S.me.workspace && a.role !== 'admin' ? '<div class="note warn">Your account isn’t linked to a workspace yet. Ask your admin.</div>' : ''}
    <section class="panel"><h2>Your name</h2><form class="row" data-form="name"><input class="ctl" name="name" value="${esc(a.name)}" maxlength="80" style="flex:1 1 220px" aria-label="Your name"><button class="btn">Save</button></form></section>
    <section class="panel"><h2>Change password</h2><form class="stack" data-form="password">
      <label class="field"><span>Current password</span><input class="ctl" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input class="ctl" type="password" name="next" autocomplete="new-password" minlength="10" required><small>At least 10 characters. Changing it logs you out on your other devices.</small></label>
      <div class="row"><button class="btn primary">Change password</button><span class="status" data-st></span></div></form></section>
    ${S.me.terms?.on && a.role !== 'admin' ? `<section class="panel"><h2>Terms and privacy</h2><p class="small" style="margin:0">${a.termsVersion ? `You accepted version ${esc(a.termsVersion)} on ${esc(day(a.acceptedAt))}.` : 'Not accepted yet.'} ${termsLinks()}.</p></section>` : ''}
    ${S.me.workspace ? `<section class="panel" id="pushPanel">${pushInner()}</section>` : ''}
    <section class="panel" id="twofaPanel">${twofaInner()}</section>
    <section class="panel" id="sessionsPanel"><h2>Where you’re logged in</h2><p class="small muted"><span class="spin"></span> Checking where you’re logged in…</p></section>
    ${S.me.workspace && a.role !== 'admin' && can('data') ? dataPanel(S.me.workspace.deletionRequest) : ''}
    ${S.me.support ? `<section class="panel"><div class="row between"><div class="head"><h2>Get help</h2><p>Questions, something not working, or ideas: we read every message.</p></div><a class="btn" href="mailto:${esc(S.me.support)}?subject=${encodeURIComponent(S.product + ' help')}">Email ${esc(S.me.support)}</a></div></section>` : ''}
    <section class="panel"><div class="row between"><div class="head"><h2>Log out</h2><p>On this device.</p></div><button class="btn" data-act="logout">Log out</button></div></section>`;
}

// Where this account is logged in, with "log out" for any other device.
async function loadSessions() {
  const box = document.getElementById('sessionsPanel');
  if (!box) return;
  try { drawSessions((await api('/api/account/sessions')).sessions); }
  catch (e) { box.innerHTML = `<h2>Where you’re logged in</h2><p class="small muted">Couldn’t check right now. ${esc(e.message)} <button class="btn sm ghost" data-act="sessions-retry">Try again</button></p>`; }
}
function drawSessions(list) {
  const box = document.getElementById('sessionsPanel');
  if (!box) return;
  const others = list.filter(x => !x.current);
  box.innerHTML = `<h2>Where you’re logged in</h2>
    <div class="stack" style="gap:6px">${list.map(x => `<div class="row between small"><span><b>${esc(x.device)}</b>${x.current ? ' <span class="pill ok">This device</span>' : ''}<br><span class="muted">active ${esc(ago(x.lastSeenAt))} · since ${esc(day(x.createdAt))}${x.ip ? ` · IP ${esc(x.ip)}` : ''}</span></span>${x.current ? '' : `<button class="btn sm ghost danger" data-act="session-end" data-id="${esc(x.id)}">Log out</button>`}</div>`).join('')}</div>
    ${others.length ? `<div class="row"><button class="btn" data-act="sessions-others">Log out everywhere else</button></div>` : ''}
    <p class="small muted" style="margin:0">Don’t recognize one? Log it out and change your password.</p>`;
}

// The last download's receipt: when, by whom, from where, and what it held.
const exportReceipt = x => `<p class="small muted" style="margin:0">Last downloaded ${esc(ago(x.at))} by ${esc(x.by)} on ${esc(x.device)}: ${[[x.counts?.videos, 'video'], [x.counts?.approvalRecords, 'approval record'], [x.counts?.facts, 'fact'], [x.counts?.clients, 'client note']].filter(([n]) => n).map(([n, w]) => plural(n, w)).join(', ') || 'settings only'}.</p>`;
// Your data: download it all as one file, or ask for the workspace to be deleted (an admin confirms).
function dataPanel(dr) {
  return `<section class="panel"><h2>Your data</h2>
    <p class="small" style="margin:0">One file with everything the app stores for your workspace: settings and their past versions, your video list, approval records and coach notes. Video files aren’t in it; download approved videos from Review. <a href="/data-deletion" target="_blank" rel="noopener">How deletion works</a></p>
    <div class="row"><a class="btn" href="/api/data/export" download data-act="export-note">Download my data</a></div>
    ${S.me.workspace?.lastExport ? exportReceipt(S.me.workspace.lastExport) : ''}
    ${dr ? `<div class="note warn">You asked on ${esc(day(dr.at))} for your workspace and all its data to be deleted. We’ll confirm it and email you when it’s done. Until then everything works as usual.</div>
      <div class="row"><button class="btn" data-act="delete-cancel">Cancel the request</button></div>`
    : `<details><summary>Delete my workspace and data</summary><form class="stack" data-form="delete-request" style="margin-top:10px">
      <p class="small" style="margin:0">This asks us to delete your workspace and everything in it: your login and any others in your workspace, settings, videos and approval records. Once we confirm it, it can’t be undone. Download your data first if you want a copy. Cancel any paid plan in <b>Billing</b> too.</p>
      <label class="field"><span>Anything we should know? (optional)</span><input class="ctl" name="note" maxlength="500"></label>
      <label class="check"><input type="checkbox" name="confirm" required> <span>Yes, delete my workspace and all its data</span></label>
      <div class="row"><button class="btn danger">Request deletion</button></div><div class="status" data-st></div></form></details>`}</section>`;
}

export { drawSessions, drawTwofa, loadSessions, termsLinks, viewAccount, viewLink, viewLogin, viewTerms, viewTwofaLogin, viewTwofaRequired };

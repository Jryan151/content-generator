// public/screens/team.js — Guide; Your team (done-for-you) and People.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { S, ago, api, can, esc, loadCfg, main, page, plural, status, usableRoutes } from '../app.js';
import { DAYS } from './brand.js';
import { stepHead } from './steps.js';

/* ================= Guide ================= */
/* ================= Your team (done-for-you) and People ================= */
// A managed agent's view of what their team runs for them, and the way to ask for changes.
async function viewTeam() {
  await loadCfg().catch(() => {});
  if (can('requests')) { try { S.requests = await api('/api/requests'); } catch { S.requests = { failed: true, requests: [], areas: {} }; } }
  if (can('people')) await loadPeople();
  drawTeam();
  if (can('people')) loadActivity();
}
function teamManagesHTML(c) {
  if (!c) return '';
  const s = c.story, U = usableRoutes(c), L = c.look, ap = c.schedule?.autopost;
  const row = (k, v) => (v ? `<div class="row between small" style="flex-wrap:nowrap;align-items:flex-start;gap:12px"><span class="muted" style="flex:none;width:120px">${k}</span><span style="flex:1">${v}</span></div>` : '');
  return `<section class="panel"><div class="head"><h2>What your team runs for you</h2><p>Your videos are made from these. To change anything, ask above.</p></div>
    <div class="stack" style="gap:6px">
      ${row('Who it’s for', esc(s.audiences.map(a => a.text).join(' · ') || 'Not set yet'))}
      ${row('Topics', `${plural(U.pains.length, 'worry', 'worries')} with confirmed facts${s.painPoints.length > U.pains.length ? ` (of ${s.painPoints.length})` : ''}`)}
      ${row('Facts', `${plural(s.insights.filter(i => i.confirmed).length, 'confirmed fact')}`)}
      ${row('How it sounds', `${esc(c.specs.energy[c.voice.energy]?.label || '')} energy, ${esc(c.specs.tone[c.voice.tone]?.label || '')} tone${c.output.mode === 'voiceover' ? ', with a voiceover' : ', captions only'}`)}
      ${row('End card', esc([L.name, L.title, L.location, L.endCta].filter(Boolean).join(' · ')))}
      ${row('Posting plan', ap?.on ? `${esc(ap.days.map(d => DAYS[d]).join(', '))} at ${esc(ap.time)}` : 'Off: you post approved videos yourself')}
    </div></section>`;
}
function drawTeam() {
  const R = S.requests, areas = R?.areas || {};
  const pill = r => (r.status === 'done' ? '<span class="pill ok">Done</span>' : '<span class="pill warn">With your team</span>');
  // (v15 Phase 10) Setup's last step: the path across the top, then the page as it was.
  main.innerHTML = `${stepHead('team')}${stepHead('team') ? `<p class="small muted" style="margin:0">${can('requests') ? 'Your team writes and tunes your videos. Ask for anything you’d like changed; you’ll hear back here.' : 'Who works in this workspace with you.'}</p>` : `<div class="head"><h1>${can('requests') ? 'Your team' : 'People'}</h1><p class="lede">${can('requests') ? 'Your team writes and tunes your videos. Ask for anything you’d like changed; you’ll hear back here.' : 'Who works in this workspace with you.'}</p></div>`}
    ${can('requests') ? `<section class="panel"><h2>Ask for a change</h2><form class="stack" data-form="request">
        <label class="field"><span>What’s it about?</span><select class="ctl" name="area">${Object.entries(areas).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>What would you like?</span><textarea class="ctl" name="text" rows="3" maxlength="800" required placeholder="e.g. More videos about Medicare supplements, and use my new headshot on the end card."></textarea></label>
        <div class="row"><button class="btn primary">Send to my team</button><span class="status" data-st></span></div></form></section>
      <section class="panel"><h2>Your requests</h2>${R?.failed ? '<p class="small muted">Couldn’t load your requests. <button class="btn sm ghost" data-act="page-retry">Try again</button></p>' : (R?.requests || []).length ? `<div class="stack" style="gap:8px">${R.requests.map(r => `<div class="box" style="gap:4px"><div class="row between"><span class="small muted">${esc(areas[r.area] || '')} · ${esc(ago(r.at))}</span>${pill(r)}</div><span class="small">${esc(r.text)}</span>${r.reply ? `<span class="small"><b>Team:</b> ${esc(r.reply)}</span>` : ''}</div>`).join('')}</div>` : '<p class="empty">Nothing asked yet.</p>'}</section>
      ${teamManagesHTML(S.cfg)}` : ''}
    ${can('people') ? peopleHTML() : ''}`;
}
// People: the agent's assistants (paid seats), what each may do, and invites still out.
async function loadPeople() { try { S.people = await api('/api/people'); S.people.failed = false; } catch { S.people = { failed: true, people: [], invites: [], seats: { total: 0, used: 0, free: 0 } }; } }
function peopleHTML() {
  const P = S.people || { people: [], invites: [], seats: { total: 0, used: 0, free: 0 } }, seat = P.seats, price = P.price;
  const money = p => (p?.amount != null ? `${(p.amount / 100).toLocaleString([], { style: 'currency', currency: (p.currency || 'usd').toUpperCase() })} a ${p.interval || 'month'}` : '');
  if (P.failed) return '<section class="panel"><h2>Assistants</h2><p class="small muted">Couldn’t load the people in this workspace. <button class="btn sm ghost" data-act="page-retry">Try again</button></p></section>';
  const assistants = P.people.filter(p => p.role === 'assistant');
  return `<section class="panel"><div class="row between"><div class="head"><h2>Assistants</h2><p>Someone to prepare and fix your videos, draft replies, and keep follow-ups and client care moving. You still approve every video. Each assistant uses a seat${price ? ` (${esc(money(price))} each)` : ''}.</p></div>
      <span class="pill">${seat.used} of ${seat.total} seat${seat.total === 1 ? '' : 's'} used</span></div>
    ${seat.canBuy ? `<div class="row"><span class="small">Seats you pay for:</span><button class="btn sm" data-act="seats" data-v="${seat.paid - 1}" ${seat.paid <= seat.minPaid ? 'disabled title="Those seats are in use"' : ''} aria-label="One fewer seat">−</button><b class="mono">${seat.paid}</b><button class="btn sm" data-act="seats" data-v="${seat.paid + 1}" ${seat.total >= seat.max ? 'disabled' : ''} aria-label="One more seat">+</button><span class="small muted">${seat.given ? `Plus ${seat.given} from your admin. ` : ''}Changes are prorated on your next invoice.</span></div>`
      : !seat.total ? `<p class="small muted" style="margin:0">${seat.managedBy === 'admin' ? 'Ask your admin for an assistant seat.' : 'Choose a plan first, then add seats here.'}</p>` : ''}
    ${assistants.length ? `<div class="stack" style="gap:8px">${assistants.map(p => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px"><b>${esc(p.name || p.email)}</b> <span class="muted">${esc(p.email)}${p.lastLoginAt ? ` · active ${esc(ago(p.lastLoginAt))}` : ' · hasn’t logged in yet'}${p.twofa ? '' : ' · two-factor not set up yet'}</span>${p.paused ? ' <span class="pill warn">Paused: no seat</span>' : ''}</span>
      <label class="check small"><input type="checkbox" data-person-post="${esc(p.id)}" ${p.canPost ? 'checked' : ''}> <span>Can post for me</span></label>${S.me.workspace?.managed ? '' : `<label class="check small"><input type="checkbox" data-person-edit="${esc(p.id)}" ${p.canEdit ? 'checked' : ''}> <span>Can edit content and settings</span></label>`}<button class="btn sm ghost danger" data-act="person-del" data-id="${esc(p.id)}">Remove</button></div>`).join('')}</div>` : ''}
    ${P.invites.map(i => `<div class="row between small"><span class="muted">Invited ${esc(i.email)} ${esc(ago(i.at))} (not accepted yet)</span><button class="btn sm ghost" data-act="invite-del" data-email="${esc(i.email)}">Take back</button></div>`).join('')}
    ${seat.free ? `<form class="row" data-form="person-invite"><input class="ctl sm" name="email" type="email" required placeholder="Their email" style="flex:1 1 220px" aria-label="Their email"><label class="check small"><input type="checkbox" name="canPost"> <span>Can post for me</span></label><button class="btn sm primary">Invite</button></form><div id="inviteOut" data-out></div>` : assistants.length || P.invites.length ? '' : ''}
    <p class="small muted" style="margin:0">Assistants never see your Mindset, billing or data, can’t approve or reject videos, and log in with two-factor.</p></section>
    ${reviewerHTML(P)}
    <section class="panel" id="activityPanel"><h2>What’s been done</h2><p class="small muted"><span class="spin"></span> Loading the activity…</p></section>`;
}
// The compliance reviewer (v15): someone (often at your carrier or marketing organization) who signs off
// each approved video before it posts. Free; they see only the Sign-off page.
function reviewerHTML(P) {
  const R = P.reviewers || { max: 3, invites: [], on: false, required: false }, list = P.people.filter(p => p.role === 'reviewer');
  const room = list.length + R.invites.length < R.max;
  return `<section class="panel" id="reviewerPanel"><div class="head"><h2>Compliance reviewer</h2><p>Someone who signs off each video you approve before it posts, if your carrier or marketing organization asks for that. They see only what’s waiting for them, and it’s free.</p></div>
    ${list.length ? `<div class="stack" style="gap:8px">${list.map(p => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px"><b>${esc(p.name || p.email)}</b> <span class="muted">${esc(p.email)}${p.lastLoginAt ? ` · active ${esc(ago(p.lastLoginAt))}` : ' · hasn’t logged in yet'}</span></span><button class="btn sm ghost danger" data-act="person-del" data-id="${esc(p.id)}">Remove</button></div>`).join('')}</div>` : ''}
    ${R.invites.map(i => `<div class="row between small"><span class="muted">Invited ${esc(i.email)} ${esc(ago(i.at))} (not accepted yet)</span><button class="btn sm ghost" data-act="invite-del" data-email="${esc(i.email)}">Take back</button></div>`).join('')}
    ${room ? `<form class="row" data-form="reviewer-invite"><input class="ctl sm" name="email" type="email" required placeholder="Your reviewer’s email" style="flex:1 1 220px" aria-label="Your reviewer’s email"><button class="btn sm${list.length ? '' : ' primary'}">Invite a reviewer</button></form>` : ''}<div id="reviewerOut" data-out></div>
    ${R.on && !R.required ? '<div class="note warn small">Sign-off is on, but no reviewer can sign in right now, so videos post without waiting.</div>' : ''}
    ${list.length ? `<div class="row between box"><span class="small" style="flex:1 1 220px"><b>${R.required ? 'Approved videos wait for sign-off.' : 'Approved videos post without waiting.'}</b> ${R.on ? 'Instagram, Facebook and the posting plan hold each one until it’s signed off; it can’t be downloaded or marked posted before.' : 'Turn this on and nothing posts until your reviewer signs it off.'}</span>
      <button class="btn sm${R.on ? ' ghost' : ' primary'}" data-act="signoff-on" data-v="${R.on ? '0' : '1'}">${R.on ? 'Turn off' : 'Turn on'}</button></div>` : '<p class="small muted" style="margin:0">Once your reviewer joins, you can turn on sign-off before posting.</p>'}
  </section>`;
}
async function loadActivity() {
  const box = document.getElementById('activityPanel');
  if (!box) return;
  try {
    const a = (await api('/api/desk/activity')).activity;
    box.innerHTML = `<h2>What’s been done</h2>${a.length ? `<ul class="list small">${a.map(e => `<li><i>·</i><span><b>${esc(e.who)}</b> ${esc(e.what)}${e.detail ? ` <span class="muted">(${esc(e.detail)})</span>` : ''} <span class="muted">${esc(ago(e.at))}</span></span></li>`).join('')}</ul>` : '<p class="empty">Nothing yet.</p>'}`;
  } catch { box.innerHTML = '<h2>What’s been done</h2><p class="small muted">Couldn’t load the activity. <button class="btn sm ghost" data-act="activity-retry">Try again</button></p>'; }
}

export { drawTeam, loadActivity, viewTeam };

// public/screens/team.js — Setup → Reviewer: the compliance reviewer, if the agent's carrier or marketing
// organization asks for one, and whether approved videos wait for their sign-off.
import { S, ago, api, can, esc, main } from '../app.js';
import { stepHead } from './steps.js';

async function viewTeam() {
  if (can('people')) await loadPeople();
  drawTeam();
}
function drawTeam() {
  main.innerHTML = `${stepHead('team')}${can('people') ? peopleHTML() : ''}`;
}
async function loadPeople() { try { S.people = await api('/api/people'); S.people.failed = false; } catch { S.people = { failed: true, people: [], reviewers: null }; } }
function peopleHTML() {
  const P = S.people || { people: [], reviewers: null };
  if (P.failed) return '<section class="panel"><h2>Compliance reviewer</h2><p class="small muted">Couldn’t load the people in this workspace. <button class="btn sm ghost" data-act="page-retry">Try again</button></p></section>';
  return reviewerHTML(P);
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
export { drawTeam, viewTeam };

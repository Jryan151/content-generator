// public/screens/desk.js — The Desk.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { S, ago, api, app, can, copy, day, esc, go, later, main, page, pollKeepsakes, short, when } from '../app.js';
import { describe } from './coach.js';
import { loadReplies, repliesPanel } from './replies.js';
import { chainFoot } from './today.js';

/* ================= The Desk ================= */
// Today's list, handoffs between the agent and an assistant, leads and follow-ups, and client care.
async function viewDesk() {
  const replies = loadReplies();   // (v15 Phase 10) keyword replies live here now, with the leads they bring
  try { S.desk = await api('/api/desk'); S.desk.failed = false; } catch (e) { S.desk = { failed: e.message }; }
  await replies;
  drawDesk();
  if ((S.desk.keepsakes || []).some(k => k.status === 'making')) pollKeepsakes();
}
const KIND_ICON = { review: '▶', handoff: '↔', followup: '☎', care: '♥', results: '📈' };
function drawDesk() {
  const D = S.desk;
  if (D.failed) { main.innerHTML = `<div class="head"><h1>Leads</h1></div><div class="note err">Couldn’t load your leads. ${esc(D.failed)} <button class="btn sm" data-act="page-retry">Try again</button></div>`; return; }
  const me = S.me.account.id, people = Object.fromEntries((D.people || []).map(p => [p.id, p]));
  const open = D.handoffs.filter(h => h.status === 'open'), done = D.handoffs.filter(h => h.status !== 'open');
  const handoffCard = h => `<div class="box" style="gap:6px"><div class="row between"><span class="small"><span class="pill">${esc(D.kinds[h.kind] || 'Note')}</span> from <b>${esc(h.byName)}</b>${h.to ? ` to <b>${esc(people[h.to]?.name || 'someone')}</b>` : ''} · <span class="muted">${esc(ago(h.at))}</span></span>${h.status === 'open' ? `<span class="row">${h.kind === 'changes' ? (S.me.role === 'owner' || S.me.role === 'admin' ? `<button class="btn sm ghost" data-act="handoff-done" data-id="${esc(h.id)}">Withdraw</button>` : '') : h.to === me || (!h.to && (S.me.role === 'owner' || h.by !== me)) || S.me.role === 'admin' ? `<button class="btn sm primary" data-act="handoff-done" data-id="${esc(h.id)}">Done</button>` : '<span class="small muted">Waiting</span>'}${h.by === me || S.me.role === 'owner' || S.me.role === 'admin' ? `<button class="x" data-act="handoff-del" data-id="${esc(h.id)}" aria-label="Remove">×</button>` : ''}</span>` : '<span class="pill ok">Done</span>'}</div>
    ${h.title ? `<b class="small pii">${esc(h.title)}</b>` : ''}${h.message ? `<p class="small" style="margin:0;white-space:pre-wrap"><span class="muted">${h.kind === 'changes' ? 'The agent’s note:' : 'They wrote:'}</span> <span class="pii">${esc(h.message)}</span></p>` : ''}
    ${h.kind === 'changes' ? `${(h.checklist || []).length ? `<div class="stack" style="gap:4px">${h.checklist.map(x => `<label class="check small"><input type="checkbox" data-handoff-check="${esc(h.id)}" data-k="${esc(x.k)}" ${x.done ? 'checked' : ''} ${h.status === 'open' ? '' : 'disabled'}> <span>${esc(x.label)}</span></label>`).join('')}</div>` : ''}
      ${h.draftId && h.status === 'open' ? `<div class="row"><a class="btn sm primary" href="#/studio/${esc(h.draftId)}">Make the changes in Studio</a><span class="small muted">Submit it again when done; it finishes this by itself.</span></div>` : ''}` : ''}
    ${h.draft ? `<p class="post small" style="margin:0">${esc(h.draft)}</p><div class="row"><button class="btn sm" data-act="handoff-copy" data-id="${esc(h.id)}">Copy the reply</button></div>` : ''}
    ${h.videoId && h.kind !== 'changes' ? '<a class="small" href="#/review">Open in Review</a>' : ''}</div>`;
  const stageSel = c => `<select class="ctl sm" data-lead-stage="${esc(c.id)}" aria-label="Stage">${Object.entries(D.stages || {}).map(([k, l]) => `<option value="${k}"${(c.stage || 'client') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  main.innerHTML = `<div class="head"><h1>Leads</h1><p class="lede">${S.me.role === 'assistant' ? 'The people your videos bring in, what needs doing today, and what to hand to the agent.' : 'The people your videos bring in, your follow-ups and client care, and what you and your assistant hand each other.'}</p></div>
    <section class="panel"><h2>Today</h2>${D.list.length ? `<div class="stack" style="gap:6px">${D.list.map(x => `<a class="row box today-item" href="#/${esc(x.go)}"><span aria-hidden="true">${KIND_ICON[x.kind] || '•'}</span><span class="small${['followup', 'care'].includes(x.kind) ? ' pii' : ''}" style="flex:1">${esc(x.text)}</span><span class="muted" aria-hidden="true">›</span></a>`).join('')}</div>` : '<p class="empty">Nothing needs you today. 👍</p>'}</section>
    <section class="panel"><div class="row between"><h2>Handoffs</h2><button class="btn sm" data-act="handoff-new">Hand something off</button></div>
      ${S.handoffNew ? `<form class="stack" data-form="handoff"><div class="fields"><label class="field"><span>What is it?</span><select class="ctl" name="kind">${Object.entries(D.kinds).map(([k, l]) => `<option value="${k}"${S.handoffNew.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>For</span><select class="ctl" name="to"><option value="">${S.me.role === 'assistant' ? 'The agent' : 'Anyone'}</option>${(D.people || []).filter(p => p.id !== me).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.role === 'assistant' ? ' (assistant)' : ''}</option>`).join('')}</select></label></div>
        <label class="field"><span>Short title</span><input class="ctl" name="title" maxlength="140" value="${esc(S.handoffNew.title || '')}" placeholder="e.g. Reply to Maria about her mom"></label>
        <label class="field"><span>What they wrote (optional)</span><textarea class="ctl" name="message" rows="2" maxlength="1200">${esc(S.handoffNew.message || '')}</textarea></label>
        <label class="field"><span>The reply to send, or your note</span><textarea class="ctl" name="draft" rows="3" maxlength="1500">${esc(S.handoffNew.draft || '')}</textarea><small>Replies go out from the agent, who reads them first.</small></label>
        <div class="row"><button class="btn primary">Hand it off</button><button type="button" class="btn ghost" data-act="handoff-cancel">Cancel</button></div></form>` : ''}
      ${open.length ? `<div class="stack" style="gap:8px">${open.map(handoffCard).join('')}</div>` : S.handoffNew ? '' : '<p class="empty">Nothing handed off. Draft a reply in the coach’s Reply to a message, then “Hand to the agent”, or add one here.</p>'}
      ${done.length ? `<details><summary class="small">Done this week (${done.length})</summary><div class="stack" style="gap:8px;margin-top:8px">${done.map(handoffCard).join('')}</div></details>` : ''}</section>
    ${D.stages ? `<section class="panel"><div class="row between"><h2>Leads and follow-ups</h2><span class="small muted">${Object.entries(D.pipeline || {}).filter(([k]) => k !== 'client' && k !== 'lost').map(([k, n]) => `${esc(D.stages[k])}: ${n}`).join(' · ')}</span></div>
      ${D.due.length ? `<div class="stack" style="gap:6px"><b class="small">Due today</b>${D.due.map(c => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px"><b class="pii">${esc(c.name)}</b>${c.next < D.today ? ' <span class="pill warn">Overdue</span>' : ''}${c.ask ? `<br><span class="muted pii">${esc(c.ask)}</span>` : ''}</span><button class="btn sm" data-act="lead-reached" data-id="${esc(c.id)}">Reached out</button></div>`).join('')}</div>` : '<p class="small muted" style="margin:0">No follow-ups due today.</p>'}
      ${D.leads.length ? `<div class="stack" style="gap:6px"><b class="small">Leads</b>${D.leads.map(c => `<div class="box lead" style="gap:6px"><div class="row between"><span class="small pii"><b>${esc(c.name)}</b>${c.phone || c.email ? ` <span class="muted">${esc(c.phone || c.email)}</span>` : ''}</span>${c.source ? `<span class="small muted">${esc(c.source)}</span>` : ''}</div>
        <div class="fields"><label class="field"><span class="small">Stage</span>${stageSel(c)}</label><label class="field"><span class="small">Next follow-up</span><input class="ctl sm" type="date" data-lead-next="${esc(c.id)}" value="${esc(c.next || '')}"></label></div></div>`).join('')}</div>` : ''}
      <form class="row" data-form="lead-add"><input class="ctl sm" name="name" required maxlength="80" placeholder="New lead’s name" style="flex:1 1 160px" aria-label="Name"><input class="ctl sm" name="phone" maxlength="40" placeholder="Phone or email" style="flex:1 1 140px" aria-label="Phone or email"><input class="ctl sm" name="source" maxlength="120" placeholder="Where from (e.g. the funeral costs video)" style="flex:2 1 200px" aria-label="Where they came from"><button class="btn sm primary">Add lead</button></form></section>
    <section class="panel"><h2>Client care</h2><p class="small muted" style="margin:0">Birthdays, policy anniversaries and anyone gone quiet, from your client notes. Add birthdays and policy dates in Grow → Mindset → Relationship notes.</p>
      ${D.care.length ? `<div class="stack" style="gap:6px">${D.care.map(careItem).join('')}</div>` : '<p class="empty">Nothing coming up in the next two weeks.</p>'}</section>
    ${keepsakesPanel(D)}` : ''}
    ${repliesPanel()}
    ${chainFoot('leads')}`;
}
// One client-care item (v15): a note drafted right here in the agent's voice, and for a birthday or a new
// client, a private video to text them. Done when it's handled.
const NOTE_LABEL = { thanks: 'Draft a thank-you', welcome: 'Draft a welcome note', birthday: 'Draft a note', anniversary: 'Draft a note', quiet: 'Draft a note' };
function careItem(x) {
  const D = S.desk, n = (S.deskNotes || {})[x.key], ed = S.keepsakeEdit?.key === x.key ? S.keepsakeEdit : null;
  const video = x.kind === 'birthday' || x.kind === 'welcome';
  const noClips = x.kind === 'welcome' && !D.ownClips;
  return `<div class="box" style="gap:6px" data-care="${esc(x.key)}"><div class="row between" style="gap:8px"><span class="small" style="flex:1 1 200px"><span class="pii">${esc(x.text)}</span> <span class="muted">· ${esc(new Date(`${x.date}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</span></span>
      <span class="row"><button class="btn sm ghost" data-act="care-draft" data-id="${esc(x.id)}" data-key="${esc(x.key)}" data-kind="${esc(x.kind)}" ${n === 'busy' ? 'disabled' : ''}>${n === 'busy' ? '<span class="spin"></span> Writing…' : esc(NOTE_LABEL[x.kind] || 'Draft a note')}</button>
      ${video ? `<button class="btn sm ghost" data-act="keepsake-open" data-id="${esc(x.id)}" data-key="${esc(x.key)}" data-kind="${esc(x.kind)}" data-name="${esc(x.name)}" ${noClips ? 'disabled title="Add your own clips in Setup → Library first"' : ''}>${x.kind === 'birthday' ? 'Make a birthday video' : 'Make a welcome video'}</button>` : ''}
      <button class="btn sm" data-act="care-done" data-id="${esc(x.id)}" data-key="${esc(x.key)}">Done</button></span></div>
    ${noClips ? '<span class="small muted">A welcome video is made from your own clips: add a few in Setup → Library → Your own clips.</span>' : ''}
    ${n && n !== 'busy' ? (n.error ? `<span class="small warn-text">${esc(n.error)}</span>` : `<div class="stack" style="gap:6px">${n.notes.map((t, k) => `<div class="row between box" style="gap:8px;background:var(--well)"><span class="small" style="flex:1 1 220px"><b>${esc(t.label)}:</b> <span class="pii">${esc(t.text)}</span></span><button class="btn sm" data-act="care-copy" data-key="${esc(x.key)}" data-k="${k}">Copy</button></div>`).join('') || '<span class="small muted">None of them passed the checks. Try again.</span>'}${n.voice ? '' : '<span class="small muted">Tip: add something you’ve written in Setup → Voice and rules, and notes sound more like you.</span>'}</div>`) : ''}
    ${ed ? `<div class="stack keepsake-edit" style="gap:6px"><b class="small">${x.kind === 'birthday' ? 'Birthday video' : 'Welcome video'} for <span class="pii">${esc(x.name)}</span>: the words</b>${ed.lines.map((l, k) => `<input class="ctl sm pii" maxlength="60" data-keepsake-line="${k}" value="${esc(l)}" aria-label="Line ${k + 1}">`).join('')}
      <span class="small muted">Over ${D.ownClips ? 'your own clips' : 'warm, simple footage'}, with your end card. Private: it’s for texting, and never posted.</span>
      <div class="row"><button class="btn sm primary" data-act="keepsake-make">Make it</button><button class="btn sm ghost" data-act="keepsake-cancel">Cancel</button></div></div>` : ''}</div>`;
}
// Keepsakes (v15): private videos for one client, to share from the phone.
function keepsakesPanel(D) {
  const ks = D.keepsakes || [];
  if (!ks.length) return '';
  return `<section class="panel"><div class="row between"><h2>Keepsakes</h2><span class="small muted">Private videos for one client. Kept 60 days.</span></div><div class="stack" style="gap:6px">${ks.map(k => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px"><b>${esc(k.kind === 'birthday' ? 'Birthday video' : 'Welcome video')} for <span class="pii">${esc(k.name)}</span></b><br><span class="muted">${k.status === 'making' ? '<span class="spin"></span> Being made…' : k.status === 'failed' ? `Didn’t finish: ${esc(k.error || 'try again')}` : `“${esc(k.lines[0])}” · ${esc(day(k.readyAt || k.createdAt))}`}</span></span>
    <span class="row">${k.status === 'ready' ? `<button class="btn sm primary" data-act="keepsake-share" data-id="${esc(k.id)}">Share</button><a class="btn sm ghost" href="/media/${esc(k.file)}" download="${esc(`${k.kind === 'birthday' ? 'Happy birthday' : 'Welcome'} ${k.name}.mp4`)}">Download</a>` : ''}<button class="x" data-act="keepsake-del" data-id="${esc(k.id)}" aria-label="Delete">×</button></span></div>`).join('')}</div></section>`;
}

async function viewGuide() {
  const admin = S.me.account.role === 'admin', ws = S.me.workspace;
  const tab = (k, label) => (ws?.onboarded ? `<a href="#/${k}">${label}</a>` : `<b>${label}</b>`);
  main.innerHTML = `<div class="head"><h1>Guide</h1><p class="lede">How ${esc(S.product)} works, in plain words. Five minutes to read; worth it.</p></div>
    <section class="panel"><h2>How it works</h2>
      <ol class="steps-list">
        <li><b>You set it up once.</b> Your name, what you sell, who you help, how you sound, and the facts your videos may teach. Only facts you confirm are ever used.</li>
        <li><b>The app writes and makes each video.</b> It picks one audience, one worry and one confirmed fact, writes several openings and drafts, checks every rule, finds footage, adds captions (and a voice if you want one) and your end card.</li>
        <li><b>You review.</b> Watch it with sound, tick the checklist, approve or reject. Rejecting with a reason teaches the next scripts.</li>
        <li><b>You post</b>, by hand or automatically to Instagram.</li>
        <li><b>You add results.</b> A few days later, add views and messages. Topics and openings that bring messages come up more often.</li>
      </ol></section>
    <section class="panel"><h2>A simple weekly routine</h2>
      <ul class="list">
        <li class="ok"><i>1</i><span><b>Monday, 5 minutes:</b> read the coach’s check-in on ${tab('today', 'Today')} and tap <em>Make these videos</em>.</span></li>
        <li class="ok"><i>2</i><span><b>Most mornings:</b> turn on <em>Overnight</em> in ${tab('create', 'Create')} so a few videos are waiting when you wake up.</span></li>
        <li class="ok"><i>3</i><span><b>Review in one sitting:</b> watch, approve or fix a scene. Approve a small batch at a time.</span></li>
        <li class="ok"><i>4</i><span><b>Post 3 to 5 times a week:</b> by hand, or set a posting plan in ${tab('autopilot', 'Setup → Autopilot')} so one approved video goes out each day.</span></li>
        <li class="ok"><i>5</i><span><b>Three days after posting:</b> add views and messages under Posted.</span></li>
      </ul></section>
    <section class="panel"><h2>Where everything is</h2>
      <p class="small muted" style="margin:0">Five stops for every day, and Setup for what you set once. Your account, this guide and billing are under your initial in the top corner.</p>
      <dl class="meta wide">
        <dt>Today</dt><dd>Where your day starts: what’s waiting, your list, the week ahead, what’s coming up, and the coach’s weekly check-in.</dd>
        <dt>Review</dt><dd>Watch, approve, reject or fix videos; post them; add results; download approval records.</dd>
        <dt>Create</dt><dd>Make videos now or pick the topic and format in Studio (and test two openings); overnight videos; test a script or footage.</dd>
        <dt>Leads</dt><dd>The people your videos bring in: leads and follow-ups, client care and keepsakes, handoffs with your assistant, and keyword replies on Instagram.</dd>
        <dt>Grow</dt><dd>What’s working and your opening tests; Communicate (the four communication styles and the input workshop); and Mindset (your why, habits and tools from ten books).</dd>
        <dt>Setup</dt><dd>Six steps, in the order a video is built: <b>Profile</b> (your name, end card, photo, booking link and who you serve), <b>Library</b> (audiences, worries, facts, solutions, your own clips), <b>Voice and rules</b>, <b>Look</b> (captions, footage, length and formats), <b>Autopilot</b> (Instagram, Facebook, the posting plan, going away) and <b>Team</b> (assistants and a compliance reviewer).</dd>
        <dt>Coach (✦)</dt><dd>Ask anything about your videos, or switch it to Communication. Its suggestions can be tried side by side and applied in one tap.</dd>
      </dl></section>
    <section class="panel"><h2>Getting better videos</h2>
      <ul class="list">
        <li class="ok"><i>✓</i><span><b>Confirm at least 4 facts</b>, each linked to a worry, so videos don’t repeat.</span></li>
        <li class="ok"><i>✓</i><span><b>Paste 2 or 3 things you wrote</b> in Setup → Voice and rules. It changes the wording more than any setting.</span></li>
        <li class="ok"><i>✓</i><span><b>Write worries in your clients’ words.</b> “I don’t want my kids paying for my funeral” beats “final expense planning”.</span></li>
        <li class="ok"><i>✓</i><span><b>Set a style for each audience</b> in Grow → Communicate, then run a worry through the input workshop.</span></li>
        <li class="ok"><i>✓</i><span><b>Change one thing at a time</b>, and use the coach’s <em>Try it first</em> to compare before and after.</span></li>
        <li class="ok"><i>✓</i><span><b>Judge by messages, not views.</b> A video with 300 views and 3 messages beat one with 5,000 and none.</span></li>
      </ul></section>
    <section class="panel rules"><h2><span class="dot"></span>Compliance checks, and your part</h2>
      <p class="small" style="margin:0">Every script and post is compliance-checked in code before you see it: no prices or percentages, no promises that someone will qualify, nothing that sounds government-backed, no client stories, no pressure or invented urgency, and facts keep words like “usually” or “may”. Only facts you confirmed are used, and every approval is recorded with a fingerprint of the exact file.</p>
      <p class="small" style="margin:0"><b>The checks catch risky wording; they don’t make a video compliant.</b> You’re still the licensed agent: watch every video before it’s posted, and you stay responsible for final approval and for following your carriers’ and your state’s advertising rules. Many carriers and states want to review ads first; the approval records help with that but don’t replace it.</p></section>
    <section class="panel faq"><h2>Common questions</h2>
      ${[['Why can’t I make a video?', 'Usually no fact is confirmed and linked to a worry, or a worry isn’t linked to an audience. Create shows exactly what’s missing and a link to fix it.'],
        ['How long does a video take?', 'About two minutes. Videos are made one at a time in the background, so you can close the page.'],
        ['Can I change one caption or clip?', 'Yes. Review → Fix a scene. It re-renders in a minute or two without writing a new script.'],
        ['Captions only, or voiceover?', 'Captions-only videos let you add a trending sound in Instagram, which helps reach. Voiceover videos carry the message for people who listen, and their post text says the voice is AI (you can turn that off in Setup → Voice and rules). Change it any time there.'],
        ['Does it post for me?', 'If Instagram is connected in Setup → Autopilot, yes: only videos you approved, at the time you pick or on your posting plan. Instagram can’t add a trending sound to automatic posts, so captions-only videos post without one.'],
        ['What does the coach know?', 'Your setup, your recent videos, why you rejected some, and which ones brought messages. It suggests; you decide.'],
        ['Who can see my workspace?', 'Only you, and your admin when they help you. Each agent’s videos and settings are separate.'],
        ['Can I use clips of myself?', 'Yes. Setup → Library → Your own clips: upload short clips from your phone, describe each in a few words, and choose how often they’re used. The rest is stock footage.'],
        ['Do some topics fit certain months?', 'Yes. Setup → Library → Worries → In season: tick the months, and those worries come up more often then. The tab suggests this month’s moment, like September’s Life Insurance Awareness Month.'],
        ['Can I refer another agent?', 'Yes, when billing is on. Billing has your referral link. When an agent you refer starts a paid plan, you get a month free.'],
        ['Can I get a copy of my data, or have it deleted?', 'Yes. Account → Your data downloads everything in one file. Request deletion there too: once it’s confirmed, your workspace, videos and records are deleted and you get an email.']].map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="small" style="margin:0">${esc(a)}</p></details>`).join('')}</section>
    ${S.me.support ? `<section class="panel"><div class="row between"><div class="head"><h2>Still stuck?</h2><p>Email us and we’ll help.</p></div><a class="btn" href="mailto:${esc(S.me.support)}?subject=${encodeURIComponent(S.product + ' help')}">Email ${esc(S.me.support)}</a></div></section>` : ''}
    ${admin ? `<section class="panel out"><h2><span class="dot"></span>For you as the admin</h2>
      <ul class="list">
        <li class="ok"><i>1</i><span><b>Add an agent:</b> Admin → Invite. With email set up the invite is emailed; otherwise send them the link. Tick <em>No charge</em> for friends and testers. People who ask on your landing page (/welcome) show up under <em>Access requests</em> with an <em>Invite</em> button.</span></li>
        <li class="ok"><i>2</i><span><b>Help an agent:</b> Admin → Open puts you in their workspace. <em>Back to Admin</em> takes you out.</span></li>
        <li class="ok"><i>3</i><span><b>Done for you:</b> mark the workspace <em>Done for you</em>, open it, tune their content and styles, and log your time on their card so you can see what each client earns per hour.</span></li>
        <li class="ok"><i>4</i><span><b>Plans:</b> Solo and Done for you are the two Stripe plans (Starter and Pro in .env). Founding rates are Stripe promotion codes; checkout accepts them.</span></li>
        <li class="ok"><i>5</i><span><b>Alerts:</b> failed videos, failed payments, failed backups, low disk and Instagram problems show in Admin. Set ALERT_WEBHOOK_URL to get them on your phone.</span></li>
        <li class="ok"><i>6</i><span><b>Data deletion:</b> when an agent asks to be deleted, you get an alert and their card in Admin shows <em>Delete everything</em> or <em>Decline</em>. Cancel their Stripe subscription first.</span></li>
        <li class="ok"><i>7</i><span><b>AI cost cap:</b> each workspace has a monthly AI budget (AI_COST_CAP_USD, $20 unless you set it). You get an alert at 80%; at 100% its new videos, test scripts and coach pause until next month. Change one workspace’s cap with <em>AI cap</em> on its card.</span></li>
        <li class="ok"><i>8</i><span><b>Updates:</b> unzip the new version on the server and run <code>bash update.sh</code>. It runs the checks first and won’t restart a broken version.</span></li>
      </ul></section>` : ''}`;
}

export { drawDesk, viewDesk, viewGuide };

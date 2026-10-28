// public/screens/review.js — Review.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { FORMATS, PERSUASION, REJECT_TIPS, S, STRUCTURES, actions, aheadPanel, api, app, can, cantNow, copy, day, esc, go, gridPanel, later, loadCfg, loadRecap, loadToday, local, main, offlineOK, overlayQueue, page, pageWs, plural, preloadMedia, prunePreload, readQueue, recapPanel, render, short, softGone, status, stopTimers, streakPanel, toast, updateBadge, watchJobs, weekPanel, when, wsKey, wsParam } from '../app.js';
import { lowNote, planSkipHTML, spendNote } from './create.js';
import { describe } from './coach.js';
import { signedOff } from '../mixer-core.js';
import { chainFoot, drawToday } from './today.js';
import { drawGrow } from './grow.js';

/* ================= Review ================= */
async function loadVideos() {
  const r = await api('/api/videos');
  S.videos = r.videos.filter(v => !softGone(`video:${v.id}`)); S.stats = r.stats; S.fixing = r.fixing; S.versioning = r.versioning || []; S.low = r.low; S.reviewPlan = r.plan; S.making = r.making || 0;
  overlayQueue();
  if (S.making || S.fixing?.length) watchJobs();   // (a fix, or a new version someone else submitted: shown when it's ready)
  if (S.me.workspace) S.me.workspace.pending = S.videos.filter(v => v.status === 'pending').length;
}
async function loadIg() { [S.ig, S.fb] = await Promise.all([S.me.instagram ? api('/api/instagram').catch(() => null) : null, S.me.facebook ? api('/api/facebook').catch(() => null) : null]); }
async function viewReview({ arg = '' } = {}) {
  S.focus = null;
  await Promise.all([loadVideos(), loadCfg().catch(() => {}), loadIg(), loadToday(true)]);
  drawReview();
  // Preloading (app.js): only videos still waiting stay kept; the first one waiting is fetched ahead.
  const waiting = S.videos.filter(v => v.status === 'pending' && v.media);
  prunePreload(new Set(waiting.map(v => v.media)));
  // A busy week's notification (#/review/focus): straight into reviewing them one by one.
  if (arg === 'focus' && can('approve') && S.videos.filter(v => v.status === 'pending').length > 1) actions['focus-on']();
  // Opened from a notification (#/review/<id>): that exact video, brought into view and loaded first.
  const want = arg && S.videos.find(v => v.id === arg);
  if (want) {
    const card = main.querySelector(`[data-vid="${CSS.escape(want.id)}"]`);
    if (card) { card.classList.add('opened'); card.scrollIntoView({ block: 'start' }); const p = card.querySelector('video.player'); if (p) p.preload = 'auto'; }
    if (want.media) preloadMedia(want.media);
  } else if (waiting[0]) setTimeout(() => preloadMedia(waiting[0].media), 1500);
  // A scene fix suggested by the coach opens here, filled in.
  const pf = S.pendingFix;
  if (pf && S.videos.some(v => v.id === pf.videoId)) {
    S.pendingFix = null;
    actions['fix-open']({ dataset: { id: pf.videoId } });
    ['text', 'accent', 'keyword'].forEach(k => { if (pf[k]) S.fix.edits[pf.i][k] = pf[k]; });
    drawReview();
    main.querySelector(`[data-fix="${pf.i}"][data-k="text"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
// `auto`: the app asked on its own, so a failure stays quiet (the last check-in still shows).
async function loadWeekly(fresh = false, auto = false) {
  try {
    if (!fresh) { S.weekly = await api('/api/coach/weekly'); return; }
    S.weeklyAsked = true; S.weeklyBusy = true; if (['review', 'today'].includes(S.view)) drawReview();
    S.weekly = await api('/api/coach/weekly', { method: 'POST', body: {} });
  } catch (e) { if (fresh && !auto) toast(e.message); }
  S.weeklyBusy = false;
  if (fresh && ['review', 'today'].includes(S.view)) drawReview();
}
function weeklyPanel() {
  if (S.weeklyBusy) return '<section class="panel"><h2>This week</h2><p class="small muted"><span class="spin"></span> The coach is looking at your videos and results…</p></section>';
  const w = S.weekly?.weekly;
  if (!w) return '';
  const pains = S.cfg?.story.painPoints || [];
  const date = new Date(w.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `<section class="panel weekly"><div class="row between"><h2>This week</h2><span class="small muted">Coach check-in · ${esc(date)}${S.weekly.current ? '' : ' · from last week'}</span></div>
    <p style="margin:0">${esc(w.summary)}</p>${w.focus ? `<p style="margin:0"><b>Focus:</b> ${esc(w.focus)}</p>` : ''}
    ${w.change ? `<div class="sg"><b class="small">${esc(w.change.label)}</b><div class="small">${describe(w.change)}</div>${w.change.why ? `<div class="small muted">${esc(w.change.why)}</div>` : ''}<div class="row"><button class="btn sm${w.change.applied ? '' : ' primary'}" data-act="weekly-apply" ${w.change.applied ? 'disabled' : ''}>${w.change.applied ? 'Applied ✓' : 'Apply'}</button></div></div>` : ''}
    ${w.plan?.length ? `<div class="stack" style="gap:8px"><h3>Suggested videos</h3>${w.plan.map((x, k) => `<label class="check"><input type="checkbox" data-plan="${k}" ${w.queuedAt ? 'disabled' : S.planOff?.at === w.at && S.planOff.off[k] ? '' : 'checked'}> <span><b>${esc(FORMATS[x.format]?.label || x.format)}</b> · ${esc(pains.find(p => p.id === x.painId)?.text || '')}${x.why ? `<br><small class="muted">${esc(x.why)}</small>` : ''}</span></label>`).join('')}
      <div class="row">${w.queuedAt ? `<span class="small muted">${w.auto ? 'Made automatically' : 'Queued'} ${esc(when(w.queuedAt))}. They’ll show up in To review.</span>` : '<button class="btn primary" data-act="plan-make">Make these videos</button>'}<button class="btn ghost sm" data-act="weekly-refresh">New check-in</button></div>${S.reviewPlan?.on ? `<p class="small muted" style="margin:0">Monday plans are made for you. ${planSkipHTML(S.reviewPlan)}</p>` : ''}</div>` : '<div class="row"><button class="btn ghost sm" data-act="weekly-refresh">New check-in</button></div>'}</section>`;
}
function rejectionsPanel(st) {
  const r = st.rejections || [], total = r.reduce((a, x) => a + x.count, 0);
  if (total < 2) return '';
  const top = r[0];
  return `<section class="panel"><div class="head"><h2>Why videos get rejected</h2><p>Your reasons from the last 60 days.</p></div>
    <div class="chips">${r.map(x => `<span class="chip"><span>${esc(x.reason)} · ${x.count}</span></span>`).join('')}</div>
    ${REJECT_TIPS[top.reason] ? `<p class="small" style="margin:0"><b>What helps with “${esc(top.reason)}”:</b> ${esc(REJECT_TIPS[top.reason])}</p>` : ''}
    <div class="row"><button class="btn sm" data-act="ask-rejections">Ask the coach</button></div></section>`;
}
// Re-check while a scene is being fixed or an Instagram post is going out (or about to).
function pollReview() {
  stopTimers();
  const soon = p => p?.status === 'processing' || (p?.status === 'scheduled' && Date.parse(p.at) < Date.now() + 5 * 60000);
  const posting = S.videos.some(v => soon(v.autopost) || soon(v.fbpost));
  if (!S.fixing.length && !posting) return;
  const sig = () => JSON.stringify([S.fixing, S.videos.map(v => [v.id, v.status, v.autopost?.status, v.fbpost?.status])]);
  later(async () => { if (S.view !== 'review') return; const before = sig(); await loadVideos().catch(() => {}); if (sig() !== before) { drawReview(); updateBadge(); } else pollReview(); }, S.fixing.length ? 5000 : 15000);
}
const STEPS_POST = mode => [
  'Copy the post text.',
  'Save the video to your phone.',
  'In Instagram, tap +, choose Reel, and pick the video.',
  mode === 'captions' ? 'Add a trending sound at low volume (sounds added in Instagram help reach).' : null,
  'Paste the post text. Use the cover image as the cover if you like.',
  'Share it, then come back and tap Mark posted.',
].filter(Boolean);

// Opening tests (v15, lib/abtests.js): two versions of one video with different openings, and what won.
async function loadAbtests() { try { S.abtests = await api('/api/abtests'); } catch { S.abtests = null; } }
const ARM_STATUS = { making: 'Being made', review: 'In review: approve and post both', live: 'Posted: results after a week', decided: '', stopped: '' };
function abtestsPanel() {
  const A = S.abtests;
  if (!A?.tests?.length) return '';
  const hook = (t, arm) => `<b>${arm}</b> “${esc(t.arms[arm].hook)}” <span class="muted">(${esc(A.styles[t.arms[arm].style] || '')})</span>`;
  return `<section class="panel" id="abtestsPanel"><div class="head"><h2>Opening tests</h2><p>Two versions of a video, the same but for the opening. Post both a day or two apart at the same time; after ${A.days} days, the one with clearly more views wins, and new scripts learn from it.</p></div>
    ${A.lessons.length ? `<p class="small" style="margin:0"><b>What’s won so far:</b> ${A.lessons.filter(l => l.won || l.lost).map(l => `${esc(l.label)} won ${l.won} of ${l.won + l.lost}`).join(' · ') || 'nothing clear yet'}</p>` : ''}
    <div class="stack" style="gap:8px">${A.tests.slice(0, 10).map(t => `<div class="box" style="gap:4px">
      <div class="row between"><span class="small">${t.status === 'decided' ? (t.winner ? `<span class="pill ok">${t.winner} won</span>` : '<span class="pill">Too close to call</span>') : t.status === 'stopped' ? '<span class="pill">Stopped</span>' : `<span class="pill warn">${esc(ARM_STATUS[t.status])}</span>`}</span><span class="small muted">${esc(day(t.createdAt))}</span></div>
      <span class="small">${hook(t, 'A')}</span><span class="small">${hook(t, 'B')}</span>
      ${t.why ? `<span class="small muted">${esc(t.why)}</span>` : ''}
      ${['making', 'review', 'live'].includes(t.status) && can('make') ? `<div class="row"><button class="btn sm ghost" data-act="ab-stop" data-id="${esc(t.id)}">Stop this test</button></div>` : ''}</div>`).join('')}</div></section>`;
}
const abPill = v => (v.abtest ? `<span class="pill">Opening test · ${esc(v.abtest.arm)}${v.abtest.result === 'won' ? ' · won' : v.abtest.result === 'lost' ? ' · lost' : v.abtest.result === 'tie' ? ' · too close' : ''}</span>` : '');
function drawReview() {
  // (v15 Phase 10) The week, the coach's check-in and the nudges moved to Today, and results to Grow:
  // their buttons redraw whichever of those pages is open.
  if (S.view === 'today') return drawToday();
  if (S.view === 'grow') return drawGrow();
  // (A video waiting for its Undo stays off the screen whichever way the list was refreshed.)
  const vids = S.videos.filter(v => !softGone(`video:${v.id}`)), st = S.stats;
  const by = s => vids.filter(v => v.status === s);
  const pending = by('pending'), approved = by('approved'), posted = by('posted'), rejected = by('rejected');
  if (S.focus) { if (pending.length) return drawFocus(pending); S.focus = null; toast('All caught up'); }
  main.innerHTML = `<div class="head"><h1>Review</h1><p class="lede">${S.me.workspace?.managed ? 'Your videos are written and tuned for you. Watch each one with sound and approve the ones you’re happy to post.' : 'Watch each video and check it. Approved videos can be downloaded and posted.'}</p></div>
    ${S.me.workspace?.spend?.over ? spendNote(S.me.workspace.spend) : ''}
    ${!vids.length ? `<section class="panel"><h2>${S.making ? 'Your first video is on its way' : 'Your videos will show up here'}</h2><p class="small" style="margin:0">${S.making ? 'It takes about two minutes. You can leave this page; it’ll be waiting here.' : 'Each video is written, checked against the rules and made in about two minutes. Then you watch it here and approve it before it goes anywhere.'}</p>${S.making ? '' : '<div class="row"><a class="btn primary" href="#/create">Make your first video</a></div>'}</section>` : `<section class="panel"><div class="stats">
      <div class="stat"><b>${pending.length}</b><span>to review</span></div>
      <div class="stat"><b>${approved.length}</b><span>ready to post</span></div>
      <div class="stat"><b>${st.month.posted}</b><span>posted this month</span></div>
      <div class="stat"><b>${st.totals.messages}</b><span>messages from videos</span></div>
      ${S.cfg?.look?.bookingUrl || st.totals.clicks ? `<div class="stat"><b>${st.totals.clicksMonth || 0}</b><span>link visits this month</span></div>` : ''}${st.totals.bookings ? `<div class="stat"><b>${st.totals.bookings}</b><span>bookings from videos</span></div>` : ''}</div></section>`}
    ${S.today?.week?.plan ? '' : lowNote(S.low)}
    ${st.needResults?.length ? `<div class="note warn">${plural(st.needResults.length, 'posted video')} ${st.needResults.length > 1 ? 'are' : 'is'} ready for results. Add views and messages under Posted: they teach the system which topics bring people to you.</div>` : ''}
    <section class="stack"><div class="row between"><h2>To review</h2><span class="row">${pending.length && offlineOK() ? `<button class="btn sm ghost" data-act="offline-save" title="${local.get(wsKey('offlineAt')) ? `Last saved ${esc(when(local.get(wsKey('offlineAt'))))}` : 'Watch and decide with no connection'}">Save for offline</button>` : ''}${pending.length > 1 && can('approve') ? '<button class="btn sm" data-act="focus-on">Review one by one</button>' : ''}</span></div>${readQueue().length ? `<div class="note small">${plural(readQueue().length, 'decision')} made offline will be sent when you’re back online.</div>` : ''}${pending.length ? `<div class="vids">${pending.map(cardPending).join('')}</div>` : S.making ? `<p class="empty"><span class="spin"></span> ${plural(S.making, 'video is', 'videos are')} being made. They’ll show up here in a few minutes.</p>` : `<p class="empty">Nothing waiting. <a href="#/create">Make a video</a>.</p>`}</section>
    ${approved.length ? `<section class="stack"><h2>Ready to post</h2><div class="vids">${approved.map(cardApproved).join('')}</div></section>` : ''}
    ${gridPanel()}
    ${posted.length ? `<section class="stack"><h2>Posted</h2><p class="small muted">Add views and messages a few days after posting. They show which topics bring people to you.</p><div class="stack">${[...posted].sort((a, b) => (st.needResults || []).includes(b.id) - (st.needResults || []).includes(a.id)).slice(0, 30).map(cardPosted).join('')}</div></section>` : ''}
    ${st.topics.length || vids.some(v => v.abtest) || S.abtests?.tests?.length || (st.rejections || []).length ? '<p class="small muted" style="margin:0">What’s working, opening tests and why videos were rejected: <a href="#/grow">Grow</a>.</p>' : ''}
    ${rejected.length ? `<details><summary>Rejected (${rejected.length}) · removed after a couple of weeks</summary><div class="vids">${rejected.map(cardRejected).join('')}</div></details>` : ''}
    ${!vids.some(v => v.approval) || !can('data') ? '' : `<section class="panel"><div class="row between"><div class="head"><h3>Approval records</h3><p>Who approved each video, what they checked, the fact used and a fingerprint of the exact file.</p></div>
      <div class="row"><a class="btn sm" href="/api/records.html${wsParam()}">Download (HTML)</a><a class="btn sm" href="/api/records.csv${wsParam()}">Spreadsheet (CSV)</a></div></div></section>`}
    ${chainFoot('review')}`;
  pollReview();
}
// Review one by one: a single video at a time, big. Swipe or ←/→ (J/K) to move, 1–9 to tick the
// checklist, Enter to approve once everything's ticked, R to reject, Esc to go back to the list.
function drawFocus(pending) {
  const i = Math.min(Math.max(0, S.focus.i || 0), pending.length - 1), v = pending[i];
  S.focus.i = i; S.focus.id = v.id;
  main.innerHTML = `<div class="focus-bar row between"><button class="btn sm ghost" data-act="focus-off">← All videos</button><b class="small">${i + 1} of ${pending.length}</b>
      <span class="row"><button class="btn sm" data-act="focus-go" data-d="-1" ${i ? '' : 'disabled'} aria-label="Previous video">‹</button><button class="btn sm" data-act="focus-go" data-d="1" ${i < pending.length - 1 ? '' : 'disabled'} aria-label="Next video">›</button></span></div>
    <div class="vids focus">${cardPending(v)}</div>
    <p class="small muted keys">Swipe or use ← → to move · 1–${S.me.checklist.length} to tick · Enter to approve · R to reject · Esc for the list</p>`;
  pollReview();
}
const haptic2 = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* not on this device */ } };
function focusKey(e) {
  if (S.view !== 'review' || !S.focus || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.getElementById('prompter') || S.coach?.open) return;   // keys belong to what's on top
  if (e.target.closest?.('input:not([type=checkbox]), textarea, select, [contenteditable], video, button, a, summary')) return;
  const k = e.key || '';
  if (k === 'ArrowRight' || k === 'j') { e.preventDefault(); actions['focus-go']({ dataset: { d: '1' } }); }
  else if (k === 'ArrowLeft' || k === 'k') { e.preventDefault(); actions['focus-go']({ dataset: { d: '-1' } }); }
  else if (k === 'Escape') { e.preventDefault(); actions['focus-off'](); }
  else if (/^[1-9]$/.test(k)) {
    const box = main.querySelectorAll(`[data-chk="${S.focus.id}"]`)[Number(k) - 1];
    if (box) { e.preventDefault(); box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); haptic2(8); }
  } else if (k === 'Enter') {
    const b = main.querySelector(`[data-act="approve"][data-id="${S.focus.id}"]`);
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  } else if (k === 'r' || k === 'R') { const b = main.querySelector(`[data-act="reject-open"][data-id="${S.focus.id}"]`); if (b) { e.preventDefault(); b.click(); } }
}
const factLine = v => `<dl class="meta"><dt>Topic</dt><dd>${esc(v.meta?.painPoint)}</dd><dt>Fact</dt><dd>${esc(v.meta?.insight)}</dd>${(v.meta?.principles || []).length ? `<dt>Uses</dt><dd>${v.meta.principles.map(p => `<span class="pill" title="${esc(PERSUASION[p]?.how || '')}">${esc(PERSUASION[p]?.label || p)}</span>`).join(' ')}</dd>` : ''}</dl>`;
const player = v => (v.media ? `<video class="player" src="${esc(v.media)}"${v.coverUrl ? ` poster="${esc(v.coverUrl)}"` : ''} controls playsinline preload="none"></video>` : '<div class="player" style="display:grid;place-items:center;color:#aaa;font-size:13px;padding:12px;text-align:center">Video file removed</div>');
const sub = v => [when(v.createdAt), FORMATS[v.meta?.format]?.label, v.meta?.structure && v.meta.structure !== 'classic' ? STRUCTURES[v.meta.structure]?.label : '', v.duration ? Math.round(v.duration) + 's' : '', v.source === 'overnight' ? 'made overnight' : '', v.version > 1 ? 'fixed' : ''].filter(Boolean).join(' · ');
const scriptList = v => `<ol class="script">${(v.scenes || []).map(s => `<li>${s.say ? esc(s.say) + '<br><small>on screen: ' + esc(s.text) + '</small>' : esc(s.text)}</li>`).join('')}</ol>`;

function cardPending(v) {
  const fixing = S.fixing.includes(v.id);
  const studioMade = !!v.meta?.draftId;
  return `<article class="vid" data-vid="${v.id}">${player(v)}<div class="info">
    <div class="row"><span class="pill warn">${studioMade && can('approve') ? 'Waiting for you' : 'To review'}</span>${abPill(v)}${v.updated ? '<span class="pill">Updated</span>' : ''}${v.needsChanges ? '<span class="pill">Changes asked for</span>' : ''}<span class="small muted">${esc(sub(v))}</span></div>
    ${factLine(v)}
    ${v.signoff?.status === 'back' ? `<div class="note warn small"><b>${esc(v.signoff.byName || 'Your reviewer')} sent this back</b> ${esc(when(v.signoff.at))}: “${esc(v.signoff.note)}”. Fix it, then approve it again; it goes back to them.</div>` : ''}
    ${changedHTML(v)}${v.needsChanges ? `<div class="note small">You asked for changes${v.needsChanges.items?.length ? ` (${esc(v.needsChanges.items.map(x => x.label).join(', '))})` : ''}${v.needsChanges.note ? `: “${esc(v.needsChanges.note)}”` : ''}. It’s in Leads; the new version will replace this one.</div>` : ''}
    ${v.preflight?.length ? `<div class="box"><h3>Automatic checks</h3><ul class="list">${v.preflight.map(p => `<li class="${p.ok ? 'ok' : 'bad'}"><i>${p.ok ? '✓' : '!'}</i><span>${esc(p.label)}</span></li>`).join('')}</ul></div>` : '<div class="note">Made by an older version, so it has no automatic checks. Look it over closely.</div>'}
    <details><summary>Script</summary>${scriptList(v)}<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="prompter-video" data-id="${v.id}">Read it on camera</button></div></details>
    ${v.post ? `<details><summary>Post text</summary>${cutoffHTML(v.post)}<p class="post">${esc(v.post)}</p><div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy-post" data-id="${v.id}">Copy post text</button></div></details>` : ''}
    ${coverPickHTML(v)}
    ${fixing ? `<div class="note"><span class="spin"></span> ${(S.versioning || []).includes(v.id) ? 'A new version is being made from its Studio draft. It’ll show up here in a few minutes.' : 'Fixing… the new version will show up here in a minute or two.'}</div>` : !can('approve') ? `
    <div class="note small">Waiting for the agent to watch and approve it.</div>
    <div class="row">${can('make') ? `<button class="btn" data-act="fix-open" data-id="${v.id}">Fix a scene</button>` : ''}${can('coach') ? `<button class="btn ghost" data-act="ask-coach" data-id="${v.id}">Ask the coach</button>` : ''}</div>
    ${S.fix?.id === v.id ? fixForm(v) : ''}` : `
    <div class="box approve"><h3>Before you approve</h3>${S.me.checklist.map(([k, label]) => `<label class="check"><input type="checkbox" data-chk="${v.id}" value="${k}"> <span>${esc(label)}</span></label>`).join('')}
      <p class="small muted" style="margin:0">${esc(S.me.approvalNote || 'You stay responsible for final approval of this video and for any review your carriers or state require.')}</p>
      <div class="row"><button class="btn primary" data-act="approve" data-id="${v.id}" disabled>Approve</button><span class="status" data-st="${v.id}"></span></div></div>
    <div class="row"><button class="btn" data-act="fix-open" data-id="${v.id}">Fix a scene</button>${studioMade && v.abtest?.arm !== 'B' ? `<button class="btn" data-act="changes-open" data-id="${v.id}">Needs changes</button>` : ''}<button class="btn" data-act="reject-open" data-id="${v.id}">Reject</button><button class="btn ghost" data-act="ask-coach" data-id="${v.id}">Ask the coach</button><button class="btn ghost danger" data-act="delete" data-id="${v.id}">Delete</button></div>
    ${S.open.reject === v.id ? rejectForm(v) : ''}${S.open.changes === v.id ? changesForm(v) : ''}${S.fix?.id === v.id ? fixForm(v) : ''}`}
  </div></article>`;
}
// What changed since the last version (v15): each changed scene before and after, and the agent's
// checklist with what was done.
function changedHTML(v) {
  const last = (v.versions || []).at(-1);
  if (!v.updated || !last || last.v < 2) return '';
  const rows = (last.before || []).map(b => { const now = v.scenes?.[b.i] || {}; return `<li><b>Scene ${b.i + 1}</b>${b.text !== now.text ? `<br><span class="muted">Before:</span> ${esc(b.text)}<br><span class="muted">Now:</span> ${esc(now.text)}` : ''}${(b.say || '') !== (now.say || '') && now.say ? `<br><span class="muted">Spoken before:</span> ${esc(b.say)}<br><span class="muted">Spoken now:</span> ${esc(now.say)}` : ''}${(b.accent || '') !== (now.accent || '') ? `<br><span class="muted">Highlight:</span> ${esc(b.accent || '—')} → ${esc(now.accent || '—')}` : ''}${(b.keyword || '') !== (now.keyword || '') ? `<br><span class="muted">Footage:</span> ${esc(b.keyword || '—')} → ${esc(now.keyword || '—')}` : ''}</li>`; }).join('');
  const asked = last.asked?.items?.length ? `<p class="small" style="margin:6px 0 0"><b>Your checklist:</b> ${last.asked.items.map(x => `${x.done ? '✓' : '○'} ${esc(x.label)}`).join(' · ')}</p>` : '';
  return `<details class="box" open><summary><b>What changed in version ${last.v}</b>${last.byName ? ` <span class="muted">· by ${esc(last.byName)}</span>` : ''}</summary>${rows ? `<ul class="script small">${rows}</ul>` : '<p class="small muted" style="margin:0">The same scenes, rendered again.</p>'}${asked}</details>`;
}
// Needs changes (v15): tick what needs work in each scene, and the music; add a note. It goes to the Desk.
function changesForm(v) {
  const voice = v.mode === 'voiceover', what = [['caption', 'Caption'], ...(voice ? [['say', 'Spoken line']] : []), ['accent', 'Highlighted word'], ['footage', 'Footage']];
  return `<form class="box stack" data-form="changes" data-id="${v.id}"><h3>What needs changes?</h3><p class="small muted" style="margin:0">Tick what needs work. It goes to Leads with your note; the new version comes back here, showing what changed. Only you can approve it.</p>
    ${(v.scenes || []).map((s, i) => `<div class="stack" style="gap:4px"><span class="small"><b>Scene ${i + 1}</b> · ${esc(s.text)}</span><div class="chips">${what.map(([k, l]) => `<label class="toggle"><input type="checkbox" name="c-${i}-${k}" data-change-i="${i}" data-change-what="${k}"> ${esc(l)}</label>`).join('')}</div></div>`).join('')}
    ${v.meta?.music ? '<label class="check"><input type="checkbox" data-change-what="music"> <span>The music</span></label>' : ''}
    <label class="field"><span>Note</span><textarea class="ctl" name="note" rows="2" maxlength="600" placeholder="What would make it right?"></textarea></label>
    <div class="row"><button class="btn primary">Send for changes</button><button type="button" class="btn ghost" data-act="changes-cancel">Cancel</button></div><div class="status" data-st="changes"></div></form>`;
}
function rejectForm(v) {
  const r = S.open.reason || '';
  return `<div class="box"><h3>Why are you rejecting it?</h3><p class="small muted">Your reason is shown to the AI on the next scripts, so the same miss doesn’t repeat.</p>
    <div class="chips">${S.me.rejectReasons.filter(x => x !== 'Wrong music' || v.meta?.music).map(x => `<button class="toggle" data-act="reason" data-v="${esc(x)}" aria-pressed="${r === x}">${esc(x)}</button>`).join('')}</div>
    ${REJECT_TIPS[r] ? `<p class="small muted" style="margin:0">${esc(REJECT_TIPS[r])}</p>` : ''}
    <input class="ctl" data-reject-note maxlength="300" placeholder="Anything specific? (optional)">
    ${r === 'Not my voice' ? '<input class="ctl" data-reject-never maxlength="80" placeholder="A word or phrase you’d never say (optional)" aria-label="A word or phrase you’d never say">' : ''}
    <div class="row"><button class="btn danger" data-act="reject" data-id="${v.id}" ${r ? '' : 'disabled'}>Reject video</button><button class="btn ghost" data-act="reject-cancel">Cancel</button></div></div>`;
}
function fixForm(v) {
  const f = S.fix;
  return `<div class="box"><h3>Fix a scene</h3><p class="small muted">Change a caption, its highlighted word or its footage. The video re-renders in a minute or two and comes back here. Edits follow the same rules as new scripts.</p>
    ${v.scenes.map((s, i) => { const e = f.edits[i]; return `<div class="scene-edit"><div class="row between"><b>Scene ${i + 1}</b><label class="check small"><input type="checkbox" data-swap="${i}" ${f.swaps.has(i) ? 'checked' : ''}> <span>New clip${v.clips[i]?.score ? ` (now ${v.clips[i].score}/5)` : v.clips[i] && !v.clips[i].checked ? ' (wasn’t AI-checked)' : ''}</span></label></div>
      ${v.mode === 'voiceover' ? `<label class="field"><span class="small">Spoken line</span><textarea class="ctl sm" rows="2" data-fix="${i}" data-k="say">${esc(e.say)}</textarea></label>` : ''}
      <label class="field"><span class="small">Caption</span><input class="ctl sm" data-fix="${i}" data-k="text" value="${esc(e.text)}"></label>
      ${rewriteHTML(v, i)}
      <div class="fields"><label class="field"><span class="small">Highlighted word</span><input class="ctl sm" data-fix="${i}" data-k="accent" value="${esc(e.accent)}"></label>
      <label class="field"><span class="small">Footage search</span><input class="ctl sm" data-fix="${i}" data-k="keyword" value="${esc(e.keyword)}"></label></div>
      ${pickerHTML(v, i)}</div>`; }).join('')}
    ${(f.findings || []).length ? `<ul class="list">${f.findings.map((x, k) => `<li class="bad"><i>!</i><span>${Number.isInteger(x.scene) ? `Scene ${x.scene + 1}: ` : ''}${esc(String(x.text).replace(/^Scene \d+:? ?/, ''))}${x.fix ? ` <button class="btn sm primary" data-act="fix-fixit" data-k="${k}">${esc(x.fix.label)}</button>` : ''}</span></li>`).join('')}</ul>` : ''}
    <div class="row"><button class="btn primary" data-act="fix-send" data-id="${v.id}">Re-render</button><button class="btn ghost" data-act="fix-cancel">Cancel</button></div><div class="status" data-st="fix"></div></div>`;
}
// The clip picker (v15): about ten clips for the scene's footage search, scored by the clip check; tap one
// to preview it (muted) and pick it. The current clip stays marked, so keeping it is one tap. Picked clips
// are used exactly when it re-renders.
function pickerHTML(v, i) {
  const f = S.fix, p = f.picker?.[i], pick = f.picks?.[i], kw = f.edits[i].keyword || v.scenes[i].keyword || '';
  const keep = `<button class="toggle" data-act="fix-keep" data-i="${i}" aria-pressed="${!pick && !f.swaps.has(i)}">Keep the current clip${v.clips[i]?.score ? ` (${v.clips[i].score}/5)` : ''}</button>`;
  if (!p) return `<div class="row">${keep}<button class="btn sm ghost" data-act="fix-clips" data-i="${i}" ${kw ? '' : 'disabled'}>Show clips for “${esc(kw || '…')}”</button></div>`;
  if (p.busy) return `<div class="row">${keep}<span class="small muted"><span class="spin"></span> Finding and checking clips…</span></div>`;
  const changed = kw && p.keyword && kw !== p.keyword;
  return `<div class="stack" style="gap:6px"><div class="row">${keep}${p.error ? `<span class="small err-text">${esc(p.error)}</span>` : ''}</div>
    ${p.clips?.length ? `<div class="cards picker" style="grid-template-columns:repeat(auto-fill,minmax(92px,1fr))">${p.clips.map((c, k) => { const on = pick && String(pick.id) === String(c.id); return `<button class="box toggle pick" style="gap:4px;padding:4px" data-act="fix-pick" data-i="${i}" data-k="${k}" aria-pressed="${on}" aria-label="Clip ${k + 1}${c.score ? `, ${c.score} out of 5` : ''}">${on && c.preview ? `<video src="${esc(c.preview)}" poster="${esc(c.thumb || '')}" muted autoplay loop playsinline style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:6px"></video>` : c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:6px">` : ''}<span class="small">${c.score ? `${c.score}/5` : 'not scored'}</span></button>`; }).join('')}</div>` : '<p class="small muted" style="margin:0">No usable clips for these words. Try others in the footage search.</p>'}
    <div class="row"><button class="btn sm ghost" data-act="fix-clips" data-i="${i}" data-more="1" ${p.left > 0 && !changed ? '' : 'disabled'}>Refresh (${p.left} left)</button>${changed ? `<button class="btn sm" data-act="fix-clips" data-i="${i}">Show clips for “${esc(kw)}”</button>` : ''}${pick ? `<span class="small muted">Picked: it’ll be used as is.</span>` : ''}</div></div>`;
}
function rewriteHTML(v, i) {
  const r = S.rewrites[`${v.id}-${i}`];
  if (!r) return `<div class="row"><button class="btn sm ghost" data-act="rewrite" data-id="${v.id}" data-i="${i}">✦ Rewrite this caption</button></div>`;
  if (r.busy) return '<p class="small muted"><span class="spin"></span> Writing a few versions and checking each one…</p>';
  if (r.error) return `<p class="small err-text">${esc(r.error)} <button class="btn sm ghost" data-act="rewrite" data-id="${v.id}" data-i="${i}">Try again</button></p>`;
  if (!r.options.length) return `<p class="small muted">None of the rewrites passed the checks. <button class="btn sm ghost" data-act="rewrite" data-id="${v.id}" data-i="${i}">Try again</button></p>`;
  return `<div class="stack" style="gap:6px"><span class="small muted">Tap one to use it (nothing in them holds a render):</span>${r.options.map((o, k) => `<button class="toggle rewrite-opt" data-act="use-rewrite" data-i="${i}" data-k="${k}" aria-pressed="${S.fix?.edits[i]?.text === o.text}"><b>${esc(o.style)}</b> ${esc(o.text)}${(o.notes || []).length ? `<br><span class="small warn-text">Note: ${esc(String(o.notes[0]).replace(/^Scene \d+:? ?/, ''))}</span>` : ''}</button>`).join('')}</div>`;
}
// Waiting for the compliance reviewer (v15, lib/signoff.js): approved, and held until they sign it off.
const waitingSignoff = v => !!S.me?.workspace?.signoff?.required && v.status === 'approved' && !signedOff(v);
function signoffHTML(v) {
  if (waitingSignoff(v)) return `<div class="note small signoff-wait"><b>Waiting for ${esc(S.me.workspace.signoff.reviewer || 'your reviewer')} to sign off.</b> It can be posted once they have. Scheduling is fine: Instagram and Facebook hold it until then.</div>`;
  if (signedOff(v)) return `<p class="small muted" style="margin:0">✓ Signed off by ${esc(v.signoff.byName || 'your reviewer')} · ${esc(when(v.signoff.at))}</p>`;
  return '';
}
function cardApproved(v) {
  const file = S.shareFiles[v.id], held = waitingSignoff(v);
  return `<article class="vid" data-vid="${v.id}">${player(v)}<div class="info">
    <div class="row"><span class="pill ok">Approved</span>${abPill(v)}${held ? '<span class="pill warn">Waiting for sign-off</span>' : ''}<span class="small muted">${v.offlineQueued ? 'on this device · sent when you’re back online' : v.approval ? `by ${esc(v.approval.byName)} · ${esc(when(v.approval.at))}` : 'before approval records were kept'}</span></div>
    ${factLine(v)}${signoffHTML(v)}
    ${!can('post') ? '<div class="note small">Ready to post. The agent posts it.</div>' : held ? `${autopostHTML(v)}${fbpostHTML(v)}${trackHTML(v)}` : `<div class="box"><h3>Post it</h3><ol class="script small">${STEPS_POST(v.mode || v.meta?.mode).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${v.post ? `${cutoffHTML(v.post)}<p class="post">${esc(v.post)}</p>` : '<div class="note warn">No post text passed the checks. Write your own.</div>'}
      <div class="row">${v.post ? `<button class="btn" data-act="copy-post" data-id="${v.id}">Copy post text</button>` : ''}
        ${v.media ? `<button class="btn primary" data-act="save-video" data-id="${v.id}">${file ? 'Tap to save or share' : 'Save video to phone'}</button>
        <a class="btn ghost" href="/api/videos/${v.id}/download${wsParam()}" download>Download</a>${v.coverUrl ? `<a class="btn ghost" href="/api/videos/${v.id}/cover?download=1${pageWs ? `&ws=${encodeURIComponent(pageWs)}` : ''}" download>Cover image</a>` : ''}` : '<span class="small muted">The video file was removed. Its record is kept.</span>'}</div></div>
    ${autopostHTML(v)}${fbpostHTML(v)}${trackHTML(v)}
    <form class="row" data-form="posted" data-id="${v.id}"><input class="ctl sm" name="url" type="url" placeholder="Instagram link (optional)" style="flex:1 1 220px" aria-label="Instagram link"><button class="btn${v.autopost?.status === 'scheduled' ? '' : ' primary'}">Mark posted</button></form>`}
    ${can('make') ? coverPickHTML(v) : ''}
    <div class="row">${can('approve') ? `<button class="btn ghost sm" data-act="reopen" data-id="${v.id}">Back to review</button>` : ''}<a class="btn ghost sm" href="/api/videos/${v.id}/receipt.html${wsParam()}" target="_blank" rel="noopener">Compliance receipt</a></div>
  </div></article>`;
}
// What shows in the feed before "…more": the first line, cut near 125 characters.
function cutoffHTML(post) {
  const first = String(post).split('\n')[0], cut = first.length > 125 ? first.slice(0, 125).replace(/\s+\S*$/, '') : first, more = String(post).length > cut.length;
  return `<div class="cutoff small"><span class="muted">In the feed:</span> <b>${esc(S.cfg?.look?.handle?.replace(/^@?/, '') || 'you')}</b> ${esc(cut)}${more ? '<span class="muted">… more</span>' : ''}</div>`;
}
// Cover frame picker: six moments from the video; tap one to make it the cover.
function coverPickHTML(v) {
  if (!v.media || !['pending', 'approved'].includes(v.status)) return '';
  if (S.coverPick !== v.id) return `<div class="row"><button class="btn sm ghost" data-act="cover-pick" data-id="${v.id}">Choose the cover</button></div>`;
  const d = Math.max(1, v.duration || 10), ts = Array.from({ length: 6 }, (_, k) => Math.round(d * (k + 0.5) / 6 * 10) / 10);
  return `<div class="box"><h3>Choose the cover</h3><p class="small muted" style="margin:0">The still people see on your grid and before it plays.</p>
    <div class="frames">${ts.map(t => `<button class="frame${Math.abs((v.coverAt ?? 0.5) - t) < 0.05 ? ' on' : ''}" data-act="cover-set" data-id="${v.id}" data-t="${t}" aria-label="Use the frame at ${t} seconds"><img src="/api/videos/${v.id}/frame?t=${t}" alt="" loading="lazy"><span>${t}s</span></button>`).join('')}</div>
    <div class="row"><button class="btn sm ghost" data-act="cover-pick" data-id="">Done</button><span class="status" data-st="cover-${v.id}"></span></div></div>`;
}
// Automatic posting to Instagram, for approved videos (only when the server has it set up).
const localInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function autopostHTML(v) {
  if (!S.me.instagram || !v.media) return '';
  const acc = S.ig?.account, ap = v.autopost;
  if (!acc?.connected) return S.ig?.ready ? '<p class="small muted" style="margin:0">Want it posted for you? <a href="#/autopilot">Connect Instagram in Setup → Autopilot</a>.</p>' : '';
  if (ap?.status === 'scheduled') return `<div class="box ig"><h3>Instagram</h3><p class="small" style="margin:0">Posting to @${esc(acc.username || 'your account')} on <b>${esc(when(ap.at))}</b>${ap.by === 'plan' ? ' (posting plan)' : ''}.</p><div class="row"><button class="btn sm ghost" data-act="ap-cancel" data-id="${v.id}">Cancel</button></div></div>`;
  if (ap?.status === 'processing') return '<div class="box ig"><h3>Instagram</h3><p class="small" style="margin:0"><span class="spin"></span> Posting… Instagram is processing the video. It usually takes a minute or two.</p></div>';
  if (acc.problem) return '<div class="note warn small">Instagram needs to be connected again before this can post. <a href="#/autopilot">Reconnect in Setup → Autopilot</a>.</div>';
  const captions = (v.mode || v.meta?.mode) === 'captions';
  return `<div class="box ig"><h3>Post to Instagram for me</h3>
    ${ap?.status === 'failed' ? `<div class="note warn small">The last try didn’t go out: ${esc(ap.error)}</div>` : ''}
    ${ap?.status === 'unsure' ? `<div class="note warn small">We couldn’t confirm whether this went out. ${esc(ap.error || '')} Check @${esc(acc.username || 'your account')} on Instagram. If it’s there, tap <b>Mark posted</b>. If it isn’t, post it again: the app checks Instagram first, so it can’t go out twice.</div>` : ''}
    <div class="row"><button class="btn sm primary" data-act="ap-now" data-id="${v.id}">Post now</button><span class="small muted">or</span>
      <input class="ctl sm" type="datetime-local" data-ap-at="${v.id}" min="${localInput(Date.now())}" style="flex:1 1 190px;width:auto" aria-label="When to post"><button class="btn sm" data-act="ap-at" data-id="${v.id}">Schedule</button></div>
    <small class="muted">Posts to @${esc(acc.username || 'your account')} as a Reel with the post text and cover.${captions ? ' Automatic posts can’t include an Instagram sound, so this one goes out quiet. To add a trending sound, post it by hand instead.' : ''}</small></div>`;
}
// The video's own tracking link: tapping it opens the agent's booking page and counts toward this video.
function trackHTML(v) {
  if (!v.trackUrl) return '';
  if (!S.cfg?.look?.bookingUrl) return v.clicks?.total ? `<p class="small muted" style="margin:0">${plural(v.clicks.total, 'click')} on this video’s booking link. Add your booking link in Setup → Profile to keep it working.</p>` : '';
  return `<div class="row small"><span class="muted">Booking link for this video:</span><code class="mono" style="overflow-wrap:anywhere">${esc(v.trackUrl)}</code><button class="btn sm ghost" data-act="copy-track" data-id="${v.id}">Copy</button>${v.clicks?.total ? `<span><b>${v.clicks.total}</b> click${v.clicks.total === 1 ? '' : 's'}</span>` : ''}</div>
    <small class="muted">Use it in your Facebook post, Stories or replies to messages: clicks are counted for this video. ${S.fb?.account?.connected ? 'Facebook posts made from here include it.' : ''}</small>`;
}
// Cross-posting to the agent's Facebook Page (only when the server has it set up).
function fbpostHTML(v, quiet = false) {
  if (!S.me.facebook || !v.media) return '';
  const acc = S.fb?.account, fp = v.fbpost;
  if (!acc?.connected) return quiet ? '' : S.fb?.ready && S.me.instagram ? '' : S.fb?.ready ? '<p class="small muted" style="margin:0">Want it on your Facebook Page too? <a href="#/autopilot">Connect Facebook in Setup → Autopilot</a>.</p>' : '';
  if (fp?.status === 'posted') return `<p class="small" style="margin:0"><span class="pill ok">On Facebook</span> ${esc(acc.pageName || '')}${fp.url ? ` · <a href="${esc(fp.url)}" target="_blank" rel="noopener">View</a>` : ''}</p>`;
  if (fp?.status === 'scheduled') return `<div class="box ig"><h3>Facebook</h3><p class="small" style="margin:0">Posting to ${esc(acc.pageName || 'your Page')} on <b>${esc(when(fp.at))}</b>${fp.by === 'plan' ? ' (posting plan)' : ''}.</p><div class="row"><button class="btn sm ghost" data-act="fb-cancel" data-id="${v.id}">Cancel</button></div></div>`;
  if (fp?.status === 'processing') return '<div class="box ig"><h3>Facebook</h3><p class="small" style="margin:0"><span class="spin"></span> Posting… Facebook is processing the video.</p></div>';
  if (acc.problem) return '<div class="note warn small">Facebook needs to be connected again before this can post. <a href="#/autopilot">Reconnect in Setup → Autopilot</a>.</div>';
  return `<div class="box ig"><h3>Post to my Facebook Page</h3>
    ${fp?.status === 'failed' ? `<div class="note warn small">The last try didn’t go out: ${esc(fp.error)}</div>` : ''}
    <div class="row"><button class="btn sm primary" data-act="fb-now" data-id="${v.id}">Post now</button><span class="small muted">or</span>
      <input class="ctl sm" type="datetime-local" data-fb-at="${v.id}" min="${localInput(Date.now())}" style="flex:1 1 190px;width:auto" aria-label="When to post to Facebook"><button class="btn sm" data-act="fb-at" data-id="${v.id}">Schedule</button></div>
    <small class="muted">Posts to ${esc(acc.pageName || 'your Page')} as a Reel with the post text${S.cfg?.look?.bookingUrl ? ' and this video’s booking link (links can be tapped on Facebook)' : ''}. <button class="btn sm ghost" data-act="fb-text" data-id="${v.id}">See the Facebook text</button></small>
    ${S.fbText?.[v.id] ? `<p class="post">${esc(S.fbText[v.id])}</p>` : ''}</div>`;
}
// What the video's link brought (v15): visits to its page, leads from its form, bookings traced to it
// (lib/bookings.js), and Facebook.
function linkResults(v) {
  const parts = [v.clicks?.total ? `<b>${v.clicks.total}</b> link visit${v.clicks.total === 1 ? '' : 's'}` : '', v.leads?.total ? `<b>${v.leads.total}</b> lead${v.leads.total === 1 ? '' : 's'}` : '',
    v.bookings?.total ? `<b>${v.bookings.total}</b> booking${v.bookings.total === 1 ? '' : 's'}${v.bookings.canceled ? ` <span class="muted">(${v.bookings.canceled} canceled)</span>` : ''}` : '',
    v.fbpost?.status === 'posted' ? `On Facebook${v.fbpost.url ? ` · <a href="${esc(v.fbpost.url)}" target="_blank" rel="noopener">View</a>` : ''}` : ''].filter(Boolean);
  return parts.length ? `<span class="small">${parts.join(' · ')}</span>` : '';
}
function cardPosted(v) {
  const r = v.results || {}, due = (S.stats?.needResults || []).includes(v.id);
  return `<div class="compact${v.coverUrl ? '' : ' nocover'}${due ? ' due' : ''}">${v.coverUrl ? `<img src="${esc(v.coverUrl)}" alt="" loading="lazy">` : ''}<div class="stack" style="gap:6px">
    <div class="row between"><b class="small">${due ? '<span class="pill warn">Add results</span> ' : ''}${v.posted?.auto ? '<span class="pill ok">Auto-posted</span> ' : ''}${v.abtest ? `${abPill(v)} ` : ''}${esc(v.meta?.painPoint)}</b><span class="small muted">Posted ${esc(day(v.posted?.at))}${v.posted?.url ? ` · <a href="${esc(v.posted.url)}" target="_blank" rel="noopener">View</a>` : ''}</span></div>
    ${r.auto ? `<span class="small">${[['views', 'views'], ['reach', 'reached'], ['likes', 'likes'], ['comments', 'comments'], ['shares', 'shares'], ['saved', 'saves']].filter(([k]) => r[k] != null).map(([k, l]) => `<b>${Number(r[k]).toLocaleString()}</b> ${l}`).join(' · ')} <span class="muted">· from Instagram, ${esc(when(r.auto.at))}</span></span>` : ''}
    ${linkResults(v)}
    ${v.fbpost?.status !== 'posted' ? fbpostHTML(v, true) : ''}
    ${resultsLine(v)}
    <div class="row"><span class="small"><b>${r.messages || 0}</b> message${r.messages === 1 ? '' : 's'}</span>${can('results') ? `<button class="btn sm" data-act="msg-plus" data-id="${v.id}">It brought a message</button>` : ''}${r.messages && can('results') ? `<button class="x" data-act="msg-minus" data-id="${v.id}" aria-label="Undo one message">−</button>` : ''}${r.messages && can('replies') ? `<button class="btn sm ghost" data-act="reply-from" data-id="${v.id}">Draft a reply</button>` : ''}</div>
    ${r.auto || !can('results') ? '' : `<form class="row" data-form="results" data-id="${v.id}"><label class="field" style="flex:1 1 100px"><span class="small">Views</span><input class="ctl sm" name="views" type="number" min="0" inputmode="numeric" value="${r.views ?? ''}"></label>
      <label class="field" style="flex:1 1 100px"><span class="small">Messages</span><input class="ctl sm" name="messages" type="number" min="0" inputmode="numeric" value="${r.messages ?? ''}"></label>
      <button class="btn sm" style="align-self:end">Save</button></form>`}</div></div>`;
}
// How a posted video did next to the agent's own average (their posts with views), in one line.
function resultsLine(v) {
  const r = v.results || {}, withViews = S.videos.filter(x => x.status === 'posted' && Number.isFinite(Number(x.results?.views)) && x.results?.views !== '' && x.results?.views != null);
  if (r.views == null || r.views === '' || withViews.length < 3) return '';
  const avg = withViews.reduce((a, x) => a + Number(x.results.views), 0) / withViews.length, k = avg ? Number(r.views) / avg : 0;
  const rank = [...withViews].sort((a, b) => Number(b.results.views) - Number(a.results.views)).findIndex(x => x.id === v.id) + 1;
  const tag = k >= 1.25 ? `<span class="pill ok">${k.toFixed(1)}× your average views</span>` : k <= 0.75 ? `<span class="pill">${Math.round(k * 100)}% of your average views</span>` : '<span class="pill">About your average</span>';
  return `<div class="row small">${tag}<span class="muted">#${rank} of ${withViews.length} by views</span>${k >= 1.25 && v.meta?.painId ? `<button class="btn sm ghost" data-act="make-topic" data-id="${esc(v.meta.painId)}">Make another on this</button>` : ''}</div>`;
}
function cardRejected(v) {
  return `<article class="vid" data-vid="${v.id}">${player(v)}<div class="info">
    <div class="row"><span class="pill err">Rejected</span><span class="small muted">${v.offlineQueued ? 'on this device, sent when you’re back online · ' : ''}${esc(v.rejection?.reason)}${v.rejection?.note ? ': ' + esc(v.rejection.note) : ''}</span></div>
    ${factLine(v)}
    <div class="row">${can('approve') ? `<button class="btn sm" data-act="reopen" data-id="${v.id}">Back to review</button>` : ''}${can('make') ? `<button class="btn sm" data-act="fix-open" data-id="${v.id}">Fix a scene</button>` : ''}${can('approve') ? `<button class="btn sm ghost danger" data-act="delete" data-id="${v.id}">Delete</button>` : ''}</div>
    ${S.fix?.id === v.id ? fixForm(v) : ''}</div></article>`;
}
function resultsPanel(st) {
  const can = g => g.key && S.cfg?.story.painPoints.some(p => p.id === g.key);
  return `<section class="panel"><div class="head"><h2>What’s working</h2><p>Posted videos by topic, most messages first. Make more of what brings people to you.</p></div>
    <div class="stack">${st.topics.map(g => `<div class="row between box" style="gap:10px"><div class="stack" style="gap:2px;flex:1 1 220px"><b class="small">${esc(g.label)}</b>
      <span class="small muted">${plural(g.posted, 'video')} posted${g.reported ? ` · ${Math.round(g.views / g.reported).toLocaleString()} avg views` : ''} · ${plural(g.messages, 'message')}</span></div>
      ${can(g) ? `<button class="btn sm" data-act="make-topic" data-id="${esc(g.key)}">Make another</button>` : ''}</div>`).join('')}</div></section>`;
}

export { abtestsPanel, drawReview, focusKey, haptic2, loadAbtests, loadIg, loadVideos, loadWeekly, player, rejectionsPanel, resultsPanel, sub, viewReview, weeklyPanel };

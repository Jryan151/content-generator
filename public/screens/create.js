// public/screens/create.js — Create.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { FORMATS, S, STRUCTURES, api, app, badgeFromMe, can, day, esc, later, loadCfg, local, main, page, plural, refreshMe, short, status, stopTimers, usableRoutes, watchJobs, when, whyNoVideos, wsKey } from '../app.js';
import { loadWeekly, weeklyPanel } from './review.js';
import { loadStudioList, studioListPanel } from './studio.js';
import { seg } from './brand.js';
import { secs } from './admin.js';

/* ================= Create ================= */
async function loadOverview() {
  S.overview = await api('/api/overview');
  S.me.workspace = { ...S.me.workspace, ...S.overview.workspace };
}
async function viewCreate() {
  await Promise.all([loadOverview(), loadCfg(), loadStudioList(), can('coach') ? loadWeekly() : null]);
  drawCreate();
}
function pollCreate() {
  stopTimers();
  const active = S.overview.jobs.some(j => j.status === 'queued' || j.status === 'running');
  later(async () => {
    if (S.view !== 'create') return;
    const before = JSON.stringify(S.overview.jobs.map(j => [j.id, j.status]));
    await loadOverview().catch(() => {});
    const after = JSON.stringify(S.overview.jobs.map(j => [j.id, j.status]));
    if (before !== after) { drawCreate(); refreshMe().then(badgeFromMe); }
    else { drawJobs(); pollCreate(); }
  }, active ? 3000 : 30000);
}
// Spend guard: a note when the workspace is near or over its monthly AI budget (percent only).
const spendNote = sp => (sp?.over ? '<div class="note err">This month’s AI budget for your workspace is used up, so new videos, test scripts and the coach are paused until next month. Your admin can raise it.</div>'
  : sp?.warn ? `<div class="note warn">You’ve used ${esc(sp.pct)}% of this month’s AI budget. At 100%, new videos, test scripts and the coach pause until next month.</div>` : '');
// The keys (v15): right after setup, the first video handed over with a short personal note, built from
// what the agent just told it. It stays until the first video is in Review (or it's closed).
function keysPanel(o, cfg, canMake) {
  if (local.get(wsKey('keys')) !== 'open') return '';
  const first = String(cfg.look?.name || S.me.account.name || '').trim().split(/\s+/)[0];
  const U = usableRoutes(cfg), worries = U.pains.length, facts = cfg.story.insights.filter(i => i.confirmed).length, city = String(cfg.look?.location || '').split(',')[0].trim();
  const making = o.jobs.some(j => ['queued', 'running'].includes(j.status)), ready = o.workspace.pending > 0;
  const note = `Every video starts from what you told it: ${plural(worries, 'topic')} your clients${city ? ` in ${esc(city)}` : ''} bring you, each with a fact you checked, and the way you like to say things. Nothing goes out until you’ve watched it and said yes.`;
  return `<section class="panel keys-panel"><div class="row between"><h2>It’s yours${first ? `, ${esc(first)}` : ''}.</h2><button class="x" data-act="keys-close" aria-label="Close">×</button></div>
    <p style="margin:0">${note}</p>
    ${ready ? '<div class="row"><a class="btn primary" href="#/review" data-act="keys-close">Watch your first video</a></div>'
      : making ? '<p class="small" style="margin:0"><span class="spin"></span> Your first video is being made. It takes a few minutes; you can close this page.</p>'
      : `<div class="row"><button class="btn primary big" data-act="keys-make" ${canMake ? '' : 'disabled'}>Make my first video</button></div>`}</section>`;
}
function drawCreate() {
  const o = S.overview, ws = o.workspace, a = ws.access, cfg = S.cfg;
  const pct = ws.limit ? Math.min(100, Math.round((ws.used / ws.limit) * 100)) : 0;
  const U = usableRoutes(cfg);
  const left = Math.max(0, ws.limit - ws.used);
  const why = whyNoVideos(cfg);
  const sp = ws.spend || {};
  const can = a.allowed && left > 0 && !why && !sp.over;
  main.innerHTML = `<div class="head"><h1>Create</h1><p class="lede">Videos are made one at a time in the background, about two minutes each. You can close this page.</p></div>
    ${keysPanel(o, cfg, can)}
    ${!a.allowed ? `<div class="note err">${esc(a.reason)}</div>` : ''}
    ${why ? `<div class="note warn">${esc(why.msg)} <a href="#/content" data-act="goto-tab" data-v="${why.tab}">Fix it in Setup → Topics</a></div>` : ''}
    ${spendNote(sp)}
    <section class="panel"><div class="row between"><h2>This month</h2><span class="mono small">${a.allowed ? `${ws.used} of ${ws.limit} videos` : 'No plan yet'}</span></div>
      <div class="meter" role="img" aria-label="${ws.used} of ${ws.limit} videos used"><i style="width:${pct}%"></i></div>
      <div class="row"><button class="btn primary big" data-act="make" data-n="1" ${can ? '' : 'disabled'}>Make a video</button><button class="btn big" data-act="make" data-n="3" ${can && left >= 2 ? '' : 'disabled'}>Make ${Math.min(3, left) || 3}</button></div>
      ${U.pains.length ? `<div class="field"><span>Or choose the topic and format</span><div class="fields">
        <select class="ctl" id="topicSel" aria-label="Topic"><option value="">Any topic</option>${U.pains.map(p => `<option value="${p.id}"${S.pick?.painId === p.id ? ' selected' : ''}>${esc(p.text)}</option>`).join('')}</select>
        <select class="ctl" id="formatSel" aria-label="Format"><option value="">Any format</option>${cfg.output.formats.map(k => `<option value="${k}"${S.pick?.format === k ? ' selected' : ''}>${esc(FORMATS[k].label)}</option>`).join('')}</select></div>
        <div class="row"><button class="btn" data-act="make-topic" ${can ? '' : 'disabled'}>Make one</button><span class="small muted">Test a script below uses these choices too.</span></div></div>` : ''}
      <div class="status" data-st="make"></div></section>
    ${lowNote(o.low)}
    ${nextPanel(o.next, can)}
    ${studioListPanel(can)}
    <section class="panel"><h2>Videos in progress</h2><div id="jobs"></div></section>
    ${(S.me.caps || []).includes('coach') ? weeklyPanel() : ''}
    <section class="panel"><div class="head"><h2>Overnight</h2><p>Wake up to videos waiting for review. They’re made between 1 and 6am your time and count toward your monthly videos.</p></div>
      <div class="field"><span>Keep this many ready each morning</span><div class="seg">${[0, 1, 2, 3, 5].map(n => `<button data-act="keep-ready" data-v="${n}" aria-pressed="${(cfg.schedule?.keepReady || 0) === n}">${n === 0 ? 'Off' : n}</button>`).join('')}</div>${cfg.schedule?.keepReady ? '<small>Made between 1 and 6am your time.</small>' : ''}</div>
      <div class="field"><span>Every Monday morning</span><div class="seg"><button data-act="auto-plan" data-v="1" aria-pressed="${!!cfg.schedule?.autoPlan}">Make the coach’s plan for me</button><button data-act="auto-plan" data-v="0" aria-pressed="${!cfg.schedule?.autoPlan}">I’ll choose</button></div>
        <small>${cfg.schedule?.autoPlan ? `The coach writes the week’s check-in and makes its 3–5 suggested videos, ready for your review. ${planSkipHTML(o.plan)}` : 'The coach’s weekly check-in above suggests videos; you tap Make these videos.'}</small></div></section>
    <section class="panel"><div class="head"><h2>Test a script</h2><p>Writes and checks a script without making a video. Good after changing your content or voice. <span data-tests-left>${o.testsLeft}</span> left today.</p></div>
      <div class="row"><button class="btn" data-act="test" ${a.allowed && o.testsLeft && !why ? '' : 'disabled'}>Write a test script</button></div><div class="status" data-st="test"></div><div id="testOut">${S.test ? testHTML(S.test) : ''}</div></section>
    <section class="panel"><div class="head"><h2>Test footage</h2><p>See the clips a search finds and how the AI clip check scores them (5 = great fit, 3 = fine, 1 = never use). Use it to find searches that work, then put them in Fix a scene.</p></div>
      <form class="stack" data-form="footage"><div class="fields">
        <label class="field"><span>Footage search</span><input class="ctl" name="keyword" placeholder="e.g. older woman kitchen table" required></label>
        <label class="field"><span>Audience</span><select class="ctl" name="audienceId">${cfg.story.audiences.filter((a, i, all) => all.findIndex(b => b.visual === a.visual) === i).map(a => `<option value="${a.id}">${esc(a.visual || a.text)}</option>`).join('')}</select></label>
        <label class="field"><span>Caption (optional)</span><input class="ctl" name="caption" placeholder="the line shown over the clip"></label></div>
        <div class="row"><button class="btn">Test this search</button><span class="status" data-st></span></div></form>
      <div id="footageOut">${S.footage ? footageHTML(S.footage) : ''}</div></section>
`;
  drawJobs();
  pollCreate();
}
// The posting plan is about to run dry.
const lowNote = low => (low ? `<div class="note warn">Your posting plan has ${plural(low.approved, 'approved video')} for ${plural(low.needed, 'posting day')} coming up. Review and approve a few${S.view === 'create' ? '' : ', or make more in <a href="#/create">Create</a>'}.</div>` : '');
const planSkipHTML = p => (p?.on ? (p.skipped ? `Next Monday is skipped. <button class="btn sm ghost" data-act="plan-skip" data-v="0">Undo</button>` : `<button class="btn sm ghost" data-act="plan-skip" data-v="1">Skip next Monday</button>`) : '');
// What to make next: gaps the app noticed, each with the one tap that fills it.
function nextPanel(list, can) {
  if (!list?.length) return '';
  return `<section class="panel"><div class="head"><h2>Ideas for what’s next</h2><p>Things worth doing soon, spotted from your content and recent videos.</p></div>
    <div class="stack" style="gap:8px">${list.map((g, k) => `<div class="row between box" style="gap:10px"><span class="small" style="flex:1 1 220px">${esc(g.text)}</span>${g.act.make ? `<button class="btn sm" data-act="next-make" data-k="${k}" ${can ? '' : 'disabled'}>${g.act.make.count > 1 ? `Make ${g.act.make.count}` : 'Make one'}</button>` : `<a class="btn sm" href="#/content" data-act="goto-tab" data-v="${esc(g.act.tab)}">Fix it</a>`}</div>`).join('')}</div></section>`;
}
function drawJobs() {
  const el = document.getElementById('jobs');
  if (!el) return;
  const jobs = S.overview.jobs.filter(j => j.status !== 'canceled' && (j.status !== 'done' || Date.now() - Date.parse(j.endedAt) < 86400000));
  const topic = j => S.cfg?.story.painPoints.find(p => p.id === j.topic)?.text;
  el.innerHTML = jobs.length ? `<div class="stack">${jobs.map(j => {
    const what = j.kind === 'fix' ? 'Fixing a video' : j.source === 'overnight' ? 'Overnight video' : 'New video';
    if (j.status === 'running') {
      // Where it really is (the step it logged), how long it's been, and what's usual here.
      const p = j.phase || { step: 0, of: 0, label: 'Working…' }, secs = Math.max(0, Math.round((Date.now() - Date.parse(j.startedAt)) / 1000)), typ = S.overview.typical;
      const slow = typ && secs > typ * 1.6;
      return `<div class="box"><div class="row between"><b>${what}${topic(j) ? ': ' + esc(topic(j)) : ''}</b><span class="small muted">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${typ ? ` · usually about ${Math.max(1, Math.round(typ / 60))} min` : ''}</span></div>
        <span class="small"><span class="spin"></span> ${p.of ? `Step ${p.step} of ${p.of}: ` : ''}${esc(p.label)}</span>
        ${p.of ? `<div class="meter" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${p.of}" aria-valuenow="${p.step}"><i style="width:${Math.round(((p.step - 0.5) / p.of) * 100)}%"></i></div>` : ''}
        ${p.retry ? '<span class="small muted">The first try hit a problem, so it’s going again from the start.</span>' : slow ? `<span class="small muted">${p.note ? esc(p.note) + ' ' : ''}Taking longer than usual. It keeps going, and you can leave this page.</span>` : ''}
        <details><summary class="small">Details</summary><pre class="log">${esc(j.log.slice(-6).join('\n'))}</pre></details></div>`;
    }
    if (j.status === 'queued') return `<div class="row between box"><span>${what}${topic(j) ? ': ' + esc(topic(j)) : ''} · <span class="muted">${j.waitUntil ? `${esc(j.waitReason || 'Waiting.')} Going again at ${esc(new Date(j.waitUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}; nothing to do.` : `waiting${j.position ? `, ${j.position} ahead` : ''}`}</span></span><button class="btn sm ghost" data-act="cancel-job" data-id="${j.id}">Cancel</button></div>`;
    if (j.status === 'done') return `<div class="row between box"><span><span class="pill ok">Ready</span> ${what} · <span class="muted">${esc(when(j.endedAt))}</span></span><a class="btn sm" href="#/review">Review</a></div>`;
    return `<div class="box"><div class="row between"><span><span class="pill err">Didn’t finish</span> ${what} · <span class="muted">${esc(when(j.endedAt))}</span></span></div><p class="small" style="margin:0">${esc(j.error)}</p>
      <div class="row"><button class="btn sm" data-act="job-again" data-id="${esc(j.id)}" data-kind="${esc(j.kind)}" data-topic="${esc(j.topic || '')}" data-draft="${esc(j.draftId || '')}">${j.kind === 'fix' ? 'Open Review' : j.kind === 'studio' ? 'Open the draft' : 'Make it again'}</button>${j.kind === 'fix' ? '' : '<span class="small muted">It didn’t count toward this month’s videos.</span>'}</div></div>`;
  }).join('')}</div>` : '<p class="empty">Nothing in progress.</p>';
  if (jobs.some(j => ['queued', 'running'].includes(j.status))) watchJobs();
}
function footageHTML(r) {
  if (!r.results.length) return '<p class="empty">No clips found for that search. Try simpler words.</p>';
  return `<p class="small muted" style="margin:0">Looking for: ${esc(r.visual || 'adults')}</p><div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${r.results.map(x => `<div class="box" style="gap:6px;padding:8px">
    ${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px">` : ''}
    <b class="${x.score >= 3 ? '' : 'muted'}">${x.score ?? '?'}/5</b><span class="small muted">${esc(x.reason)}</span></div>`).join('')}</div>
    ${goodSearch(r)}`;
}
function goodSearch(r) {
  const a = S.cfg?.story.audiences.find(x => x.id === r.audienceId), top = r.results[0]?.score || 0;
  if (!a || !r.keyword) return '';
  if ((a.searches || []).includes(r.keyword.toLowerCase())) return `<p class="small muted">This search is saved for ${esc(a.text)}.</p>`;
  return top >= 4 ? `<div class="row"><button class="btn sm primary" data-act="save-search" data-a="${esc(a.id)}" data-q="${esc(r.keyword)}">Save this search for ${esc(short(a.text))}</button><span class="small muted">New videos for this audience will try it when a scene’s own search finds weak footage.</span></div>`
    : '<p class="small muted">Save searches that score 4 or 5. Try simpler words that name who is in the shot.</p>';
}
function testHTML(r) {
  const extra = r.scores?.some(s => s.styleFit != null);
  const scores = r.scores ? `<div class="table-wrap"><table class="t"><thead><tr><th>Draft</th><th>Hook</th><th>Insight</th><th>Bridge</th><th>CTA</th><th>Flow</th><th>Fresh</th>${extra ? '<th>Style fit</th>' : ''}</tr></thead><tbody>${r.scores.map(s => `<tr${s.draft === r.chosen ? ' style="color:var(--master);font-weight:600"' : ''}>${['draft', 'hook', 'insight', 'bridge', 'cta', 'flow', 'fresh', ...(extra ? ['styleFit'] : [])].map(k => `<td>${esc(s[k] ?? '–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="box"><b>${esc(FORMATS[r.meta.format]?.label || '')}${r.meta.structure && r.meta.structure !== 'classic' ? ` · ${esc(STRUCTURES[r.meta.structure]?.label || '')}` : ''} · ${esc(r.meta.painPoint)}</b><small class="muted">Fact: ${esc(r.meta.insight)}</small>
    <ol class="script">${r.scenes.map(s => `<li>${s.say ? esc(s.say) + '<br><small>on screen: ' + esc(s.text) + '</small>' : esc(s.text)}${s.accent ? ` <small>· highlight “${esc(s.accent)}”</small>` : ''}</li>`).join('')}</ol>
    ${r.hooks?.length ? `<details><summary>Openings the AI chose between</summary><ol class="script small">${r.hooks.map(h => `<li>${esc(h.text)}${h.score ? ` <small>· ${h.score}/10${h.why ? ', ' + esc(h.why) : ''}</small>` : ''}</li>`).join('')}</ol></details>` : ''}
    ${scores}${r.post ? `<details><summary>Post text</summary><p class="post">${esc(r.post)}</p></details>` : ''}
    <details><summary>Log</summary><pre class="log">${esc((r.log || []).join('\n'))}</pre></details>
    <div class="row"><button class="btn sm" data-act="ask-coach-test">Ask the coach about this script</button></div></div>`;
}

export { drawCreate, footageHTML, loadOverview, lowNote, planSkipHTML, spendNote, testHTML, viewCreate };

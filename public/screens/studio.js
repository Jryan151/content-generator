// public/screens/studio.js — Studio: build a video by hand.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { FORMATS, LIMITS, S, STRUCTURES, api, app, beatPlan, can, esc, go, later, loadCfg, main, page, plural, render, short, softGone, stopTimers, structureFits, studioChecks, studioPicks, toast, usableRoutes, watching, when } from '../app.js';
import { spellFixed } from '../mixer-core.js';
import { sub } from './review.js';
import { loadLibrary } from './brand.js';
import { lines } from './coach.js';

/* ================= Studio: build a video by hand ================= */
// A step-by-step builder in Create: the brief (audience, worry, confirmed facts, format, structure,
// series), the opening (eight written and scored, or your own), one card per scene with live checks
// (the same ones every video must pass, from mixer-core.js), footage chosen per scene, then render.
// Drafts save on the server as you go, so you can leave and come back.
async function loadStudioList() { try { const l = await api('/api/studio'); S.studioList = { ...l, drafts: (l.drafts || []).filter(d => !softGone(`draft:${d.id}`)) }; } catch { S.studioList = { drafts: [], series: [], max: 20, failed: true }; } }
function studioListPanel(can) {
  const L0 = S.studioList || { drafts: [] }, L = { ...L0, drafts: (L0.drafts || []).filter(d => !softGone(`draft:${d.id}`)) };
  const pill = d => (d.status === 'rendering' ? '<span class="pill warn">Rendering</span>' : d.status === 'done' ? '<span class="pill ok">Made</span>' : '<span class="pill">Draft</span>');
  return `<section class="panel"><div class="row between"><div class="head"><h2>Studio</h2><p>Build a video yourself: pick the topic and facts, choose the opening, write or edit each scene and pick the footage. It goes through the same checks as every video.</p></div>
      <button class="btn primary" data-act="studio-new" ${can ? '' : 'disabled'}>New video</button></div>
    ${seriesCards(L, can)}
    ${L.drafts.length ? `<div class="stack" style="gap:8px">${L.drafts.map(d => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px">${pill(d)} <b>${esc(d.title)}</b><br><span class="muted">${esc(when(d.updatedAt))}${d.error ? ` · ${esc(d.error).slice(0, 140)}` : ''}</span></span>
      <span class="row"><a class="btn sm" href="#/studio/${esc(d.id)}">${d.status === 'done' ? 'Open' : 'Continue'}</a><button class="btn sm ghost danger" data-act="studio-del" data-id="${esc(d.id)}">Delete</button></span></div>`).join('')}</div>` : L.failed ? '<p class="small muted">Couldn’t load your drafts. <button class="btn sm ghost" data-act="page-retry">Try again</button></p>' : '<p class="empty">No drafts yet. Tap New video to build one yourself.</p>'}</section>`;
}

// Continue a series (v15): each series already started, with its next part one tap away; the others
// can be started from the same place.
function seriesCards(L, can) {
  const series = (L.series || []).filter(x => Number.isInteger(x.next)), going = series.filter(x => x.started), fresh = series.filter(x => !x.started);
  if (!can || !series.length) return '';
  const card = x => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 200px"><b>${x.started ? 'Continue' : 'Start'} “${esc(x.label)}”</b><br><span class="muted">Part ${x.next + 1} of ${x.parts.length}: ${esc(x.parts[x.next].title)}</span></span><button class="btn sm${x.started ? ' primary' : ''}" data-act="studio-new" data-series="${esc(x.id)}" data-part="${x.next}">${x.started ? `Make part ${x.next + 1}` : 'Start it'}</button></div>`;
  return `<div class="stack" style="gap:6px">${going.map(card).join('')}${fresh.length ? `<details class="small"><summary>Start a series (${fresh.length})</summary><div class="stack" style="gap:6px;margin-top:6px">${fresh.map(card).join('')}</div></details>` : ''}</div>`;
}
async function viewStudio(ctx) {
  await Promise.all([loadCfg(), loadStudioList(), S.lib ? null : loadLibrary()]);
  let r;
  try { r = await api('/api/studio/' + encodeURIComponent(ctx.arg || '')); }
  catch (e) { if (e.status === 404 || !ctx.arg) { toast('That draft isn’t there anymore. Here are your drafts.'); return go('create'); } throw e; }
  S.st = { d: r.draft, foot: {}, rw: {}, busy: '' };
  drawStudio();
  pollStudio();
}
function pollStudio() {
  stopTimers();
  if (S.st?.d.status !== 'rendering') return;
  later(async () => { if (S.view !== 'studio' || !S.st) return; try { S.st.d = (await api('/api/studio/' + S.st.d.id)).draft; } catch {} drawStudio(); pollStudio(); }, 5000);
}
// The picks and checks, computed here exactly as the server does (same mixer-core.js).
const stPicks = () => studioPicks(S.cfg, S.st.d.brief);
const stCfg = n => ({ ...S.cfg, output: { ...S.cfg.output, scenes: n } });
// v15: every finding is one of three kinds (mixer-core.js RULES): 'stop' (only locked compliance rules,
// or a rule Admin set to block: these hold the render, each with a one-tap fix), 'warn' (a note, behind
// Check my script; never holds the render) and 'fix' (the app fixes it: shown, with the one tap).
// Spelling notes come from the server (no dictionary in the browser), refreshed as captions change.
function stCheck() {
  const p = stPicks(), sc = S.st.d.scenes;
  if (sc.length && sc.length !== p.scenes) { const t = `This video has ${p.scenes} scenes in the brief; the board has ${sc.length}.`; return { ok: false, problems: [t], soft: [], findings: [{ rule: 'complete', kind: 'stop', scene: null, text: t }] }; }
  if (!sc.length) return { ok: false, problems: p.problems, soft: [], findings: p.problems.map(t => ({ rule: 'facts', kind: 'stop', scene: null, text: t })) };
  const r = studioChecks(sc.map(x => ({ ...x, ...(S.cfg.output.mode === 'voiceover' ? {} : { say: undefined }) })), stCfg(sc.length), p);
  const spelling = (S.st.spell || []).flatMap((list, i) => (sc[i] ? list.map(m => { const value = m.suggestion ? spellFixed(sc[i].text, m) : null; return { rule: 'spelling', kind: 'warn', scene: i, text: m.suggestion ? `“${m.word}” may be “${m.suggestion}”.` : `“${m.word}” isn’t a word we know.`, ...(value ? { fix: { label: `Change to “${m.suggestion}”`, edits: [{ i, field: 'text', value }] } } : {}) }; }) : []));
  return { ...r, findings: [...r.findings, ...spelling] };
}
// Spelling: asked of the server a moment after the captions stop changing.
function stSpell(delay = 700) {
  clearTimeout(S.st.spellTimer);
  S.st.spellTimer = setTimeout(async () => {
    const texts = S.st.d.scenes.map(x => x.text || ''), key = JSON.stringify(texts);
    if (key === S.st.spellKey) return;
    try { const r = await api('/api/spell', { method: 'POST', body: { texts } }); S.st.spellKey = key; S.st.spell = r.results || []; if (S.view === 'studio') stRefreshChecks(); } catch { /* spelling is a nicety */ }
  }, delay);
}
const KIND_MARK = { stop: '!', warn: '·', fix: '✓' };
// One finding as a list item: its scene (tap to go there), what it says, and its one-tap fix.
function findingHTML(f, showScene = true) {
  const k = S.st.findings.indexOf(f);
  const scene = showScene && Number.isInteger(f.scene) ? `<button class="linkish" data-act="st-goto" data-i="${f.scene}">Scene ${f.scene + 1}</button>: ` : '';
  const text = String(f.text).replace(/^Scene \d+:? ?/, '');
  const fix = f.fix ? ` <button class="btn sm${f.kind === 'stop' ? ' primary' : ' ghost'}" data-act="st-fix" data-n="${k}">${esc(f.fix.label)}</button>` : '';
  return `<li class="${f.kind === 'stop' ? 'bad' : f.kind === 'warn' ? 'note-warn' : 'fixed'}"><i>${KIND_MARK[f.kind]}</i><span>${scene}${esc(text)}${fix}</span></li>`;
}
// What shows on one scene card: what holds the render, and what's fixed for you (notes wait for Check my script).
// (A spelling slip shows on its card too: it's quicker to fix where it is.)
const cardFindings = i => S.st.findings.filter(f => f.scene === i && (f.kind !== 'warn' || f.rule === 'spelling' || S.st.showNotes));
function stChecksHTML(c) {
  const stops = c.findings.filter(f => f.kind === 'stop'), notes = c.findings.filter(f => f.kind === 'warn');
  const general = stops.filter(f => !Number.isInteger(f.scene));
  return `${general.length ? `<ul class="list">${general.map(f => findingHTML(f)).join('')}</ul>` : ''}
    ${stops.length ? `<p class="small" style="margin:0"><b>${plural(stops.length, 'thing')} to change before rendering</b>${stops.length > general.length ? ` (on the scene cards: ${[...new Set(stops.filter(f => Number.isInteger(f.scene)).map(f => f.scene + 1))].map(n => `<button class="linkish" data-act="st-goto" data-i="${n - 1}">scene ${n}</button>`).join(', ')})` : ''}. Each has a one-tap fix.</p>` : '<ul class="list"><li class="ok"><i>✓</i><span>Nothing holds it back. Ready to render.</span></li></ul>'}
    <div class="row"><button class="btn sm ghost" data-act="st-notes" aria-expanded="${!!S.st.showNotes}">${S.st.showNotes ? 'Hide the notes' : notes.length ? `Check my script (${plural(notes.length, 'note')})` : 'Check my script'}</button></div>
    ${S.st.showNotes ? (notes.length ? `<ul class="list">${notes.map(f => findingHTML(f)).join('')}</ul><p class="small muted" style="margin:0">Notes are suggestions: you can render with them. They’re shown again in Review before you approve.</p>` : '<p class="small muted" style="margin:0">No notes: it reads well.</p>') : ''}`;
}
function stSave(delay = 1200) {
  clearTimeout(S.st.saveTimer);
  S.st.saveTimer = setTimeout(async () => {
    try { const r = await api('/api/studio/' + S.st.d.id, { method: 'PUT', body: { scenes: S.st.d.scenes } }); S.st.d.status = r.draft.status; S.st.saved = Date.now(); const el = document.getElementById('stSaved'); if (el) el.textContent = 'Saved'; }
    catch (e) { const el = document.getElementById('stSaved'); if (el) el.innerHTML = `Not saved. <button class="btn sm ghost" data-act="st-save-retry">Try again</button>`; else toast(e.message); }
  }, delay);
}
async function stBrief(patch) {
  // The scene cards here may be newer than the server's (a save still waiting), so they're kept.
  try { const r = await api('/api/studio/' + S.st.d.id, { method: 'PUT', body: { brief: { ...S.st.d.brief, ...patch } } }); S.st.d = { ...r.draft, scenes: S.st.d.scenes }; } catch (e) { toast(e.message); }
  // The board follows the scene count.
  const n = stPicks().scenes, sc = S.st.d.scenes;
  if (sc.length && sc.length !== n) { S.st.d.scenes = sc.length > n ? sc.slice(0, n) : [...sc, ...Array.from({ length: n - sc.length }, () => ({ say: '', text: '', accent: '', keyword: '' }))]; stSave(0); }
  drawStudio();
}
function stRefreshChecks() {
  const c = stCheck();
  S.st.findings = c.findings;
  const box = document.getElementById('stChecks'); if (box) box.innerHTML = stChecksHTML(c);
  S.st.d.scenes.forEach((_, i) => { const el = document.querySelector(`[data-stp="${i}"]`); if (el) el.innerHTML = cardFindings(i).map(f => findingHTML(f, false)).join(''); });
  const btn = document.querySelector('[data-act="st-render"]');
  if (btn) { btn.disabled = !c.ok || S.st.d.status === 'rendering'; btn.textContent = renderLabel(c); }
}
// v15 open drafting: "Submit for review" renders it and puts it in Review for the agent; a later submit
// is the next version of the same video.
const renderLabel = c => { const n = c.findings.filter(f => f.kind === 'warn').length, again = S.st.d.submitted && ['pending', 'rejected'].includes(S.st.d.submitted.status); return S.st.d.status === 'rendering' ? 'Rendering…' : `${again ? 'Submit the new version' : 'Submit for review'}${n ? ` (${plural(n, 'note')})` : ''}`; };
function drawStudio() {
  const st = S.st, d = st.d, cfg = S.cfg, p = stPicks(), voice = cfg.output.mode === 'voiceover', U = usableRoutes(cfg);
  const series = (S.studioList?.series || []), ser = series.find(x => x.id === d.brief.seriesId);
  const audiences = U.audiences, pains = U.pains.filter(x => !p.audience || x.links.includes(p.audience.id));
  const facts = U.insights.filter(i => p.painPoint && i.links.includes(p.painPoint.id));
  const unconfirmed = cfg.story.insights.filter(i => p.painPoint && i.links.includes(p.painPoint.id) && !facts.some(f => f.id === i.id));
  const filled = d.scenes.filter(x => x.text.trim()).length, opened = !!d.scenes[0]?.text.trim();
  const fillWhy = p.problems.length ? p.problems[0] : d.status === 'rendering' ? 'This video is rendering.' : st.busy && st.busy !== 'fill' ? 'Wait for the other helper to finish.' : '';
  const multi = ['list', 'compare'].includes(p.format);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const plan = beatPlan(p.scenes, p.format, Math.max(1, p.insights.length), p.structure);
  const beatOf = i => plan.find(b => i + 1 >= b.from && i + 1 <= b.to)?.beat || '';
  const c = stCheck();
  S.st.findings = c.findings;
  stSpell(0);
  const rendering = d.status === 'rendering';
  main.innerHTML = `<div class="head"><a class="small" href="#/create">← Create</a><h1>Studio</h1><p class="lede">${esc(d.title)}${p.series ? ` <span class="pill">${esc(p.series.title)}</span>` : ''}</p></div>
    ${rendering ? '<div class="note"><span class="spin"></span> Rendering. It’ll be in Review in a few minutes. You can close this page.</div>' : d.status === 'done' ? `<div class="note ok">Submitted${d.submitted?.version > 1 ? ` (version ${d.submitted.version})` : ''}. It’s in <a href="#/review">Review</a>${can('approve') ? '' : ', waiting for the agent'}. Change anything here and submit again to make a new version${d.submitted?.approved ? ' (this one is approved, so it’ll be a new video)' : ''}.</div>` : d.submitted && ['pending', 'rejected'].includes(d.submitted.status) ? `<div class="note small">Version ${d.submitted.version} is in Review. Submitting again replaces it with version ${d.submitted.version + 1}, showing the agent what changed.</div>` : ''}
    ${d.changes ? `<section class="panel" style="border-color:var(--warn)"><div class="head"><h2>Changes asked for</h2><p>${esc(d.changes.byName || 'The agent')} asked for these${d.changes.note ? `: “${esc(d.changes.note)}”` : ''}. Tick each one as you do it, then submit the new version.</p></div>
      <div class="stack" style="gap:4px">${(d.changes.checklist || []).map(x => `<label class="check"><input type="checkbox" data-handoff-check="${esc(d.changes.handoffId)}" data-k="${esc(x.k)}" ${x.done ? 'checked' : ''}> <span>${esc(x.label)}</span>${Number.isInteger(x.i) ? ` <button class="linkish small" data-act="st-goto" data-i="${x.i}">go to it</button>` : ''}</label>`).join('') || '<span class="small muted">No items, just the note.</span>'}</div></section>` : ''}
    ${d.error && !rendering ? `<div class="note warn">Last render didn’t finish: ${esc(d.error)}</div>` : ''}
    ${st.more || p.series ? `<section class="panel story"><div class="head"><div class="row between"><h2><span class="dot"></span>1. What it’s about</h2>${p.series ? '' : '<button class="btn sm ghost" data-act="st-less">Simpler view</button>'}</div><p>Only confirmed facts can be taught. The format sets how it opens; the structure sets the scenes after that.</p></div>
      <div class="fields">
        ${series.length ? `<label class="field"><span>Series (optional)</span><select class="ctl" data-stb="seriesId">${opt('', 'None', d.brief.seriesId)}${series.map(x => opt(x.id, x.label, d.brief.seriesId)).join('')}</select></label>` : ''}
        ${ser ? `<label class="field"><span>Part</span><select class="ctl" data-stb="part">${ser.parts.map((x, k) => opt(String(k), `${k + 1}. ${x.title}`, String(d.brief.part))).join('')}</select></label>` : ''}
        <label class="field"><span>Audience</span><select class="ctl" data-stb="audienceId">${audiences.map(a => opt(a.id, short(a.text), p.audience?.id)).join('') || '<option>No audience has a confirmed fact yet</option>'}</select>${audiences.length ? '' : '<small><a href="#/content" data-act="goto-tab" data-v="insights">Confirm a fact in Setup → Library</a> to start.</small>'}</label>
        <label class="field"><span>Their worry</span><select class="ctl" data-stb="painId">${opt('', 'Pick a worry', p.painPoint?.id || '')}${pains.map(x => opt(x.id, short(x.text), p.painPoint?.id)).join('')}</select>${st.briefNote ? `<small class="warn-text">${esc(st.briefNote)}</small>` : ''}</label>
        <label class="field"><span>Format</span><select class="ctl" data-stb="format"${p.series ? ' disabled aria-describedby="stSeriesFmt"' : ''}>${Object.entries(FORMATS).map(([k, f]) => opt(k, f.label, p.format)).join('')}</select>${p.series ? `<small id="stSeriesFmt">Set by the series part (${esc(`Part ${p.series.part}: ${p.series.title}`)}). Pick another part, or <button class="linkish" data-act="st-leave-series">leave the series</button> to choose the format.</small>` : ''}</label>
        <label class="field"><span>Structure</span><select class="ctl" data-stb="structure">${Object.entries(STRUCTURES).filter(([k]) => structureFits(k, p.scenes, p.format)).map(([k, x]) => opt(k, x.label, p.structure)).join('')}</select></label>
        <label class="field"><span>Scenes</span><select class="ctl" data-stb="scenes">${Array.from({ length: LIMITS.scenes[1] - LIMITS.scenes[0] + 1 }, (_, k) => LIMITS.scenes[0] + k).map(n => opt(String(n), String(n), String(p.scenes))).join('')}</select></label>
      </div>
      ${p.painPoint && !p.noFact ? `<div class="field"><span>${multi ? `Facts to teach (pick ${FORMATS[p.format].needs?.facts || 2})` : 'The fact to teach'}</span>${facts.map(f => `<label class="check"><input type="${multi ? 'checkbox' : 'radio'}" name="stfact" data-stfact="${esc(f.id)}" ${p.insights.some(x => x.id === f.id) ? 'checked' : ''}> <span class="small">${esc(f.text)}</span></label>`).join('')}</div>` : ''}
      ${multi ? '' : `<label class="check"><input type="checkbox" data-stnofact ${p.noFact ? 'checked' : ''}> <span class="small">This video doesn’t teach a specific fact${p.noFact ? ' (so no numbers or prices can be in it)' : ''}</span></label>`}
      ${p.painPoint && unconfirmed.length ? `<p class="small muted" style="margin:0">${plural(unconfirmed.length, 'more fact')} for this worry ${unconfirmed.length > 1 ? 'aren’t' : 'isn’t'} confirmed yet. <a href="#/content" data-act="goto-facts">Confirm in Setup → Library</a> (with a source) to teach ${unconfirmed.length > 1 ? 'them' : 'it'}.</p>` : ''}
      ${p.problems.length ? `<div class="note warn small">${p.problems.map(esc).join(' ')}</div>` : ''}
      ${p.question ? `<p class="small muted" style="margin:0">Their open question: “${esc(p.question)}”</p>` : ''}</section>` : stStartHTML(p, U)}
    <section class="panel voice"><div class="head"><h2><span class="dot"></span>2. The opening</h2><p>The first line decides whether the right person keeps watching. Get eight written and scored, or write your own in scene 1.</p></div>
      <div class="row"><button class="btn" data-act="st-hooks" ${p.problems.length || st.busy ? 'disabled' : ''}>${st.busy === 'hooks' ? '<span class="spin"></span> Writing and scoring openings…' : d.hooks.length ? 'Write 8 more' : 'Write 8 openings'}</button></div>
      ${st.hooksError ? `<div class="note warn small">${esc(st.hooksError)} <button class="btn sm ghost" data-act="st-hooks">Try again</button></div>` : ''}
      ${d.hooks.length ? (() => {
        // The best three, each with its one-line reason; the rest behind "Show more" (v15).
        const ranked = d.hooks.map((h, k) => ({ h, k })).sort((a, b) => (b.h.score || 0) - (a.h.score || 0));
        const shown = st.allHooks ? ranked : ranked.slice(0, 3);
        return `<div class="stack" style="gap:6px">${shown.map(({ h, k }) => `<div class="row between box hook-row" style="gap:8px"><span class="small" style="flex:1 1 220px">${h.score ? `<b class="mono">${esc(h.score)}/10</b> ` : ''}${esc(h.text)}${h.why ? `<br><span class="muted">${esc(String(h.why).split(/(?<=[.!?])\s/)[0])}</span>` : ''}</span><button class="btn xs${d.scenes[0]?.text === h.text ? '' : ' primary'}" data-act="st-usehook" data-k="${k}">${d.scenes[0]?.text === h.text ? 'Using ✓' : 'Use'}</button></div>`).join('')}
          ${ranked.length > 3 ? `<button class="btn sm ghost" data-act="st-hooks-more">${st.allHooks ? 'Show the top 3' : `Show ${ranked.length - 3} more`}</button>` : ''}</div>`;
      })() : ''}
      ${opened && filled < p.scenes ? `<div class="row"><button class="btn primary" data-act="st-fill" ${fillWhy || st.busy ? 'disabled' : ''}>${st.busy === 'fill' ? '<span class="spin"></span> Writing the rest…' : 'Use this opening and write the rest'}</button>${fillWhy ? `<span class="small muted">${esc(fillWhy)}</span>` : ''}</div>` : ''}</section>
    <section class="panel"><div class="row between"><div class="head"><h2>3. Scenes</h2><p>Each card has a job. Checks run as you type. <span id="stSaved" class="small muted"></span></p></div>
      <span class="stack" style="gap:4px;align-items:flex-end"><button class="btn${filled ? '' : ' primary'}" data-act="st-fill" ${fillWhy || st.busy ? 'disabled' : ''}>${st.busy === 'fill' ? '<span class="spin"></span> Writing…' : filled ? 'Write the empty scenes' : 'Write all the scenes'}</button>${fillWhy ? `<span class="small muted" style="text-align:right">${esc(fillWhy)}</span>` : ''}</span></div>
      ${st.fillError ? `<div class="note warn small">${esc(st.fillError)} <button class="btn sm ghost" data-act="st-fill">Try again</button></div>` : ''}
      ${d.scenes.length ? d.scenes.map((x, i) => `<div class="scene-edit" id="st-scene-${i}"><div class="row between"><b>Scene ${i + 1} · ${esc(beatOf(i))}</b><span class="row">
          <button class="btn sm ghost" data-act="st-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn sm ghost" data-act="st-move" data-i="${i}" data-d="1" ${i < d.scenes.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></span></div>
        ${voice ? `<label class="field"><span class="small">Spoken line</span><textarea class="ctl sm" rows="2" data-sts="${i}" data-k="say">${esc(x.say)}</textarea></label>` : ''}
        <label class="field"><span class="small">Caption</span><input class="ctl sm" data-sts="${i}" data-k="text" value="${esc(x.text)}"></label>
        <div class="fields"><label class="field"><span class="small">Highlighted word</span><input class="ctl sm" data-sts="${i}" data-k="accent" value="${esc(x.accent)}"></label>
          <label class="field"><span class="small">Footage search</span><input class="ctl sm" data-sts="${i}" data-k="keyword" value="${esc(x.keyword)}" placeholder="e.g. older woman kitchen table"></label></div>
        <ul class="problems findings" data-stp="${i}">${cardFindings(i).map(f => findingHTML(f, false)).join('')}</ul>
        ${x.note ? `<p class="small muted" style="margin:0">To film: ${esc(x.note)} <button class="x" data-act="st-note-del" data-i="${i}" aria-label="Remove this filming idea">×</button></p>` : ''}
        <div class="row"><button class="btn sm ghost" data-act="st-ideas" data-i="${i}" ${p.problems.length ? 'disabled' : ''}>✦ Ideas</button>${voice ? `<button class="btn sm ghost" data-act="st-hear" data-i="${i}" ${x.say ? '' : 'disabled'}>▶ Hear this line</button>` : ''}<button class="btn sm ghost" data-act="st-foot" data-i="${i}" ${x.keyword ? '' : 'disabled'}>Find footage</button>
          <span class="small muted">${x.clip ? `Footage: ${x.clip.id && String(x.clip.id).startsWith('own:') ? 'your clip' : 'chosen'} <button class="x" data-act="st-clipclear" data-i="${i}" aria-label="Let the app pick">×</button>` : 'Footage: the app picks'}</span></div>
        ${stIdeasHTML(i)}${stFootHTML(i)}</div>`).join('') : `<p class="empty">${p.problems.length ? 'Finish step 1 first.' : 'Tap “Write all the scenes”, or start with an opening above.'}</p>`}</section>
    <section class="panel"><div class="head"><h2>4. Check and submit</h2><p>Submitting renders it (about two minutes) and puts it in Review${can('approve') ? '' : ' for the agent to approve'}. The first submit uses one of this month’s videos; new versions don’t.</p></div>
      <div id="stChecks">${stChecksHTML(c)}</div>
      <div class="row"><button class="btn primary big" data-act="st-render" ${c.ok && !rendering ? '' : 'disabled'}>${esc(renderLabel(c))}</button>${S.st.d.scenes.length ? '<button class="btn ghost" data-act="prompter-studio">Read it on camera</button>' : ''}</div></section>`;
}
// ✦ Ideas for one scene: lines that already passed the checks (and why any were hidden), footage
// searches and things to film. Each is one tap.
// The simple start (v15): one question, "What's this video about?", with the agent's worries as cards
// in their own words. One tap sets the rest: the audience linked to that worry, its recommended confirmed
// fact, and a format that takes turns with recent drafts. A sentence then says what the video will be,
// with Change for the full settings (also behind More options). Surprise me picks one for them.
function stStartHTML(p, U) {
  const noFact = !!S.st.d.brief.noFact, pains = noFact ? S.cfg.story.painPoints : U.pains;
  const ask = x => (x.question ? `${x.question.replace(/^./, c => c.toUpperCase()).replace(/[?.]$/, '')}?` : '');   // (saved as the end of a sentence: "how much…")
  if (!p.painPoint) {
    return `<section class="panel story"><div class="head"><h2><span class="dot"></span>1. What’s this video about?</h2><p>Pick what it’s about. We’ll set up the rest.</p></div>
      ${pains.length ? `<div class="cards worry-cards">${pains.map(x => `<button class="box worry-card" data-act="st-worry" data-id="${esc(x.id)}"><b>${esc(x.text)}</b>${x.question ? `<span class="small muted">${esc(ask(x))}</span>` : ''}</button>`).join('')}</div>`
        : `<p class="empty">${noFact ? 'Add a worry in Setup → Library first.' : 'No worry has a confirmed fact yet. <a href="#/content" data-act="goto-facts">Confirm one in Setup → Library</a>, or make a video that doesn’t teach a fact.'}</p>`}
      <div class="row">${pains.length ? '<button class="btn primary" data-act="st-surprise">Surprise me</button>' : ''}<button class="btn ghost sm" data-act="st-nofact-start" aria-pressed="${noFact}">${noFact ? 'Teach a confirmed fact instead' : 'Make one that doesn’t teach a fact'}</button><button class="btn ghost sm" data-act="st-more">More options</button></div></section>`;
  }
  const fmt = FORMATS[p.format]?.label || p.format, aud = p.audience ? short(p.audience.text).replace(/[.]$/, '') : 'your audience';
  const fact = p.insights.length > 1 ? `${p.insights.length} facts` : p.insights[0] ? `that ${p.insights[0].text.replace(/^./, c => c.toLowerCase()).replace(/[.]$/, '')}` : '';
  const sentence = `A “${fmt}” video for ${aud}${noFact ? ', about this worry (no specific fact taught, so no numbers or prices)' : fact ? `, teaching ${fact}` : ''}. ${plural(p.scenes, 'scene')}.`;
  return `<section class="panel story"><div class="head"><h2><span class="dot"></span>1. ${esc(p.painPoint.text)}</h2><p class="st-summary">${esc(sentence)}</p></div>
    ${p.problems.length ? `<div class="note warn small">${p.problems.map(esc).join(' ')} <button class="btn sm" data-act="st-more">Change</button></div>` : ''}
    <div class="row"><button class="btn sm" data-act="st-more">Change</button><button class="btn sm ghost" data-act="st-worry" data-id="">Another worry</button>${p.insights.length && !noFact && !['list', 'compare'].includes(p.format) && (U.insights.filter(i => i.links.includes(p.painPoint.id)).length > 1) ? '<button class="btn sm ghost" data-act="st-more" data-facts="1">Teach something else</button>' : ''}<button class="btn sm ghost" data-act="st-surprise">Surprise me</button></div></section>`;
}
function stIdeasHTML(i) {
  const r = S.st.rw[i];
  if (!r) return '';
  if (r.busy) return '<p class="small muted"><span class="spin"></span> Writing lines, footage and filming ideas…</p>';
  if (r.error) return `<p class="small err-text">${esc(r.error)}</p>`;
  const lines = r.options || [];
  return `<div class="box" style="gap:8px">
    <div class="stack" style="gap:6px"><span class="small muted">${r.fixing ? `Rewritten to fix: ${esc(r.fixing)}` : 'Lines (nothing in them holds a render; tap to use)'}</span>
      ${lines.length ? lines.map((o, k) => `<button class="toggle rewrite-opt" data-act="st-userw" data-i="${i}" data-k="${k}"><b>${esc(o.style || 'option')}</b> ${esc(o.text)}${(o.notes || []).length ? `<br><span class="small warn-text">Note: ${esc(String(o.notes[0]).replace(/^Scene \d+:? ?/, ''))}</span>` : ''}</button>`).join('') : '<span class="small muted">None of the versions passed the checks.</span>'}
      ${r.hidden ? `<span class="small muted">${esc(r.hidden)}</span>` : ''}</div>
    ${(r.searches || []).length ? `<div class="stack" style="gap:6px"><span class="small muted">Footage searches (tap to search)</span><div class="chips">${r.searches.map((x, k) => `<button class="toggle" data-act="st-usesearch" data-i="${i}" data-k="${k}">${esc(x.keyword)}${x.shot ? ` <span class="muted">· ${esc(x.shot)}</span>` : ''}</button>`).join('')}</div></div>` : ''}
    ${(r.scenery || []).length ? `<div class="stack" style="gap:6px"><span class="small muted">If you film it yourself (tap to keep as a note)</span>${r.scenery.map((x, k) => `<button class="toggle rewrite-opt" data-act="st-usescenery" data-i="${i}" data-k="${k}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div class="row"><button class="btn sm ghost" data-act="st-ideas" data-i="${i}">More ideas</button><button class="btn sm ghost" data-act="st-ideas-close" data-i="${i}">Close</button></div></div>`;
}
function stFootHTML(i) {
  const f = S.st.foot[i];
  if (!f) return '';
  if (f.busy) return '<p class="small muted"><span class="spin"></span> Searching and scoring…</p>';
  if (f.error) return `<p class="small err-text">${esc(f.error)}</p>`;
  const cur = S.st.d.scenes[i].clip?.id;
  const card = (id, thumb, label, sub) => `<button class="box toggle" style="gap:4px;padding:6px;text-align:left" data-act="st-pick" data-i="${i}" data-id="${esc(id)}" data-thumb="${esc(thumb)}" data-q="${esc(label)}" aria-pressed="${String(cur) === String(id)}">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:6px">` : ''}<span class="small">${esc(label)}</span>${sub ? `<span class="small muted">${esc(sub)}</span>` : ''}</button>`;
  return `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">${f.results.map(x => card(x.id, x.thumb, x.score != null ? `${x.score}/5` : 'not scored', x.reason)).join('')}${(f.own || []).map(x => card(x.id, x.thumb, 'Your clip', x.description)).join('')}</div>${f.results.length ? '' : '<p class="small muted">No stock clips found. Try simpler words in the footage search.</p>'}`;
}
function stSetScene(i, patch) { S.st.d.scenes[i] = { ...S.st.d.scenes[i], ...patch }; stSave(); }

export { drawStudio, loadStudioList, pollStudio, stBrief, stCheck, stPicks, stRefreshChecks, stSave, stSetScene, stSpell, studioListPanel, viewStudio };

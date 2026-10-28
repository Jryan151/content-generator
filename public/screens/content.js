// public/screens/content.js — Content: Topics, your clients, your voice, and the call to action.
// A topic is one video idea whose parts belong together: the client's worry, the one fact it teaches,
// the question only the agent can answer, and how the offer is named. Videos only use a topic once the
// agent ticks that its fact is true for what they sell. (The checks read cfg.story, built from the
// topics by storyFrom in mixer-core.js.)
import { S, analyze, api, checkInsightText, esc, factNotes, loadCfg, main, plural, saveBar, styleLabel, toast } from '../app.js';
import { storyFrom, uid } from '../mixer-core.js';
import { styleBadges } from './communicate.js';
import { drawStep, stepView } from './steps.js';

/* ================= Content ================= */
async function viewContent() { await loadCfg(); drawContent(); }
const CONTENT_TABS = [['topics', 'Topics'], ['clients', 'Your clients'], ['voice', 'Your voice'], ['cta', 'Call to action']];

// The story the checks read, rebuilt after a topic changes on this page (the server does the same on save).
function restory() { if (S.cfg) Object.assign(S.cfg.story, storyFrom(S.cfg)); }
const topicById = id => (S.cfg?.topics || []).find(t => t.id === id);
// Display state: ticked here but not saved yet still counts as checked on screen.
const stateOf = t => (!t.fact ? 'empty' : t.confirmed ? 'checked' : 'waiting');
const PILL = { checked: ['ok', 'Checked'], waiting: ['', 'Not checked'], empty: ['warn', 'Needs a fact'] };

function topicCard(t) {
  const st = stateOf(t), [cls, label] = PILL[st], problems = t.fact ? checkInsightText(t.fact) : [], notes = t.fact ? factNotes(t.fact) : [];
  const inp = (k, ph, max = 160) => `<input class="ctl sm" data-topic="${t.id}" data-k="${k}" value="${esc(t[k])}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" maxlength="${max}">`;
  return `<div class="item fact ${st === 'checked' ? 'confirmed' : ''}" data-topic-item="${t.id}">
    <div class="item-top"><div class="row"><span class="pill ${cls}" data-tpill="${t.id}">${label}</span>${t.ai ? '<span class="pill ai">AI suggestion · check carefully</span>' : ''}</div><button class="x" data-act="topic-del" data-id="${t.id}" aria-label="Delete topic">×</button></div>
    <label class="field"><span class="small">The worry, in your clients’ words</span>${inp('worry', 'e.g. I don’t want my kids paying for my funeral.')}</label>
    <label class="field"><span class="small">The fact this video teaches</span><textarea class="ctl" rows="2" data-topic="${t.id}" data-k="fact" maxlength="300" placeholder="e.g. Final expense insurance is usually a small whole life policy…" aria-label="The fact">${esc(t.fact)}</textarea></label>
    <ul class="problems" data-tproblems="${t.id}">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    <div data-tnotes="${t.id}">${notes.length ? `<div class="soft-note small"><span>${esc(notes[0])}</span></div>` : ''}</div>
    <label class="field"><span class="small">The question only you can answer (the video ends on it)</span>${inp('question', 'e.g. how much coverage would cover your final expenses')}</label>
    <details><summary class="small">More: how you name the offer, who’s in the footage</summary><div class="stack" style="gap:8px;margin-top:8px">
      <label class="field"><span class="small">Your offer, in plain words</span>${inp('offer', 'e.g. a small whole life policy for funeral costs', 120)}</label>
      <label class="field"><span class="small">Always say with it (optional)</span>${inp('mention', 'e.g. waiting period', 40)}</label>
      <label class="field"><span class="small">Who’s in the footage for this topic (optional)</span>${inp('who', S.cfg.audience?.visual || 'e.g. older adults in their 60s and 70s', 100)}</label></div></details>
    <label class="check"><input type="checkbox" data-topic-ok="${t.id}" ${t.confirmed ? 'checked' : ''} ${!t.fact || problems.length ? 'disabled' : ''}> <span>This fact is true for what I sell</span></label></div>`;
}

// (v15 Phase 10) The page's parts, so Setup's steps can show them: the checks, the tab row, each tab.
function contentParts(tabs = CONTENT_TABS) {
  const cfg = S.cfg, s = cfg.story, topics = cfg.topics || [], bank = cfg.bank, A = cfg.audience || {};
  const tab = tabs.some(([k]) => k === S.contentTab) ? S.contentTab : tabs[0][0];
  const checked = topics.filter(t => t.fact && t.confirmed).length;
  const counts = { topics: `${checked}/${topics.length}`, clients: '', voice: bank.samples.length + bank.stories.length + bank.questions.length, cta: '' };
  const warnings = analyze(cfg).warnings;
  const sections = {
    topics: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Topics</h2><p>Each topic is one video: a worry your clients have, the one fact that answers it, and the question only you can answer. A video never mixes parts of different topics.</p></div>
      <form class="stack box" data-form="topic-add" style="gap:8px"><b class="small">Add a topic</b>
        <input class="ctl" name="worry" maxlength="160" placeholder="The worry, e.g. I’m on a fixed income. I can’t afford much." autocomplete="off" aria-label="The worry">
        <textarea class="ctl" name="fact" rows="2" maxlength="300" placeholder="The fact it teaches, with “usually”, “often” or “many”" aria-label="The fact"></textarea>
        <div class="row"><button class="btn">Add</button></div></form>
      <div class="stack">${topics.map(topicCard).join('') || '<p class="empty">No topics yet. Add one above.</p>'}</div></section>`,
    clients: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Your clients</h2><p>Who your videos are for, and who appears in the footage.</p></div>
      <label class="field"><span>Who your clients are</span><input class="ctl" data-bind="profile.clients" value="${esc(cfg.profile.clients)}" maxlength="200" placeholder="e.g. older adults on fixed incomes, mostly retired"></label>
      <label class="field"><span>Who appears in the footage</span><input class="ctl" data-bind="audience.visual" value="${esc(A.visual)}" maxlength="100" placeholder="e.g. older adults in their 60s and 70s"><small>Age range and relationship. Never ethnicity, religion or health.</small></label>
      <div class="row small"><span class="muted">How they like to be spoken to:</span>${A.style ? `${styleBadges(A.style)}<span>${esc(styleLabel(A.style))}</span>` : '<span class="muted">not set yet</span>'}<a href="#/communicate">${A.style ? 'Change' : 'Set it'}</a></div>
      ${(A.searches || []).length ? `<div class="field"><span class="small">Saved footage searches</span><div class="chips">${A.searches.map(q => `<span class="chip"><span>${esc(q)}</span><button class="x" data-act="search-del" data-q="${esc(q)}" aria-label="Remove">×</button></span>`).join('')}</div></div>` : ''}</section>`,
    voice: () => `<section class="panel voice"><div class="head"><h2><span class="dot"></span>Your voice</h2><p>The strongest way to make scripts sound like you. Your real writing, true stories and real questions beat any setting.</p></div>
      <div class="stack"><h3>Things you’ve written</h3><p class="small muted" style="margin:0">Paste captions, texts or posts you wrote yourself (up to 8). The AI copies your word choice and rhythm, never the lines themselves.</p>
        ${bank.samples.map((t, i) => `<div class="item"><div class="item-top"><textarea class="ctl" rows="3" data-sample="${i}" aria-label="Writing sample">${esc(t)}</textarea><button class="x" data-act="bdel" data-list="samples" data-i="${i}" aria-label="Delete">×</button></div></div>`).join('')}
        ${bank.samples.length < 8 ? '<form class="stack" data-form="sample"><textarea class="ctl" name="text" rows="3" placeholder="Paste something you wrote, e.g. a caption from your Instagram"></textarea><div class="row"><button class="btn">Add</button></div></form>' : ''}</div>
      <div class="divider"></div>
      <div class="stack"><h3>Your true stories</h3><p class="small muted" style="margin:0">Short, true moments from your own life (under 80 words), like why you became an agent. Mini-story videos use them exactly as written.</p>
        ${bank.stories.map(st => `<div class="item${st.confirmed ? ' fact confirmed' : ''}"><div class="item-top"><textarea class="ctl" rows="3" data-bankedit="stories" data-id="${st.id}" data-k="text" aria-label="Story">${esc(st.text)}</textarea><button class="x" data-act="bdel" data-list="stories" data-id="${st.id}" aria-label="Delete">×</button></div>
          <ul class="problems" data-sproblems="${st.id}"></ul>
          <label class="check"><input type="checkbox" data-story-ok="${st.id}" ${st.confirmed ? 'checked' : ''}> <span>This really happened to me</span></label></div>`).join('')}
        <form class="add" data-form="badd" data-list="stories"><input class="ctl" name="text" placeholder="Add a true story" autocomplete="off"><button class="btn">Add</button></form></div>
      <div class="divider"></div>
      <div class="stack"><h3>Questions you hear</h3><p class="small muted" style="margin:0">Real questions people ask you, in their words. “Question I get asked” videos open with them.</p>
        ${bank.questions.map(q => `<div class="item"><div class="item-top"><input class="ctl sm" data-bankedit="questions" data-id="${q.id}" data-k="text" value="${esc(q.text)}" aria-label="Question"><button class="x" data-act="bdel" data-list="questions" data-id="${q.id}" aria-label="Delete">×</button></div></div>`).join('')}
        <form class="add" data-form="badd" data-list="questions"><input class="ctl" name="text" placeholder="e.g. Do I really need a policy if I have savings?" autocomplete="off"><button class="btn">Add</button></form></div></section>`,
    cta: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Call to action</h2><p>The last scene of every video.</p></div><div class="fields">
      <label class="field"><span>Action</span><input class="ctl" data-bind="story.ctaAction" value="${esc(s.ctaAction)}" maxlength="60"></label>
      <label class="field"><span>Question when a topic has none</span><input class="ctl" data-bind="story.defaultQuestion" value="${esc(s.defaultQuestion)}"></label></div></section>`,
  };
  return { sections, tab, checks: `<section class="panel"><div class="row between"><h2>Checks</h2><span class="mono small">${plural(checked, 'topic')} ready for videos</span></div>
      ${warnings.length ? `<ul class="list">${warnings.slice(0, S.allWarnings ? 99 : 3).map(w => `<li class="bad"><i>!</i><span>${esc(w.msg)}</span></li>`).join('')}</ul>${warnings.length > 3 && !S.allWarnings ? `<button class="btn sm ghost" data-act="all-warnings">Show all ${warnings.length}</button>` : ''}` : '<p class="small muted" style="margin:0">Everything looks ready.</p>'}</section>`,
    tabs: `<div class="chips" role="tablist">${tabs.map(([k, l]) => `<button class="toggle" role="tab" data-act="content-tab" data-v="${k}" aria-pressed="${tab === k}">${l}${counts[k] !== '' ? ` · ${counts[k]}` : ''}</button>`).join('')}</div>` };
}
function drawContent() {
  if (stepView()) return drawStep();   // (v15 Phase 10) on a Setup step, that step is redrawn
  const P = contentParts();
  main.innerHTML = `<div class="head"><h1>Content</h1><p class="lede">Every video is one topic: a worry, the fact that answers it, and a question only you can answer.</p></div>
    ${P.checks}
    ${P.tabs}
    ${P.sections[P.tab]()}`;
}

// Typing in a topic (called by app.js's input handler). A changed fact must be checked again.
function onTopicInput(el) {
  const t = topicById(el.dataset.topic || el.dataset.topicOk);
  if (!t) return;
  if (el.dataset.topicOk) {
    t.confirmed = el.checked; t.confirmedAt = '';
    if (el.checked) t.ai = false;
    const [cls, label] = PILL[stateOf(t)], pill = main.querySelector(`[data-tpill="${t.id}"]`);
    if (pill) { pill.className = `pill ${cls}`; pill.textContent = label; }
    el.closest('.item')?.classList.toggle('confirmed', el.checked);
    if (el.checked) toast('Checked. Save to use it in videos.');
  } else {
    t[el.dataset.k] = el.value;
    if (el.dataset.k === 'fact') {
      t.confirmed = false; t.confirmedAt = '';
      const problems = t.fact ? checkInsightText(t.fact) : [], notes = t.fact ? factNotes(t.fact) : [];
      const pr = main.querySelector(`[data-tproblems="${t.id}"]`); if (pr) pr.innerHTML = problems.map(p => `<li>${esc(p)}</li>`).join('');
      const fn = main.querySelector(`[data-tnotes="${t.id}"]`); if (fn) fn.innerHTML = notes.length ? `<div class="soft-note small"><span>${esc(notes[0])}</span></div>` : '';
      const box = main.querySelector(`[data-topic-ok="${t.id}"]`); if (box) { box.checked = false; box.disabled = !t.fact || problems.length > 0; }
      const [cls, label] = PILL[stateOf(t)], pill = main.querySelector(`[data-tpill="${t.id}"]`);
      if (pill) { pill.className = `pill ${cls}`; pill.textContent = label; }
      el.closest('.item')?.classList.remove('confirmed');
    }
  }
  restory(); saveBar();
}
// The Add form (called by app.js's submit handler).
function addTopic(data) {
  const worry = String(data.worry || '').trim(), fact = String(data.fact || '').trim();
  if (!worry && !fact) return toast('Write the worry or the fact first.');
  S.cfg.topics.unshift({ id: uid('t'), worry, fact, question: '', offer: '', mention: '', who: '', confirmed: false, confirmedAt: '', confirmedBy: '', ai: false });
  restory(); drawContent(); saveBar();
  toast(fact ? 'Added. Tick that the fact is true, then save.' : 'Added. Add the fact it teaches, then save.');
}
// (Added to the portal's actions by app.js.)
const contentActions = {
  'topic-del'(el) {
    const i = (S.cfg.topics || []).findIndex(t => t.id === el.dataset.id);
    if (i < 0) return;
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = '?'; el.title = 'Tap again to delete'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = '×'; }, 2500); return; }
    S.cfg.topics.splice(i, 1);
    restory(); drawContent(); saveBar();
  },
  'search-del'(el) { const A = S.cfg.audience; A.searches = (A.searches || []).filter(q => q !== el.dataset.q); restory(); drawContent(); saveBar(); },
};

export { CONTENT_TABS, addTopic, contentActions, contentParts, drawContent, onTopicInput, restory, viewContent };

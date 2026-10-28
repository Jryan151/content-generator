// public/screens/content.js — Content.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { FACT_REVIEW_DAYS, MONTHS, PRODUCT_LINES, S, actions, ago, analyze, api, can, checkInsightText, checkStoryText, checkingLinks, copy, countMixes, day, esc, factNotes, insightStatus, linkChecks, loadCfg, main, page, plural, saveBar, seasonsNow, short, status, styleLabel, toast, usableRoutes, when } from '../app.js';
import { sourceList } from './setup.js';
import { styleBadges } from './communicate.js';
import { lines } from './coach.js';
import { drawStep, stepView } from './steps.js';

/* ================= Content ================= */
async function viewContent() { await loadCfg(); drawContent(); }
// Display status: a fact confirmed here but not saved yet counts as confirmed on screen.
const factState = i => (i.confirmed && !i.confirmedAt ? 'confirmed' : insightStatus(i));
// Gentle notes on a fact (it still can be confirmed), with a way to reword it with the coach.
const fnotesHTML = i => { const n = factNotes(i.text); return n.length ? `<div class="soft-note small"><span>${esc(n[0])}</span><button class="btn sm ghost" data-act="fact-coach" data-id="${i.id}">Reword with the coach</button></div>` : ''; };
function factStatus(i) {
  const st = factState(i);
  if (st === 'confirmed') return ['ok', 'Confirmed', i.confirmedAt ? `Confirmed ${day(i.confirmedAt)}${i.source ? ' · ' + i.source : ''}` : 'Save to start using it in videos.'];
  if (st === 'stale') return ['warn', 'Re-confirm', `Confirmed over ${FACT_REVIEW_DAYS} days ago. Check it’s still true.`];
  return ['', 'Not confirmed', 'Not used in videos until you confirm it.'];
}
function factActions(i) {
  const st = factState(i), note = factStatus(i)[2], problems = checkInsightText(i.text);
  return `<span class="small muted">${esc(note)}</span>${st === 'confirmed' ? `<button class="btn sm ghost" data-act="unconfirm" data-id="${i.id}">Unconfirm</button>` : `<button class="btn sm ${st === 'stale' ? 'primary' : ''}" data-act="confirm" data-id="${i.id}" ${problems.length ? 'disabled' : ''}>${st === 'stale' ? 'Re-confirm' : 'Confirm: true for what I sell'}</button>`}`;
}
const CONTENT_TABS = [['routes', 'Routes'], ['insights', 'Facts'], ['voice', 'Your voice'], ['painPoints', 'Worries'], ['audiences', 'Audiences'], ['solutions', 'Solutions'], ['cta', 'Call to action']];
// Links a new item in every direction, then shows what it did with an Undo.
async function autoLinkItem(list, id) {
  const item0 = S.cfg?.story?.[list]?.find(x => x.id === id);
  if (!item0 || !item0.text.trim()) return;
  S.autoLinking = id; drawContent();
  try {
    const r = await api('/api/content/autolink', { method: 'POST', body: { kind: list, id, config: S.cfg } });
    // Looked up again: the page may have saved (a fresh copy) or the item may be gone by now.
    const s = S.cfg.story, item = s[list].find(x => x.id === id);
    if (!item) throw new Error('gone');
    const childList = { audiences: 'painPoints', painPoints: 'insights', insights: 'solutions' }[list];
    const upList = { painPoints: 'audiences', insights: 'painPoints', solutions: 'insights' }[list];
    const parents = r.parents.filter(p => !item.links?.includes(p) && s[upList]?.some(x => x.id === p)), children = r.children.filter(c => s[childList]?.some(x => x.id === c && !x.links.includes(id)));
    if (item.links) item.links.push(...parents);
    children.forEach(c => s[childList].find(x => x.id === c)?.links.push(id));
    const product = r.product && !item.product && ['insights', 'solutions'].includes(list) ? r.product : '';
    if (product) item.product = product;
    s.fit = { ...s.fit, ...r.fit };
    S.autoLinked = { ...(S.autoLinked || {}), ...(parents.length || children.length || product ? { [id]: { list, childList, parents, children, product } } : {}) };
    if (!parents.length && !children.length) toast('No clear match yet. Tap what it links to.');
  } catch (e) { toast(e.message.includes('coaching') ? e.message : 'Couldn’t link it automatically. Tap what it links to.'); }
  S.autoLinking = null;
  if (S.view === 'content') drawContent();
  else if (S.view === 'library') drawStep();
  saveBar();
}
// Link everything: the proposed links, each with a tick box, applied together.
function linkAllHTML() {
  const L = S.linkAll;
  if (!L || L.busy) return '';
  if (L.error) return `<p class="small err-text">${esc(L.error)}</p>`;
  if (!L.add.length) return '<p class="small muted" style="margin:0">Nothing clearly missing. Every link that fits is already there.</p>';
  const name = { painPoints: 'Worry', insights: 'Fact', solutions: 'Solution' };
  return `<div class="box" style="gap:6px"><b class="small">${plural(L.add.length, 'link')} to add</b>${L.add.map((a, k) => `<label class="check"><input type="checkbox" data-linkall="${k}" ${a.off ? '' : 'checked'}> <span class="small">${name[a.list]} “${esc(a.from.slice(0, 60))}” → “${esc(a.to.slice(0, 60))}”<br><span class="muted">${esc(a.reason)}</span></span></label>`).join('')}
    <div class="row"><button class="btn sm primary" data-act="link-all-apply">Add the ticked links</button><button class="btn sm ghost" data-act="link-all-close">Close</button></div></div>`;
}
// Routes: each worry's whole chain on one line, with a badge: green (ready), yellow (works, but look
// at it), red (not used, and why).
function routesHTML(cfg) {
  const s = cfg.story, U = usableRoutes(cfg), checks = linkChecks(cfg), now = Date.now();
  const linkOf = (c, p) => checks.find(l => l.key === `${c}>${p}`);
  const rows = s.painPoints.map(p => {
    const auds = s.audiences.filter(a => p.links.includes(a.id)), facts = s.insights.filter(i => i.links.includes(p.id));
    const up = U.pains.find(u => u.id === p.id), reach = up && up.links.some(a => U.audiences.some(x => x.id === a));
    const usable = reach ? facts.filter(i => U.insights.find(u => u.id === i.id)?.links.includes(p.id)) : [];
    const sols = [...new Set(usable.flatMap(i => U.solutions.filter(x => x.links.includes(i.id))))];
    const red = [], yellow = [];
    if (!auds.length) red.push('not linked to an audience');
    else if (facts.length && !reach) red.push('its audience links don’t fit');
    if (!facts.length) red.push('no facts answer it');
    else if (!usable.length) red.push(facts.some(i => insightStatus(i, now) !== 'confirmed') ? 'its facts aren’t confirmed yet' : 'its links don’t fit');
    auds.forEach(a => { const l = linkOf(p.id, a.id); if (l?.state === 'blocked' && !l.override) red.push(`doesn’t fit “${a.text.slice(0, 30)}”`); else if (l?.state === 'weak') yellow.push(`loosely fits “${a.text.slice(0, 30)}”`); });
    facts.forEach(i => { const l = linkOf(i.id, p.id); if (l?.state === 'weak') yellow.push('a fact only loosely answers it'); if (insightStatus(i, now) === 'confirmed' && now - Date.parse(i.confirmedAt) > (FACT_REVIEW_DAYS - 7) * 86400000) yellow.push('a fact is due for review soon'); });
    if (usable.length && !sols.length) yellow.push('no solution follows from its facts');
    const badge = red.length && !usable.length ? 'red' : red.length || yellow.length ? 'yellow' : 'green';
    return { p, auds, facts, usable, sols, badge, why: [...new Set([...red, ...yellow])] };
  });
  const dot = { green: '<span class="pill ok">Ready</span>', yellow: '<span class="pill warn">Check</span>', red: '<span class="pill err">Not used</span>' };
  return `<section class="panel story"><div class="head"><h2><span class="dot"></span>Routes</h2><p>Each worry’s whole chain: who has it → the worry → the facts that answer it → the solution → your call to action. Green is ready for videos, yellow works but is worth a look, red isn’t used yet.</p></div>
    <div class="stack">${rows.map(r => `<div class="item"><div class="row between">${dot[r.badge]}<span class="small muted">${plural(r.usable.length, 'usable fact')}</span></div>
      <p class="small" style="margin:0"><span class="muted">${r.auds.map(a => esc(a.text)).join(', ') || 'No audience'}</span> → <b>${esc(r.p.text)}</b> → ${r.facts.length ? r.facts.map(i => `${esc(i.text.slice(0, 60))}${i.text.length > 60 ? '…' : ''}${r.usable.includes(i) ? '' : ' <span class="muted">(not used)</span>'}`).join(' · ') : '<span class="muted">no facts</span>'} → ${r.sols.length ? r.sols.map(x => esc(x.text)).join(', ') : '<span class="muted">no solution</span>'} → <span class="muted">${esc(cfg.story.ctaAction)}</span></p>
      ${r.why.length ? `<p class="small ${r.badge === 'red' ? 'err-text' : 'warn-text'}" style="margin:0">${esc(r.why.slice(0, 3).join('; '))}.</p>` : ''}</div>`).join('') || '<p class="empty">No worries yet. <a href="#/content" data-act="goto-tab" data-v="painPoints">Add the worries your clients have</a>, then link facts to them.</p>'}</div></section>`;
}
// (v15 Phase 10) The page's parts, so Setup's steps can show them: the checks, the tab row, each tab.
// `tabs`: which tabs to offer (Setup → Library leaves "Your voice" to Voice and rules).
function contentParts(tabs = CONTENT_TABS) {
  const cfg = S.cfg, s = cfg.story, report = analyze(cfg);
  const mixes = countMixes(cfg), tab = S.contentTab || 'insights';
  const short = t => (t.length > 34 ? t.slice(0, 33) + '…' : t);
  // Links fold away so each card stays short on a phone.
  // Link checks: each linked button shows whether the pair fits; weak and blocked ones say why.
  const checks = new Map(linkChecks(cfg).map(l => [l.key, l]));
  const mark = l => (!l ? '' : l.state === 'blocked' && !l.override ? ' ⛔' : l.state === 'weak' ? ' ⚠' : l.state === 'ok' || l.override ? ' ✓' : '');
  const fitNotes = item => item.links.map(pid => checks.get(`${item.id}>${pid}`)).filter(l => l && (l.state === 'blocked' || l.state === 'weak')).map(l => `<li class="${l.state === 'blocked' && !l.override ? 'bad' : ''}"><i>${l.state === 'blocked' && !l.override ? '⛔' : '⚠'}</i><span class="small">${l.state === 'blocked' ? (l.override ? 'Used anyway' : 'Not used in videos') : 'Loosely related'}: “${esc(short(l.parent.text))}”. ${esc(l.reason)}${l.override ? ` <span class="muted">(your reason: ${esc(l.override)})</span>` : ''}
      ${l.state === 'blocked' && !l.override ? `<span class="row" style="margin-top:4px"><button class="btn sm ghost" data-act="link" data-list="${l.childList}" data-id="${item.id}" data-pid="${l.parent.id}">Unlink</button><button class="btn sm ghost" data-act="fit-override" data-key="${esc(l.key)}">Use it anyway…</button></span>` : ''}</span></li>`).join('');
  const auto = item => { const a = S.autoLinked?.[item.id]; return a ? `<div class="row small"><span class="muted">✦ Linked automatically (${plural(a.parents.length + a.children.length, 'link')}).</span><button class="btn sm ghost" data-act="autolink-undo" data-id="${item.id}">Undo</button></div>` : S.autoLinking === item.id ? '<p class="small muted" style="margin:0"><span class="spin"></span> Linking it to what it fits…</p>' : ''; };
  const toggles = (list, verb, noun, item, parents) => { const sugg = list === 'insights' ? S.suggestedLinks[item.id] || [] : []; const notes = fitNotes(item); return `${auto(item)}${!item.links.length && parents.length ? `<div class="row small warn-text"><span>Not used in videos until you tap at least one ${noun} below.</span>${item.text.trim() ? `<button class="btn sm ghost" data-act="autolink" data-list="${list}" data-id="${item.id}">✦ Link it for me</button>` : ''}</div>` : ''}<details${S.openLinks === item.id || !item.links.length || notes ? ' open' : ''}><summary>${verb} ${plural(item.links.length, noun, noun === 'worry' ? 'worries' : noun + 's')}</summary><div class="links">${parents.length ? parents.map(p => `<button class="toggle${sugg.includes(p.id) && !item.links.includes(p.id) ? ' suggested' : ''}" data-act="link" data-list="${list}" data-id="${item.id}" data-pid="${p.id}" aria-pressed="${item.links.includes(p.id)}" title="${esc(p.text)}${item.links.includes(p.id) && checks.get(`${item.id}>${p.id}`)?.reason ? ' — ' + esc(checks.get(`${item.id}>${p.id}`).reason) : ''}">${sugg.includes(p.id) && !item.links.includes(p.id) ? '✦ ' : ''}${esc(short(p.text))}${item.links.includes(p.id) ? mark(checks.get(`${item.id}>${p.id}`)) : ''}</button>`).join('') : '<span class="empty small">Add some first.</span>'}</div>${notes ? `<ul class="list">${notes}</ul>` : ''}</details>`; };
  // The product line a fact or solution is about: links to another product line are blocked.
  const productSel = (list, it) => `<label class="row small" style="gap:6px"><span class="muted">Product line</span><select class="ctl sm" data-edit="${list}" data-id="${it.id}" data-k="product" style="width:auto">${[['', 'Any (not just one)'], ...PRODUCT_LINES.map(p => [p.id, p.label])].map(([v, l]) => `<option value="${v}"${(it.product || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  // ✦ Generate: three options written from what they'd link to.
  const gen = (list, label, pick) => { const g = S.gen?.list === list ? S.gen : null; return `<div class="row">${pick || ''}<button class="btn sm" data-act="gen" data-list="${list}" ${g?.busy ? 'disabled' : ''}>${g?.busy ? '<span class="spin"></span> Writing…' : `✦ Generate ${label}`}</button></div>
    ${g?.error ? `<p class="small err-text">${esc(g.error)}</p>` : ''}${g?.options ? (g.options.length ? `<div class="stack" style="gap:6px">${g.options.map((o, k) => `<div class="row between box" style="gap:8px"><span class="small" style="flex:1 1 220px">${esc(o.text)}${o.question ? `<br><span class="muted">Their question: ${esc(o.question)}</span>` : ''}${o.visual ? `<br><span class="muted">In the footage: ${esc(o.visual)}</span>` : ''}${o.plain ? `<br><span class="muted">Said as: ${esc(o.plain)}${o.mustMention ? ` · always mention “${esc(o.mustMention)}”` : ''}</span>` : ''}</span><button class="btn sm primary" data-act="gen-add" data-k="${k}" ${o.added ? 'disabled' : ''}>${o.added ? 'Added ✓' : list === 'cta' ? 'Use' : 'Add'}</button></div>`).join('')}${list === 'insights' ? '<p class="small muted" style="margin:0">Added facts start unconfirmed. Check each against your carrier materials, add a source, then confirm it.</p>' : ''}</div>` : '<p class="small muted">None of the options passed the checks. Try again.</p>') : ''}`; };
  const sel = (key, items, label) => `<select class="ctl sm" data-gen="${key}" aria-label="${esc(label)}" style="flex:1 1 200px;width:auto">${items.map(x => `<option value="${esc(x.id)}"${S.genFor?.[key] === x.id ? ' selected' : ''}>${esc(short(x.text))}</option>`).join('')}</select>`;
  const add = (list, ph) => `<form class="add" data-form="add" data-list="${list}"><input class="ctl" name="text" placeholder="${esc(ph)}" autocomplete="off" aria-label="${esc(ph)}"><button class="btn">Add</button></form>`;
  const del = (list, id) => `<button class="x" data-act="del" data-list="${list}" data-id="${id}" aria-label="Delete">×</button>`;
  const edit = (list, it, k, ph, tag = 'input') => tag === 'input'
    ? `<input class="ctl sm" data-edit="${list}" data-id="${it.id}" data-k="${k}" value="${esc(it[k])}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`
    : `<textarea class="ctl" rows="3" data-edit="${list}" data-id="${it.id}" data-k="${k}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">${esc(it[k])}</textarea>`;
  const factsFor = p => s.insights.filter(i => i.links.includes(p.id) && insightStatus(i) === 'confirmed').length;
  const bank = cfg.bank;
  const counts = { routes: '', insights: `${s.insights.filter(i => factState(i) === 'confirmed').length}/${s.insights.length}`, voice: bank.samples.length + bank.stories.length + bank.questions.length, painPoints: s.painPoints.length, audiences: s.audiences.length, solutions: s.solutions.length, cta: '' };
  const warnings = report.warnings;
  const sections = {
    insights: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Facts</h2><p>The value in every video. Only confirmed facts are used. Words like “usually” or “may” keep a fact accurate, and scripts must keep them.</p></div>
      ${add('insights', 'Add a fact, e.g. “Many policies…”')}${sourceList}
      ${s.painPoints.length ? gen('insights', 'facts for', sel('painId', s.painPoints, 'The worry the facts answer')) : ''}
      <div class="stack">${s.insights.map(i => { const [cls, label, note] = factStatus(i); const problems = checkInsightText(i.text); const st = factState(i); return `<div class="item fact ${st}${i.links.length ? '' : ' unrouted'}" data-fact-item="${i.id}">
        <div class="item-top"><div class="row"><span class="pill ${cls}" data-pill="${i.id}">${label}</span>${i.ai ? '<span class="pill ai">AI suggestion</span>' : ''}</div>${del('insights', i.id)}</div>
        ${edit('insights', i, 'text', 'The fact', 'textarea')}
        <ul class="problems" data-problems="${i.id}">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        <div data-fnotes="${i.id}">${fnotesHTML(i)}</div>
        <div class="row" data-fact-actions="${i.id}">${factActions(i)}</div>
        <input class="ctl sm" data-edit="insights" data-id="${i.id}" data-k="source" value="${esc(i.source)}" list="sourceList" maxlength="80" placeholder="Source (optional), e.g. carrier materials" aria-label="Source">
        ${productSel('insights', i)}
        ${toggles('insights', 'Answers', 'worry', i, s.painPoints)}</div>`; }).join('') || '<p class="empty">No facts yet. Add one above, or use ✦ Generate for a worry, then confirm it with a source.</p>'}</div></section>`,
    painPoints: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Worries</h2><p>The hook. Each worry is in your clients’ own words, with the personal question only you can answer.</p></div>
      ${seasonsNow(S.cfg).map(x => `<div class="note"><b>This month: ${esc(x.label)}.</b> ${esc(x.tip)} Tag the worries that fit with <em>In season</em> and they’ll come up more often.</div>`).join('')}
      ${add('painPoints', 'Add a worry, in their words')}
      ${gen('painPoints', s.audiences.length ? 'worries for' : 'worries', s.audiences.length ? sel('audienceId', s.audiences, 'The audience') : '')}
      <div class="stack">${s.painPoints.map(p => `<div class="item${p.links.length ? '' : ' unrouted'}"><div class="item-top">${edit('painPoints', p, 'text', 'Their worry')}${del('painPoints', p.id)}</div>
        <label class="field"><span class="small">The question only you can answer</span>${edit('painPoints', p, 'question', 'e.g. how much coverage would cover your final expenses')}</label>
        <small class="muted">${plural(factsFor(p), 'confirmed fact')}</small>${toggles('painPoints', 'For', 'audience', p, s.audiences)}
        <details${(p.months || []).length ? ' open' : ''}><summary class="small">${(p.months || []).length ? `In season: ${p.months.map(m => MONTHS[m - 1]).join(', ')}` : 'In season (optional)'}</summary><div class="links">${MONTHS.map((m, k) => `<button class="toggle" data-act="season" data-id="${p.id}" data-m="${k + 1}" aria-pressed="${(p.months || []).includes(k + 1)}">${m}</button>`).join('')}</div><small class="muted">In these months this worry comes up about 3× as often.</small></details></div>`).join('') || '<p class="empty">No worries yet.</p>'}</div></section>`,
    audiences: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Audiences</h2><p>Who each video is for, who should appear in the footage, and how they like to be spoken to.</p></div>
      ${add('audiences', 'Add an audience, e.g. Seniors on a fixed income')}
      ${gen('audiences', 'audiences')}
      <div class="stack">${s.audiences.map(a => `<div class="item"><div class="item-top">${edit('audiences', a, 'text', 'Audience')}${del('audiences', a.id)}</div>
        <label class="field"><span class="small">In the footage</span>${edit('audiences', a, 'visual', 'e.g. older adults in their 60s and 70s')}</label>
        <div class="row small"><span class="muted">How they like to be spoken to:</span>${a.style ? `${styleBadges(a.style)}<span>${esc(styleLabel(a.style))}</span>` : '<span class="muted">not set yet</span>'}<a href="#/communicate">${a.style ? 'Change' : 'Set it'} in Communicate</a></div>
        ${(a.searches || []).length ? `<div class="field"><span class="small">Saved footage searches</span><div class="chips">${a.searches.map(q => `<span class="chip"><span>${esc(q)}</span><button class="x" data-act="search-del" data-a="${a.id}" data-q="${esc(q)}" aria-label="Remove">×</button></span>`).join('')}</div></div>` : ''}</div>`).join('') || '<p class="empty">No audiences yet.</p>'}</div></section>`,
    solutions: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Solutions</h2><p>What you offer, named in plain words. A required phrase is always said when it’s named (like “waiting period”).</p></div>
      ${add('solutions', 'Add a solution, e.g. Term life')}
      ${s.insights.length ? gen('solutions', 'solutions for', sel('factId', s.insights, 'The fact the solution follows')) : ''}
      <div class="stack">${s.solutions.map(x => `<div class="item${x.links.length ? '' : ' unrouted'}"><div class="item-top">${edit('solutions', x, 'text', 'Solution')}${del('solutions', x.id)}</div>
        <div class="fields"><label class="field"><span class="small">Said as</span>${edit('solutions', x, 'plain', 'plain-language name')}</label><label class="field"><span class="small">Always mention</span>${edit('solutions', x, 'mustMention', 'e.g. waiting period')}</label></div>
        ${productSel('solutions', x)}
        ${toggles('solutions', 'Follows', 'fact', x, s.insights)}</div>`).join('') || '<p class="empty">No solutions yet.</p>'}</div></section>`,
    voice: () => {
      const bt = (list, item) => `<details${S.openLinks === item.id ? ' open' : ''}><summary>${item.links.length ? `For ${plural(item.links.length, 'worry', 'worries')}` : 'Any worry'}</summary><div class="links">${s.painPoints.map(p => `<button class="toggle" data-act="blink" data-list="${list}" data-id="${item.id}" data-pid="${p.id}" aria-pressed="${item.links.includes(p.id)}" title="${esc(p.text)}">${esc(short(p.text))}</button>`).join('')}</div></details>`;
      return `<section class="panel voice"><div class="head"><h2><span class="dot"></span>Your voice</h2><p>The strongest way to make scripts sound like you. Your real writing, true stories and real questions beat any setting.</p></div>
      <div class="stack"><h3>Things you’ve written</h3><p class="small muted" style="margin:0">Paste captions, texts or posts you wrote yourself (up to 8). The AI copies your word choice and rhythm, never the lines themselves.</p>
        ${bank.samples.map((t, i) => `<div class="item"><div class="item-top"><textarea class="ctl" rows="3" data-sample="${i}" aria-label="Writing sample">${esc(t)}</textarea><button class="x" data-act="bdel" data-list="samples" data-i="${i}" aria-label="Delete">×</button></div></div>`).join('')}
        ${bank.samples.length < 8 ? `<form class="stack" data-form="sample"><textarea class="ctl" name="text" rows="3" placeholder="Paste something you wrote, e.g. a caption from your Instagram"></textarea><div class="row"><button class="btn">Add</button></div></form>` : ''}</div>
      <div class="divider"></div>
      <div class="stack"><h3>Your true stories</h3><p class="small muted" style="margin:0">Short, true moments from your own life (under 80 words), like why you became an agent or when your own family wasn’t ready. Mini-story videos use them exactly as written. Never about clients.</p>
        ${bank.stories.map(st => { const pr = checkStoryText(st.text); return `<div class="item${st.confirmed ? ' fact confirmed' : ''}"><div class="item-top"><textarea class="ctl" rows="3" data-bankedit="stories" data-id="${st.id}" data-k="text" aria-label="Story">${esc(st.text)}</textarea><button class="x" data-act="bdel" data-list="stories" data-id="${st.id}" aria-label="Delete">×</button></div>
          <ul class="problems" data-sproblems="${st.id}">${pr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <label class="check"><input type="checkbox" data-story-ok="${st.id}" ${st.confirmed ? 'checked' : ''} ${pr.length ? 'disabled' : ''}> <span>This really happened to me</span></label>${bt('stories', st)}</div>`; }).join('')}
        <form class="add" data-form="badd" data-list="stories"><input class="ctl" name="text" placeholder="Add a true story" autocomplete="off"><button class="btn">Add</button></form></div>
      <div class="divider"></div>
      <div class="stack"><h3>Questions you hear</h3><p class="small muted" style="margin:0">Real questions people ask you, in their words. “Question I get asked” videos open with them.</p>
        ${bank.questions.map(q => `<div class="item"><div class="item-top"><input class="ctl sm" data-bankedit="questions" data-id="${q.id}" data-k="text" value="${esc(q.text)}" aria-label="Question"><button class="x" data-act="bdel" data-list="questions" data-id="${q.id}" aria-label="Delete">×</button></div>${bt('questions', q)}</div>`).join('')}
        <form class="add" data-form="badd" data-list="questions"><input class="ctl" name="text" placeholder="e.g. Do I really need a policy if I have savings?" autocomplete="off"><button class="btn">Add</button></form></div></section>`;
    },
    cta: () => `<section class="panel story"><div class="head"><h2><span class="dot"></span>Call to action</h2><p>The last scene of every video.</p></div><div class="fields">
      <label class="field"><span>Action</span><input class="ctl" data-bind="story.ctaAction" value="${esc(s.ctaAction)}" maxlength="60"></label>
      <label class="field"><span>Question when a worry has none</span><input class="ctl" data-bind="story.defaultQuestion" value="${esc(s.defaultQuestion)}"></label></div>
      ${gen('cta', s.audiences.length ? 'calls to action for' : 'calls to action', s.audiences.length ? sel('ctaAudienceId', s.audiences, 'The audience') : '')}</section>`,
    routes: () => routesHTML(cfg),
  };
  const shown = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  return { sections, tab: shown, checks: `<section class="panel"><div class="row between"><h2>Checks</h2><span class="mono small">${mixes} distinct video${mixes === 1 ? '' : 's'} possible</span></div>
      <div class="row"><button class="btn sm" data-act="link-all" ${S.linkAll?.busy ? 'disabled' : ''}>${S.linkAll?.busy ? '<span class="spin"></span> Looking at everything…' : '✦ Link everything'}</button><button class="btn sm ghost" data-act="check-links" ${checkingLinks ? 'disabled' : ''}>${checkingLinks ? '<span class="spin"></span> Checking links…' : 'Check links'}</button></div>
      ${linkAllHTML()}
      ${warnings.length ? `<ul class="list">${warnings.slice(0, S.allWarnings ? 99 : 3).map(w => `<li class="bad"><i>!</i><span>${esc(w.msg)}</span></li>`).join('')}</ul>${warnings.length > 3 && !S.allWarnings ? `<button class="btn sm ghost" data-act="all-warnings">Show all ${warnings.length}</button>` : ''}` : '<ul class="list"><li class="ok"><i>✓</i><span>Everything is routed, every fact fits its scenes and nothing clashes.</span></li></ul>'}</section>
`,
    tabs: `<div class="chips" role="tablist">${tabs.map(([k, l]) => `<button class="toggle" role="tab" data-act="content-tab" data-v="${k}" aria-pressed="${shown === k}">${l}${counts[k] !== '' ? ` · ${counts[k]}` : ''}</button>`).join('')}</div>` };
}
function drawContent() {
  if (stepView()) return drawStep();   // (v15 Phase 10) on a Setup step, that step is redrawn
  const P = contentParts();
  main.innerHTML = `<div class="head"><h1>Content</h1><p class="lede">Every video is one audience, one worry, one confirmed fact and a solution, ending with a question only you can answer.</p></div>
    ${P.checks}
    ${P.tabs}
    ${P.sections[P.tab]()}`;
}

export { CONTENT_TABS, autoLinkItem, contentParts, drawContent, factActions, fnotesHTML, viewContent };

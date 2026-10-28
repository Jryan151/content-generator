// public/screens/mindset.js — Mindset.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { AUTO_HABITS, BOOKS, PERSUASION, S, SKILLS, api, can, copy, day, esc, go, loadCfg, main, page, plural, toast, when } from '../app.js';
import { growTabs } from './grow.js';
import { redraw } from './coach.js';

/* ================= Mindset ================= */
// Work on yourself the same way you work your pipeline. Every book is a tool here, and the parts
// that matter for videos (the why, the sweet spot, objections) shape what Create makes.
async function viewMindset() { await Promise.all([loadCfg(), loadMind()]); drawMindset(); }
async function loadMind() { S.mind = await api('/api/mindset'); }
async function mindSave(body, msg = 'Saved') {
  try {
    S.mind = await api('/api/mindset', { method: 'PUT', body });
    // The profile parts live in the config: keep the page's copy in step without making it look unsaved.
    if (body.profile && S.cfg) {
      S.cfg.mindset = S.mind.profile;
      try { const saved = JSON.parse(S.saved); saved.mindset = S.mind.profile; S.saved = JSON.stringify(saved); } catch { /* nothing saved yet */ }
    }
    S.mindWarnings = S.mind.warnings || [];
    drawMindset(); if (msg) toast(msg);
  } catch (e) { toast(`Not saved: ${e.message}`); drawMindset(); }   // switches go back to what's saved
}
const bookTag = id => (BOOKS[id] ? `${esc(BOOKS[id].title)} · ${esc(BOOKS[id].author)}` : '');
// The habits editor's rows as typed.
function habitRows() {
  const f = main.querySelector('[data-form="mind-habits"]');
  if (!f) return { identity: S.mind.mindset.identity, habits: S.mind.mindset.habits };
  const fd = new FormData(f), all = k => fd.getAll(k).map(String), ids = all('id'), texts = all('text'), autos = all('auto'), targets = all('target');
  return { identity: String(fd.get('identity') || ''), habits: ids.map((id, i) => ({ id, text: texts[i], ...(autos[i] ? { auto: autos[i], target: Number(targets[i]) || 3 } : {}) })) };
}
// What's typed in Mindset forms but not saved yet survives a redraw (ticking a habit, tapping I did
// it…). The form that was just saved starts from what was saved.
function mindDrafts() {
  const out = new Map();
  main?.querySelectorAll('form[data-form^="mind-"]').forEach(f => {
    if (f.dataset.form === S.mindSaved) return;
    const key = `${f.dataset.form}|${f.dataset.id || f.dataset.k || ''}`;
    [...f.elements].forEach((el, i) => { if (!el.name) return; if (el.type === 'checkbox' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue) out.set(`${key}|${el.name}|${i}`, el.type === 'checkbox' ? el.checked : el.value); });
  });
  return out;
}
function restoreDrafts(d) {
  if (!d.size) return;
  main.querySelectorAll('form[data-form^="mind-"]').forEach(f => {
    const key = `${f.dataset.form}|${f.dataset.id || f.dataset.k || ''}`;
    [...f.elements].forEach((el, i) => { const k = `${key}|${el.name}|${i}`; if (d.has(k)) { if (el.type === 'checkbox') el.checked = d.get(k); else el.value = d.get(k); } });
  });
}
// Every Mindset form, saved straight away.
async function mindForm(kind, f, data) {
  const fd = new FormData(f), all = k => fd.getAll(k).map(String);
  S.mindSaved = kind;   // this form's typing was saved, so it isn't kept over the saved values
  try { return await mindFormSave(kind, f, data, fd, all); } finally { S.mindSaved = null; }
}
async function mindFormSave(kind, f, data, fd, all) {
  switch (kind) {
    case 'mind-why': S.editWhy = false; return mindSave({ profile: { why: { why: data.why, how: data.how, what: data.what, show: S.mind.profile.why.show } } }, 'Your why is saved.');
    case 'mind-habits': { const ids = all('id'), texts = all('text'), autos = all('auto'), targets = all('target'); S.editHabits = false; return mindSave({ identity: data.identity, habits: ids.map((id, i) => ({ id, text: texts[i], ...(autos[i] ? { auto: autos[i], target: Number(targets[i]) || 3 } : {}) })) }); }
    case 'mind-lens': {
      S.lensText = data.text;
      const b = f.querySelector('button'); if (b) b.innerHTML = '<span class="spin"></span> Checking your draft…';
      try { S.lens = await api('/api/mindset/lens', { method: 'POST', body: { text: data.text } }); } catch (e) { if (b) b.textContent = 'Try on a draft'; throw e; }
      return drawMindset();
    }
    case 'mind-audit': { const a = all('activity'), h = all('hours'), ap = all('appts'), d = all('deals'); S.mind = await api('/api/mindset/audit', { method: 'POST', body: { rows: a.map((x, i) => ({ activity: x, hours: h[i], appts: ap[i], deals: d[i] })).filter(r => r.activity.trim()) } }); drawMindset(); return toast('Saved'); }
    case 'mind-practice': { S.mind = await api('/api/mindset/practice', { method: 'POST', body: data }); drawMindset(); return toast('Logged. Practice is how levels go up.'); }
    case 'mind-mentor': return mindSave({ mentor: data });
    case 'mind-hedgehog': return mindSave({ profile: { hedgehog: { love: data.love, best: data.best, pays: data.pays } } }, 'Saved.');
    case 'mind-strat': { const k = f.dataset.k, v = String(data.text || '').trim(); if (!v) return; return mindSave({ strategy: { ...S.mind.mindset.strategy, [k]: [...S.mind.mindset.strategy[k], v] } }, ''); }
    case 'mind-obj': { if (!String(data.text || '').trim()) return; return mindSave({ profile: { objections: [...S.mind.profile.objections, { text: data.text, answer: data.answer, links: [], topic: false }] } }, 'Added to your objection bank.'); }
    case 'mind-closer': { if (!String(data.text || '').trim()) return; return mindSave({ closer: [...S.mind.mindset.closer, { text: data.text, dread: Number(data.dread) || 3 }] }, ''); }
    case 'mind-rival': return mindSave({ rival: data });
    case 'mind-reflect': { S.mind = await api('/api/mindset/reflection', { method: 'POST', body: data }); drawMindset(); return toast('Reflection saved. See you next Friday.'); }
    default: return undefined;
  }
}
// A light tap on phones that support it (approving, ticking a habit).
const haptic = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };
function drawMindset() {
  // Open toolkit cards stay open, and unsaved typing stays, when the page redraws.
  S.mindOpen = S.mindOpen || {};
  document.querySelectorAll('[data-mind-card]').forEach(d => { S.mindOpen[d.dataset.mindCard] = d.open; });
  const drafts = S.view === 'mindset' ? mindDrafts() : new Map();
  try { drawMindsetPage(); } finally { restoreDrafts(drafts); }
}
// The persuasion lens' read (v15): each flag with the exact words that set it off (fear and guilt as a
// gentle note), what works, one way to give first, and a sample rewrite using one honest principle.
const FLAG_LABEL = { urgency: 'Urgency', scarcity: 'Scarcity', testimonial: 'A testimonial (not allowed)', fear: 'Fear or guilt' };
function lensHTML(L) {
  const flags = L.flags || [], hard = flags.filter(f => f.kind !== 'fear'), soft = flags.filter(f => f.kind === 'fear');
  return `<div class="box"><b class="small">${L.honest ? '✓ Honest persuasion' : '⚠ Some pressure in here'}</b>
    ${L.principles.length ? L.principles.map(x => `<span class="small"><b>${esc(PERSUASION[x.id].label)}:</b> ${esc(x.how)}</span>`).join('') : '<span class="small muted">No clear principle yet.</span>'}
    ${hard.map(f => `<span class="small warn-text"><b>${esc(FLAG_LABEL[f.kind] || f.kind)}:</b> “${esc(f.words)}”</span>`).join('')}
    ${soft.map(f => `<span class="small muted"><b>${esc(FLAG_LABEL.fear)}:</b> “${esc(f.words)}”. Naming a real worry is often fine; answer it calmly.</span>`).join('')}
    ${(L.strengths || []).length ? `<span class="small"><b>Works:</b> ${L.strengths.map(esc).join(' ')}</span>` : ''}
    ${L.note ? `<span class="small">${esc(L.note)}</span>` : ''}
    ${L.advice || L.addValue ? `<span class="small muted">Give first: ${esc(L.advice || L.addValue)}</span>` : ''}
    ${L.rewrite ? `<span class="small"><b>A version using ${esc(PERSUASION[L.rewrite.principle]?.label?.toLowerCase() || L.rewrite.principle)}:</b> “${esc(L.rewrite.text)}”</span>` : ''}</div>`;
}
function drawMindsetPage() {
  // (A client waiting for its Undo stays off the screen whichever way the data was refreshed.)
  const V = S.mind, m = V.mindset, p = V.profile, cfg = S.cfg, s = cfg.story, open = S.mindOpen || {};
  const delta = V.score - V.scoreWeekAgo;
  const why = p.why, friday = new Date().getDay() === 5, reflected = m.reflections.some(r => r.week === V.week);
  const card = (key, title, book, about, body, side = '') => `<details class="panel" ${open[key] ? 'open' : ''} data-mind-card="${key}"><summary class="row between" style="cursor:pointer"><span><b>${title}</b><br><span class="small muted">${book}</span></span>${side}</summary><p class="small muted" style="margin:6px 0 0">${about}</p><div class="stack" style="margin-top:10px">${body}</div></details>`;
  const lowest = Object.entries(V.levels).sort((a, b) => a[1] - b[1])[0];
  const audit = m.audit.find(w => w.week === V.week)?.rows || [];
  const totalDeals = audit.reduce((a, r) => a + r.deals, 0), ranked = audit.map(r => ({ ...r, rate: r.hours ? r.deals / r.hours : 0 })).sort((a, b) => b.deals - a.deals || b.rate - a.rate);
  let acc = 0; const top = totalDeals ? ranked.filter(r => { if (acc >= totalDeals * 0.8) return false; acc += r.deals; return r.deals > 0; }) : [];
  main.innerHTML = `<div class="head"><h1>Mindset</h1><p class="lede">Work on yourself the same way you work your pipeline. Better agent, better results.</p></div>
    ${growTabs()}
    <div class="row"><span class="box" style="padding:8px 14px;display:inline-flex;gap:10px;align-items:baseline"><span class="small">Growth score</span><b class="mono" style="font-size:22px">${V.score}</b>${delta ? `<span class="small ${delta > 0 ? 'ok-text' : 'muted'}">${delta > 0 ? '+' : ''}${delta} this week</span>` : ''}</span><span class="small muted">Habits, skills, reflection and results together.</span></div>
    <section class="panel"><div class="row between"><span class="small mono">MY WHY</span><span class="small muted">${bookTag('sinek_why')}</span></div>
      ${why.why && !S.editWhy ? `<p style="font-size:22px;font-weight:700;margin:4px 0">${esc(why.why)}</p>
        ${why.how ? `<p class="small" style="margin:0"><b>How:</b> ${esc(why.how)}</p>` : ''}${why.what ? `<p class="small" style="margin:0"><b>What:</b> ${esc(why.what)}</p>` : ''}
        <label class="check small"><input type="checkbox" data-mind-show ${why.show === 'on' ? 'checked' : ''}> <span>Show my why before I reply to a message</span></label>
        ${(S.mindWarnings || []).map(w => `<p class="small warn-text" style="margin:0">${esc(w)}</p>`).join('')}
        <div class="row"><button class="btn sm ghost" data-act="mind-why-edit">Edit</button></div>
        <p class="small muted" style="margin:0">Your videos feel it too: it shapes the tone of the bridge and the call to action, and one opening each time comes from it.</p>`
      : `<form class="stack" data-form="mind-why"><p class="small muted" style="margin:0">Start with why, then how, then what. Most people say it backwards.</p>
        <label class="field"><span>Why do you do this work?</span><input class="ctl" name="why" maxlength="200" value="${esc(why.why)}" placeholder="e.g. No family I meet should be left wondering how they’ll get by."></label>
        <label class="field"><span>How do you do it?</span><input class="ctl" name="how" maxlength="200" value="${esc(why.how)}" placeholder="e.g. Plain-language advice, honest numbers, always reachable."></label>
        <label class="field"><span>What do you offer?</span><input class="ctl" name="what" maxlength="200" value="${esc(why.what)}" placeholder="e.g. Term, whole life and final expense coverage."></label>
        <div class="row"><button class="btn primary">Save my why</button>${why.why ? '<button type="button" class="btn ghost" data-act="mind-why-cancel">Cancel</button>' : ''}</div></form>`}</section>
    <section class="panel"><div class="row between"><span class="small mono">TODAY’S PRINCIPLE</span><span class="small muted">${V.principle.n} of ${V.principle.of}</span></div>
      <div><span class="pill">${esc(V.principle.book.title)} · ${esc(V.principle.book.author)}</span></div>
      <p style="font-size:19px;font-weight:700;margin:4px 0">${esc(V.principle.text)}</p>
      <div class="box"><span class="small mono">TODAY’S CHALLENGE</span><span>${esc(V.principle.challenge)}</span></div>
      <div class="row"><button class="btn ${V.principle.done ? '' : 'primary'}" data-act="mind-did" ${V.principle.done ? 'disabled' : ''}>${V.principle.done ? 'Done today ✓' : 'I did it'}</button><button class="btn ghost" data-act="mind-next">Next principle</button></div></section>
    <section class="panel"><div class="row between"><span><span class="small mono">DAILY HABITS</span><br><span class="small muted">${bookTag('clear')}</span></span><button class="btn sm" data-act="mind-habits-edit">${S.editHabits ? 'Done' : 'Edit habits'}</button></div>
      ${S.editHabits ? `<form class="stack" data-form="mind-habits"><label class="field"><span>I’m the agent who…</span><input class="ctl" name="identity" maxlength="80" value="${esc(m.identity)}"></label>
        ${m.habits.map(h => `<div class="row" style="flex-wrap:nowrap"><input type="hidden" name="id" value="${esc(h.id)}"><input type="hidden" name="auto" value="${esc(h.auto || '')}"><input class="ctl sm" name="text" maxlength="80" value="${esc(h.text)}" aria-label="Habit">${h.auto ? `<input class="ctl sm" type="number" name="target" min="1" max="14" value="${h.target}" style="width:70px" aria-label="Times a week">` : '<input type="hidden" name="target" value="">'}<button type="button" class="x" data-act="mind-habit-del" data-id="${esc(h.id)}" aria-label="Remove">×</button></div>`).join('')}
        <div class="row"><button class="btn primary">Save habits</button><button type="button" class="btn sm ghost" data-act="mind-habit-add">Add a daily habit</button>${m.habits.some(h => h.auto === 'post') ? '' : '<button type="button" class="btn sm ghost" data-act="mind-habit-auto" data-v="post">Add “Post reels this week”</button>'}${m.habits.some(h => h.auto === 'approve') ? '' : '<button type="button" class="btn sm ghost" data-act="mind-habit-auto" data-v="approve">Add “Approve videos this week”</button>'}</div></form>`
      : `${m.identity ? `<p style="margin:0">I’m the agent who <b>${esc(m.identity)}</b>.</p>` : ''}${V.dayOff ? '<p class="small muted" style="margin:0">It’s your day off: nothing breaks today. Tick anything you do anyway.</p>' : ''}
        <div class="stack" style="gap:6px">${m.habits.map(h => { if (h.auto) { const a = V.autos[h.id]; return `<div class="row between box" style="padding:10px 12px"><span><span aria-hidden="true">${a.done ? '✅' : '◻️'}</span> ${esc(AUTO_HABITS[h.auto].label.replace('{n}', h.target))}</span><span class="small muted">${a.n} of ${a.target} · ticks itself</span></div>`; }
          const st = V.streaks[h.id]; return `<label class="row between box" style="padding:10px 12px;cursor:pointer"><span><input type="checkbox" data-mind-check="${esc(h.id)}" ${st.today ? 'checked' : ''}> ${esc(h.text)}</span><span class="small ${st.missedOnce ? 'warn-text' : 'muted'}">${st.missedOnce ? 'Never miss twice: do a small version today' : st.streak ? `${st.streak}d` : ''}</span></label>`; }).join('')}</div>`}</section>
    <h2 style="margin:8px 0 0">Your toolkit</h2><p class="small muted" style="margin:0">Each tool is built on one book.</p>
    ${card('lens', 'Persuasion lens', bookTag('cialdini'), 'Checks a draft for reciprocity, authority, liking, unity, commitment and social proof, with an honesty check. Scarcity and urgency stay off.',
      `<form class="stack" data-form="mind-lens"><textarea class="ctl" name="text" rows="4" maxlength="3000" placeholder="Paste a message, post or script">${esc(S.lensText || '')}</textarea><div class="row"><button class="btn sm primary">Try on a draft</button></div></form>
      ${S.lens ? lensHTML(S.lens) : ''}
      <label class="check small"><input type="checkbox" data-mind-persuasion ${p.persuasion === 'on' ? 'checked' : ''}> <span>Show which principles each video uses, in Review</span></label>
      ${V.contentPrinciples.length ? `<div class="box"><b class="small">What your posted videos used</b>${V.contentPrinciples.map(x => `<span class="small">${esc(x.label)}: ${plural(x.videos, 'video')}, ${plural(x.messages, 'message')}</span>`).join('')}</div>` : ''}`)}
    ${card('audit', '80/20 time audit', bookTag('ferriss'), 'Log your week, see what actually closes business, then cut, automate or delegate the rest.',
      `<form class="stack" data-form="mind-audit"><div class="table-wrap"><table class="t"><thead><tr><th>Activity</th><th>Hours</th><th>Appts</th><th>Closed</th></tr></thead><tbody>
        ${[...audit, ...Array.from({ length: Math.max(2, 6 - audit.length) }, () => ({ activity: '', hours: '', appts: '', deals: '' }))].map(r => `<tr><td><input class="ctl sm" name="activity" maxlength="80" value="${esc(r.activity)}" placeholder="e.g. Cold calls"></td><td><input class="ctl sm" type="number" step="0.5" min="0" name="hours" value="${esc(r.hours)}" style="width:70px"></td><td><input class="ctl sm" type="number" min="0" name="appts" value="${esc(r.appts)}" style="width:60px"></td><td><input class="ctl sm" type="number" min="0" name="deals" value="${esc(r.deals)}" style="width:60px"></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn sm primary">Save this week</button>${audit.length ? '<button type="button" class="btn sm" data-act="mind-advice">✦ What should I cut?</button>' : ''}</div></form>
      ${top.length ? `<p class="small" style="margin:0"><b>${top.map(r => esc(r.activity)).join(', ')}</b> brought ${Math.round(top.reduce((a, r) => a + r.deals, 0) / totalDeals * 100)}% of this week’s closed business, in ${Math.round(top.reduce((a, r) => a + r.hours, 0) / Math.max(1, audit.reduce((a, r) => a + r.hours, 0)) * 100)}% of your hours.</p>` : ''}
      ${S.advice ? `<div class="box">${[['keep', 'Protect'], ['cut', 'Cut'], ['automate', 'Automate'], ['delegate', 'Delegate']].map(([k, l]) => (S.advice[k] ? `<span class="small"><b>${l}:</b> ${esc(S.advice[k])}</span>` : '')).join('')}</div>` : ''}`, m.audit.length ? '' : '<span class="small muted">Not run yet</span>')}
    ${card('mastery', 'Mastery path', bookTag('greene'), `A skill tree for prospecting, objections and closing, with a practice log and a mentor. Every five practice sessions moves a skill up a level.`,
      `<div class="stack" style="gap:6px">${Object.entries(SKILLS).map(([k, x]) => `<div class="row between"><span class="small" title="${esc(x.tip)}">${esc(x.label)}</span><span class="mono small">${'●'.repeat(V.levels[k])}${'○'.repeat(5 - V.levels[k])}</span></div>`).join('')}</div>
      <p class="small" style="margin:0">Next: <b>${esc(SKILLS[lowest[0]].label)}</b>. ${esc(SKILLS[lowest[0]].tip)}</p>
      <form class="stack" data-form="mind-practice"><div class="fields"><label class="field"><span class="small">Skill</span><select class="ctl sm" name="skill">${Object.entries(SKILLS).map(([k, x]) => `<option value="${k}"${k === lowest[0] ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label><label class="field"><span class="small">What I practiced</span><input class="ctl sm" name="what" maxlength="200" placeholder="e.g. The “I need to think about it” objection, out loud"></label></div><input class="ctl sm" name="note" maxlength="300" placeholder="What I learned (optional)"><div class="row"><button class="btn sm primary">Log practice</button></div></form>
      ${m.practice.slice(-5).reverse().map(x => `<div class="row between small"><span>${esc(SKILLS[x.skill].label)}: ${esc(x.what)}${x.note ? ` <span class="muted">· ${esc(x.note)}</span>` : ''}</span><button class="x" data-act="mind-practice-del" data-id="${esc(x.id)}" aria-label="Remove">×</button></div>`).join('')}
      <form class="fields" data-form="mind-mentor"><label class="field"><span class="small">Mentor</span><input class="ctl sm" name="name" maxlength="80" value="${esc(m.mentor.name)}" placeholder="Who you learn from"></label><label class="field"><span class="small">Next time we talk</span><input class="ctl sm" type="date" name="next" value="${esc(m.mentor.next)}"></label><label class="field"><span class="small">What I’m learning from them</span><input class="ctl sm" name="learning" maxlength="300" value="${esc(m.mentor.learning)}"></label><div class="row" style="align-self:end"><button class="btn sm">Save</button></div></form>`, `<span class="small muted">Next: ${esc(SKILLS[lowest[0]].label)}</span>`)}
    ${card('hedgehog', 'Hedgehog finder', bookTag('collins'), 'What you love, what you can be the best at, and what pays. The overlap is your niche.',
      `<form class="stack" data-form="mind-hedgehog">
        <label class="field"><span class="small">What I love about this work</span><textarea class="ctl sm" name="love" rows="2" maxlength="300">${esc(p.hedgehog.love)}</textarea></label>
        <label class="field"><span class="small">What I can be the best at</span><textarea class="ctl sm" name="best" rows="2" maxlength="300">${esc(p.hedgehog.best)}</textarea></label>
        <label class="field"><span class="small">What actually pays</span><textarea class="ctl sm" name="pays" rows="2" maxlength="300">${esc(p.hedgehog.pays)}</textarea></label>
        <div class="row"><button class="btn sm primary">Save</button></div><small class="muted">Videos pick these about half again as often. Everything else still comes up.</small></form>`)}
    ${card('strategy', 'Strategy board', bookTag('suntzu'), 'Know yourself and the ground. Prepare your answers so you win before the conversation starts.',
      `${[['strengths', 'My strengths'], ['weaknesses', 'My weaknesses'], ['competitors', 'Other agents and options near me'], ['shifts', 'What’s changing in my market']].map(([k, l]) => `<div class="field"><span class="small">${l}</span><div class="chips">${m.strategy[k].map((x, i) => `<span class="chip"><span>${esc(x)}</span><button class="x" data-act="mind-strat-del" data-k="${k}" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div><form class="add" data-form="mind-strat" data-k="${k}"><input class="ctl sm" name="text" maxlength="160" autocomplete="off" placeholder="Add one"><button class="btn sm">Add</button></form></div>`).join('')}
      <div class="divider"></div><b class="small">Objection bank</b><p class="small muted" style="margin:0">Objections you hear, with your answer. Mark one as a video topic and “Question I get asked” videos can open with it (your answer stays yours; videos only teach confirmed facts).</p>
      ${p.objections.map(o => `<div class="box" style="gap:4px"><div class="row between"><b class="small">“${esc(o.text)}”</b><button class="x" data-act="mind-obj-del" data-id="${esc(o.id)}" aria-label="Remove">×</button></div>${o.answer ? `<span class="small muted">${esc(o.answer)}</span>` : ''}<div class="row"><label class="check small"><input type="checkbox" data-mind-topic="${esc(o.id)}" ${o.topic ? 'checked' : ''}> <span>Video topic</span></label></div><div class="links">${s.painPoints.map(x => `<button class="toggle" data-act="mind-obj-link" data-id="${esc(o.id)}" data-pid="${esc(x.id)}" aria-pressed="${o.links.includes(x.id)}">${esc(x.text.slice(0, 34))}</button>`).join('')}</div></div>`).join('')}
      <form class="stack" data-form="mind-obj"><input class="ctl sm" name="text" maxlength="200" placeholder="An objection, in their words, e.g. “I need to think about it”"><textarea class="ctl sm" name="answer" rows="2" maxlength="600" placeholder="Your answer (for you; never put in a video)"></textarea><div class="row"><button class="btn sm">Add objection</button></div></form>`)}
    ${card('closer', 'Closer check', bookTag('grover'), 'The hard tasks you keep putting off. Rate how much you’re avoiding each, then attack the toughest first.',
      `<form class="row" data-form="mind-closer"><input class="ctl sm" name="text" maxlength="160" placeholder="Something you keep putting off" style="flex:1 1 200px"><select class="ctl sm" name="dread" style="width:auto">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'●'.repeat(n)}</option>`).join('')}</select><button class="btn sm">Add</button></form>
      ${m.closer.filter(c => !c.done).sort((a, b) => b.dread - a.dread).map((c, k) => `<div class="row between box" style="padding:8px 12px"><span>${k === 0 ? '<b>First:</b> ' : ''}${esc(c.text)} <span class="small muted">${'●'.repeat(c.dread)}</span></span><button class="btn sm" data-act="mind-closer-done" data-id="${esc(c.id)}">Done</button></div>`).join('') || '<p class="empty">Nothing waiting. Add the thing you’d rather not do.</p>'}
      ${m.closer.some(c => c.done) ? `<p class="small muted" style="margin:0">Finished: ${m.closer.filter(c => c.done).length}</p>` : ''}`, `<span class="small muted">${m.closer.filter(c => !c.done).length ? plural(m.closer.filter(c => !c.done).length, 'task') + ' waiting' : ''}</span>`)}
    ${card('rival', 'Worthy rival', bookTag('sinek_game'), 'Pick an agent who’s better than you at something. Study what they do well, so you keep getting better, not just beat them.',
      `<form class="stack" data-form="mind-rival"><label class="field"><span class="small">My worthy rival</span><input class="ctl sm" name="name" maxlength="80" value="${esc(m.rival.name)}"></label><label class="field"><span class="small">What they do better</span><input class="ctl sm" name="better" maxlength="200" value="${esc(m.rival.better)}"></label><label class="field"><span class="small">What I’ll learn from them</span><input class="ctl sm" name="learn" maxlength="300" value="${esc(m.rival.learn)}"></label><label class="field"><span class="small">This month’s note</span><textarea class="ctl sm" name="note" rows="2" maxlength="300">${esc(m.rival.note)}</textarea></label><div class="row"><button class="btn sm primary">Save</button></div></form>`, m.rival.name ? '' : '<span class="small muted">No rival chosen</span>')}
    <section class="panel"><div class="head"><h2>Weekly reflection</h2><p>Five minutes, every Friday. This is how you adapt.</p></div>${friday && !reflected ? '<div><span class="pill warn">Due today</span></div>' : reflected ? '<div><span class="pill ok">Done this week</span></div>' : ''}
      <form class="stack" data-form="mind-reflect">${(r => [['win', 'What was my biggest win?', 'One client, one conversation, one habit kept…'], ['number', 'What’s the honest number I’m avoiding?', 'Calls made, appointments set, policies placed…'], ['matched', 'Did my week match my why?', 'Where I was on purpose, where I drifted…'], ['change', 'One thing I’ll change next week', 'Keep it small and specific']].map(([k, l, ph]) => `<label class="field"><span>${l}</span><textarea class="ctl" name="${k}" rows="2" maxlength="400" placeholder="${ph}">${esc(r?.[k] || '')}</textarea></label>`).join(''))(m.reflections.find(r => r.week === V.week))}
        <div class="row"><button class="btn primary">Save reflection</button>${m.reflections.length ? `<button type="button" class="btn ghost" data-act="mind-past">${S.pastWeeks ? 'Hide past weeks' : 'See past weeks'}</button>` : ''}</div></form>
      ${S.pastWeeks ? m.reflections.slice().reverse().map(r => `<div class="box small"><b>Week of ${esc(r.week)}</b>${r.win ? `<span>Win: ${esc(r.win)}</span>` : ''}${r.number ? `<span>Number: ${esc(r.number)}</span>` : ''}${r.matched ? `<span>Why: ${esc(r.matched)}</span>` : ''}${r.change ? `<span>Change: ${esc(r.change)}</span>` : ''}</div>`).join('') : ''}</section>`;
}

export { drawMindset, habitRows, haptic, loadMind, mindForm, mindSave, viewMindset };

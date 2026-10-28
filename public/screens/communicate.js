// public/screens/communicate.js — Communicate.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { DEFAULT_CONFIG, DRILL, FORMATS, PRINCIPLES, RUBRIC, S, SALES, STYLES, STYLE_KEYS, WORKSHOP_KINDS, api, can, copy, esc, later, loadCfg, main, normStyle, plural, short, status, styleLabel, when } from '../app.js';
import { growTabs } from './grow.js';
import { seg } from './brand.js';

/* ================= Communicate ================= */
// Learn how people take in information, set how each audience likes to be spoken to,
// and practice writing inputs that land. The playbook comes from comms-core.js, the same
// file the AI is given.
const styleBadge = k => `<span class="sb sb-${k}" title="${esc(STYLES[k].name)}">${k}</span>`;
const styleBadges = st => normStyle(st).split('').filter(Boolean).map(styleBadge).join('');
const pairsWith = st => {
  const k = normStyle(st)[0];
  if (!k) return '';
  const x = STYLES[k];
  return `${esc(DEFAULT_CONFIG.specs.energy[x.settings.energy].label)} energy, ${esc(DEFAULT_CONFIG.specs.tone[x.settings.tone].label)} tone, and the ${x.formats.map(f => esc(FORMATS[f]?.label || f)).join(', ')} formats`;
};
const shuffled = n => { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const COMMS_STARTERS = ['How do my clients like to be spoken to?', 'Rewrite one of my worries for a Careful audience', 'A client said “it’s too expensive.” What’s under that?', 'How do I spot someone’s style from a DM?'];

async function viewCommunicate() { await Promise.all([loadCfg(), loadCalibration()]); drawCommunicate(); }
// How each audience's real messages read (from the reply helper), so a style is checked, not guessed.
async function loadCalibration() { try { S.calibration = (await api('/api/comms/calibration')).calibration; } catch { S.calibration = []; } }
function calibrationHTML(a) {
  const c = (S.calibration || []).find(x => x.audienceId === a.id);
  if (!c?.total) return '<small class="muted">Check this guess against real messages: in the coach’s <b>Reply to a message</b>, pick this audience when you paste one in.</small>';
  const parts = Object.entries(c.counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${esc(STYLES[k].name)}`).join(', ');
  if (c.total < 10) return `<small class="muted">From real messages so far: ${parts} (${c.total} of 10 needed to compare).</small>`;
  if (c.suggest) return `<div class="note warn small">${c.share}% of ${c.total} real messages from this audience read <b>${esc(STYLES[c.suggest].name)}</b>${c.set ? `, but it’s set to ${esc(STYLES[c.set].name)}` : ''}. <button class="btn sm" data-act="aud-style-set" data-id="${a.id}" data-k="${c.suggest}">Use ${esc(STYLES[c.suggest].name)}</button></div>`;
  return `<small class="muted">Real messages agree: ${parts} (${c.total} read).</small>`;
}
function drawCommunicate() {
  const cfg = S.cfg, s = cfg.story;
  S.comm ||= { open: 'S' };
  const open = STYLES[S.comm.open];
  // One audience: the agent's clients (Content → Your clients). Topics' own footage people share its style.
  const auds = s.audiences.filter(a => a.id === 'aud'), styled = auds.filter(a => a.style).length;
  main.innerHTML = `<div class="head"><h1>Communicate</h1><p class="lede">Speak the way your viewer listens. Learn the four communication styles, set how each audience likes to be spoken to, and practice writing inputs that land. Better inputs make better videos.</p></div>
    ${growTabs()}
    <section class="panel story"><div class="head"><h2><span class="dot"></span>The four styles</h2><p>DISC is a simple model of how people take in information and make decisions. Everyone is a blend, and nobody is just one letter. Read the person in front of you, never their age, culture or background.</p></div>
      <div class="styles4" role="tablist">${STYLE_KEYS.map(k => `<button class="style-card sty-${k}" role="tab" data-act="comm-style" data-k="${k}" aria-pressed="${S.comm.open === k}">${styleBadge(k)}<b>${esc(STYLES[k].name)}</b><span>${esc(STYLES[k].short)}</span></button>`).join('')}</div>
      <div class="style-detail sty-${open.key}">
        <div class="row between"><h3>${styleBadge(open.key)} ${esc(open.name)} <span class="small muted">(${esc(open.disc)})</span></h3></div>
        <dl class="meta wide"><dt>Wants</dt><dd>${esc(open.wants)}</dd><dt>Fears</dt><dd>${esc(open.fears)}</dd><dt>Decides</dt><dd>${esc(open.decides)}</dd><dt>Clues</dt><dd>${esc(open.cues)}</dd>
          <dt>Words that land</dt><dd>${open.land.map(w => `<span class="chip"><span>${esc(w)}</span></span>`).join(' ')}</dd><dt>Words that lose them</dt><dd>${open.lose.map(w => `<span class="chip locked"><span>${esc(w)}</span></span>`).join(' ')}</dd></dl>
        <div class="box"><h3>In a video</h3><ul class="list"><li class="ok"><i>1</i><span><b>Hook:</b> ${esc(open.video.hook)}</span></li><li class="ok"><i>2</i><span><b>Middle:</b> ${esc(open.video.middle)}</span></li><li class="ok"><i>3</i><span><b>Call to action:</b> ${esc(open.video.cta)}</span></li></ul>
          <p class="small muted" style="margin:0">Pairs well with ${pairsWith(open.key)}.</p></div>
        <div class="box"><h3>Sounds like</h3><dl class="meta wide"><dt>Worry</dt><dd>“${esc(open.example.worry)}”</dd><dt>Hook</dt><dd>“${esc(open.example.hook)}”</dd><dt>Call to action</dt><dd>“${esc(open.example.cta)}”</dd></dl></div>
        <p class="small" style="margin:0"><b>In a conversation:</b> ${esc(open.talk)}</p>
      </div></section>
    <section class="panel story"><div class="head"><h2><span class="dot"></span>How your clients like to be spoken to</h2><p>Pick one or two styles, main one first. Every script is written to fit. It’s a working guess: check it against which videos bring messages.</p></div>
      ${auds.length ? `<div class="stack">${auds.map(a => `<div class="item"><div class="row between"><b>${esc(a.text)}</b><span class="row" style="gap:4px">${styleBadges(a.style) || '<span class="small muted">No style yet</span>'}</span></div>
        <div class="row">${STYLE_KEYS.map(k => `<button class="toggle sty-${k}" data-act="aud-style" data-id="${a.id}" data-k="${k}" aria-pressed="${(a.style || '').includes(k)}">${k} · ${esc(STYLES[k].name)}</button>`).join('')}</div>
        ${a.style ? `<small class="muted">${esc(styleLabel(a.style))}. Pairs well with ${pairsWith(a.style)}.</small>` : ''}
        ${calibrationHTML(a)}
        <div class="row"><button class="btn sm ghost" data-act="aud-coach" data-id="${a.id}">✦ Ask the coach about your clients</button></div></div>`).join('')}</div>` : ''}
      ${auds.length && styled < auds.length ? `<p class="small muted" style="margin:0">${plural(auds.length - styled, 'audience')} still without a style.</p>` : ''}</section>
    ${workshopPanel()}
    ${drillPanel()}
    <section class="panel"><div class="head"><h2>How people take in a message</h2><p>The few ideas behind almost every message that works.</p></div>
      <div class="cards">${PRINCIPLES.map(p => `<div class="box"><b>${esc(p.title)}</b><span class="small">${esc(p.body)}</span><span class="small muted"><b>In a video:</b> ${esc(p.video)}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="head"><h2>Selling, the honest way</h2><p>The fundamentals of selling, and where each one lives in your videos. Trust is the sale; pressure costs it.</p></div>
      <div class="beats">${[['Hook', 'They feel seen'], ['Insight', 'You give value first'], ['Solution', 'An option, in plain words'], ['Bridge', 'A discovery question'], ['CTA', 'One small next step']].map(([b, t]) => `<div class="beat"><b>${b}</b><span>${t}</span></div>`).join('<span class="arrow" aria-hidden="true">→</span>')}</div>
      <div class="stack">${SALES.map(x => `<div class="box" style="gap:6px"><span class="small"><b>${esc(x.title)}.</b> ${esc(x.body)}</span><span class="pill" style="justify-self:start">${esc(x.beat)}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="head"><h2>Ask the communication coach</h2><p>About styles, words, objections, or what to say on a call. It knows your audiences, worries and facts, and its suggestions can be applied in one tap.</p></div>
      <div class="chips">${COMMS_STARTERS.map(q => `<button class="toggle" data-act="comms-starter" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" data-act="comms-open">Open the coach</button><button class="btn" data-act="reply-open">Draft a reply to a message</button></div></section>`;
}

// The input workshop: score one input, then three rewrites for different styles.
const wsItems = (cfg, kind) => ({ worry: cfg.story.painPoints, question: cfg.story.painPoints, fact: cfg.story.insights, audience: cfg.story.audiences.filter(a => a.id === 'aud') }[kind] || []);
function workshopPanel() {
  const cfg = S.cfg, W = S.workshop ||= { kind: 'worry', itemId: '', audienceId: '', painId: '', style: '', text: '', busy: false, out: null };
  const K = WORKSHOP_KINDS[W.kind], items = wsItems(cfg, W.kind);
  const label = x => short(W.kind === 'question' ? `${x.text} → ${x.question || '(no question yet)'}` : x.text);
  return `<section class="panel voice" id="workshop"><div class="head"><h2><span class="dot"></span>Input workshop</h2><p>Write or pick one input. The coach scores it, says what would make it land, and rewrites it for different styles. Rewrites pass the same checks as everything else; tap Use to put one in your content.</p></div>
    <div class="field"><span>What are you writing?</span><div class="chips">${Object.entries(WORKSHOP_KINDS).map(([k, v]) => `<button class="toggle" data-act="ws-kind" data-v="${k}" aria-pressed="${W.kind === k}">${esc(v.label)}</button>`).join('')}</div><small>${esc(K.hint)}</small></div>
    <div class="fields">
      ${items.length ? `<label class="field"><span>Start from</span><select class="ctl" data-wsf="itemId"><option value="">${W.kind === 'question' ? 'Pick a worry' : 'Something new'}</option>${items.map(x => `<option value="${x.id}"${W.itemId === x.id ? ' selected' : ''}>${esc(label(x))}</option>`).join('')}</select></label>` : ''}
      ${W.kind === 'fact' && !W.itemId ? `<label class="field"><span>Answers which worry?</span><select class="ctl" data-wsf="painId"><option value="">Choose later</option>${cfg.story.painPoints.map(p => `<option value="${p.id}"${W.painId === p.id ? ' selected' : ''}>${esc(short(p.text))}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>For which audience?</span><select class="ctl" data-wsf="audienceId"><option value="">Any</option>${cfg.story.audiences.filter(a => a.id === 'aud').map(a => `<option value="${a.id}"${W.audienceId === a.id ? ' selected' : ''}>${esc(short(a.text))}${a.style ? ` (${a.style})` : ''}</option>`).join('')}</select></label>
      <div class="field"><span>Speak to</span><div class="seg">${[['', 'Auto'], ...STYLE_KEYS.map(k => [k, k])].map(([v, l]) => `<button data-act="ws-style" data-v="${v}" aria-pressed="${W.style === v}" title="${v ? esc(STYLES[v].name) : 'The audience’s own style'}">${l}</button>`).join('')}</div></div>
    </div>
    <label class="field"><span>Your words</span><textarea class="ctl" data-wsf="text" rows="2" maxlength="400" placeholder="e.g. ${esc(K.example)}">${esc(W.text)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="ws-run" ${W.busy ? 'disabled' : ''}>${W.busy ? '<span class="spin"></span> Coaching…' : 'Coach me'}</button><span class="status" data-st="ws"></span></div>
    <div id="wsOut">${W.out ? workshopHTML(W.out) : ''}</div></section>`;
}
function workshopHTML(r) {
  return `<div class="stack">
    <div class="scores">${RUBRIC.map(([k, l]) => `<div class="score"><span class="small">${esc(l)}</span><i class="bar"><i style="width:${(r.scores[k] || 0) * 20}%"></i></i><b class="mono small">${r.scores[k]}/5</b></div>`).join('')}</div>
    ${r.read ? `<p class="small" style="margin:0">Right now this speaks to ${styleBadge(r.read.style)} <b>${esc(STYLES[r.read.style].name)}</b>${r.read.why ? `: ${esc(r.read.why)}` : ''}</p>` : ''}
    ${r.works ? `<p class="small" style="margin:0"><b>What works:</b> ${esc(r.works)}</p>` : ''}
    ${r.improve ? `<p class="small" style="margin:0"><b>To make it land:</b> ${esc(r.improve)}</p>` : ''}
    ${r.lesson ? `<div class="note ok small"><b>Remember:</b> ${esc(r.lesson)}</div>` : ''}
    ${r.versions.length ? `<h3>Rewritten for different styles</h3>${r.versions.map((v, i) => `<div class="sg">${v.style ? `<div class="row">${styleBadge(v.style)}<b class="small">${esc(STYLES[v.style].name)}</b>${v.why ? `<span class="small muted">· ${esc(v.why)}</span>` : ''}</div>` : ''}
      <p style="margin:0">“${esc(v.text)}”</p>
      <div class="row">${v.apply ? `<button class="btn sm${v.applied ? '' : ' primary'}" data-act="ws-use" data-i="${i}" ${v.applied ? 'disabled' : ''}>${v.applied ? 'Used ✓' : esc(v.apply.type.startsWith('edit') ? 'Use instead' : v.apply.type === 'set_cta' ? 'Use as my call to action' : 'Add to my content')}</button>` : ''}<button class="btn sm ghost" data-act="ws-copy" data-i="${i}">Copy</button></div></div>`).join('')}` : '<p class="empty">None of the rewrites passed the checks this time. Try again, or reword it a little.</p>'}
    ${r.versions.some(v => v.apply?.type === 'add_fact' || v.apply?.type === 'edit_fact') ? '<p class="small muted" style="margin:0">A new or reworded fact starts unconfirmed: check it against your carrier materials, then confirm it in Setup → Topics.</p>' : ''}
  </div>`;
}

// Guess the style: real-sounding messages, no AI cost.
function drillPanel() {
  const D = S.drill ||= { order: shuffled(DRILL.length), i: 0, picked: '', right: 0, done: 0 };
  const q = DRILL[D.order[D.i % D.order.length]];
  const ok = D.picked && D.picked === q.style;
  return `<section class="panel" id="drill"><div class="head"><h2>Practice: guess the style</h2><p>Messages like the ones your videos bring in. Which style is writing? Spotting it fast tells you how to answer.</p></div>
    <div class="quote">“${esc(q.text)}”</div>
    <div class="styles-pick">${STYLE_KEYS.map(k => `<button class="btn sty-${k}${D.picked && k === q.style ? ' right' : ''}${D.picked === k && !ok ? ' wrong' : ''}" data-act="drill-pick" data-k="${k}" ${D.picked ? 'disabled' : ''}>${styleBadge(k)} ${esc(STYLES[k].name)}</button>`).join('')}</div>
    ${D.picked ? `<div class="note ${ok ? 'ok' : 'warn'}"><b>${ok ? 'Right.' : `It reads ${STYLES[q.style].name}.`}</b> ${esc(q.why)}<br><span class="small"><b>How to answer:</b> ${esc(q.reply)}</span></div>
      <div class="row between"><span class="small muted">${D.right} of ${D.done} right</span><button class="btn" data-act="drill-next">Next message</button></div>` : `<span class="small muted">${D.done ? `${D.right} of ${D.done} right so far` : `${DRILL.length} messages to practice with`}</span>`}</section>`;
}

export { COMMS_STARTERS, drawCommunicate, drillPanel, loadCalibration, shuffled, styleBadge, styleBadges, viewCommunicate, workshopPanel, wsItems };

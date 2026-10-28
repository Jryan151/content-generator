// public/screens/coach.js — Coach.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { DEFAULT_CONFIG, FORMATS, S, STYLES, api, app, applySuggestionTo, calm, can, copy, dirty, esc, go, later, loadCfg, main, render, saveBar, saveCfg, saveOneChange, short, status, styleLabel, suggestAccent, toast, watchJobs } from '../app.js';
import { drawReview } from './review.js';
import { drawCreate, loadOverview } from './create.js';
import { drawStudio, stBrief, stCheck, stPicks, stSave, stSetScene } from './studio.js';
import { drawContent } from './content.js';
import { drawMindset } from './mindset.js';
import { drawBrand, seg } from './brand.js';
import { drawSettings } from './settings.js';
import { COMMS_STARTERS, drawCommunicate, styleBadge, styleBadges } from './communicate.js';

const coachKey = () => 'coach.' + (S.me?.workspace?.id || '') + '.' + (S.me?.account?.id || '') + (S.coach.mode === 'comms' ? '.comms' : '');
function loadCoachMsgs() {
  if (S.coach.loaded === coachKey()) return;
  S.coach.ws = S.me?.workspace?.id; S.coach.loaded = coachKey();
  try { S.coach.msgs = JSON.parse(sessionStorage.getItem(coachKey()) || '[]'); } catch { S.coach.msgs = []; }
}
function setCoachMode(mode) {
  if (!['content', 'comms'].includes(mode) || mode === S.coach.mode) return;
  saveCoachMsgs();
  S.coach.mode = mode; S.coach.focus = null;
  loadCoachMsgs();
}
function saveCoachMsgs() { try { sessionStorage.setItem(coachKey(), JSON.stringify(S.coach.msgs.slice(-30), (k, v) => (k === 'trying' ? undefined : v))); } catch {} }
const STARTERS = {
  review: ['How do I get more messages from my videos?', 'Why do my videos get rejected?', 'How do I write a stronger opening line?'],
  create: ['What should I make next?', 'Which format fits my audience best?', 'Teach me what makes a great hook'],
  content: ['Review my facts', 'Help me write better worries', 'What should I put in Your voice?'],
  mindset: ['Help me write my why', 'Which habit should I start with?', 'How do I answer “I need to think about it”?'],
  brand: ['Which energy and tone fit my clients?', 'Captions only or voiceover?'],
  settings: ['How many drafts should I use?', 'Explain how my rules work'],
  communicate: COMMS_STARTERS,
};
// Setup's steps and Grow ask what those pages are about.
Object.assign(STARTERS, { grow: STARTERS.review, replies: ['Help me write a keyword reply'], library: STARTERS.content, profile: STARTERS.content, voice: [...STARTERS.brand, 'What should I put in Your voice?'], look: STARTERS.settings, autopilot: ['How often should I post?', 'What time should my posts go out?'] });
// Studio starters name a real scene: the first one with a problem, or the first teaching scene.
function studioStarters() {
  const bad = S.st ? stCheck().problems.map(p => p.match(/^Scene (\d+)/)?.[1]).find(Boolean) : null;
  const n = bad || 2;
  return [`3 options for scene ${n}`, 'Make it warmer', 'Footage ideas for every scene', 'Find a truth for this worry', 'What’s stopping this from rendering?', 'Tighten the whole script'];
}
// Light formatting for the coach's replies: paragraphs, "- " bullets and **bold**, all escaped first.
function md(text) {
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return String(text).split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
function describe(sg, m = 0, j = 0) {
  const q = t => `“${esc(t)}”`;
  switch (sg.type) {
    case 'add_fact': return `New fact (you’ll confirm it): ${q(sg.text)}`;
    case 'edit_fact': return `Fact → ${q(sg.text)}<br><span class="muted">You’ll confirm it again before it’s used.</span>`;
    case 'link_fact': return `Link the fact to: ${sg.painIds.map(id => q(S.cfg?.story.painPoints.find(p => p.id === id)?.text || id)).join(', ')}`;
    case 'add_search': return `Saved footage search for ${esc(S.cfg?.story.audiences.find(a => a.id === sg.audienceId)?.text || 'this audience')}: ${q(sg.text)}`;
    case 'add_note': return `Remember: ${q(sg.text)}`;
    case 'add_worry': return `New worry: ${q(sg.text)}${sg.question ? `<br>Open question: ${q(sg.question)}` : ''}`;
    case 'edit_worry': return `Worry ${sg.text ? `→ ${q(sg.text)}` : ''}${sg.question ? `<br>Open question → ${q(sg.question)}` : ''}`;
    case 'add_audience': return `New audience: ${q(sg.text)}${sg.visual ? `<br>In the footage: ${q(sg.visual)}` : ''}`;
    case 'edit_audience': return `Audience ${sg.text ? `→ ${q(sg.text)}` : ''}${sg.visual ? `<br>In the footage → ${q(sg.visual)}` : ''}`;
    case 'add_question': return `Question bank: ${q(sg.text)}`;
    case 'add_rule': return `${{ mustDo: 'Always do', neverDo: 'Never do', neverUse: 'Never use' }[sg.list]}: ${q(sg.text)}`;
    case 'set_voice': return [sg.energy && `Energy → ${esc(DEFAULT_CONFIG.specs.energy[sg.energy].label)}`, sg.tone && `Tone → ${esc(DEFAULT_CONFIG.specs.tone[sg.tone].label)}`].filter(Boolean).join(', ');
    case 'set_formats': return `Formats → ${sg.formats.map(k => esc(FORMATS[k]?.label || k)).join(', ')}`;
    case 'set_cta': return `Call to action → ${q(sg.text)}`;
    case 'set_output': return Object.entries(sg).filter(([k]) => ['scenes', 'maxWords', 'drafts'].includes(k)).map(([k, v]) => `${{ scenes: 'Scenes', maxWords: 'Words on screen', drafts: 'Drafts' }[k]} → ${v}`).join(', ');
    case 'set_style': return `${esc(S.cfg?.story.audiences.find(a => a.id === sg.audienceId)?.text || 'Audience')} → ${styleBadges(sg.style)} ${esc(styleLabel(sg.style))}`;
    case 'studio_scene': return `Scene ${sg.i + 1} → ${q(sg.text)}${sg.say ? `<br><span class="muted">Spoken: ${q(sg.say)}</span>` : ''}${(sg.notes || []).length ? `<br><span class="warn-text">Note: ${esc(String(sg.notes[0]).replace(/^Scene \d+:? ?/, ''))}</span>` : ''}${sg.alone ? `<br><span class="small muted">Use it on its own, not with the lines above: together they’d stop the render (${esc(sg.alone)}).</span>` : ''}`;
    case 'studio_draft': return `<ol class="script small">${sg.scenes.map((x, k) => `<li>${esc(x.text)}${sg.before?.[k] && sg.before[k] !== x.text ? `<br><span class="muted">was: ${esc(sg.before[k])}</span>` : ''}${sg.applied ? '' : (sg.usedScenes || []).includes(k) ? ' <span class="muted">Used ✓</span>' : ` <button class="btn sm ghost" data-act="coach-apply-scene" data-m="${m}" data-j="${j}" data-k="${k}">Use</button>`}</li>`).join('')}</ol>`;
    case 'studio_hook': return `Opening → ${q(sg.text)}`;
    case 'studio_footage': return `Scene ${sg.i + 1} footage search → ${q(sg.keyword)}`;
    case 'studio_scenery': return `Scene ${sg.i + 1}, to film: ${q(sg.text)}`;
    case 'use_fact': return `Teach this confirmed fact: ${q(sg.text)}`;
    case 'fix_scene': return `Scene ${sg.i + 1}: ${['text', 'accent', 'keyword'].filter(k => sg[k]).map(k => `${{ text: 'caption', accent: 'highlight', keyword: 'footage search' }[k]} → ${q(sg[k])}`).join(', ')}`;
    default: return '';
  }
}
// In Studio the coach always looks at the board as it is on screen, saved or not.
const coachFocus = () => (S.view === 'studio' && S.st && S.coach.mode !== 'comms' ? { label: 'this Studio draft', data: { studio: { draftId: S.st.d.id, scenes: S.st.d.scenes } } } : S.coach.focus);
// Studio suggestions change the open draft (the board saves itself).
function applyStudio(sg, only = null) {
  // Only on the draft it was written for, while it's open, with the same number of scenes.
  if (S.view !== 'studio' || !S.st || (sg.draftId && S.st.d.id !== sg.draftId)) return 'Open that Studio draft to use this.';
  const d = S.st.d, n = stPicks().scenes;
  if (!d.scenes.length) d.scenes = Array.from({ length: n }, () => ({ say: '', text: '', accent: '', keyword: '' }));
  if (sg.sceneCount && d.scenes.length !== sg.sceneCount && sg.type !== 'use_fact') return 'The board has changed since. Ask the coach again.';
  // A new footage search means the clip picked for the old one no longer fits.
  let cleared = 0;
  const search = (i, keyword) => { const x = { ...d.scenes[i] }; if (keyword && keyword !== x.keyword && x.clip) { delete x.clip; cleared++; } d.scenes[i] = { ...x, keyword: keyword || x.keyword }; };
  switch (sg.type) {
    case 'studio_scene': stSetScene(sg.i, { text: sg.text, accent: sg.accent, ...(sg.say ? { say: sg.say } : {}) }); break;
    case 'studio_draft': sg.scenes.forEach((x, k) => { if (only === null || only === k) { search(k, x.keyword); stSetScene(k, { text: x.text, accent: x.accent, ...(x.say ? { say: x.say } : {}) }); } }); break;
    case 'studio_hook': stSetScene(0, { text: sg.text, accent: suggestAccent(sg.text, S.cfg), ...(sg.say ? { say: sg.say } : {}) }); break;
    case 'studio_footage': search(sg.i, sg.keyword); stSave(); break;
    case 'studio_scenery': stSetScene(sg.i, { note: sg.text }); break;
    case 'use_fact': {
      const multi = ['list', 'compare'].includes(stPicks().format), ids = d.brief.insightIds || [];
      stBrief({ insightIds: multi ? [...ids.filter(id => id !== sg.id), sg.id].slice(-3) : [sg.id] });
      return 'Now teaching that fact. Check the teaching scenes still say it.';
    }
    default: return '';
  }
  S.st.rw = {}; drawStudio();
  const note = cleared ? ' The clip you picked was cleared; the app (or Find footage) picks one for the new search.' : '';
  return (only !== null ? `Scene ${only + 1} updated. Check the board: mixing old and new scenes can change the checks.` : 'Added to your draft.') + note;
}
async function applySuggestion(sg, only = null) {
  if (sg.type.startsWith('studio_') || sg.type === 'use_fact') return applyStudio(sg, only);
  if (sg.type === 'fix_scene') { S.pendingFix = sg; S.coach.open = false; drawCoach(); go('review'); return 'Opened the fix with the change filled in. Check it, then tap Re-render.'; }
  if (sg.type === 'add_note') { await api('/api/coach/notes', { method: 'POST', body: { text: sg.text } }); S.coach.notes = null; return 'Saved to the coach’s notes.'; }
  await loadCfg();
  // Applied means saved (v15): the change goes to the saved settings at once, so nothing is left
  // waiting on a Save button that follows the agent from page to page.
  let saved = true;
  try { await saveOneChange(c => applySuggestionTo(c, sg)); }
  catch (e) { saved = false; S.cfg = applySuggestionTo(S.cfg, sg); saveBar(); toast(`Not saved yet: ${e.message}`); }
  // The coach keeps a short log of applied changes, so later advice builds on them.
  api('/api/coach/notes', { method: 'POST', body: { text: `Applied: ${sg.label}${sg.why ? ` (${sg.why})` : ''}`, kind: 'applied' } }).then(() => { S.coach.notes = null; }).catch(() => {});
  redraw();
  if (sg.type === 'add_fact') return `Fact added for this worry${saved ? '' : ' (tap Save to keep it)'}. Confirm it (with a source) in Setup → Library → Facts before a video can teach it.`;
  if (sg.type === 'edit_fact') return `Fact reworded${saved ? '' : ' (tap Save to keep it)'}. Confirm it again in Setup → Library → Facts.`;
  return saved ? 'Applied and saved. Setup → Look → Saved versions can take it back.' : 'Applied here. Tap Save to keep it.';
}
function openCoach(question = '', focus = null, mode = '') {
  if (mode) setCoachMode(mode);
  loadCoachMsgs();
  S.coach.open = true;
  if (question || focus) S.coach.tab = 'ask';
  if (focus) S.coach.focus = focus;
  drawCoach();
  if (question) sendCoach(question);
  else setTimeout(() => document.querySelector('#coach textarea')?.focus(), 50);
}
async function sendCoach(q) {
  if (S.coach.busy) return;
  S.coach.msgs.push({ role: 'user', content: q });
  S.coach.busy = true; drawCoach();
  try {
    // Failed turns (and the question they failed on, if asked again) aren't part of the conversation sent.
    const sendable = S.coach.msgs.filter((m, i, a) => !m.error && !(m.role === 'user' && a[i + 1]?.error));
    const r = await api('/api/coach', { method: 'POST', body: { mode: S.coach.mode, messages: sendable.map(m => ({ role: m.role, content: m.content })), view: S.view, focus: (coachFocus())?.data || null, ...(dirty() ? { config: S.cfg } : {}) } });
    S.coach.notes = null;
    S.coach.msgs.push({ role: 'assistant', content: r.reply, suggestions: r.suggestions || [], followups: r.followups || [] });
    rememberNotes(S.coach.msgs[S.coach.msgs.length - 1]);
  } catch (e) { S.coach.msgs.push({ role: 'assistant', content: `I couldn’t answer that just now. ${e.message}`, error: true, retry: q, suggestions: [] }); }
  S.coach.busy = false; saveCoachMsgs(); drawCoach();
}
function drawCoach() {
  let el = document.getElementById('coach');
  if (!el) { el = document.createElement('aside'); el.id = 'coach'; el.setAttribute('aria-label', 'Coach'); document.body.append(el); }
  el.hidden = !S.coach.open;
  document.body.classList.toggle('coach-open', !!S.coach.open);
  if (!S.coach.open) return;
  const c = S.coach, comms = c.mode === 'comms', starters = comms ? COMMS_STARTERS : S.view === 'studio' && S.st ? studioStarters() : STARTERS[S.view] || STARTERS.create;
  const tabs = [['ask', 'Ask'], ['reply', 'Reply to a message'], ['notes', 'Notes']];
  const head = `<div class="coach-head"><div><b>Coach</b><span class="small muted"> · ${comms ? 'communication styles, words and selling' : 'scripts, prompts and replies'}</span></div><button class="x" data-act="coach-close" aria-label="Close">×</button></div>
    <div class="coach-mode seg" role="tablist" aria-label="Coach mode"><button role="tab" data-act="coach-mode" data-v="content" aria-pressed="${!comms}">Videos</button><button role="tab" data-act="coach-mode" data-v="comms" aria-pressed="${comms}">Communication</button></div>
    <div class="coach-tabs seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="coach-tab" data-v="${k}" aria-pressed="${c.tab === k}">${l}</button>`).join('')}</div>`;
  if (c.tab === 'reply') { el.innerHTML = head + coachReplyHTML(); return; }
  if (c.tab === 'notes') { el.innerHTML = head + coachNotesHTML(); if (!c.notes) loadCoachNotes(); return; }
  const last = c.msgs[c.msgs.length - 1];
  el.innerHTML = `${head}
    ${coachFocus() ? `<div class="coach-focus small"><span>Looking at: ${esc(coachFocus().label)}</span>${c.focus ? '<button class="x" data-act="coach-unfocus" aria-label="Stop looking at this">×</button>' : ''}</div>` : ''}
    <div class="coach-msgs" id="coachMsgs">${c.msgs.length ? c.msgs.map((m, i) => m.role === 'user' ? `<div class="msg me">${esc(m.content)}</div>`
      : m.error ? `<div class="msg ai err">${esc(m.content)}${i === c.msgs.length - 1 && m.retry ? `<div class="row"><button class="btn sm" data-act="coach-retry">Try again</button></div>` : ''}</div>`
      : `<div class="msg ai">${md(m.content)}${coachExtras(m, i)}</div>`).join('')
      : comms ? `<div class="msg ai"><p>Hi! I coach communication: how different people take in information (the four DISC styles), what words land with each of your audiences, honest selling, handling objections, and turning all of that into better worries, hooks and facts. Ask me anything, or start here:</p></div>`
      : `<div class="msg ai"><p>Hi! I can help you write stronger hooks, sharper facts and worries, pick formats, reply to messages, and understand how your settings shape every script. Ask me anything, or start here:</p></div>`}
      ${c.busy ? '<div class="msg ai small muted"><span class="spin"></span> The coach is writing…</div>' : ''}
      ${!c.busy && last?.role === 'assistant' && last.followups?.length ? `<details class="small"><summary>Ask a follow-up</summary><div class="chips" style="margin-top:6px">${last.followups.map(q => `<button class="toggle" data-act="coach-starter" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></details>` : ''}</div>
    ${!c.msgs.length ? `<div class="chips coach-starters">${starters.map(q => `<button class="toggle" data-act="coach-starter" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
    <form class="coach-input" data-form="coach"><textarea class="ctl" name="q" rows="2" placeholder="${comms ? 'Ask about styles, words, objections…' : 'Ask about hooks, facts, formats…'}" aria-label="Your question"></textarea><button class="btn primary" ${c.busy ? 'disabled' : ''}>Send</button></form>`;
  const box = document.getElementById('coachMsgs'); box.scrollTop = box.scrollHeight;
}
// Under each answer: things the coach remembered (saved quietly), then one suggestion, with any
// others folded away so the chat stays readable.
function coachExtras(m, i) {
  const all = (m.suggestions || []).map((sg, j) => ({ sg, j }));
  const notes = all.filter(x => x.sg.type === 'add_note' && x.sg.applied && x.sg.auto), rest = all.filter(x => !notes.includes(x));
  const remembered = notes.map(x => `<p class="small muted" style="margin:6px 0 0">✓ Remembered: ${esc(x.sg.text)}</p>`).join('');
  if (!rest.length) return remembered;
  // Lines for Studio scenes always come as cards, one per scene, each with Use, and Use all (v15).
  const lines = rest.filter(x => x.sg.type === 'studio_scene');
  if (lines.length) {
    const others = rest.filter(x => !lines.includes(x));
    const perScene = lines.filter(x => x.sg.together).length, open = lines.filter(x => x.sg.together && !x.sg.applied);
    return remembered + lines.map(x => suggestionHTML(x.sg, i, x.j)).join('')
      + (perScene > 1 && open.length ? `<div class="row"><button class="btn sm primary" data-act="coach-apply-all" data-m="${i}">Use all (${perScene} scenes)</button></div>` : '')
      + (others.length ? `<details class="small"><summary>${others.length} more idea${others.length === 1 ? '' : 's'}</summary>${others.map(x => suggestionHTML(x.sg, i, x.j)).join('')}</details>` : '');
  }
  const [first, ...more] = rest;
  return remembered + suggestionHTML(first.sg, i, first.j) + (more.length ? `<details class="small"><summary>${more.length} more idea${more.length === 1 ? '' : 's'}</summary>${more.map(x => suggestionHTML(x.sg, i, x.j)).join('')}</details>` : '');
}
// The coach's notes ("prefers calm videos") are saved as soon as it says them; the agent can remove
// them in the coach's Notes tab.
async function rememberNotes(m) {
  // At most one per answer; anything else (or a failed save) stays a suggestion to tap.
  const sg = (m.suggestions || []).find(x => x.type === 'add_note' && !x.applied);
  if (!sg) return;
  try { await api('/api/coach/notes', { method: 'POST', body: { text: sg.text } }); sg.applied = true; sg.auto = true; } catch { return; }
  S.coach.notes = null; saveCoachMsgs(); drawCoach();
}
const lines = scenes => `<ol class="script small">${scenes.map(x => `<li>${esc(x.say || x.text)}</li>`).join('')}</ol>`;
function suggestionHTML(sg, i, j) {
  const t = sg.trial;
  const verdict = t?.verdict ? `<p class="small"><b>${t.verdict.better === 'B' ? 'The change reads stronger.' : t.verdict.better === 'A' ? 'Your current setup reads stronger here.' : 'About the same.'}</b> ${esc(t.verdict.why)}</p>${t.verdict.lesson ? `<p class="small muted">Takeaway: ${esc(t.verdict.lesson)}</p>` : ''}` : '';
  return `<div class="sg"><b class="small">${esc(sg.label)}</b><div class="small">${describe(sg, i, j)}</div>${sg.why ? `<div class="small muted">${esc(sg.why)}</div>` : ''}
    ${t ? `<div class="trial"><p class="small muted">Same video idea (${esc(t.after.format)} · ${esc(t.after.topic)}), written both ways:</p><div class="trial-cols"><div><b class="small">Now</b>${lines(t.before.scenes)}</div><div><b class="small">With this change</b>${lines(t.after.scenes)}</div></div>${verdict}</div>` : ''}
    ${sg.tryError ? `<p class="small err-text">${esc(sg.tryError)}</p>` : ''}
    <div class="row">${!can('settings') && !['add_note', 'fix_scene', 'use_fact'].includes(sg.type) && !String(sg.type).startsWith('studio') ? (can('requests') ? `<button class="btn sm${sg.applied ? '' : ' primary'}" data-act="coach-ask-team" data-m="${i}" data-j="${j}" ${sg.applied ? 'disabled' : ''}>${sg.applied ? 'Sent to your team ✓' : 'Ask my team for this'}</button>` : '<span class="small muted">The agent can apply this.</span>') : `<button class="btn sm${sg.applied ? '' : ' primary'}" data-act="coach-apply" data-m="${i}" data-j="${j}" ${sg.applied ? 'disabled' : ''}>${sg.applied ? (sg.type === 'studio_scene' ? 'Used ✓' : 'Applied ✓') : sg.type === 'add_note' ? 'Remember this' : sg.type === 'studio_draft' ? 'Use all' : sg.type === 'studio_scene' ? 'Use' : 'Apply'}</button>`}
      ${sg.tryable && !sg.applied && !t ? `<button class="btn sm" data-act="coach-try" data-m="${i}" data-j="${j}" ${sg.trying ? 'disabled' : ''}>${sg.trying ? '<span class="spin"></span> Writing both…' : 'Try it first'}</button>` : ''}</div></div>`;
}
function coachReplyHTML() {
  const r = S.coach.reply;
  // Their why first (Grow → Mindset → My why, if they asked to see it before replies).
  const why = S.cfg?.mindset?.why;
  return `<div class="coach-msgs">${why?.show === 'on' && why.why ? `<div class="note small"><b>Your why:</b> ${esc(why.why)}</div>` : ''}<form class="stack" data-form="coach-reply">
      <p class="small muted" style="margin:0">Paste a comment or DM from one of your videos. The coach reads their communication style and writes three replies to fit it. Replies never include prices, promises or health questions, and move real interest toward a call.</p>
      <label class="field"><span>What they wrote</span><textarea class="ctl pii" name="message" rows="4" maxlength="1200" placeholder="e.g. How much would this cost for my mom? She's 72." required>${esc(r.message)}</textarea></label>
      <label class="field"><span>Anything you know about them? <small>(optional)</small></span><input class="ctl pii" name="note" maxlength="300" value="${esc(r.note)}" placeholder="e.g. she follows me and has commented before"></label>
      ${(S.cfg?.story.audiences || []).length ? `<label class="field"><span>Which audience are they? <small>(optional)</small></span><select class="ctl" name="audienceId"><option value="">Not sure</option>${S.cfg.story.audiences.map(a => `<option value="${a.id}"${r.audienceId === a.id ? ' selected' : ''}>${esc(short(a.text))}</option>`).join('')}</select><small>Picking one teaches the app how that audience really writes, so its communication style can be checked against real messages.</small></label>` : ''}
      <div class="row"><button class="btn primary" ${r.busy ? 'disabled' : ''}>${r.busy ? '<span class="spin"></span> Writing…' : 'Draft replies'}</button></div>
      ${r.error && !r.busy ? `<p class="small err-text" style="margin:0">${esc(r.error)} Your message is still here; try again.</p>` : ''}</form>
    ${r.out ? `<div class="stack">${r.out.style && STYLES[r.out.style] ? `<p class="small" style="margin:0">${styleBadge(r.out.style)} Reads as <b>${esc(STYLES[r.out.style].name)}</b>${r.out.read ? `: ${esc(r.out.read.replace(/[.!\s]+$/, ''))}` : ''}. ${esc(STYLES[r.out.style].talk)}</p>` : ''}${r.out.replies.length ? r.out.replies.map((x, k) => `<div class="sg"><b class="small">${esc(x.label)}</b><p class="small pii" style="margin:0;white-space:pre-wrap">${esc(x.text)}</p><div class="row"><button class="btn sm" data-act="coach-copy" data-k="${k}">Copy</button></div></div>`).join('') : '<p class="empty">No reply passed the checks. Try adding a little context.</p>'}
      ${r.out.tip ? `<p class="small muted">Tip: ${esc(r.out.tip)}</p>` : ''}<p class="small muted">Read each reply before sending. You’re the licensed agent.</p></div>` : ''}</div>`;
}
async function loadCoachNotes() { try { S.coach.notes = (await api('/api/coach/notes')).notes; S.coach.notesFailed = false; } catch { S.coach.notes = []; S.coach.notesFailed = true; } if (S.coach.tab === 'notes') drawCoach(); }
function coachNotesHTML() {
  const n = S.coach.notes;
  if (!n) return '<div class="coach-msgs"><p class="small muted"><span class="spin"></span> Getting what the coach remembers…</p></div>';
  if (S.coach.notesFailed) return '<div class="coach-msgs"><p class="small muted">Couldn’t load the coach’s notes. <button class="btn sm ghost" data-act="coach-notes-retry">Try again</button></p></div>';
  const own = n.filter(x => x.kind !== 'applied'), applied = n.filter(x => x.kind === 'applied');
  const li = x => `<li class="row between"><span>${esc(x.text)}</span><button class="x" data-act="note-del" data-id="${x.id}" aria-label="Forget this">×</button></li>`;
  return `<div class="coach-msgs"><p class="small muted" style="margin:0">What the coach remembers about how you work. It reads these before every answer and check-in.</p>
    <ul class="notes">${own.map(li).join('') || '<li class="muted small">Nothing yet. Tell the coach your preferences, or add one here.</li>'}</ul>
    <form class="add" data-form="coach-note"><input class="ctl" name="text" maxlength="200" placeholder="e.g. My clients are mostly grandparents" autocomplete="off" aria-label="New note"><button class="btn">Add</button></form>
    ${applied.length ? `<h3 class="small">Changes you applied</h3><ul class="notes small muted">${applied.map(li).join('')}</ul>` : ''}</div>`;
}

function redraw() {
  const d = { mindset: drawMindset, content: drawContent, communicate: drawCommunicate, brand: drawBrand, settings: drawSettings, create: drawCreate, review: drawReview, today: drawReview, grow: drawReview, studio: () => S.st && drawStudio(), profile: drawBrand, library: drawBrand, voice: drawBrand, look: drawBrand, autopilot: drawBrand };
  d[S.view]?.();
}
async function makeVideos(n, painId = '', format = '') {
  const st = main.querySelector('[data-st="make"]');
  if (dirty() && can('settings')) { try { await saveCfg(); } catch (e) { return toast(e.message); } }
  try {
    const r = await api('/api/jobs', { method: 'POST', body: { count: n, painId, format } });
    toast(r.jobs.length > 1 ? `${r.jobs.length} videos are in line` : 'Your video is in line');
    watchJobs();
    if (S.view !== 'create') return go('create');
    await loadOverview(); drawCreate();
  } catch (e) { if (st) status(st, e.message, 'err'); else toast(e.message); }
}

export { applyStudio, applySuggestion, describe, drawCoach, lines, loadCoachNotes, makeVideos, openCoach, redraw, saveCoachMsgs, sendCoach, setCoachMode };

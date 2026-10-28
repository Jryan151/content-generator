// public/screens/settings.js — Settings.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { FOOTAGE_MIX, FORMATS, GOV_TERMS, S, SHOT_TYPES, STRUCTURES, api, app, beatPlan, can, cityOf, copy, day, esc, estimateSeconds, loadCfg, loadToday, main, nicheOf, plural, roll, short, toast, when } from '../app.js';
import { statesList, zoneOptions } from './setup.js';
import { onOff, seg } from './brand.js';
import { describe } from './coach.js';
import { drawStep, stepView } from './steps.js';

/* ================= Settings ================= */
async function viewSettings() { await Promise.all([loadCfg(), loadMemory(), loadAway()]); if (!S.picks) S.picks = roll(S.cfg); drawSettings(); }
// Away mode (v15 Phase 8): the agent's own.
async function loadAway() { if (!can('approve')) { S.awayState = null; return; } try { const r = await api('/api/away'); S.awayState = { ...(S.awayState || {}), away: r.away }; } catch { S.awayState = null; } }
const dayName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const plusDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const COVER_HOW = { plan: 'your posting plan posts it', scheduled: 'scheduled', 'will-schedule': 'gets scheduled' };
function awayPanel() {
  const A = S.awayState;
  if (!A) return '';
  const a = A.away && !A.away.endedAt ? A.away : null;
  const today = S.today?.date || new Date().toISOString().slice(0, 10);
  if (a && a.until >= today) return `<section class="panel" id="awayPanel"><div class="head"><h2><span class="dot"></span>Away</h2></div>
    <div class="note">You’re away until ${esc(dayName(plusDays(a.until, 1)))}. Notifications, nudges and review emails are off${a.postingDays ? `, and ${a.covered} of ${plural(a.postingDays, 'posting day')} are covered` : ''}. <button class="btn sm" data-act="away-back">I’m back</button></div></section>`;
  const p = A.preview, back = A.back || plusDays(today, 7);
  const how = p ? ({ plan: 'Your posting plan posts these by itself.', schedule: `These get scheduled for ${esc(p.time)} on the days below.`, none: 'Nothing is connected to post from here: connect Instagram in Setup → Autopilot, or post these yourself when you’re back.' })[p.mode] : '';
  return `<section class="panel" id="awayPanel"><div class="head"><h2><span class="dot"></span>Going away?</h2><p>Away mode turns off notifications, nudges and review emails until you’re back. Your approved videos cover your posting days, your assistant is told, and a short welcome back is waiting when you return.</p></div>
    <div class="row" style="align-items:flex-end"><label class="field" style="flex:0 1 220px"><span>I’m back on</span><input class="ctl" type="date" data-away-back min="${plusDays(today, 1)}" max="${plusDays(today, 61)}" value="${esc(back)}"></label><button class="btn" data-act="away-preview">See what happens</button></div>
    ${p ? `${p.days.length ? `<ul class="list small">${p.days.map(d => `<li class="${d.video && d.how ? 'ok' : 'bad'}"><i>${d.video && d.how ? '✓' : '!'}</i><span><b>${esc(d.label)}</b> · ${d.video ? `“${esc(d.video.hook)}”${d.how ? `, ${COVER_HOW[d.how]}` : ' (nothing to post it from)'}` : 'nothing approved for this day'}</span></li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">No posting days fall while you’re away.</p>'}
      <p class="small" style="margin:0">${how}${p.empty ? ` ${plural(p.empty, 'day')} ${p.empty === 1 ? 'has' : 'have'} nothing approved: approve more before you go, or leave ${p.empty === 1 ? 'it' : 'them'} quiet.` : ''}</p>
      <div class="row"><button class="btn primary" data-act="away-start">Go away until ${esc(dayName(back))}</button></div>` : ''}</section>`;
}
// What the app has learned from rejections (Memory): shown so it can be undone, never needed to work.
async function loadMemory() { try { S.memory = await api('/api/memory'); } catch { S.memory = null; } }
function memoryInner() {
  const m = S.memory, none = !m || (!m.music && !m.openingsCount);
  return `<div class="head"><h2><span class="dot"></span>What the app remembers</h2><p>Learned from your approvals and rejections, so you don’t have to say it twice.</p></div>
    ${!m ? '<p class="small muted" style="margin:0">Couldn’t load this right now. <button class="btn sm ghost" data-act="memory-retry">Try again</button></p>' : `<ul class="list small">
      <li class="ok"><i>✓</i><span>Formats you approve come up more; ones you reject come up less.</span></li>
      ${m.music ? `<li class="ok"><i>✓</i><span>${plural(m.music, 'music track')} you turned down won’t be used. <button class="btn sm ghost" data-act="memory-forget" data-v="music">Forget</button></span></li>` : ''}
      ${m.openingsCount ? `<li class="ok"><i>✓</i><span>${plural(m.openingsCount, 'opening')} you rejected as weak ${m.openingsCount === 1 ? 'is' : 'are'} steered clear of, like “${esc(m.openings[0])}”. <button class="btn sm ghost" data-act="memory-forget" data-v="openings">Forget</button></span></li>` : ''}
    </ul>${none ? '<p class="small muted" style="margin:0">Reject a video for its music or its opening and it’s remembered here.</p>' : ''}`}`;
}
function drawMemory() { const box = document.getElementById('memPanel'); if (box) box.innerHTML = memoryInner(); }
// (v15 Phase 10) Each panel on its own, so Setup's steps can show the ones that belong together; the
// Settings page shows them all, as before.
function settingsParts() {
  const c = S.cfg, o = c.output, p = c.profile, g = c.guardrails, voice = o.mode === 'voiceover';
  const num = (k, label, step = 1) => `<div class="box" style="gap:6px"><span class="label">${label}</span><div class="row" style="flex-wrap:nowrap"><button class="btn sm" data-act="step" data-k="${k}" data-d="-${step}" aria-label="Less">−</button><b class="mono" style="flex:1;text-align:center;font-size:20px">${o[k]}</b><button class="btn sm" data-act="step" data-k="${k}" data-d="${step}" aria-label="More">+</button></div></div>`;
  const strings = (k, label, hint) => `<div class="field"><span>${label}</span><small>${hint}</small><div class="chips">${nicheOf(c).platformGuardrails[k].map(x => `<span class="chip locked" title="Platform rule"><span>🔒 ${esc(x)}</span></span>`).join('')}${g[k].map((x, i) => `<span class="chip"><span>${esc(x)}</span><button class="x" data-act="rule-del" data-k="${k}" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div>
    <form class="add" data-form="rule" data-k="${k}"><input class="ctl sm" name="rule" placeholder="Add your own" autocomplete="off" aria-label="Add to ${label}"><button class="btn sm">Add</button></form></div>`;
  return {
    video: () => `<section class="panel out"><div class="head"><h2><span class="dot"></span>Video</h2><p>About <b>${estimateSeconds(c)} seconds</b> long with these settings.</p></div>
      <div class="nums">${num('scenes', 'Scenes')}${num('maxWords', 'Words on screen')}${voice ? num('maxSpoken', 'Spoken words per scene') : num('pace', 'Reading speed (words/sec)', 0.1)}${num('minSeconds', 'Shortest scene (sec)')}${num('drafts', 'Drafts per video')}</div>
      <div class="field"><span>Scene plan</span><div class="chips">${beatPlan(o.scenes).map(b => `<span class="chip locked"><span><b>${b.beat}</b> ${b.scenes}</span></span>`).join('')}</div></div>
      <div class="field"><span>Formats</span><small>Proven short-video shapes, rotated so videos feel different. Formats that bring messages come up a little more often. ${cityOf(c) ? '' : '“Local” needs your city in Setup → Profile.'}</small>
        <div class="stack" style="gap:6px">${Object.entries(FORMATS).map(([k, f]) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><button class="toggle" style="--c:var(--out);flex:none;min-width:140px" data-act="format" data-v="${k}" aria-pressed="${o.formats.includes(k)}">${esc(f.label)}</button><span class="small muted">${esc(f.about)}</span></div>`).join('')}</div></div>
      <div class="field"><span>Structures</span><small>The order of the scenes after the opening, rotated so videos don’t all share one shape. The ending style (how the question and call to action are worded) rotates too. Classic is always on.</small>
        <div class="stack" style="gap:6px">${Object.entries(STRUCTURES).map(([k, x]) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><button class="toggle" style="--c:var(--out);flex:none;min-width:140px" data-act="structure" data-v="${k}" aria-pressed="${(o.structures || ['classic']).includes(k)}" ${k === 'classic' ? 'disabled' : ''}>${esc(x.label)}</button><span class="small muted">${esc(x.about)}${o.scenes < x.min ? ` <b>Needs ${x.min}+ scenes.</b>` : ''}</span></div>`).join('')}</div></div>
      <div class="fields"><div class="field"><span>AI clip check</span>${onOff('output.clipCheck', o.clipCheck)}<small>Looks at each clip before using it.</small></div>
        <div class="field"><span>Background music</span>${seg('output.music', [['off', 'None'], ['library', 'Music folder']], o.music)}<small>Trending sounds added in Instagram help reach.</small></div>
        <label class="field"><span>Reading level</span><select class="ctl" data-bind="output.readingLevel">${['3rd grade', '6th grade', '8th grade', 'Adult / professional'].map(x => `<option${x === o.readingLevel ? ' selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <div class="field"><span>Footage mix</span>${seg('output.footageMix', Object.entries(FOOTAGE_MIX).map(([k, x]) => [k, x.label]), o.footageMix || 'balanced')}<small>Each video plans a mix of shots: faces, close-ups, places, movement and light, never the same kind twice in a row. ${{ people: 'About 2 in 3 scenes show people.', balanced: 'About half the scenes show people.', scenery: 'About 1 in 3 scenes shows people.' }[o.footageMix || 'balanced']} The opening and the call to action always do.</small></div>
      <details><summary class="small">Kinds of shots (${(o.shotTypes || []).length} of ${Object.keys(SHOT_TYPES).length} on)</summary><div class="chips" style="margin-top:8px">${Object.entries(SHOT_TYPES).map(([k, x]) => `<button class="toggle" data-act="shot-type" data-v="${k}" aria-pressed="${(o.shotTypes || []).includes(k)}" ${k === 'people' ? 'disabled' : ''} title="${esc(x.about)}">${esc(x.label)}</button>`).join('')}</div><small class="muted">People shots always stay on. Footage searches you type yourself (Studio, Fix a scene) can be anything.</small></details></section>`,
    profile: () => `<section class="panel"><div class="head"><h2><span class="dot"></span>Profile</h2><p>Helps the AI write for your clients. Not shown on screen.</p></div>
      <div class="field"><span>States you’re licensed in</span><div class="chips">${p.states.map((s, i) => `<span class="chip"><span>${esc(s)}</span><button class="x" data-act="pstate-del" data-i="${i}" aria-label="Remove">×</button></span>`).join('') || '<span class="empty">None.</span>'}</div><form class="add" data-form="pstate"><input class="ctl sm" name="state" list="stateList" placeholder="Add a state" autocomplete="off"><button class="btn sm">Add</button></form>${statesList}</div>
      <div class="field"><span>Days off</span><div class="chips">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, k) => `<button class="toggle" data-act="day-off" data-v="${k}" aria-pressed="${(p.daysOff || []).includes(k)}">${d}</button>`).join('')}</div><small>No notifications, nudges or review emails on these days, and habit streaks don’t break. Your posting plan still posts what you approved.</small></div>
      <div class="fields"><label class="field"><span>Time zone</span><select class="ctl" data-bind="profile.timezone">${zoneOptions(p.timezone)}</select></label>
        <label class="field"><span>How you describe yourself</span><input class="ctl" data-bind="profile.about" value="${esc(p.about)}" maxlength="160"></label></div>
      <label class="field"><span>Your clients</span><textarea class="ctl" data-bind="profile.clients" maxlength="200">${esc(p.clients)}</textarea></label></section>`,
    rules: () => `<section class="panel rules"><div class="head"><h2><span class="dot"></span>Rules</h2><p>🔒 Platform rules apply to every agent and can’t be removed. Phrase rules are checked in code on every script and post; the others guide the AI. Words that suggest a government connection (${GOV_TERMS.map(t => t[1]).slice(0, 5).join(', ')}…) are always blocked.</p></div>
      ${strings('mustUse', 'Always include', 'Checked in code. Phrases on your end card count.')}${strings('neverUse', 'Never use', 'Checked in code.')}${strings('mustDo', 'Always do', 'Guides the AI.')}${strings('neverDo', 'Never do', 'Guides the AI.')}</section>`,
    memory: () => `<section class="panel" id="memPanel">${memoryInner()}</section>`,
    versions: () => `<section class="panel"><div class="head"><h2><span class="dot"></span>Saved versions</h2><p>Every save keeps a copy. Load one, look it over, then save to use it.</p></div>
      ${S.versions.length ? `<div class="row"><select class="ctl" id="versionSel" style="flex:1 1 240px">${S.versions.map(x => `<option value="${esc(x.name)}">${esc(when(x.savedAt))}</option>`).join('')}</select><button class="btn" data-act="load-version">Load</button></div>` : '<p class="empty">No saved versions yet.</p>'}</section>`,
    recipe: () => `<section class="panel"><details${S.promptOpen ? ' open' : ''}><summary>What goes into a video</summary><div class="stack">${recipeHTML(c, S.picks)}</div></details></section>`,
  };
}
function drawSettings() {
  if (stepView()) return drawStep();   // (v15 Phase 10) on a Setup step, that step is redrawn
  const P = settingsParts();
  main.innerHTML = `<div class="head"><h1>Settings</h1><p class="lede">Timing, formats, your rules and your profile.</p></div>
    ${awayPanel()}
    ${P.video()}
    ${P.profile()}
    ${P.rules()}
    ${P.memory()}
    ${P.versions()}
    ${P.recipe()}`;
}
// One example video's ingredients: what the AI is given (not how it's asked). Admins can see the full prompt.
function recipeHTML(c, p) {
  const admin = S.me.account.role === 'admin';
  const facts = (p.insights?.length ? p.insights : [p.insight]).filter(Boolean), sols = (p.solutions?.length ? p.solutions : [p.solution]).filter(Boolean);
  const row = (k, v) => (v ? `<div class="row between small" style="flex-wrap:nowrap;align-items:flex-start;gap:12px"><span class="muted" style="flex:none;width:110px">${k}</span><span style="flex:1">${v}</span></div>` : '');
  return `<div class="row"><button class="btn sm" data-act="reroll">Pick another topic</button>${admin ? '<button class="btn sm" data-act="show-prompt">Show the full prompt</button><button class="btn sm" data-act="ask-coach-prompt">Explain this prompt</button>' : ''}</div>
    ${p.insight ? `<div class="stack" style="gap:6px">${row('Audience', esc(p.audience?.text))}${row('Their worry', esc(p.painPoint?.text))}${facts.map((f, i) => row(facts.length > 1 ? `Fact ${i + 1}` : 'Fact', esc(f.text))).join('')}${sols.map(x => row('Solution', esc(x.plain || x.text))).join('')}${row('Format', esc(FORMATS[p.format]?.label))}${row('Open question', esc(p.question))}${p.story ? row('Your story', esc(p.story.text)) : ''}${p.askQuestion ? row('Question you hear', esc(p.askQuestion.text)) : ''}${row('Scene plan', beatPlan(c.output.scenes, p.format, facts.length, p.structure).map(b => `<b>${esc(b.beat)}</b> ${esc(b.scenes)}`).join(' · '))}</div>` : `<p class="empty">${esc(p.breaks?.[0] || 'No confirmed route yet.')} <a href="#/content" data-act="goto-tab" data-v="routes">See your routes in Setup → Library</a></p>`}
    <p class="small muted" style="margin:0">The AI also gets your voice settings, your writing samples, recent videos (so new ones don’t repeat) and every rule above. Each script is then checked in code against the platform rules and yours before you see it.</p>
    ${admin ? `<div id="promptOut">${S.promptPreview && S.promptPreviewFor === JSON.stringify(S.cfg) ? promptHTML(S.promptPreview) : ''}</div>` : ''}`;
}
const promptHTML = b => `<pre class="preview"><b>SYSTEM</b>\n${esc(b.system)}\n\n<b>USER</b>\n${b.sections.map(sec => `[${esc(sec.title)}]\n` + sec.lines.map(l => l.map(x => (typeof x === 'string' ? esc(x) : `<mark>${esc(x.pick)}</mark>`)).join('')).join('\n')).join('\n\n')}</pre>`;
const promptText = b => `${b.system}\n\n${b.sections.map(sec => `[${sec.title}]\n` + sec.lines.map(l => l.map(x => (typeof x === 'string' ? x : x.pick)).join('')).join('\n')).join('\n\n')}`;
async function loadPromptPreview() {
  const { recent, ...picks } = S.picks || {};
  S.promptPreview = await api('/api/prompt-preview', { method: 'POST', body: { config: S.cfg, picks } });
  S.promptPreviewFor = JSON.stringify(S.cfg);
  return S.promptPreview;
}

export { awayPanel, drawMemory, drawSettings, loadAway, loadMemory, loadPromptPreview, promptHTML, promptText, settingsParts, viewSettings };
// Away mode's actions, registered by app.js (screens can't use app.js exports at load time).
export const awayActions = {
  async 'away-preview'(el) {
    const back = document.querySelector('[data-away-back]')?.value || '';
    el.disabled = true;
    try { const r = await api(`/api/away?back=${encodeURIComponent(back)}`); S.awayState = { ...(S.awayState || {}), back, preview: r.preview, away: r.away }; drawSettings(); document.getElementById('awayPanel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    catch (e) { el.disabled = false; toast(e.message); }
  },
  async 'away-start'(el) {
    const back = S.awayState?.back;
    el.disabled = true;
    try {
      const r = await api('/api/away', { method: 'POST', body: { back } });
      S.awayState = { away: r.away };
      await loadToday(true); drawSettings();
      toast(`You’re away until ${dayName(back)}. Enjoy it.`);
    } catch (e) { el.disabled = false; toast(e.message); }
  },
};

// public/screens/setup.js — Setup wizard.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { DEFAULT_CONFIG, LEVELS, S, VOICES, api, can, checkInsightText, copy, esc, later, main, short, status } from '../app.js';
import { termsLinks } from './account.js';
import { seg } from './brand.js';
import { describe } from './coach.js';

/* ================= Setup wizard ================= */
const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
const ZONES = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']];
const zoneOptions = sel => {
  const list = ZONES.some(z => z[0] === sel) || !sel ? ZONES : [[sel, sel], ...ZONES];
  return list.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}${l !== v ? ` (${v})` : ''}</option>`).join('');
};
const statesList = `<datalist id="stateList">${STATES.map(s => `<option value="${s}">`).join('')}</datalist>`;

async function viewSetup() {
  if (!S.setup) {
    const r = await api('/api/setup');
    const a = r.answers;
    if (!a.timezone || a.timezone === 'America/Denver') a.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
    if (!a.products.length) a.products = ['final_expense'];
    S.setup = { step: 1, answers: a, hasContent: r.hasContent, keepContent: r.hasContent, draft: null, note: '', accept: false, acceptTerms: false };
  }
  drawSetup();
}
function drawSetup() {
  const st = S.setup, a = st.answers;
  const steps = `<div class="steps" aria-label="Step ${st.step} of 4">${[1, 2, 3, 4].map(n => `<i class="${n <= st.step ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = (back, nextLabel, act = 'setup-next') => `<div class="row between">${back ? '<button class="btn ghost" data-act="setup-back">Back</button>' : '<span></span>'}<button class="btn primary big" data-act="${act}">${nextLabel}</button></div><div class="status" data-st></div>`;
  let body = '';
  if (st.step === 1) body = `<div class="head"><span class="label">Step 1 of 4</span><h1>About you</h1><p class="lede">This goes on your end card and helps the AI write in your voice.</p></div>
    <section class="panel"><div class="fields">
      <label class="field"><span>Your name *</span><input class="ctl" data-ans="name" value="${esc(a.name)}" autocomplete="name" placeholder="Jane Smith"></label>
      <label class="field"><span>Title</span><input class="ctl" data-ans="title" value="${esc(a.title)}" placeholder="Licensed Agent"></label>
      <label class="field"><span>City</span><input class="ctl" data-ans="location" value="${esc(a.location)}" placeholder="Gallup, NM"><small>Used for “Here in…” videos.</small></label>
      <label class="field"><span>Instagram handle</span><input class="ctl" data-ans="handle" value="${esc(a.handle)}" placeholder="@yourhandle"></label>
      <label class="field"><span>Time zone</span><select class="ctl" data-ans="timezone">${zoneOptions(a.timezone)}</select></label>
    </div>
    <div class="field"><span>States you’re licensed in</span><div class="chips">${a.states.map((s, i) => `<span class="chip"><span>${esc(s)}</span><button class="x" data-act="state-del" data-i="${i}" aria-label="Remove ${esc(s)}">×</button></span>`).join('') || '<span class="empty">None added yet.</span>'}</div>
      <form class="add" data-form="state"><input class="ctl" name="state" list="stateList" placeholder="Add a state" autocomplete="off"><button class="btn">Add</button></form>${statesList}</div>
    <label class="field"><span>How do you describe yourself? <small>(optional)</small></span><input class="ctl" data-ans="about" value="${esc(a.about)}" maxlength="160" placeholder="e.g. a mom running my own business"><small>A few words in your own voice. Scripts sound more like you.</small></label>
    </section>${nav(false, 'Next')}`;
  if (st.step === 2) body = `<div class="head"><span class="label">Step 2 of 4</span><h1>Who you help</h1><p class="lede">Your starter topics are vetted final expense topics, worded for your clients.</p></div>
    <section class="panel">
      <label class="field"><span>Who are your clients?</span><textarea class="ctl" data-ans="clients" maxlength="200" placeholder="e.g. older adults on fixed incomes, mostly retired, many helping raise grandkids">${esc(a.clients)}</textarea><small>Used to word your topics’ worries. Never shown on screen.</small></label>
      ${st.hasContent ? `<div class="field"><span>Your current content</span><div class="seg"><button data-act="keep" data-v="1" aria-pressed="${st.keepContent}">Keep it</button><button data-act="keep" data-v="0" aria-pressed="${!st.keepContent}">Start from the templates</button></div><small>${st.keepContent ? 'Your topics stay. You’ll check each one next.' : 'Replaces your current content with fresh starter content.'}</small></div>` : ''}
    </section>${nav(true, 'Next')}`;
  if (st.step === 3) {
    const spec = (k, lv) => DEFAULT_CONFIG.specs[k][lv];
    body = `<div class="head"><span class="label">Step 3 of 4</span><h1>How you sound</h1><p class="lede">You can change all of this later in Setup.</p></div>
    <section class="panel voice">
      <div class="field"><span>Video type</span><div class="seg"><button data-act="ans" data-k="mode" data-v="captions" aria-pressed="${a.mode === 'captions'}">Captions only</button><button data-act="ans" data-k="mode" data-v="voiceover" aria-pressed="${a.mode === 'voiceover'}">Voiceover + captions</button></div>
        <small>${a.mode === 'voiceover' ? 'A stock AI voice reads each scene. You can add your own voice later.' : 'Captions carry the message. Add a trending sound in Instagram.'}</small></div>
      ${a.mode === 'voiceover' ? `<label class="field"><span>Voice</span><select class="ctl" data-ans="ttsVoice">${VOICES.map(v => `<option${v === a.ttsVoice ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      ${['energy', 'tone'].map(k => `<div class="field"><span>${k === 'energy' ? 'Energy' : 'Tone'}</span><div class="seg">${LEVELS.map(l => `<button data-act="ans" data-k="${k}" data-v="${l}" aria-pressed="${a[k] === l}">${esc(spec(k, l).label)}</button>`).join('')}</div>
        <div class="spec"><span class="muted">${esc(spec(k, a[k]).rules)}</span><q>${esc(spec(k, a[k]).example)}</q></div></div>`).join('')}
      <label class="field"><span>Call to action</span><input class="ctl" data-ans="ctaAction" value="${esc(a.ctaAction)}" maxlength="60" placeholder="Message me"><small>The last scene of every video. Keep it short.</small></label>
      <div class="chips">${['Message me', 'Call me', 'Send me a message'].map(c => `<button class="toggle" data-act="ans" data-k="ctaAction" data-v="${c}" aria-pressed="${a.ctaAction === c}">${c}</button>`).join('')}</div>
      <label class="field"><span>Something you wrote <small>(optional, but it helps a lot)</small></span><textarea class="ctl" data-ans="sample" rows="3" maxlength="800" placeholder="Paste a caption, post or text you wrote yourself">${esc(a.sample || '')}</textarea><small>Scripts copy your word choice and rhythm. You can add more later in Setup → Voice and rules.</small></label>
    </section>${nav(true, st.keepContent && st.hasContent ? 'Next: check your topics' : 'Draft my content', 'setup-draft')}`;
  }
  if (st.step === 4) body = setupFactsHTML() + nav(true, 'Finish setup', 'setup-finish');
  main.innerHTML = `<div class="stack" style="gap:18px">${steps}${body}</div>`;
}
function setupFactsHTML() {
  const st = S.setup, topics = st.draft.topics;
  const n = topics.filter(t => t.confirmed && t.fact).length;
  return `<div class="head"><span class="label">Step 4 of 4</span><h1>Check your topics</h1>
    <p class="lede">Each topic is one video: a worry your clients have and the fact that answers it. Videos only teach facts you tick. Tick one only if it’s true for what you sell in your state. You can edit the wording; it’s checked against the same rules.</p></div>
    ${st.note ? `<div class="note warn">${esc(st.note)}</div>` : ''}
    <section class="panel story"><div class="stack">${topics.map(setupFact).join('')}</div></section>
    <section class="panel"><div class="row between"><b>${n} of ${topics.length} checked</b>${n < 4 ? '<span class="small muted">Check at least 4 for variety. 1 is the minimum.</span>' : ''}</div>
      <label class="check"><input type="checkbox" data-act="accept" ${st.accept ? 'checked' : ''}> <span>I’ve read each fact I ticked. I’ll watch every video before posting it, and I’m responsible for following my state’s and my carriers’ advertising rules.</span></label>
      ${S.me.termsRequired ? `<label class="check"><input type="checkbox" data-act="accept-terms" ${st.acceptTerms ? 'checked' : ''}> <span>I’ve read and accept the ${termsLinks()}.</span></label>` : ''}</section>`;
}
function setupFact(t) {
  const problems = checkInsightText(t.fact);
  return `<div class="item fact${t.confirmed ? ' confirmed' : ''}" data-fact="${t.id}">
    <div class="row">${t.ai ? '<span class="pill ai">AI suggestion · check carefully</span>' : '<span class="pill">Starter topic</span>'}</div>
    ${t.worry ? `<b class="small">“${esc(t.worry)}”</b>` : ''}
    <textarea class="ctl" data-fact-text="${t.id}" rows="3" aria-label="Fact">${esc(t.fact)}</textarea>
    <ul class="problems" data-problems="${t.id}">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    <label class="check"><input type="checkbox" data-fact-ok="${t.id}" ${t.confirmed ? 'checked' : ''} ${problems.length ? 'disabled' : ''}> <span>True for what I sell</span></label>
  </div>`;
}

export { drawSetup, statesList, viewSetup, zoneOptions };

// public/screens/steps.js — Setup (v15 Phase 10): everything an agent sets once and tunes now and then,
// as one guided path in the order a video is built: who you are (Profile), what you teach (Library),
// how it sounds and what it never says (Voice and rules), how it looks (Look), what runs by itself
// (Autopilot), and who helps (Team). Each step shows the same panels the Content, Brand and Settings
// pages always had (those pages still open from older links), so every control works exactly as before.
import { S, can, canSee, esc, loadCfg, main, roll } from '../app.js';
import { captionsPanel, endCardPanel, fbPanel, igPanel, libraryPanel, loadBookHook, loadLibrary, loadLogoColors, planPanel, socialReturn, videoPagesPanel, voicePanel } from './brand.js';
import { awayPanel, loadAway, loadMemory, settingsParts } from './settings.js';
import { CONTENT_TABS, contentParts } from './content.js';
import { loadIg } from './review.js';

// The steps, in order: [view, label, what it's for, can this person see it?]
const STEPS = [
  ['profile', 'Profile', 'Who you are: your name and end card, your photo and booking link, and who you serve.', () => can('settings')],
  ['library', 'Library', 'What you teach: audiences, worries, confirmed facts, solutions and your call to action, and your own clips.', () => can('settings')],
  ['voice', 'Voice and rules', 'How you sound, your own words and stories, and what a video must always or never say.', () => can('settings')],
  ['look', 'Look', 'How a video looks and is built: captions, colors, footage, length and formats.', () => can('settings')],
  ['autopilot', 'Autopilot', 'What runs by itself: Instagram and Facebook, the posting plan, and time away.', () => can('settings') || can('connect')],
  ['team', 'Team', 'Who helps: assistants and a compliance reviewer, or your done-for-you team.', () => can('people') || can('requests')],
];
const STEP_OF = Object.fromEntries(STEPS.map((x, i) => [x[0], i]));
const stepsFor = () => STEPS.filter(x => x[3]());
// Is the page open one of Setup's steps (not counting Team, which draws itself)?
const stepView = () => Object.hasOwn(STEP_OF, S.view) && S.view !== 'team';
const canSetup = () => stepsFor().length > 0;
const firstStep = () => stepsFor()[0]?.[0] || '';

// The path across the top, and the way on at the bottom.
function stepHead(view) {
  const list = stepsFor(), i = list.findIndex(x => x[0] === view), cur = list[i];
  if (!cur) return '';
  return `<div class="head"><h1>Setup</h1><p class="lede">${esc(cur[2])}</p></div>
    <nav class="steps" aria-label="Setup steps">${list.map((x, k) => `<a href="#/${x[0]}"${x[0] === view ? ' aria-current="step"' : ''}><b>${k + 1}</b> ${esc(x[1])}</a>`).join('')}</nav>`;
}
function stepFoot(view) {
  const list = stepsFor(), i = list.findIndex(x => x[0] === view), next = list[i + 1];
  return next ? `<div class="row step-next"><a class="btn" href="#/${next[0]}">Next: ${esc(next[1])} →</a></div>` : '';
}

// What each step loads before it's drawn.
async function viewStep({ arg, q } = {}) {
  const v = S.view;
  const loads = [loadCfg()];
  if (v === 'profile') loads.push(loadBookHook());
  if (v === 'library') loads.push(loadLibrary());
  if (v === 'voice') loads.push(loadMemory());
  if (v === 'look') loads.push(loadLogoColors());
  if (v === 'autopilot') loads.push(loadIg(), loadAway());
  await Promise.all(loads);
  if (v === 'look' && !S.picks) S.picks = roll(S.cfg);
  if (v === 'library' && arg) S.contentTab = arg;
  if (v === 'autopilot') socialReturn(q, 'autopilot');
  drawStep();
}
// Library's tabs: everything Content had, except "Your voice" (it's in Voice and rules). (Asked for
// when drawn: the screens load each other, so nothing of another screen is used while loading.)
const libraryTabs = () => CONTENT_TABS.filter(([k]) => k !== 'voice');
const PARTS = {
  profile: () => `${endCardPanel()}${videoPagesPanel()}${settingsParts().profile()}`,
  library: () => { const P = contentParts(libraryTabs()); return `${P.checks}${P.tabs}${P.sections[P.tab]()}${libraryPanel(S.cfg)}`; },
  voice: () => { const P = contentParts(); return `${voicePanel(S.cfg, { never: false })}${P.sections.voice()}${settingsParts().rules()}${settingsParts().memory()}`; },
  look: () => { const P = settingsParts(); return `${captionsPanel()}${P.video()}${P.versions()}${P.recipe()}`; },
  autopilot: () => `${can('connect') ? igPanel() + fbPanel() : ''}${can('settings') ? planPanel() : ''}${can('approve') ? awayPanel() : ''}
    <section class="panel"><div class="head"><h2>Also running by itself</h2></div><ul class="list small">
      <li><i>·</i><span><b>Overnight videos</b> and the Monday plan: <a href="#/create">Create</a>.</span></li>
      <li><i>·</i><span><b>Keyword replies</b> on Instagram: <a href="#/leads">Leads</a>.</span></li>
      ${canSee('profile') ? '<li><i>·</i><span><b>Booking confirmations</b>, so each booking traces back to its video: <a href="#/profile">Profile → Your video pages</a>.</span></li>' : ''}</ul></section>`,
};
function drawStep() {
  const v = S.view;
  if (!PARTS[v]) return;
  main.innerHTML = `${stepHead(v)}${PARTS[v]()}${stepFoot(v)}`;
}

export { STEPS, canSetup, drawStep, firstStep, stepFoot, stepHead, stepView, viewStep };

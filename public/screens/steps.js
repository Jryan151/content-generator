// public/screens/steps.js — Setup (v15 Phase 10): everything an agent sets once and tunes now and then,
// as one guided path in the order a video is built: who you are (Profile), what you teach (Topics),
// how it sounds and what it never says (Voice and rules), how it looks (Look), what runs by itself
// (Autopilot), and who signs off (Reviewer). Each step shows the same panels the Content, Brand and Settings
// pages always had (those pages still open from older links), so every control works exactly as before.
import { S, can, esc, loadCfg, main, roll } from '../app.js';
import { captionsPanel, endCardPanel, fbPanel, igPanel, libraryPanel, loadLibrary, loadLogoColors, planPanel, socialReturn, voicePanel } from './brand.js';
import { loadReplies, repliesPanel } from './replies.js';
import { loadMemory, settingsParts } from './settings.js';
import { CONTENT_TABS, contentParts } from './content.js';
import { loadIg } from './review.js';

// The steps, in order: [view, label, what it's for, can this person see it?]
const STEPS = [
  ['profile', 'Profile', 'Who you are: your name, end card and booking link, and who you serve.', () => can('settings')],
  ['library', 'Topics', 'What you teach: your topics (a worry, its fact and your question), your clients, the call to action, and your own clips.', () => can('settings')],
  ['voice', 'Voice and rules', 'How you sound, your own words and stories, and what a video must always or never say.', () => can('settings')],
  ['look', 'Look', 'How a video looks and is built: captions, colors, footage, length and formats.', () => can('settings')],
  ['autopilot', 'Autopilot', 'What runs by itself: Instagram and its keyword replies, Facebook, and the posting plan.', () => can('settings') || can('connect')],
  ['team', 'People', 'Your assistant, who makes the content, and a compliance reviewer, if your carrier asks for one.', () => can('people')],
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
  if (v === 'library') loads.push(loadLibrary());
  if (v === 'voice') loads.push(loadMemory());
  if (v === 'look') loads.push(loadLogoColors());
  if (v === 'autopilot') loads.push(loadIg(), loadReplies());
  await Promise.all(loads);
  if (v === 'look' && !S.picks) S.picks = roll(S.cfg);
  if (v === 'library' && arg) S.contentTab = arg;
  if (v === 'autopilot') socialReturn(q, 'autopilot');
  drawStep();
}
// The Topics step's tabs: everything Content has, except "Your voice" (it's in Voice and rules). (Asked for
// when drawn: the screens load each other, so nothing of another screen is used while loading.)
const libraryTabs = () => CONTENT_TABS.filter(([k]) => k !== 'voice');
const PARTS = {
  profile: () => `${endCardPanel()}${settingsParts().profile()}`,
  library: () => { const P = contentParts(libraryTabs()); return `${P.checks}${P.tabs}${P.sections[P.tab]()}${libraryPanel(S.cfg)}`; },
  voice: () => { const P = contentParts(); return `${voicePanel(S.cfg, { never: false })}${P.sections.voice()}${settingsParts().rules()}${settingsParts().memory()}`; },
  look: () => { const P = settingsParts(); return `${captionsPanel()}${P.video()}${P.versions()}${P.recipe()}`; },
  autopilot: () => `${can('connect') ? igPanel() : ''}${repliesPanel()}${can('connect') ? fbPanel() : ''}${can('settings') ? planPanel() : ''}
    <section class="panel"><div class="head"><h2>Also running by itself</h2></div><ul class="list small">
      <li><i>·</i><span><b>Overnight videos</b> and the Monday plan: <a href="#/create">Create</a>.</span></li></ul></section>`,
};
function drawStep() {
  const v = S.view;
  if (!PARTS[v]) return;
  main.innerHTML = `${stepHead(v)}${PARTS[v]()}${stepFoot(v)}`;
}

export { STEPS, canSetup, drawStep, firstStep, stepFoot, stepHead, stepView, viewStep };

// mixer-core.js  (v13)
// The engine's rules and routing. The portal (browser) and the generator (server) both import
// this file, so the checks an agent sees are exactly the checks a script must pass. The prompts
// themselves are built in lib/prompts.js, which only the server loads (it's never sent to browsers).
//
// Foundation: one audience, one worry, one confirmed fact (insight), then an open question
// only the agent can answer, so the viewer reaches out to get it.
//
//   Audience → Pain point → Insight → Solution → Bridge (open question) → CTA
//
// Rules run in PRIORITY ORDER. When two conflict, the higher one wins:
//   1 Compliance  2 Accuracy  3 Structure  4 Persuasion  5 Style
// Platform rules (below) apply to every agent and can't be removed; agents can add their own.
// No browser-only or Node-only code in this file.
import { normStyle, styleLabel, styleRules, STYLES } from './comms-core.js';
import { NICHES, DEFAULT_NICHE, nicheOf } from './niches/index.js';
export { nicheOf, NICHES, DEFAULT_NICHE };

/* ---------------- Platform constants ---------------- */
export const CONFIG_VERSION = 13;
export const FACT_REVIEW_DAYS = 180;          // a confirmed fact must be re-confirmed after this
export const END_CARD_SECONDS = 2.5;

// Niche-specific content (products, the compliance floor, government-sounding words, eligibility
// promises, absolute claims…) lives in niches/<niche>.js. The checks below read the workspace's
// niche from cfg.niche. These exports are the default niche's, for code that has no config at hand.
const LI = NICHES[DEFAULT_NICHE];
export const PRODUCT_LINES = LI.productLines;
// Compliance floor for every agent. Agents can add rules; they can't remove these.
export const PLATFORM_GUARDRAILS = LI.platformGuardrails;
// Language that makes the product sound government-backed. Checked in code on every script and post.
export const GOV_TERMS = LI.govTerms;

/* ---------------- Base config (onboarding fills story and brand) ---------------- */
export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  niche: DEFAULT_NICHE,            // niches/<niche>.js: products, compliance floor, wording
  profile: {
    states: [],                    // where the agent is licensed, e.g. ['New Mexico']
    timezone: 'America/Denver',
    products: [],                  // PRODUCT_LINES ids
    about: '',                     // how they describe themselves, e.g. "a mom running my own business"
    clients: '',                   // who their clients usually are, e.g. "older adults on fixed incomes"
    daysOff: [],                   // weekdays off (0 = Sunday): no nudges, notifications or streak breaks
  },
  story: {
    // audiences: { id, text, visual, style }    visual = who appears in the footage; style = DISC lean, e.g. "SC"
    // painPoints: { id, text, links:[audience], question }   question = the curiosity gap
    // insights:  { id, text, links:[pain], confirmed, confirmedAt, source, ai }
    // solutions: { id, text, plain, links:[insight], mustMention }
    audiences: [], painPoints: [], insights: [], solutions: [],
    ctaAction: 'Message me',
    defaultQuestion: LI.defaults.defaultQuestion,
  },
  // The Mindset tab's parts that shape videos (the rest, like habits and notes, lives in lib/mindset.js).
  mindset: {
    why: { why: '', how: '', what: '', show: 'off' },        // Start With Why: shapes the tone of the bridge and CTA; one hook angle opens from it
    hedgehog: { love: '', best: '', pays: '', products: [], audiences: [] },   // Good to Great: their sweet spot comes up more often
    objections: [],          // The Art of War: { id, text, answer, links:[pain], topic } — topic: true = a "question I get asked" video topic
    persuasion: 'on',        // Influence: score which honest principles each script uses (badges in Review)
    giveAsk: 'on',           // The Infinite Game: lean toward teaching when recent videos asked a lot
  },
  // The agent's own material. Scripts use it so videos sound like them, not like AI.
  bank: {
    samples: [],     // things the agent wrote (captions, texts): the AI copies their word choice and rhythm
    stories: [],     // { id, text, confirmed, links:[pain] } true moments from the agent's life; only confirmed ones are used
    questions: [],   // { id, text, links:[pain] } real questions the agent hears
  },
  voice: {
    role: '',
    energy: 'low',
    tone: 'low',
    ttsVoice: 'coral',
    ttsStyle: LI.defaults.ttsStyle,
    aiNote: 'on',            // voiceover videos: add AI_VOICE_NOTE to the post text, so viewers know the voice is AI
    say: [],                 // pronunciations for the AI voice: [{ word: 'Gallup', say: 'GAL-up' }]
  },
  // Each level is a written spec plus an example. Examples set rhythm only, never topic.
  specs: {
    energy: {
      low:  { label: 'Calm', rules: 'Unhurried, complete sentences. Periods only, no exclamation marks.', example: 'Most of us put this off. I did too, for a long time.' },
      mid:  { label: 'Conversational', rules: 'Short, natural sentences spoken straight to "you", like talking across a table.', example: 'Here’s the part nobody tells you.' },
      high: { label: 'High', rules: 'Punchy lines, often 2-6 words. Fragments are fine. At most one exclamation mark in the whole script.', example: 'Same bills. Half the income.' },
    },
    tone: {
      low:  { label: 'Relatable', rules: 'Plain everyday words, like a neighbor who has been through it. Use the plain-language name for any product.', example: 'I didn’t understand this either until someone sat down with me.' },
      mid:  { label: 'Balanced', rules: 'Warm but credible. At most one industry term, explained in plain words.', example: 'It’s simpler than it sounds.' },
      high: { label: 'Authoritative', rules: 'Speak as the expert and state facts with confidence, but keep every qualifier from the insight.', example: 'Here is how this actually works.' },
    },
  },
  // The agent's own extra rules. Platform rules are always added on top (see guardrailsFor).
  guardrails: { mustUse: [], neverUse: [], mustDo: ['Speak in first person, as the agent'], neverDo: [] },
  look: {
    font: 'Poppins SemiBold',
    accent: 'on', motion: 'on', grade: 'on', endCard: 'on',
    captionStyle: 'line',    // 'line' (each caption fades in whole) | 'words' (words appear as they're read)
    accentColor: 'sand',     // ACCENT_COLORS key (or 'brand' for brandColor): the highlighted word and the end card's second line
    brandColor: '',          // a color from the agent's logo, '#RRGGBB'
    logo: 'off',             // 'on' shows the uploaded logo on the end card
    name: '', title: LI.defaults.title, location: '', endCta: 'Message me', handle: '', disclaimer: '', bookingUrl: '', landing: 'page',
  },
  output: {
    mode: 'captions',        // 'captions' | 'voiceover'
    scenes: 6,
    maxWords: 10,            // on-screen words per caption
    maxSpoken: 20,           // spoken words per scene (voiceover)
    pace: 2.2,               // reading speed, words per second (captions mode)
    minSeconds: 3,           // shortest a scene can be
    readingLevel: '6th grade',
    drafts: 2,               // drafts compete; a critic picks the best
    formats: ['question', 'myth', 'didyouknow', 'ifyoure', 'asked', 'local', 'list', 'mistake', 'compare', 'story'],
    structures: ['classic', 'answer', 'objection', 'recap', 'nobridge'],   // STRUCTURES ids, rotated so videos don't all share one shape
    clipCheck: 'on',         // AI looks at each clip's thumbnail before using it
    music: 'off',            // 'off' (add a trending sound in Instagram) | 'library'
    ownClips: 'off',         // the agent's own clips (Brand): 'off' | 'few' (first and last scenes) | 'many' (about half)
    footageMix: 'balanced',  // shot plan: 'people' (2 in 3 scenes show people) | 'balanced' (half) | 'scenery' (1 in 3)
    shotTypes: ['people', 'closeup', 'action', 'wide', 'still', 'soft', 'golden', 'overhead', 'slow'],   // SHOT_TYPES the plan may use
  },
  schedule: {
    keepReady: 0,            // overnight, top up to this many videos waiting for review (0 = off)
    autoPlan: false,         // Monday mornings: write the weekly check-in and make its videos (the agent can skip a week)
    // Posting plan (needs Instagram connected): post one approved video on these days at this time.
    autopost: { on: false, time: '09:00', days: [1, 2, 3, 4, 5], platforms: ['instagram'] },   // days: 0 = Sunday … 6 = Saturday
  },
};

export const LEVELS = ['low', 'mid', 'high'];
export const MODES = ['captions', 'voiceover'];
export const VOICES = ['coral', 'nova', 'shimmer', 'sage', 'ballad', 'alloy', 'ash', 'verse'];
export const LIMITS = { scenes: [5, 10], maxWords: [5, 16], maxSpoken: [10, 30], minSeconds: [2, 6], drafts: [1, 3], pace: [1.5, 3.5] };
// Highlight colors for the accent word and the end card. hex is RGB; the renderer converts it.
export const ACCENT_COLORS = {
  sand: { label: 'Sand', hex: '#EED2A8' }, gold: { label: 'Gold', hex: '#F6C453' }, coral: { label: 'Coral', hex: '#FF9E80' },
  sky: { label: 'Sky', hex: '#9FD3FF' }, mint: { label: 'Mint', hex: '#A8E6C1' }, rose: { label: 'Rose', hex: '#F7A8C8' }, white: { label: 'White', hex: '#FFFFFF' },
};
// The highlight color: a palette color, or the agent's logo color made light enough to read on video.
export function accentHex(cfg) {
  const L = cfg.look || {};
  if (L.accentColor === 'brand' && /^#[0-9a-f]{6}$/i.test(L.brandColor || '')) return readableOnVideo(L.brandColor);
  return (ACCENT_COLORS[L.accentColor] || ACCENT_COLORS.sand).hex;
}
// Lifts a color toward white until it reads on dark footage (relative luminance at least 0.45).
export function readableOnVideo(hex) {
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  let rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let k = 0; k < 20 && lum(rgb) < 0.45; k++) rgb = rgb.map(v => Math.round(v + (255 - v) * 0.15));
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
// A pronunciation is only a way of saying a word: letters, at most four words, and nothing the rules
// would block in a script (it's spoken, so it gets the same checks the captions do).
export function sayProblems(say, cfg) {
  const t = String(say || '').trim(), out = [], N = nicheOf(cfg);
  if (!/^[\p{L}' .-]+$/u.test(t)) out.push('Use letters only: no numbers or symbols.');
  if (t.split(/\s+/).length > 4) out.push('Keep it to four words or fewer.');
  const lower = t.toLowerCase();
  if (N.eligibility.some(re => re.test(t)) || govHits(t, N).length || N.absolutes.some(([re]) => re.test(t))
    || guardrailsFor(cfg).neverUse.some(w => new RegExp(`\\b${escRe(w.toLowerCase())}\\b`).test(lower))) out.push('That wording isn’t allowed in videos.');
  return out;
}
// The AI voice's pronunciations: each word (whole word, any case) is said the way the agent spelled it.
export function sayIt(text, cfg) {
  let t = String(text ?? '');
  for (const { word, say } of cfg.voice?.say || []) t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(word)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (m, pre) => pre + say);
  return t;
}
export const CAPTION_STYLES = ['line', 'words'];
// Caption fonts. Files download automatically on the server the first time they're used.
export const FONTS = {
  'Poppins SemiBold': { file: 'Poppins-SemiBold.ttf', italic: 'Poppins-SemiBoldItalic.ttf' },
  'Poppins Medium':   { file: 'Poppins-Medium.ttf',   italic: 'Poppins-MediumItalic.ttf' },
  'Poppins Bold':     { file: 'Poppins-Bold.ttf',     italic: 'Poppins-BoldItalic.ttf' },
};

// Video formats: proven short-form shapes. Each has its own opening and its own middle
// ("body"); every format keeps the same compliance, accuracy, bridge and call to action rules.
// Each format's opening instruction for the AI is in lib/prompts.js (FORMAT_HOOKS).
export const FORMATS = {
  question:   { label: 'Question', body: 'teach', about: 'Opens with their worry as a question, then teaches one fact. Simple and reliable.' },
  myth:       { label: 'Myth vs. fact', body: 'myth', about: 'Opens with something many people believe, then sets it straight. Strong at stopping the scroll.' },
  didyouknow: { label: 'Did you know', body: 'teach', about: 'Opens with the most surprising part of the fact.' },
  ifyoure:    { label: "If you're…", body: 'teach', about: 'Calls out one exact situation so the right viewer feels seen.' },
  asked:      { label: 'Question I get asked', body: 'teach', about: 'Answers a question clients really ask. Sharper with your question bank.' },
  local:      { label: 'Local', body: 'teach', about: 'Grounds the video in your town. Needs your city in Brand.' },
  list:       { label: 'Things to know', body: 'list', needs: { facts: 2 }, about: 'Promises 2 or 3 quick facts, one per scene. Easy to save and share. Needs a worry with 2+ confirmed facts.' },
  mistake:    { label: 'Mistake to avoid', body: 'mistake', about: 'Names a common, honest mistake and what to do instead.' },
  compare:    { label: 'This or that', body: 'compare', needs: { facts: 2 }, about: 'Puts two options side by side, fairly. Needs a worry with 2+ confirmed facts.' },
  story:      { label: 'Mini-story', body: 'story', needs: { story: true }, about: 'Opens with a true moment from your story bank, then the lesson. Builds the most trust.' },
};

// Structures: the order of the scenes after the opening. Formats decide how a video opens and what
// its middle does; structures vary the shape around that, so 30–60 videos a month don't all feel alike.
// `min`: the fewest scenes it needs. `bodies`: the format bodies it works with (list, compare and story
// keep the classic shape). The scene instructions for the AI are in lib/prompts.js.
export const STRUCTURES = {
  classic:   { label: 'Classic', about: 'Teach, name the solution, raise their personal question, then the call to action.', min: 5 },
  answer:    { label: 'Answer first', about: 'Gives the bottom line right after the opening, then why it matters.', min: 6, bodies: ['teach', 'myth', 'mistake'] },
  objection: { label: 'Objection', about: 'Names a doubt people often have and answers it with the fact.', min: 7, bodies: ['teach', 'myth', 'mistake'] },
  recap:     { label: 'Recap', about: 'Ends the teaching with one line worth remembering.', min: 7, bodies: ['teach', 'myth', 'mistake'] },
  nobridge:  { label: 'Straight to you', about: 'No question scene: the call to action raises their personal question itself.', min: 5, bodies: ['teach', 'myth', 'mistake'] },
};
export const structureFits = (id, n, format = 'question') => { const x = STRUCTURES[id]; return !!x && n >= x.min && (!x.bodies || x.bodies.includes(FORMATS[format]?.body || 'teach')); };
// How the bridge raises the open question, and how the call to action asks. Rotated like formats.
export const BRIDGE_STYLES = {
  depends: { label: 'It depends' }, picture: { label: 'Picture yours' }, direct: { label: 'Ask it straight' }, decides: { label: 'What decides it' },
};
export const CTA_STYLES = {
  tie: { label: 'Tie back' }, easy: { label: 'Make it easy' }, specific: { label: 'Their answer' }, gentle: { label: 'No pressure' },
};
// Endings that ask for a conversation (the others give: tie back, no pressure).
export const ASKING_CTAS = ['easy', 'specific'];
// The call-to-action style each communication style takes to most (comms-core.js STYLES keys).
const CTA_FOR_STYLE = { D: 'specific', I: 'easy', S: 'gentle', C: 'specific' };

// Overused phrases that make scripts sound like ads or like AI. Blocked in scripts and posts.
export const CLICHES = ['peace of mind', 'navigate', 'navigating', 'journey', "it's important to note", "don't wait", 'protect what matters most', 'secure your future', 'secure your family', 'safeguard', 'unlock', 'game changer', 'game-changer', "in today's world", 'at the end of the day', 'worry-free', 'look no further', 'tailored', 'comprehensive', 'delve', 'embark', 'rest easy', 'life happens', 'leave a legacy', 'when the unexpected happens', 'the unexpected'];
const straight = t => String(t).toLowerCase().replace(/[’‘]/g, "'");
export const clicheHits = (text, list = CLICHES) => { const t = straight(text); return list.filter(c => new RegExp(`(^|[^a-z])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)); };

// Flesch-Kincaid grade level, roughly. Used to keep scripts at the agent's reading level.
const syllables = w => { const x = w.toLowerCase().replace(/[^a-z]/g, ''); if (!x) return 0; if (x.length <= 3) return 1; const m = x.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1); };
export function readingGrade(lines) {
  const text = lines.join(' ');
  const words = text.match(/[A-Za-z’']+/g) || [];
  if (words.length < 8) return 0;
  const sentences = Math.max(lines.length, (text.match(/[.!?]+/g) || []).length);
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}
const GRADE_TARGET = { '3rd grade': 3, '6th grade': 6, '8th grade': 8, 'Adult / professional': 12 };

// Words that name who is in a shot. Every keyword needs one, so footage shows people.
export const PEOPLE_WORDS = ['woman', 'women', 'man', 'men', 'couple', 'grandmother', 'grandfather', 'grandma', 'grandpa', 'grandparents', 'grandparent', 'grandchild', 'grandchildren', 'grandkids', 'grandson', 'granddaughter', 'senior', 'seniors', 'elderly', 'older', 'mother', 'father', 'mom', 'dad', 'daughter', 'son', 'family', 'people', 'person', 'friends', 'hands', 'agent', 'parent', 'parents', 'adult', 'retiree', 'retired', 'lady', 'gentleman', 'kids', 'kid', 'children', 'child', 'baby', 'toddler', 'boy', 'girl', 'husband', 'wife', 'homeowner', 'homeowners', 'neighbors', 'worker'];
// Absolute claims that need the insight to back them up (default niche; checks use cfg's niche).
export const ABSOLUTES = LI.absolutes;
// Words that keep a claim accurate. The script must keep one from the same group as the insight's.
export const QUALIFIER_GROUPS = [
  ['generally', 'usually', 'typically', 'often', 'commonly', 'normally', 'sometimes'],
  ['may', 'might', 'can', 'could'],
  ['many', 'some', 'lots'],
];
export const QUALIFIERS = QUALIFIER_GROUPS.flat();
// Keywords that pull abstract or off-topic stock footage.
export const ABSTRACT_KEYWORDS = LI.abstractKeywords;
// Words that are never the highlighted accent: qualifiers, product terms, the agent's title, filler.
const ACCENT_BANNED_CORE = ['usually', 'often', 'generally', 'typically', 'many', 'some', 'may', 'might', 'can', 'could', 'message', 'me', 'call', 'a', 'an', 'the', 'is', 'it', 'this', 'that', 'to', 'for', 'of', 'and', 'or', 'your', 'my', 'be', 'are', 'just', 'so'];
const accentBanned = N => [...ACCENT_BANNED_CORE, ...N.accentBanned];
const STOP = new Set(['a', 'an', 'the', 'is', 'it', 'this', 'that', 'to', 'for', 'of', 'and', 'or', 'you', 'your', 'me', 'my', 'i', 'can', 'be', 'are', 'do', 'what', 'how', 'if', 'in', 'on', 'with', 'about', 'so', 'just']);

/* ---------------- Small helpers ---------------- */
export const uid = prefix => prefix + Math.random().toString(36).slice(2, 8);
const newUid = uid;
export const countWords = t => (String(t).match(/\S+/g) || []).length;
const clone = o => JSON.parse(JSON.stringify(o));
const uniq = arr => [...new Set(arr.map(x => String(x).trim()).filter(Boolean))];
const routedFrom = (list, parent) => (parent ? list.filter(x => (x.links || []).includes(parent.id)) : []);
const wordsIn = t => String(t).toLowerCase().match(/[a-z’']+/g) || [];
const qualifiersIn = t => QUALIFIERS.filter(q => wordsIn(t).includes(q));
const isVoice = cfg => cfg.output.mode === 'voiceover';
const accentOn = cfg => (cfg.look?.accent || 'on') === 'on';
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contentWords = t => new Set(String(t).toLowerCase().match(/[a-z’']+/g)?.filter(w => !STOP.has(w)) || []);
const firstWords = (t, n = 3) => (String(t).toLowerCase().match(/[a-z’']+/g) || []).slice(0, n).join(' ');
export const firstName = cfg => String(cfg.look?.name || '').trim().split(/\s+/)[0] || 'the agent';
export const cityOf = cfg => String(cfg.look?.location || '').split(',')[0].trim();

// How alike two lines are, 0..1 (shared meaningful words).
export function similarity(a, b) {
  const A = contentWords(a), B = contentWords(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach(w => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
}

// The system message's opening: who the agent is and who they talk to.
export function roleFor({ name, title, location, about, clients, niche }) {
  const what = nicheOf({ niche }).agentFor(title);
  const first = String(name || '').trim().split(/\s+/)[0];
  if (!first) return `You write short videos for ${what}${location ? ` in ${location}` : ''}, who talks to neighbors in first person: warm, plain and honest, never salesy.${clients ? ` Most clients are ${clients}.` : ''}`;
  return `You write short videos for ${name.trim()}, ${what}${location ? ` in ${location}` : ''}.${about ? ` In ${first}’s own words: “${String(about).trim().replace(/[.]$/, '')}.”` : ''} ${first} talks to neighbors in first person: warm, plain and honest, never salesy.${clients ? ` Most of ${first}’s clients are ${clients}.` : ''}`;
}

// The agent's own role text if they wrote one, otherwise built from their profile and brand.
export const roleText = cfg => String(cfg.voice?.role || '').trim() || roleFor({ name: cfg.look?.name, title: cfg.look?.title, location: cfg.look?.location, about: cfg.profile?.about, clients: cfg.profile?.clients, niche: cfg.niche });

// Platform rules + the agent's own rules, merged.
export function guardrailsFor(cfg) {
  const g = cfg.guardrails || {}, P = nicheOf(cfg).platformGuardrails;
  return {
    mustUse: uniq([...P.mustUse, ...(g.mustUse || [])]),
    neverUse: uniq([...P.neverUse, ...(g.neverUse || [])]),
    mustDo: uniq([...P.mustDo, ...(g.mustDo || [])]),
    neverDo: uniq([...P.neverDo, ...(g.neverDo || [])]),
  };
}

/* ---------------- Facts: confirmed, unconfirmed or due for review ---------------- */
export function insightStatus(x, now = Date.now()) {
  if (!x || !x.confirmed || !x.confirmedAt) return 'unconfirmed';
  const age = (now - Date.parse(x.confirmedAt)) / 86400000;
  return age > FACT_REVIEW_DAYS ? 'stale' : 'confirmed';
}
export const isUsable = (x, now) => insightStatus(x, now) === 'confirmed';

/* ---------------- Scene plan and timing ---------------- */
// The scene plan for a format. `count` = how many facts a list uses.
export function beatPlan(n, format = 'question', count = 3, structure = 'classic') {
  const range = (a, b) => (a >= b ? `Scene ${a}` : `Scenes ${a}-${b}`);
  const body = FORMATS[format]?.body || 'teach';
  const beat = (name, a, b) => ({ beat: name, scenes: range(a, b), from: a, to: Math.max(a, b) });
  const plan = [beat('Hook', 1, 1)];
  const name = { teach: 'Insight', myth: 'The truth', mistake: 'Why + what to do', compare: 'Option A, then B', story: 'Story + lesson' }[body];
  const st = structure !== 'classic' && structureFits(structure, n, format) ? structure : 'classic';
  if (st === 'nobridge') { plan.push(beat(name, 2, n - 2), beat('Solution', n - 1, n - 1), beat('CTA', n, n)); return plan; }
  if (st === 'answer') plan.push(beat('Bottom line', 2, 2), beat(name, 3, n - 3), beat('Solution', n - 2, n - 2));
  else if (st === 'objection') plan.push(beat(name, 2, n - 4), beat('Common doubt', n - 3, n - 3), beat('Solution', n - 2, n - 2));
  else if (st === 'recap') plan.push(beat(name, 2, n - 4), beat('Remember this', n - 3, n - 3), beat('Solution', n - 2, n - 2));
  else if (body === 'list') {
    const k = Math.max(2, Math.min(count, n - 3));
    plan.push(beat('Items', 2, 1 + k));
    if (2 + k <= n - 2) plan.push(beat('Solution', 2 + k, n - 2));
  } else {
    plan.push(beat(name, 2, n - 3), beat('Solution', n - 2, n - 2));
  }
  plan.push(beat('Bridge', n - 1, n - 1), beat('CTA', n, n));
  return plan;
}

// Captions mode: each scene stays up long enough to read at the configured pace.
export function readingSeconds(text, cfg) {
  const s = countWords(text) / cfg.output.pace + 0.8;
  return Math.max(cfg.output.minSeconds, Math.round(s * 10) / 10);
}

// Rough length for the portal before anything is generated.
export function estimateSeconds(cfg) {
  const o = cfg.output;
  const per = isVoice(cfg) ? Math.max(o.minSeconds, (o.maxSpoken * 0.8) / 2.6 + 0.4) : Math.max(o.minSeconds, (o.maxWords * 0.8) / o.pace + 0.8);
  return Math.round(per * o.scenes + ((cfg.look?.endCard || 'on') === 'on' ? END_CARD_SECONDS : 0));
}

/* ---------------- Upgrade older configs ---------------- */
export function migrate(c) {
  if (!c || typeof c !== 'object' || !(c.version >= 5)) return clone(DEFAULT_CONFIG);
  const d = clone(DEFAULT_CONFIG), x = clone(c);
  const out = { ...d, ...x };
  ['profile', 'story', 'voice', 'guardrails', 'output', 'look', 'schedule'].forEach(k => { out[k] = { ...d[k], ...(x[k] || {}) }; });
  out.specs = { energy: { ...d.specs.energy, ...(x.specs?.energy || {}) }, tone: { ...d.specs.tone, ...(x.specs?.tone || {}) } };
  const s = out.story;
  ['audiences', 'painPoints', 'insights', 'solutions'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
  // Ids are short word characters only (they end up in page markup and file lookups).
  const okId = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
  ['audiences', 'painPoints', 'insights', 'solutions'].forEach(k => {
    s[k] = s[k].filter(x => x && typeof x === 'object').map(x => ({ ...x, id: okId(x.id) ? x.id : uid(k[0]), text: String(x.text ?? ''), ...(Array.isArray(x.links) ? { links: x.links.filter(okId) } : {}) }));
  });
  s.painPoints = s.painPoints.map(p => {
    const months = [...new Set((Array.isArray(p.months) ? p.months : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b);
    const { months: _drop, ...rest } = p;
    return { question: '', ...rest, links: p.links || [], ...(months.length ? { months } : {}) };
  });
  // Footage searches that scored well for an audience (saved from Test footage).
  s.audiences = s.audiences.map(a => ({ visual: '', ...a, style: normStyle(a.style), searches: uniq((Array.isArray(a.searches) ? a.searches : []).map(q => String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean)).slice(0, 8) }));
  // Facts from before v8 were never formally confirmed: the agent confirms each one once.
  s.insights = s.insights.map(i => ({ confirmed: false, confirmedAt: '', source: '', ai: false, ...i, links: i.links || [] }));
  s.solutions = s.solutions.map(x2 => ({ ...x2, links: x2.links || [], mustMention: x2.mustMention ?? (/waiting period/i.test(x2.plain || '') ? 'waiting period' : '') }));
  if (c.version < 6) {
    const OLD = {
      'a final expense policy with a few health questions and no exam': 'a final expense policy that may skip the medical exam',
      'a policy that accepts almost anyone, with a waiting period': 'a final expense policy built for tougher health histories, with a waiting period',
      'a policy you own yourself, so it stays with you': 'a policy you own yourself, separate from your job',
    };
    s.solutions = s.solutions.map(x2 => ({ ...x2, plain: OLD[x2.plain] || x2.plain }));
  }
  if (!s.ctaAction) s.ctaAction = d.story.ctaAction;
  // Link verdicts (story.fit) and product-line tags: kept only in the shapes the checks expect.
  const ids = new Set(['audiences', 'painPoints', 'insights', 'solutions'].flatMap(k => s[k].map(x => x.id)));
  // Only links that exist now keep a verdict (so old ones never pile up).
  const linked = new Set(LINK_KINDS.flatMap(([c]) => s[c].flatMap(x => (x.links || []).map(p => `${x.id}>${p}`))));
  s.fit = Object.fromEntries(Object.entries(s.fit && typeof s.fit === 'object' ? s.fit : {}).filter(([k, v]) => {
    const [a, b] = k.split('>');
    return /^[\w-]{1,40}>[\w-]{1,40}$/.test(k) && ids.has(a) && ids.has(b) && linked.has(k) && v && typeof v === 'object';
  }).slice(0, 3000).map(([k, v]) => [k, { s: Math.min(5, Math.max(1, Math.round(Number(v.s) || 3))), r: String(v.r ?? '').slice(0, 160), k: String(v.k ?? '').slice(0, 16), ...(v.g ? { g: String(v.g).slice(0, 24) } : {}), ...(v.u ? { u: 1 } : {}), ...(v.o ? { o: String(v.o).slice(0, 200), oAt: String(v.oAt || '').slice(0, 30) } : {}) }]));
  const lines = new Set(PRODUCT_LINES.map(p => p.id));
  ['audiences', 'painPoints', 'insights', 'solutions'].forEach(k => { s[k] = s[k].map(x => { if (x.product && !lines.has(x.product)) { const { product, ...rest } = x; return rest; } return x; }); });
  const b = x.bank && typeof x.bank === 'object' ? x.bank : {};
  const items = (arr, prefix, n, len, extra) => (Array.isArray(arr) ? arr : []).filter(o => o && typeof o === 'object')
    .map(o => ({ id: okId(o.id) ? o.id : uid(prefix), text: String(o.text ?? '').slice(0, len), links: (Array.isArray(o.links) ? o.links : []).filter(okId), ...extra(o) })).slice(0, n);
  const mi = x.mindset && typeof x.mindset === 'object' ? x.mindset : {}, dm = d.mindset;
  const txt = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const audIds = new Set(s.audiences.map(a => a.id)), painIds = new Set(s.painPoints.map(p => p.id));
  out.mindset = {
    why: { why: txt(mi.why?.why, 200), how: txt(mi.why?.how, 200), what: txt(mi.why?.what, 200), show: mi.why?.show === 'on' ? 'on' : 'off' },
    hedgehog: { love: txt(mi.hedgehog?.love, 300), best: txt(mi.hedgehog?.best, 300), pays: txt(mi.hedgehog?.pays, 300),
      products: uniq(Array.isArray(mi.hedgehog?.products) ? mi.hedgehog.products : []).filter(p => PRODUCT_LINES.some(x => x.id === p)),
      audiences: uniq(Array.isArray(mi.hedgehog?.audiences) ? mi.hedgehog.audiences : []).filter(a => audIds.has(a)) },
    objections: (Array.isArray(mi.objections) ? mi.objections : []).filter(o => o && typeof o === 'object' && txt(o.text, 200)).slice(0, 40)
      .map(o => ({ id: okId(o.id) ? o.id : uid('ob'), text: txt(o.text, 200), answer: txt(o.answer, 600), links: (Array.isArray(o.links) ? o.links : []).filter(id => painIds.has(id)), topic: !!o.topic })),
    persuasion: mi.persuasion === 'off' ? 'off' : dm.persuasion,
    giveAsk: mi.giveAsk === 'off' ? 'off' : dm.giveAsk,
  };
  out.bank = {
    samples: (Array.isArray(b.samples) ? b.samples : []).map(t => String(t ?? '').slice(0, 800)).filter(t => t.trim()).slice(0, 8),
    stories: items(b.stories, 'st', 30, 600, o => ({ confirmed: !!o.confirmed })),
    questions: items(b.questions, 'q', 50, 200, () => ({})),
  };
  // Platform rules now live in code; keep only the agent's own extras.
  if (!NICHES[out.niche]) out.niche = DEFAULT_NICHE;
  const P = nicheOf(out).platformGuardrails;
  ['mustUse', 'neverUse', 'mustDo', 'neverDo'].forEach(k => {
    out.guardrails[k] = uniq(out.guardrails[k] || []).filter(v => !P[k].map(z => z.toLowerCase()).includes(v.toLowerCase()));
  });
  if (!FONTS[out.look.font]) out.look.font = d.look.font;
  if (!CAPTION_STYLES.includes(out.look.captionStyle)) out.look.captionStyle = d.look.captionStyle;
  out.look.brandColor = /^#[0-9a-f]{6}$/i.test(String(out.look.brandColor || '')) ? out.look.brandColor.toUpperCase() : '';
  if (!ACCENT_COLORS[out.look.accentColor] && !(out.look.accentColor === 'brand' && out.look.brandColor)) out.look.accentColor = d.look.accentColor;
  if (!['on', 'off'].includes(out.look.logo)) out.look.logo = 'off';
  if (!['off', 'few', 'many'].includes(out.output.ownClips)) out.output.ownClips = 'off';
  out.output.formats = (Array.isArray(out.output.formats) ? out.output.formats : d.output.formats).filter(f => FORMATS[f]);
  // Version 9 added four formats; turn them on for existing agents.
  if (c.version < 9) out.output.formats = uniq([...out.output.formats, 'list', 'mistake', 'compare', 'story']);
  if (!out.output.formats.length) out.output.formats = d.output.formats.slice();
  // Version 10 added structures: everyone gets them all, and Classic always stays on.
  out.output.structures = uniq(['classic', ...(Array.isArray(out.output.structures) ? out.output.structures : d.output.structures)]).filter(k => STRUCTURES[k]);
  if (!['on', 'off'].includes(out.output.clipCheck)) out.output.clipCheck = 'on';
  if (!FOOTAGE_MIX[out.output.footageMix]) out.output.footageMix = 'balanced';
  // Version 12 added the shot plan. People shots always stay on: openings and calls to action need a face.
  out.output.shotTypes = uniq(['people', ...(Array.isArray(out.output.shotTypes) ? out.output.shotTypes : d.output.shotTypes)]).filter(k => SHOT_TYPES[k]);
  if (!LEVELS.includes(out.voice.energy)) out.voice.energy = d.voice.energy;
  if (!LEVELS.includes(out.voice.tone)) out.voice.tone = d.voice.tone;
  if (!['on', 'off'].includes(out.voice.aiNote)) out.voice.aiNote = d.voice.aiNote;
  if (!MODES.includes(out.output.mode)) out.output.mode = 'captions';
  if (!['off', 'library'].includes(out.output.music)) out.output.music = 'off';
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) out.output[k] = Math.min(hi, Math.max(lo, Number(out.output[k]) || d.output[k]));
  out.schedule.keepReady = Math.min(7, Math.max(0, Math.round(Number(out.schedule.keepReady) || 0)));
  out.schedule.autoPlan = !!out.schedule.autoPlan;
  const ap = out.schedule.autopost && typeof out.schedule.autopost === 'object' ? out.schedule.autopost : {};
  const okTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
  out.schedule.autopost = { on: !!ap.on, time: okTime(ap.time) ? ap.time : d.schedule.autopost.time,
    days: [...new Set((Array.isArray(ap.days) ? ap.days : d.schedule.autopost.days).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort(),
    platforms: (() => { const p = uniq(Array.isArray(ap.platforms) ? ap.platforms : []).filter(x => PLATFORMS.includes(x)); return p.length ? p : ['instagram']; })() };
  out.look.bookingUrl = okBookingUrl(out.look.bookingUrl) ? String(out.look.bookingUrl).trim() : '';
  // What a video's tracking link opens (v15): the agent's own page ('page'), or the booking page directly.
  if (!['page', 'direct'].includes(out.look.landing)) out.look.landing = 'page';
  if (!Array.isArray(out.profile.states)) out.profile.states = [];
  if (!Array.isArray(out.profile.products)) out.profile.products = [];
  out.profile.daysOff = [...new Set((Array.isArray(out.profile.daysOff) ? out.profile.daysOff : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort().slice(0, 6);
  out.voice.say = (Array.isArray(out.voice.say) ? out.voice.say : []).map(x => ({ word: String(x?.word || '').replace(/\s+/g, ' ').trim().slice(0, 40), say: String(x?.say || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
    .filter((x, i, a) => x.word && x.say && a.findIndex(y => y.word.toLowerCase() === x.word.toLowerCase()) === i && !sayProblems(x.say, out).length).slice(0, 50);
  delete out.output.secondsPerScene;
  out.version = CONFIG_VERSION;
  return out;
}

/* ---------------- Roll: follow the routing, upstream first ---------------- */
// Weighted random pick: items used recently are less likely, never impossible.
// `boost`: { id: weight } from posted results, so what brings messages comes up a bit more.
function pickFresh(arr, rng, recentIds, keep = 0.2, boost = {}) {
  if (!arr || !arr.length) return null;
  const w = arr.map(x => (recentIds.includes(x.id ?? x) ? keep : 1) * (boost[x.id ?? x] || 1));
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
const shuffle = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Which routes can make a video right now: only confirmed facts count.
/* ---------------- Link checks: does each link make sense? ---------------- */
// Every link (worry → audience, fact → worry, solution → fact) can carry a verdict in story.fit,
// keyed "childId>parentId": { s: 1-5 fit score from the AI, r: one-line reason, k: textKey of the two
// texts it judged (a changed text makes the verdict stale), o: the agent's override reason }.
// A fact or solution tagged with one product line linked to one tagged with another is a mismatch
// without any AI. Mismatches are left out of videos until fixed or overridden; weak links only warn.
export const FIT_WEAK = 3, FIT_BAD = 2;
export const textKey = (a, b) => { let h = 5381; for (const ch of `${a}\u0000${b}`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
export const linkKey = (childId, parentId) => `${childId}>${parentId}`;
const LINK_KINDS = [['painPoints', 'audiences', 'worry-audience'], ['insights', 'painPoints', 'fact-worry'], ['solutions', 'insights', 'solution-fact']];
// Every link in the content, with its state: ok | weak | blocked | unchecked (and why).
export function linkChecks(cfg) {
  const s = cfg.story, fit = s.fit || {}, out = [];
  for (const [childList, parentList, kind] of LINK_KINDS) {
    for (const child of s[childList] || []) for (const pid of child.links || []) {
      const parent = (s[parentList] || []).find(x => x.id === pid);
      if (!parent) continue;
      const key = linkKey(child.id, pid), v = fit[key] || null;
      // `u`: not a verdict the server made (only an override rides on it), so it counts as unchecked.
      const fresh = v && !v.u && v.k === textKey(child.text, parent.text) ? v : null;
      const productClash = kind !== 'worry-audience' && child.product && parent.product && child.product !== parent.product;
      let state = 'unchecked', reason = '';
      if (productClash) { state = 'blocked'; reason = `Different product lines (${productLabel(child.product)} and ${productLabel(parent.product)}).`; }
      else if (fresh && fresh.s <= FIT_BAD) { state = 'blocked'; reason = fresh.r || 'These don’t fit together.'; }
      else if (fresh && fresh.s <= FIT_WEAK) { state = 'weak'; reason = fresh.r || 'Only loosely related.'; }
      else if (fresh) { state = 'ok'; reason = fresh.r || ''; }
      out.push({ key, kind, childList, parentList, child, parent, state, reason, score: fresh?.s ?? null, override: v?.o || '', product: !!productClash });
    }
  }
  return out;
}
const productLabel = id => PRODUCT_LINES.find(p => p.id === id)?.label || id;
// Links videos never use: blocked, and not overridden by the agent.
export const blockedLinks = cfg => new Set(linkChecks(cfg).filter(l => l.state === 'blocked' && !l.override).map(l => l.key));

export function usableRoutes(cfg, now = Date.now()) {
  const s = cfg.story;
  // With blocked links, items are copies with those links left out (the content itself is unchanged).
  const B = s.fit || s.insights.some(i => i.product) ? blockedLinks(cfg) : new Set();
  const cut = x => (B.size && (x.links || []).some(id => B.has(linkKey(x.id, id))) ? { ...x, links: x.links.filter(id => !B.has(linkKey(x.id, id))) } : x);
  const insights = s.insights.filter(i => isUsable(i, now)).map(cut);
  const pains = s.painPoints.map(cut).filter(p => insights.some(i => i.links.includes(p.id)));
  const audiences = s.audiences.filter(a => pains.some(p => p.links.includes(a.id)));
  const solutions = B.size ? s.solutions.map(cut) : s.solutions;
  return { insights, pains, audiences, solutions, blocked: B };
}

// Posted videos with results → small boosts for the topics and formats that bring messages.
// Needs at least 2 reported videos for a topic or format before it counts.
export function boostsFrom(videos = []) {
  const out = { pains: {}, formats: {} };
  const group = (key, into) => {
    const m = {};
    videos.filter(v => v.status === 'posted' && (v.results || v.clicks?.total || v.leads?.total)).forEach(v => { const k = key(v); if (!k) return; (m[k] ||= []).push(resultValue(v)); });
    Object.entries(m).forEach(([k, arr]) => { if (arr.length >= 2) into[k] = 1 + Math.min(1.5, arr.reduce((a, b) => a + b, 0) / arr.length / 2); });
  };
  group(v => v.meta?.painId, out.pains);
  group(v => v.meta?.format, out.formats);
  return out;
}

/* ---------------- Seasons ---------------- */
// A worry tagged with months (painPoints[].months: 1–12) comes up about 3× as often in those months,
// in the agent's time zone. Untagged worries are unchanged.
export const SEASON_BOOST = 3;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthIn(tz, now = Date.now()) {
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Denver', month: 'numeric' }).format(new Date(now))); }
  catch { return new Date(now).getUTCMonth() + 1; }
}
// Worries that fit this month's calendar moment (the niche's season `match` words, in the worry or
// its audiences) come up about twice as often on their own; ones the agent tagged, three times.
export const SEASON_AUTO = 2;
export function seasonBoosts(cfg, now = Date.now()) {
  const m = monthIn(cfg.profile?.timezone, now), out = {}, s = cfg.story || {};
  const moments = (nicheOf(cfg).seasons || []).filter(x => x.months.includes(m) && x.match).map(x => new RegExp(`\\b(${x.match})s?\\b`, 'i'));
  (s.painPoints || []).forEach(p => {
    if ((p.months || []).includes(m)) out[p.id] = SEASON_BOOST;
    else if (moments.length && !(p.months || []).length) {
      const text = [p.text, ...(s.audiences || []).filter(a => p.links.includes(a.id)).map(a => a.text)].join(' ');
      if (moments.some(re => re.test(text))) out[p.id] = SEASON_AUTO;
    }
  });
  return out;
}
// Memory seats: what the agent approves and rejects teaches which formats they like, without asking.
// From the last 90 days of decisions per format (3 or more): mostly approved → up to 1.3×, mostly
// rejected → down to 0.5×. Results (boostsFrom) still count on top.
// Only rejections about the writing say something about the format (not the music, footage or a fact).
export const FORMAT_REASONS = ['Weak opening', 'Too salesy', 'Not my voice'];
export function tasteFrom(videos = [], now = Date.now()) {
  const m = {};
  videos.filter(v => now - Date.parse(v.createdAt || 0) < 90 * 86400000 && v.meta?.format).forEach(v => {
    const k = v.meta.format, x = (m[k] ||= { yes: 0, no: 0 });
    if (['approved', 'posted'].includes(v.status)) x.yes++; else if (v.status === 'rejected' && FORMAT_REASONS.includes(v.rejection?.reason)) x.no++;
  });
  return Object.fromEntries(Object.entries(m).filter(([, x]) => x.yes + x.no >= 3).map(([k, x]) => [k, Math.round(Math.min(1.3, Math.max(0.5, 0.5 + (x.yes / (x.yes + x.no)) * 0.8)) * 100) / 100]));
}
// The niche's calendar moments for this month (shown as ideas in Content).
export const seasonsNow = (cfg, now = Date.now()) => { const m = monthIn(cfg.profile?.timezone, now); return (nicheOf(cfg).seasons || []).filter(x => x.months.includes(m)); };

/* ---------------- Shot plan: what kind of shot each scene's footage is ---------------- */
// Automatic videos get a plan before the script is written, so footage varies: faces, details,
// places, movement and light, never the same kind of shot twice in a row. `human` shots show people.
// `term` is the search word stock sites tag that style with. Searches the agent types are never
// held to this (manual footage is theirs to choose).
export const SHOT_TYPES = {
  people:   { label: 'People', human: true, about: 'a medium shot of a person or people in an everyday moment', example: 'older couple kitchen table', term: '' },
  closeup:  { label: 'Close-up', human: true, about: 'a close-up of a face, hands or a meaningful detail someone is holding', example: 'grandmother hands close up', term: 'close up' },
  action:   { label: 'Action', human: true, about: 'people moving: walking, cooking, kids running, a car pulling into a driveway', example: 'family walking park', term: '' },
  slow:     { label: 'Slow motion', human: true, about: 'a slow-motion moment with people that lets the line breathe', example: 'grandchild laughing slow motion', term: 'slow motion' },
  wide:     { label: 'Wide shot', human: false, about: 'a wide or establishing shot of a place: a house from outside, a small-town street, open land', example: 'small town street wide shot', term: 'wide shot' },
  still:    { label: 'Still life', human: false, about: 'objects with no people and no movement: a family photo on a shelf, keys on a table, a porch swing', example: 'family photos on shelf', term: '' },
  soft:     { label: 'Soft focus', human: false, about: 'soft focus: blurred lights or window light with a shallow depth of field', example: 'window light bokeh', term: 'bokeh' },
  golden:   { label: 'Golden hour', human: false, about: 'golden-hour light: a sunset, or backlit silhouettes', example: 'couple silhouette sunset', term: 'sunset' },
  overhead: { label: 'Overhead or aerial', human: false, about: 'an overhead or drone shot: a table from above, a neighborhood from the air', example: 'aerial neighborhood houses', term: 'aerial' },
};
// The share of scenes that show people, by Settings → Footage mix.
export const FOOTAGE_MIX = { people: { label: 'More people', share: 2 / 3 }, balanced: { label: 'Balanced', share: 1 / 2 }, scenery: { label: 'More scenery', share: 1 / 3 } };

// A shot type per scene. The opening is a person (close-up or medium: faces stop the scroll) and so
// is the call to action; no type twice in a row or more than twice a video (unless only a few are
// on); people in at least the mix's share of scenes; and a different rhythm from the last videos.
// `recent`: what the last videos used (each may have `shots`).
export function shotPlan(n, rng = Math.random, { mix = 'balanced', allowed = Object.keys(SHOT_TYPES), recent = [] } = {}) {
  const on = Object.keys(SHOT_TYPES).filter(k => allowed.includes(k));
  const pool = on.length ? on : ['people'];
  const human = pool.filter(k => SHOT_TYPES[k].human);
  const need = Math.min(n, Math.ceil(n * (FOOTAGE_MIX[mix]?.share ?? 0.5)));
  const most = Math.max(2, Math.ceil(n / pool.length));
  const before = recent.map(r => r.shots).filter(Array.isArray).slice(0, 3);
  const pick = (opts, i) => {
    if (!opts.length) return null;
    // Rotate: a type at the same spot in the last video, or used a lot lately, is less likely.
    const w = opts.map(k => (before[0]?.[i] === k ? 0.3 : 1) * (before.flat().filter(x => x === k).length >= 4 ? 0.6 : 1));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let j = 0; j < opts.length; j++) { r -= w[j]; if (r <= 0) return opts[j]; }
    return opts[opts.length - 1];
  };
  // Several tries; the first that keeps every rule wins, otherwise the one that breaks the fewest.
  let best = null, bestScore = Infinity;
  for (let attempt = 0; attempt < 40; attempt++) {
    const plan = [];
    const count = k => plan.filter(x => x === k).length;
    for (let i = 0; i < n; i++) {
      const humansLeft = need - plan.filter(k => SHOT_TYPES[k].human).length, slotsLeft = n - i;
      const mustHuman = i === n - 1 || humansLeft >= slotsLeft;
      const base = i === 0 ? ['closeup', 'people'].filter(k => pool.includes(k)) : mustHuman ? human : pool;
      let opts = base.filter(k => k !== plan[i - 1] && count(k) < most);
      if (!opts.length) opts = base.filter(k => k !== plan[i - 1]);
      if (!opts.length) opts = base.length ? base : pool;
      plan.push(pick(opts, i));
    }
    const humans = plan.filter(k => SHOT_TYPES[k].human).length;
    const same = before[0] && before[0].length === n && before[0].every((k, i) => k === plan[i]);
    const broken = Math.max(0, need - humans) + plan.filter((k, i) => i && k === plan[i - 1]).length
      + pool.reduce((a, k) => a + Math.max(0, count(k) - most), 0) + (same ? 1 : 0);
    if (!broken) return plan;
    if (broken < bestScore) { best = plan; bestScore = broken; }
  }
  return best;
}

// `recent`: what the last videos used (newest first), so the next one is different.
// `force`: { painId, audienceId, insightId, format, perf } — a chosen topic, audience or format, and results boosts.
export function roll(cfg, rng = Math.random, recent = [], force = {}, now = Date.now()) {
  const s = cfg.story, bank = cfg.bank || {}, breaks = [], perf = force.perf || {};
  const last = (k, n) => recent.slice(0, n).map(r => r[k]).filter(Boolean);
  const U = usableRoutes(cfg, now);
  if (!U.insights.length) breaks.push('No confirmed facts yet. Confirm at least one insight in Content before making videos.');

  // Hedgehog (Mindset): the audiences and product lines in the agent's sweet spot come up more often.
  const hh = cfg.mindset?.hedgehog || {}, hhA = hh.audiences || [], hhP = hh.products || [];
  const audBoost = hhA.length ? Object.fromEntries(hhA.map(id => [id, 1.5])) : {};
  let painPoint = force.painId ? U.pains.find(p => p.id === force.painId) : null;
  if (force.painId && !painPoint) breaks.push('That topic has no confirmed facts yet, so a different one was picked.');
  let audience;
  if (painPoint) audience = (force.audienceId && U.audiences.find(a => a.id === force.audienceId && painPoint.links.includes(a.id))) || pickFresh(U.audiences.filter(a => painPoint.links.includes(a.id)), rng, last('audienceId', 2), 0.4, audBoost);
  else {
    audience = pickFresh(U.audiences, rng, last('audienceId', 2), 0.4, audBoost);
    const season = seasonBoosts(cfg, now);
    const sweet = p => (hhP.length && p.product && hhP.includes(p.product) ? 1.5 : 1);
    const boost = Object.keys(season).length || hhP.length ? Object.fromEntries(U.pains.map(p => [p.id, (perf.pains?.[p.id] || 1) * (season[p.id] || 1) * sweet(p)])) : perf.pains;
    painPoint = pickFresh(U.pains.filter(p => audience && p.links.includes(audience.id)), rng, last('painId', 3), 0.3, boost);
  }
  const insightPool = U.insights.filter(i => painPoint && i.links.includes(painPoint.id));
  const insight = (force.insightId && insightPool.find(i => i.id === force.insightId)) || pickFresh(insightPool, rng, last('insightId', 8), 0.15);
  const extra = insightPool.filter(i => insight && i.id !== insight.id);

  const solutionFor = i => { const sols = routedFrom(U.solutions, i); return sols.length ? sols[Math.floor(rng() * sols.length)] : null; };
  let solution = solutionFor(insight);
  if (insight && !solution && U.solutions.length) {
    breaks.push(`No solution is routed from the insight "${insight.text}", so one was picked at random.`);
    solution = U.solutions[Math.floor(rng() * U.solutions.length)];
    // Never one blocked for this fact, or for a different product line.
    const fits = x => !U.blocked.has(linkKey(x.id, insight.id)) && !(insight.product && x.product && x.product !== insight.product);
    if (!fits(solution)) solution = U.solutions.find(fits) || null;
  }

  const fits = x => !x.links?.length || (painPoint && x.links.includes(painPoint.id));
  const stories = (bank.stories || []).filter(x => x.confirmed && x.text.trim() && fits(x));
  // Objections the agent prepared answers for (Mindset → Strategy board) can be video topics too:
  // a "question I get asked" video opens with the objection (their answer is theirs, never used).
  const objections = (cfg.mindset?.objections || []).filter(o => o.topic).map(o => ({ id: o.id, text: o.text, links: o.links }));
  const questions = [...(bank.questions || []), ...objections].filter(x => x.text.trim() && fits(x));
  const can = f => FORMATS[f] && (f !== 'local' || cityOf(cfg)) && (!FORMATS[f].needs?.facts || 1 + extra.length >= FORMATS[f].needs.facts) && (!FORMATS[f].needs?.story || stories.length);
  const enabled = (cfg.output.formats || []).filter(can);
  let format = force.format && can(force.format) ? force.format : null;
  if (force.format && !format) breaks.push(`The ${FORMATS[force.format]?.label || force.format} format can't be used for this topic, so another was picked.`);
  // An audience's communication style leans toward the formats that suit it (comms-core.js), gently.
  const lean = normStyle(audience?.style)[0], fmtBoost = { ...(perf.formats || {}) };
  Object.entries(perf.taste || {}).forEach(([f, w]) => { fmtBoost[f] = (fmtBoost[f] || 1) * w; });
  if (lean) (STYLES[lean]?.formats || []).forEach(f => { fmtBoost[f] = (fmtBoost[f] || 1) * 1.5; });
  format ||= pickFresh(enabled.length ? enabled : ['question'], rng, last('format', 3), 0.1, fmtBoost);

  let insights = insight ? [insight] : [];
  if (format === 'list') insights = [insight, ...shuffle(extra, rng).slice(0, Math.min(2, cfg.output.scenes - 4))];
  if (format === 'compare') insights = [insight, extra.find(i => { const o = routedFrom(U.solutions, i); return o.length && !o.some(x => x.id === solution?.id); }) || extra[0]];
  const solutions = [solution, ...insights.slice(1).map(solutionFor)].filter((x, i, a) => x && a.findIndex(y => y?.id === x.id) === i);
  const story = format === 'story' ? pickFresh(stories, rng, last('storyId', 4), 0.2) : null;
  const askQuestion = format === 'asked' && questions.length ? pickFresh(questions, rng, last('questionId', 4), 0.2) : null;

  const question = ((painPoint && painPoint.question) || s.defaultQuestion || '').replace(/\.$/, '');
  // Picked last, so everything above stays the same for the same random seed.
  const n = cfg.output.scenes;
  const shapes = (cfg.output.structures || ['classic']).filter(k => structureFits(k, n, format));
  const structure = force.structure && structureFits(force.structure, n, format) ? force.structure : pickFresh(shapes.length ? shapes : ['classic'], rng, last('structure', 2), 0.25);
  const bridgeStyle = pickFresh(Object.keys(BRIDGE_STYLES), rng, last('bridgeStyle', 2), 0.2);
  const ctaPref = CTA_FOR_STYLE[lean];
  // Give before you ask (Mindset): when 3 of the last 5 videos ended asking for a conversation, lean
  // the next ending toward giving (tie it back, no pressure).
  const asked = recent.slice(0, 5).filter(r => ASKING_CTAS.includes(r.ctaStyle)).length;
  const giving = cfg.mindset?.giveAsk !== 'off' && recent.length >= 5 && asked >= 3 ? { tie: 2, gentle: 2 } : {};
  const ctaStyle = pickFresh(Object.keys(CTA_STYLES), rng, last('ctaStyle', 2), 0.2, { ...(ctaPref ? { [ctaPref]: 2 } : {}), ...giving });
  // The shot plan, last of all, so everything above stays the same for the same random seed.
  const shots = shotPlan(n, rng, { mix: cfg.output.footageMix, allowed: cfg.output.shotTypes, recent });
  return { audience, painPoint, insight, insights, solution, solutions, question, format, structure, bridgeStyle, ctaStyle, story, askQuestion, shots, recent: recent.slice(0, 8), breaks };
}

/* ---------------- Shared with the prompt builders (lib/prompts.js, server only) ---------------- */
export const factsOf = picks => (picks?.insights?.length ? picks.insights : [picks?.insight]).filter(Boolean);
export const solutionsOf = picks => (picks?.solutions?.length ? picks.solutions : [picks?.solution]).filter(Boolean);
export { isVoice, accentOn, qualifiersIn, firstWords };

// Code checks for one hook: the same rules as scene 1 of a script.
export function validateHook(h, cfg, picks) {
  const problems = [], o = cfg.output, N = nicheOf(cfg);
  const text = String(h?.text || '').trim(), say = String(h?.say || '').trim();
  if (!text) return ['empty'];
  const heard = `${isVoice(cfg) ? say : ''} ${text}`;
  const allowed = [...factsOf(picks).map(f => f.text), picks.story?.text || ''].join(' ').toLowerCase();
  if (countWords(text) > o.maxWords) problems.push('too long');
  if (isVoice(cfg) && (!say || countWords(say) > o.maxSpoken)) problems.push('spoken line missing or too long');
  if (/\p{Extended_Pictographic}|#\w/u.test(heard)) problems.push('emoji or hashtag');
  if (/\$\s?\d|\d+\s?%|\bpercent\b/i.test(heard)) problems.push('price or percentage');
  if (N.eligibility.some(re => re.test(heard))) problems.push('implies they qualify');
  if (govHits(heard, N).length) problems.push('government wording');
  if (clicheHits(heard).length) problems.push('overused phrase');
  guardrailsFor(cfg).neverUse.forEach(w => { if (new RegExp(`\\b${escRe(w.toLowerCase())}\\b`).test(heard.toLowerCase())) problems.push(`banned phrase "${w}"`); });
  N.absolutes.forEach(([re, label]) => { if (re.test(heard) && !re.test(allowed)) problems.push(`absolute claim "${label}"`); });
  if ((picks.recent || []).some(r => r.hook && (similarity(text, r.hook) >= 0.6 || firstWords(text) === firstWords(r.hook)))) problems.push('too close to a recent hook');
  return problems;
}

/* ---------------- Style notes: soft, never block a video ---------------- */
// What tends to lose each communication style, checked lightly. These give the writer one chance to
// reword; a script that still has them is used anyway (style shapes wording, never the rules).
const URGENCY = /\b(hurry|limited time|act (now|fast|today)|right now|before it'?s too late|today only|asap|don'?t miss)\b/i;
const HYPE = /\b(amazing|incredible|unbelievable|huge|insane|best ever|life-changing|mind-blowing)\b/i;
// `longest`: a Direct audience's line limit (a few words under the agent's own spoken limit).
export function styleNotes(heard, scenes, style, longest = 16) {
  const k = normStyle(style), primary = k[0], out = [];
  if (!primary) return out;
  const all = heard.join(' ');
  if (k.includes('S') && URGENCY.test(all)) out.push('This audience leans Steady: drop the urgency ("' + all.match(URGENCY)[0] + '"). Calm and no pressure lands better.');
  if (k.includes('C') && HYPE.test(all)) out.push('This audience leans Careful: drop the hype word ("' + all.match(HYPE)[0] + '"). Plain, precise wording lands better.');
  if (primary === 'D') {
    const long = scenes.map((sc, i) => (countWords(sc.say || sc.text || '') > longest ? i + 1 : 0)).filter(Boolean);
    if (long.length) out.push(`This audience leans Direct: tighten scene${long.length > 1 ? 's' : ''} ${long.join(', ')} to ${longest} words or fewer.`);
  }
  return out;
}

// Which style an audience's real messages read as, from the reply helper's reads (lib/coach.js →
// draftReplies). After `min` reads, if one style clearly leads and it isn't the audience's main style,
// suggest it. reads: [{ audienceId, style }].
export function styleCalibration(audiences = [], reads = [], min = 10) {
  return audiences.map(a => {
    const mine = reads.filter(r => r.audienceId === a.id && STYLES[normStyle(r.style)[0]]);
    const counts = {};
    mine.forEach(r => { const k = normStyle(r.style)[0]; counts[k] = (counts[k] || 0) + 1; });
    const [top, n] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0] || [];
    const set = normStyle(a.style)[0] || '';
    const enough = mine.length >= min, clear = enough && n / mine.length >= 0.6;
    return { audienceId: a.id, total: mine.length, counts, top: top || '', share: mine.length ? Math.round((n / mine.length) * 100) : 0, set, suggest: clear && top !== set ? top : '' };
  });
}

/* ---------------- Render rules (v15): every check, what kind it is, and how strict ---------------- */
// Every check a script can fail has an id here. Three kinds, the same everywhere (Studio, Fix a scene,
// ✦ Ideas, the coach, automatic videos):
//   locked   platform compliance: a claim that could mislead a client or break advertising rules. It
//            always stops a render, can't be turned down (only shown, in Admin → Render rules), and
//            comes with a one-tap fix so nobody is ever stuck.
//   the rest style and craft: each has a level for drafts people write (Studio, Fix a scene) and one for
//            automatic videos: 'block' (must pass; the writer rewrites), 'warn' (a yellow note that never
//            stops a render) or 'off'. Admin can change both, for everyone or one workspace (cfg.rules,
//            filled in by the server: lib/rules.js).
// Some problems are fixed for the agent ('fix'): a highlighted word that differs only in capitals just
// matches; one that isn't in the caption is picked from it; a missing footage search is filled in.
export const RULES = {
  price: { locked: true, label: 'Prices, percentages and price comparisons', about: 'Prices depend on each person, so videos never quote or compare them.', example: '“$30 a month”, “less than your monthly coffee”, “pennies a day”' },
  rates: { locked: true, label: 'Rate and urgency wording', about: 'Talk of rates rising or locking them in is a price claim and pressure.', example: '“lock in your low rate”, “rates are going up”' },
  numbers: { locked: true, label: 'Numbers or ages the facts don’t have', about: 'A number is a claim; only the confirmed facts can make one.', example: '“after 65”, “in 10 years”' },
  qualify: { locked: true, label: 'Saying the viewer will qualify', about: 'Coverage depends on qualifying.', example: '“you’ll qualify”, “anyone can get covered”' },
  government: { locked: true, label: 'Government wording', about: 'Words that make private coverage sound government-backed.', example: '“Social Security”, “program”, “burial benefit”' },
  absolute: { locked: true, label: 'Absolute claims the facts don’t make', about: 'A promise for everyone, unless a confirmed fact says it.', example: '“always”, “everyone”, “no exam”' },
  qualifier: { locked: true, label: 'Dropped qualifier', about: 'Without its “often” or “usually”, a fact becomes an absolute claim. It must also be on screen.', example: 'the fact says “often”; the script doesn’t' },
  banned: { locked: true, label: 'Banned phrases', about: 'The platform’s and the agent’s own.', example: '“guaranteed”, “act now”, “my clients”' },
  required: { locked: true, label: 'Wording the agent requires', about: 'Phrases the agent (or a solution) must always say.', example: 'a required “Licensed agent”' },
  facts: { locked: true, label: 'Unconfirmed facts', about: 'Videos only teach facts the agent confirmed.', example: 'a fact that’s due for review' },
  complete: { locked: true, label: 'A caption (and spoken line) in every scene', about: 'There has to be something to show and say.', example: 'an empty scene' },
  cliche: { draft: 'warn', auto: 'block', label: 'Overused ad wording', about: 'Phrases that sound like an ad (or like AI). Each comes with a plainer suggestion.', example: '“peace of mind”, “navigate”', list: 'cliches' },
  factMatch: { draft: 'warn', auto: 'off', label: 'Teaching scenes say the fact', about: 'The teaching scenes keep most of the confirmed fact’s key words.', example: 'a fact about “final expenses” taught without them', setting: 'factMatch' },
  accent: { draft: 'warn', auto: 'block', label: 'The highlighted word', about: 'One or two words from the caption, not a weak word.', example: 'highlighting “the”, or a word that isn’t in the caption', list: 'noHighlight' },
  length: { draft: 'warn', auto: 'block', label: 'Caption and spoken word limits', about: 'Short lines read in time.', example: 'a 19-word caption', setting: ['captionWords', 'spokenWords'] },
  fresh: { draft: 'warn', auto: 'block', label: 'Too close to a recent video', about: 'The opening, bridge and call to action don’t repeat recent videos.', example: 'the same opening as last week', setting: 'recentCount' },
  questions: { draft: 'warn', auto: 'block', label: 'Where questions go', about: 'Only the opening (and the bridge) ask questions.', example: 'a question in a teaching scene' },
  footage: { draft: 'off', auto: 'block', label: 'Footage search rules', about: 'Written searches name who’s in the shot, in a few concrete words.', example: '“insurance plan” (abstract)', list: 'abstract' },
  cta: { draft: 'warn', auto: 'block', label: 'The call to action', about: 'The last scene says the agent’s call to action.', example: 'a last scene that doesn’t invite a message' },
  symbols: { draft: 'warn', auto: 'block', label: 'Emoji and hashtags', about: 'They don’t belong in captions or the voice.', example: '“#lifeinsurance”' },
  energy: { draft: 'warn', auto: 'block', label: 'Exclamation marks', about: 'Calm energy has none; high energy one.', example: '“Call me today!” in a calm voice' },
  style: { draft: 'warn', auto: 'warn', label: 'Style fit and reading level', about: 'What lands with the audience’s communication style, and the reading level.', example: 'urgency for a Steady audience' },
  product: { draft: 'warn', auto: 'warn', label: 'Another product or audience', about: 'Lines about a different product line than the video’s.', example: '“term policy” in a final expense video' },
  spelling: { draft: 'warn', auto: 'off', label: 'Spelling', about: 'Words that aren’t in the dictionary or the agent’s own words, with a one-tap correction.', example: '“afforadable”, “its” for “it’s”' },
};
export const RULE_SETTINGS = {
  factMatch: { label: 'How much of the fact the teaching scenes must say', min: 0.3, max: 0.8, step: 0.05, def: 0.5, unit: 'share of its key words' },
  captionWords: { label: 'Caption word limit (blank: the workspace’s setting)', min: 6, max: 20, step: 1, def: null, unit: 'words' },
  spokenWords: { label: 'Spoken line word limit (blank: the workspace’s setting)', min: 10, max: 40, step: 1, def: null, unit: 'words' },
  recentCount: { label: 'Recent videos that count for “too close”', min: 3, max: 50, step: 1, def: 30, unit: 'videos' },
};
export const RULE_LISTS = {
  cliches: { label: 'Overused ad phrases', base: () => CLICHES },
  abstract: { label: 'Abstract footage words', base: N => N.abstractKeywords },
  noHighlight: { label: 'Words never to highlight', base: N => accentBanned(N) },
};
export const LEVELS_OK = ['block', 'warn', 'off'];
// The rules in force for a workspace: the built-in defaults, then Admin's (cfg.rules).
export function rulesOf(cfg) {
  const R = cfg?.rules || {}, N = nicheOf(cfg);
  const level = (id, ctx = 'auto') => {
    const r = RULES[id];
    if (!r || r.locked) return 'block';
    const set = R.levels?.[id]?.[ctx];
    return LEVELS_OK.includes(set) ? set : r[ctx] || 'block';
  };
  const setting = k => {
    const s = RULE_SETTINGS[k], raw = R.settings?.[k];
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) return s.def;
    return Math.min(s.max, Math.max(s.min, Number(raw)));
  };
  const list = k => {
    const L = RULE_LISTS[k], add = (R.lists?.[k]?.add || []).map(x => String(x).toLowerCase().trim()).filter(Boolean);
    const remove = new Set((R.lists?.[k]?.remove || []).map(x => String(x).toLowerCase().trim()));
    return uniq([...L.base(N), ...add]).filter(w => !remove.has(w.toLowerCase()));
  };
  return { level, setting, list };
}

// Plainer words for overused ad phrases (the one-tap fix offered with the note). '' = just take it out.
export const PLAINER = {
  'peace of mind': 'less to worry about', navigate: 'work through', navigating: 'working through', journey: 'next steps', "it's important to note": '', "don't wait": '',
  'protect what matters most': 'look after your family', 'secure your future': 'plan ahead', 'secure your family': 'look after your family', safeguard: 'protect', unlock: 'open',
  'game changer': 'big help', 'game-changer': 'big help', "in today's world": '', 'at the end of the day': '', 'worry-free': 'calmer', 'look no further': '', tailored: 'fitted to you',
  comprehensive: 'full', delve: 'look', embark: 'start', 'rest easy': 'relax', 'life happens': 'things come up', 'leave a legacy': 'leave something behind',
  'when the unexpected happens': 'if something happens', 'the unexpected': 'surprises',
};
// Price comparisons to everyday costs, and rate and urgency talk: both are price claims.
export const PRICE_COMPARE = /\b(?:less|cheaper|lower) than (?:(?:a|an|the|your|one|two|daily|weekly|monthly|single|cup of|morning|night's?|of)\s+){0,4}(?:coffees?|lattes?|lunch(?:es)?|dinners?|meals?|movies?|movie tickets?|streaming|netflix|subscriptions?|phone bill|cell phone|gym|sodas?|pizzas?|takeout|take-out|nights? out|gas|cable|coffee habit|habit)\b|\bpennies (?:a|per) day\b|\b(?:a|one|two|few) dollars? (?:a|per) (?:day|week|month)\b|\b(?:for )?(?:about |around )?the (?:price|cost) of (?:a|an|your|one)\b|\b(?:same|as much) as (?:(?:a|an|your|one|the)\s+)?(?:\w+\s+){0,2}(?:coffees?|lattes?|lunch(?:es)?|dinners?|movies?|streaming)\b/i;
export const RATE_TALK = /\block(?:ing|ed)? in (?:(?:your|a|the|today's|today’s|these|those)\s+)?(?:(?:low|lower|lowest|current|great|good)\s+)?(?:rates?|prices?|premiums?)\b|\b(?:rates?|prices?|premiums?) (?:are|is|will|could|might|keep|keeps) (?:going |go |about to go )?(?:up|rising|rise|increasing|climbing)\b|\bbefore (?:the |your )?(?:rates?|prices?|premiums?) (?:go up|goes up|rise|rises|increase|increases|climb)\b|\b(?:low|lowest|best|cheap|cheapest) (?:rates?|premiums?)\b|\b(?:rates?|premiums?) (?:go|goes) up (?:every|each|with every|with each) (?:year|birthday)\b/i;

// The caption with one spelling correction made where the word is (never inside another word), or null
// if the caption has changed since it was checked.
export function spellFixed(text, m) {
  const t = String(text || ''), w = String(m.word);
  if (Number.isInteger(m.at) && t.slice(m.at, m.at + w.length) === w) return t.slice(0, m.at) + m.suggestion + t.slice(m.at + w.length);
  const re = new RegExp(`(^|[^A-Za-z’'])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z’'])`);
  const hit = re.exec(t);
  return hit ? t.slice(0, hit.index + hit[1].length) + m.suggestion + t.slice(hit.index + hit[0].length) : null;
}
// One-tap fixes. A fix is { label, edits: [{ i, field, value }] } (applied as is), { label, rewrite: i }
// (rewrite that scene, told what to avoid) or { label, action } ('fill': write the empty scenes,
// 'nofact': teach no specific fact, 'facts': open Content → Facts).
const tidyLine = (t, was = '') => {
  let s = String(t).replace(/\s*,\s*,\s*/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,;:])[,;:]+/g, '$1').replace(/(?<!\.)\.\.(?!\.)/g, '.').replace(/([!?])\.(?!\.)/g, '$1').replace(/([,;:])(?=[.!?])/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:.–—-]+/, '').trim();
  if (/^[A-Z“‘"']/.test(String(was).trim()) && s) s = s[0].toUpperCase() + s.slice(1);
  return s;
};
// A line left hanging once something is taken out ("Plans can cost", "Coverage for only"): it needs
// rewriting, not trimming.
const HANG_WORDS = '(?:costs?|costing|pay|pays|paying|for|at|from|only|just|about|around|under|over|of|to|than|like|as|is|are|be|was|can|could|will|and|or|but|with|by|per|a|an|the|your|my|our|starting|starts|start|low|less|more)';
const HANGING = new RegExp(`\\b${HANG_WORDS}[.!?…]*$`, 'i'), HANGS_BEFORE = new RegExp(`\\b${HANG_WORDS}\\s*$`, 'i');
export const leftHanging = (t, was = '') => { const w = wordsIn(t); return !w.length || (w.length < 3 && wordsIn(was).length > 3) || HANGING.test(String(t).trim()); };
// Taking out each piece `re` matches would cut a phrase in two ("plans for $30 a month are…" → "for are").
// …or leave the next word with nothing to hang on ("Plans run 5% of what you think" → "run of what").
const HANGS_AFTER = /^\s*(?:of|than|per|off|more|less|cheaper|lower|higher|a (?:month|year|week|day))\b/i;
const cutsPhrase = (v, re) => [...v.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].some(m => HANGS_BEFORE.test(v.slice(0, m.index) + (m[1] && m[0].startsWith(m[1]) ? m[1] : '')) || HANGS_AFTER.test(v.slice(m.index + m[0].length)));
const fixFields = (scenes, voice, i, re, to, label) => {
  const s = scenes[i] || {}, edits = [];
  for (const f of voice ? ['text', 'say'] : ['text']) {
    const v = String(s[f] || '');
    re.lastIndex = 0;
    if (!re.test(v)) continue;
    re.lastIndex = 0;
    const value = tidyLine(v.replace(re, to), v);
    if ((!to || to === '$1') && (leftHanging(value, v) || cutsPhrase(v, re))) return null;
    edits.push({ i, field: f, value });
  }
  return edits.length ? { label, edits } : null;
};
const rewriteFix = (i, label = 'Rewrite this line for me') => (Number.isInteger(i) ? { label, rewrite: i } : null);
const reOf = phrase => new RegExp(`(^|[^a-z’'])(${escRe(phrase)})(?=[^a-z’']|$)`, 'gi');
// Puts a fact's qualifier back: before the word it came before in the fact, or at the start of the line
// ("Often, …") for the ones that read that way. null when it can't be placed by itself (rewrite instead).
function putQualifierBack(scenes, i, fact, q, voice, onScreenOnly) {
  const fw = wordsIn(fact.text), next = fw[fw.indexOf(q) + 1], s = scenes[i] || {}, edits = [];
  for (const f of onScreenOnly || !voice ? ['text'] : ['text', 'say']) {
    const v = String(s[f] || '');
    if (!v || qualifiersIn(v).includes(q)) continue;
    const at = next ? v.search(new RegExp(`\\b${escRe(next)}\\b`, 'i')) : -1;
    if (at >= 0) edits.push({ i, field: f, value: `${v.slice(0, at)}${q} ${v.slice(at)}` });
    else if (QUALIFIER_GROUPS[0].includes(q)) edits.push({ i, field: f, value: `${q[0].toUpperCase()}${q.slice(1)}, ${v[0]?.toLowerCase() || ''}${v.slice(1)}` });
    else return null;
  }
  return edits.length ? { label: `Put “${q}” back`, edits } : null;
}
const ABSOLUTE_SWAPS = [[/\balways\b/gi, 'often'], [/\beveryone\b/gi, 'many people'], [/\banyone (can|will)\b/gi, 'many people $1']];
const PRICE_TOKEN = /\$\s?\d[\d,.]*(?:\s?(?:a|per|\/)\s?(?:month|mo|year|yr|day|week))?|\b\d+(?:\.\d+)?\s?%|\b\d+\s?percent\b/gi;
const SYMBOLS = /\s*(?:\p{Extended_Pictographic}|#\w+)/gu;

/* ---------------- Validate: hard rules, checked in code ---------------- */
const govHits = (text, N = nicheOf(null)) => N.govTerms.filter(([re]) => re.test(text)).map(t => t[1]);

// Checks a script. Returns { ok, problems, soft, findings, data }:
//   problems  what must change (locked rules, and rules set to 'block'), then the soft notes
//   soft      notes that never stop it (rules set to 'warn')
//   findings  the same, structured for the screens: { rule, kind: 'stop' | 'warn' | 'fix', scene (0-based
//             or null), text, fix? } (stages/script.js and the writer only use the strings)
// `picks.person`: a draft a person wrote (Studio, Fix a scene): the 'draft' levels apply, and a few
// problems the app can fix itself ('fix') never count against it.
export function validateScript(raw, cfg, picks = null) {
  const problems = [], soft = [], findings = [], N = nicheOf(cfg), R = rulesOf(cfg);
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { return { ok: false, problems: ['The reply isn’t valid JSON.'], soft: [], findings: [], data: null }; }
  }
  const scenes = data && data.scenes;
  if (!Array.isArray(scenes)) return { ok: false, problems: ['Missing the "scenes" array.'], soft: [], findings: [], data };

  const o = cfg.output, g = guardrailsFor(cfg), voice = isVoice(cfg), person = !!picks?.person, ctx = person ? 'draft' : 'auto';
  const maxWords = R.setting('captionWords') ?? o.maxWords, maxSpoken = R.setting('spokenWords') ?? o.maxSpoken;
  // Every problem goes through here: its rule decides whether it stops the video, is a note, or is off.
  const add = (rule, text, scene = null, fix = null, { softOnly = false, kind = '' } = {}) => {
    let lvl = R.level(rule, ctx);
    if (softOnly && lvl === 'block') lvl = 'warn';
    if (lvl === 'off' && kind !== 'fix') return;   // (what the app fixes by itself, it always fixes)
    const k = kind || (lvl === 'block' ? 'stop' : 'warn');
    if (k === 'stop') problems.push(text); else if (k === 'warn') soft.push(text);
    findings.push({ rule, kind: k, scene, text, ...(fix ? { fix } : {}) });
  };
  if (scenes.length !== o.scenes) add('complete', `Has ${scenes.length} scenes; needs exactly ${o.scenes}.`);

  // Everything the viewer sees or hears, per scene.
  const heard = scenes.map(sc => `${voice ? String(sc.say || '') : ''} ${String(sc.text || '')}`.trim());
  const facts = factsOf(picks);
  // Absolute words are only allowed when a fact (or the agent's own story) says them.
  const insightText = [...facts.map(f => f.text), picks?.story?.text || ''].join(' ').toLowerCase();
  const noHighlight = R.list('noHighlight'), abstractWords = R.list('abstract');
  // The numbers a script may say: the facts', the agent's own story's, its call to action and required
  // wording (a phone number, "Route 66"), and a list video's count.
  const own = [...facts.map(f => f.text), picks?.story?.text || '', cfg.story?.ctaAction || '', ...g.mustUse].join(' ');
  const listCount = picks?.format === 'list' ? Math.max(1, facts.length) : 0;
  const okNums = new Set([...(own.match(/\d+/g) || []), ...(listCount ? [String(listCount)] : [])]);
  const factText = facts.map(f => f.text).join(' ').toLowerCase(), ownLower = own.toLowerCase();
  const okWords = new Set([...NUMBER_WORDS.filter(w => new RegExp(`\\b${w}\\b`).test(ownLower)), ...(listCount && COUNT_WORDS[listCount] ? [COUNT_WORDS[listCount]] : [])]);
  const factPrice = factText.match(PRICE_WORDS)?.[0].toLowerCase();

  scenes.forEach((sc, i) => {
    const n = i + 1, text = String(sc.text || ''), say = String(sc.say || ''), kw = String(sc.keyword || '');
    if (!text) add('complete', `Scene ${n} has no "text".`, i, { label: 'Write the empty scenes for me', action: 'fill' });
    if (voice && !say) add('complete', `Scene ${n} has no "say".`, i, text ? { label: 'Say the caption', edits: [{ i, field: 'say', value: text }] } : null);
    if (!kw) {
      // A draft's missing footage search is filled in for them (the audience's own searches, or the caption).
      const guess = person ? (picks?.audience?.searches?.[i % Math.max(1, picks.audience.searches.length)] || `${String(picks?.audience?.visual || 'older couple').split(',')[0].trim()} at home`) : '';
      if (person) add('footage', `Scene ${n} has no footage search, so it uses “${guess}”.`, i, { label: `Search for “${guess}”`, edits: [{ i, field: 'keyword', value: guess }] }, { kind: 'fix' });
      else problems.push(`Scene ${n} has no "keyword".`), findings.push({ rule: 'complete', kind: 'stop', scene: i, text: `Scene ${n} has no "keyword".` });
    }
    if (countWords(text) > maxWords) add('length', `Scene ${n} caption is ${countWords(text)} words; the limit is ${maxWords}.`, i, rewriteFix(i, 'Shorten it for me'));
    if (voice && countWords(say) > maxSpoken) add('length', `Scene ${n} "say" is ${countWords(say)} words; the limit is ${maxSpoken}.`, i, rewriteFix(i, 'Shorten it for me'));
    // Footage searches the agent types (Studio, Fix a scene) are theirs: any words, any subject.
    // Written ones follow the shot plan: people shots name who is in them; the rest show places,
    // objects or light. Without a plan (older videos), every shot names a person.
    const manual = !!picks?.manualFootage, shot = SHOT_TYPES[picks?.shots?.[i]];
    if (!manual && countWords(kw) > (shot ? 5 : 4)) add('footage', `Scene ${n} keyword "${kw}" is more than ${shot ? 5 : 4} words.`, i);
    if (!manual && kw && (!shot || shot.human) && !wordsIn(kw).some(w => PEOPLE_WORDS.includes(w))) add('footage', `Scene ${n} keyword "${kw}" doesn't say who is in the shot. Start it with a person, like "older woman" or "parents".`, i);
    if (accentOn(cfg)) {
      const acc = String(sc.accent || '').trim();
      const pick = suggestAccent(text, cfg);
      // In a person's draft, a missing or mismatched highlight is simply picked from the caption.
      if (!acc) add('accent', `Scene ${n} has no "accent".`, i, pick ? { label: `Highlight “${pick}”`, edits: [{ i, field: 'accent', value: pick }] } : null, person ? { kind: 'fix' } : {});
      else if (countWords(acc) > 2) add('accent', `Scene ${n} accent "${acc}" is more than 2 words.`, i, pick ? { label: `Highlight “${suggestAccent(acc, cfg) || pick}”`, edits: [{ i, field: 'accent', value: suggestAccent(acc, cfg) || pick }] } : null, person ? { kind: 'fix' } : {});
      else if (!text.toLowerCase().replace(/[‘’]/g, "'").includes(acc.toLowerCase().replace(/[‘’]/g, "'"))) add('accent', person ? `Scene ${n}: the highlighted word “${acc}” isn’t in the caption${pick ? `, so “${pick}” is highlighted instead` : ''}.` : `Scene ${n} accent "${acc}" isn't copied exactly from its "text".`, i, pick ? { label: `Highlight “${pick}”`, edits: [{ i, field: 'accent', value: pick }] } : null, person ? { kind: 'fix' } : {});
      else if (wordsIn(acc).every(w => noHighlight.includes(w))) add('accent', `Scene ${n} accent "${acc}" is a weak word to highlight. Pick the word with the most feeling or benefit, not a qualifier, product term or the call to action.`, i, pick && pick.toLowerCase() !== acc.toLowerCase() ? { label: `Highlight “${pick}”`, edits: [{ i, field: 'accent', value: pick }] } : null);
    }
    const abstract = manual ? [] : wordsIn(kw).filter(w => abstractWords.includes(w));
    if (abstract.length) add('footage', `Scene ${n} keyword "${kw}" uses an abstract word ("${abstract[0]}"). Describe a real scene with people or a place.`, i);
    if (/\p{Extended_Pictographic}/u.test(heard[i])) add('symbols', `Scene ${n} contains an emoji.`, i, fixFields(scenes, voice, i, SYMBOLS, '', 'Take it out') || rewriteFix(i));
    if (/#\w/.test(heard[i])) add('symbols', `Scene ${n} contains a hashtag.`, i, fixFields(scenes, voice, i, SYMBOLS, '', 'Take it out') || rewriteFix(i));
    if (/\$\s?\d|\d+\s?%|\bpercent\b/i.test(heard[i])) add('price', `Scene ${n} contains a price or percentage.`, i, fixFields(scenes, voice, i, PRICE_TOKEN, '', `Take out “${heard[i].match(/\$\s?\d[\d,.]*|\d+(?:\.\d+)?\s?%|\d+\s?percent/i)?.[0] || 'the price'}”`) || rewriteFix(i));
    const cmp = heard[i].match(PRICE_COMPARE);
    if (cmp) add('price', `Scene ${n} compares the cost to an everyday expense (“${cmp[0]}”). That’s a price claim, and prices depend on each person.`, i, rewriteFix(i, 'Rewrite it without the price'));
    // Numbers and ages the facts don't have, and price words ("a few dollars a month"): locked, in every
    // video (v15: automatic videos and Fix a scene too, not only Studio).
    const num = (heard[i].match(/\d+/g) || []).find(x => !okNums.has(x)) || wordsIn(heard[i].replace(NOT_A_NUMBER, ' ')).find(w => NUMBER_WORDS.includes(w) && !okWords.has(w));
    if (num) add('numbers', `Scene ${n} has the number "${num}", which isn’t in your confirmed fact. Remove it.`, i, rewriteFix(i, `Rewrite it without “${num}”`));
    const priceWord = heard[i].match(PRICE_WORDS)?.[0];
    const claim = !priceWord && !cmp && heard[i].match(PRICE_CLAIM)?.[0];
    if (claim && !factText.includes(claim.toLowerCase())) add('price', `Scene ${n} makes a claim about price (“${claim}”). What it costs depends on each person, so leave it out.`, i, rewriteFix(i, 'Rewrite it without the price'));
    if (priceWord && priceWord.toLowerCase() !== factPrice && !cmp && !/\$\s?\d|\d+\s?%|\bpercent\b/i.test(heard[i])) add('price', `Scene ${n} talks about price ("${priceWord}"), which isn’t in your confirmed fact. Prices depend on each person, so leave them out.`, i, rewriteFix(i, 'Rewrite it without the price'));
    const rate = heard[i].match(RATE_TALK);
    if (rate) add('rates', `Scene ${n} talks about rates (“${rate[0]}”). Rates going up, or locking them in, is a price claim and pressure.`, i, rewriteFix(i, 'Rewrite it without the rates'));
    const elig = N.eligibility.map(re => heard[i].match(re)).find(Boolean);
    if (elig) add('qualify', person ? `Scene ${n} implies the viewer will qualify (“${elig[0]}”).` : `Scene ${n} implies the viewer will qualify.`, i, /^you(?:'ll|’ll| will)? (?:\w+ )?qualify$/i.test(elig[0]) && /(?:^|[.!?,;:]\s*)$/.test(heard[i].slice(0, heard[i].search(new RegExp(escRe(elig[0]), 'i')))) ? fixFields(scenes, voice, i, new RegExp(escRe(elig[0]), 'gi'), 'see if you qualify', 'Say “see if you qualify”') : rewriteFix(i));
    govHits(heard[i], N).forEach(t => add('government', `Scene ${n} uses "${t}", which can make ${N.govSubject} sound government-backed. Remove it.`, i, rewriteFix(i, `Rewrite it without “${t}”`)));
    N.absolutes.forEach(([re, label]) => {
      if (!re.test(heard[i]) || re.test(insightText)) return;
      const swap = ABSOLUTE_SWAPS.find(([r]) => { r.lastIndex = 0; return r.test(label); });
      add('absolute', `Scene ${n} makes an absolute claim ("${label}") that the insight doesn't support. Soften it, for example with "may" or "many".`, i, (swap && fixFields(scenes, voice, i, new RegExp(swap[0].source, 'gi'), swap[1], `Say “${label.replace(swap[0], swap[1])}”`)) || rewriteFix(i));
    });
  });

  // A line about another product line than the video's (a term policy in a final expense video).
  const prodId = picks?.painPoint?.product || picks?.audience?.product || '';
  const lines = N.productLines || [], mine = lines.find(l => l.id === prodId);
  if (mine) heard.forEach((h, i) => {
    const other = lines.find(l => l.id !== mine.id && l.words?.test(h) && !mine.words?.test(h));
    if (other) add('product', `Scene ${i + 1} sounds like ${other.label.toLowerCase()} (“${h.match(other.words)[0]}”), but this video is about ${mine.label.toLowerCase()}.`, i, rewriteFix(i, `Rewrite it for ${mine.label.toLowerCase()}`));
  });

  const lower = heard.join(' ').toLowerCase();
  const where = re => heard.findIndex(h => re.test(h.toLowerCase()));
  g.neverUse.forEach(w => {
    const re = new RegExp(`\\b${escRe(w.toLowerCase())}\\b`);
    if (!re.test(lower)) return;
    const i = where(re), simple = !/\bclients?\b/i.test(w);
    add('banned', `Uses the banned phrase "${w}".`, i >= 0 ? i : null, i >= 0 ? (simple && fixFields(scenes, voice, i, reOf(w), '$1', `Take out “${w}”`)) || rewriteFix(i) : null);
  });
  // Phrases already on the end card (like "Licensed Agent") don't have to be in the script too.
  const L = cfg.look || {};
  const card = (L.endCard || 'on') === 'on' ? [L.name, L.title, L.location, L.endCta, L.handle].join(' ').toLowerCase() : '';
  const last = scenes.length - 1;
  const addToLast = w => (last >= 0 && scenes[last]?.text ? { label: `Add “${w}” to the last scene`, edits: [{ i: last, field: 'text', value: `${String(scenes[last].text).replace(/[.!]\s*$/, '')}. ${w}` }] } : null);
  g.mustUse.forEach(w => { if (!lower.includes(w.toLowerCase()) && !card.includes(w.toLowerCase())) add('required', `Never says "${w}".`, null, addToLast(w)); });
  solutionsOf(picks).forEach(sol => { if (sol.mustMention && !lower.includes(sol.mustMention.toLowerCase())) add('required', `The solution "${sol.text}" must be named with "${sol.mustMention}", and the script doesn't say it.`, null, addToLast(sol.mustMention)); });
  if (picks?.hook && scenes[0] && String(scenes[0].text || '').trim().toLowerCase() !== String(picks.hook.text).trim().toLowerCase()) add('complete', `Scene 1 must be the chosen opening, exactly: "${picks.hook.text}".`, 0, { label: 'Use the chosen opening', edits: [{ i: 0, field: 'text', value: picks.hook.text }] });
  const cliches = R.list('cliches');
  const cl = clicheHits(lower, cliches);
  if (cl.length) {
    const i = where(reOf(cl[0])), plain = PLAINER[cl[0]];
    const fix = i >= 0 ? fixFields(scenes, voice, i, reOf(cl[0]), plain ? `$1${plain}` : '$1', plain ? `Say “${plain}”` : `Take out “${cl[0]}”`) : null;
    add('cliche', `Uses overused ad wording ("${cl.join('", "')}"). Say it plainly instead${plain ? ` (for example “${plain}”)` : ''}.`, i >= 0 ? i : null, fix);
  }
  // The call to action, named whole (never a fragment of it).
  const ctaWhole = String(cfg.story?.ctaAction || '').trim(), action = firstWords(ctaWhole, 2);
  if (action && heard.length && !firstWords(heard[heard.length - 1], 40).includes(action)) add('cta', person ? `The last scene doesn’t say your call to action (“${ctaWhole}”).` : `The last scene (CTA) doesn't say "${action}".`, last, last >= 0 ? { label: 'Use your call to action', edits: [{ i: last, field: 'text', value: ctaWhole }] } : null);

  // Freshness: the hook, bridge and CTA can't be near-copies of recent videos.
  const recent = ((picks && picks.recent) || []).slice(0, R.setting('recentCount'));
  const plan = beatPlan(o.scenes, picks?.format || 'question', Math.max(1, facts.length), picks?.structure || 'classic');
  const bridgeAt = plan.find(b => b.beat === 'Bridge')?.from || 0;
  const tooClose = (line, key, limit) => recent.find(r => r[key] && (similarity(line, r[key]) >= limit || (key === 'hook' && firstWords(line) === firstWords(r[key]))));
  if (heard.length) {
    const h = tooClose(heard[0], 'hook', 0.6); if (h) add('fresh', `The hook is too close to a recent video ("${h.hook}"). Open a different way.`, 0, rewriteFix(0, 'Write a different opening'));
    // Bridge and CTA are soft: one chance to reword, but similar wording never blocks a video.
    const b = bridgeAt ? tooClose(heard[bridgeAt - 1] || '', 'bridge', 0.7) : null; if (b) add('fresh', `The bridge is too close to a recent video ("${b.bridge}"). Word it differently.`, bridgeAt - 1, rewriteFix(bridgeAt - 1), { softOnly: true });
    const c = tooClose(heard[heard.length - 1], 'cta', 0.85); if (c) add('fresh', `The CTA is too close to a recent video ("${c.cta}"). Word it differently.`, last, rewriteFix(last), { softOnly: true });
  }

  // Questions belong only in the hook (scene 1) and the bridge (second to last, when the structure has one).
  heard.forEach((t, i) => {
    const n = i + 1;
    if (n !== 1 && n !== bridgeAt && t.includes('?')) add('questions', bridgeAt ? `Scene ${n} is a question. Only the hook (scene 1) and the bridge (scene ${bridgeAt}) may ask questions, so make scene ${n} a statement.` : `Scene ${n} is a question. In this structure only the hook (scene 1) may ask a question, so make scene ${n} a statement.`, i, fixFields(scenes, voice, i, /\?/g, '.', 'Make it a statement'));
  });
  styleNotes(heard, scenes, normStyle(picks?.audience?.style), voice ? Math.max(10, maxSpoken - 4) : maxWords).forEach(x => add('style', x, null, null, { softOnly: true }));

  // Each fact keeps its qualifier ("usually", "may"…), and it shows on screen, not only in the voiceover.
  const captions = scenes.map(sc => String(sc.text || '')).join(' ');
  const teach = plan.filter(b => !['Hook', 'Solution', 'Bridge', 'CTA'].includes(b.beat)).flatMap(b => Array.from({ length: b.to - b.from + 1 }, (_, k) => b.from + k - 1)).filter(k => k < scenes.length);
  facts.forEach(f => {
    const need = qualifiersIn(f.text);
    if (!need.length) return;
    const have = new Set(qualifiersIn(lower)), screen = new Set(qualifiersIn(captions));
    const label = facts.length > 1 ? `the fact "${f.text.slice(0, 40)}…"` : 'the insight';
    // The qualifier goes back in the teaching scene that says the words around it in the fact ("is usually
    // a small policy" → the scene about the small policy), then the one that says the most of the fact.
    const q = need[0];
    const fw = wordsIn(f.text), qi = fw.indexOf(q), near = qi >= 0 ? keyWords(fw.slice(Math.max(0, qi - 3), qi + 4).join(' ')) : [];
    const kws = keyWords(f.text), best = (teach.length ? teach : scenes.map((_, k) => k)).map(k => { const w = keyWords(heard[k] || ''); return [k, w.filter(x => near.includes(x)).length, w.filter(x => kws.includes(x)).length]; })
      .sort((a, b) => b[1] - a[1] || b[2] - a[2])[0]?.[0] ?? 0;
    if (QUALIFIER_GROUPS.some(gr => gr.some(x => need.includes(x)) && !gr.some(x => have.has(x)))) add('qualifier', `Dropped the qualifier of ${label} ("${need.join('", "')}"). Without it the claim may be inaccurate.`, best, putQualifierBack(scenes, best, f, q, voice, false) || rewriteFix(best, `Rewrite it with “${q}”`));
    else if (QUALIFIER_GROUPS.some(gr => gr.some(x => need.includes(x)) && !gr.some(x => screen.has(x)))) add('qualifier', `The qualifier of ${label} ("${need.join('", "')}") must appear in an on-screen caption, not only in the voiceover.`, best, putQualifierBack(scenes, best, f, q, voice, true) || rewriteFix(best, `Rewrite it with “${q}”`));
  });

  // Reading level: a nudge, never a block.
  const target = GRADE_TARGET[o.readingLevel] ?? 6, grade = readingGrade(heard);
  if (grade > target + 5) add('style', `Reads at about grade ${Math.round(grade)}; aim for ${o.readingLevel}. Use shorter words and sentences.`, null, null, { softOnly: true });

  const bangs = (lower.match(/!/g) || []).length;
  const calmFix = () => { const edits = []; scenes.forEach((sc, i) => { for (const fld of voice ? ['text', 'say'] : ['text']) if (String(sc[fld] || '').includes('!')) edits.push({ i, field: fld, value: String(sc[fld]).replace(/!/g, '.') }); }); return edits.length ? { label: 'Use full stops instead', edits } : null; };
  if (cfg.voice.energy === 'low' && bangs > 0) add('energy', 'Calm energy allows no exclamation marks.', null, calmFix());
  if (cfg.voice.energy === 'high' && bangs > 1) add('energy', `High energy allows one exclamation mark; found ${bangs}.`, null, calmFix());
  return { ok: problems.length === 0, problems: [...problems, ...soft], soft, findings, data };
}

// A story from the agent's story bank must pass the same rules before it's used.
export function checkStoryText(text, cfg = null) {
  const t = String(text || '').trim(), problems = [], N = nicheOf(cfg);
  if (!t) return ['The story is empty.'];
  if (countWords(t) > 80) problems.push('Keep each story under 80 words: one moment, not the whole history.');
  if (/\$\s?\d|\d+\s?%|\bpercent\b/i.test(t)) problems.push('No prices or percentages in a story.');
  govHits(t, N).forEach(x => problems.push(`"${x}" can make ${N.govSubject} sound government-backed.`));
  N.platformGuardrails.neverUse.forEach(w => { if (new RegExp(`\\b${escRe(w)}\\b`, 'i').test(t)) problems.push(`"${w}" isn't allowed. Stories are about your own life, not clients.`); });
  return problems;
}

// A fact itself must pass the platform rules before anyone can confirm it.
export function checkInsightText(text, cfg = null) {
  const t = String(text || '').trim(), problems = [], N = nicheOf(cfg);
  if (!t) return ['The fact is empty.'];
  if (countWords(t) > 30) problems.push('Keep each fact under 30 words so it fits in a video.');
  if (/\$\s?\d|\d+\s?%|\bpercent\b/i.test(t)) problems.push('No prices or percentages in a fact.');
  govHits(t, N).forEach(x => problems.push(`"${x}" can make ${N.govSubject} sound government-backed.`));
  N.absolutes.forEach(([re, label]) => { if (re.test(t)) problems.push(`"${label}" is an absolute claim. Use "may", "many" or "usually".`); });
  N.platformGuardrails.neverUse.forEach(w => { if (new RegExp(`\\b${escRe(w)}\\b`, 'i').test(t)) problems.push(`"${w}" isn't allowed.`); });
  return problems;
}

/* ---------------- Soft notes on a fact (never block confirming) ---------------- */
// A fact with no qualifier reads as a promise for everyone. Hard problems live in checkInsightText.
export function factNotes(text) {
  const t = String(text || '').trim();
  if (!t || checkInsightText(t).length) return [];
  return qualifiersIn(t).length ? [] : ['This reads as true for everyone. Adding “usually”, “often”, “many” or “may” keeps it accurate, and scripts keep that word on screen.'];
}

/* ---------------- Studio: videos the agent builds by hand ---------------- */
// A Studio brief chooses everything roll() would: { audienceId, painId, insightIds, format, structure,
// scenes, bridgeStyle, ctaStyle, seriesId, part }. Only confirmed facts linked to the worry can be
// picked. Returns picks in the same shape as roll(), plus `problems` when the brief can't work.
// `brief.noFact` (v15): "This video doesn't teach a specific fact": any worry and audience, no fact (so
// formats that need facts aren't available, and every number or price is held back).
// The simple Studio start (v15). A format for a worry the agent just tapped: one that needs nothing
// more than the brief already has (no second fact, story or city), taking turns with the formats of
// their recent drafts (the least recently used first), so videos don't all open the same way.
export function studioFormatFor(cfg, brief, recentFormats = []) {
  const ok = Object.keys(FORMATS).filter(k => !FORMATS[k].needs && k !== 'local' && !studioPicks(cfg, { ...brief, format: k }).problems.length);
  if (!ok.length) return 'question';
  const last = k => { const i = recentFormats.indexOf(k); return i < 0 ? Infinity : i; };   // recentFormats: newest first
  return [...ok].sort((a, b) => last(b) - last(a) || ok.indexOf(a) - ok.indexOf(b))[0];
}
// Each series with the part to make next: the one after the furthest part already drafted.
export function seriesProgress(series = [], drafts = []) {
  return series.map(x => {
    const done = drafts.filter(d => d.brief?.seriesId === x.id).map(d => Math.max(0, Number(d.brief.part) || 0));
    const next = done.length ? Math.max(...done) + 1 : 0;
    return { id: x.id, label: x.label, parts: x.parts.map(p => ({ title: p.title, format: p.format })), started: done.length > 0, next: next < x.parts.length ? next : null };
  });
}
export function studioPicks(cfg, brief = {}, now = Date.now()) {
  const s = cfg.story, bank = cfg.bank || {}, U = usableRoutes(cfg, now), problems = [], noFact = !!brief.noFact;
  const pains = noFact ? s.painPoints : U.pains, auds = noFact ? s.audiences : U.audiences;
  const painPoint = pains.find(p => p.id === brief.painId) || null;
  if (!painPoint) problems.push(noFact ? 'Pick a worry.' : 'Pick a worry that has a confirmed fact.');
  const audience = (painPoint && auds.find(a => a.id === brief.audienceId && painPoint.links.includes(a.id))) || (painPoint && auds.find(a => painPoint.links.includes(a.id))) || null;
  const pool = noFact ? [] : U.insights.filter(i => painPoint && i.links.includes(painPoint.id));
  const asked = noFact ? [] : Array.isArray(brief.insightIds) ? brief.insightIds : [];
  let insights = asked.map(id => pool.find(i => i.id === id)).filter(Boolean);
  // A fact the draft was built on that's no longer usable (unconfirmed, due for review, unlinked) is
  // never swapped for another one silently: the scenes were written for that fact.
  if (painPoint && insights.length < asked.length) problems.push('A fact this draft teaches is no longer confirmed for this worry. Check it in Content, or pick another fact (and rewrite the teaching scenes).');
  if (!asked.length && pool.length) insights = [pool[0]];
  const fits = x => !x.links?.length || (painPoint && x.links.includes(painPoint.id));
  const story = (bank.stories || []).find(x => x.confirmed && x.text.trim() && fits(x)) || null;
  const askQuestion = (bank.questions || []).find(x => x.text.trim() && fits(x)) || null;
  // A series part sets its own format, so "Part 2: A common myth" is always a myth video.
  const series = (nicheOf(cfg).series || []).find(x => x.id === brief.seriesId);
  const part = series && series.parts[Math.max(0, Math.min(series.parts.length - 1, Number(brief.part) || 0))];
  let format = part && FORMATS[part.format] ? part.format : FORMATS[brief.format] ? brief.format : 'question';
  const need = FORMATS[format].needs || {};
  if (need.facts && insights.length < need.facts) problems.push(`${FORMATS[format].label} needs ${need.facts} confirmed facts for this worry.`);
  if (need.story && !story) problems.push('Mini-story needs a confirmed story in Content → Your voice.');
  if (format === 'local' && !cityOf(cfg)) problems.push('Local needs your city in Brand.');
  if (!['list', 'compare'].includes(format)) insights = insights.slice(0, 1);
  const n = Math.min(LIMITS.scenes[1], Math.max(LIMITS.scenes[0], Math.round(Number(brief.scenes) || cfg.output.scenes)));
  const structure = structureFits(brief.structure, n, format) ? brief.structure : 'classic';
  const solutionFor = i => routedFrom(U.solutions, i)[0] || null;
  const solutions = insights.map(solutionFor).filter((x, i, a) => x && a.findIndex(y => y.id === x.id) === i);
  return {
    audience, painPoint, insight: insights[0] || null, insights, solution: solutions[0] || null, solutions,
    question: ((painPoint && painPoint.question) || s.defaultQuestion || '').replace(/\.$/, ''),
    format, structure, scenes: n,
    bridgeStyle: BRIDGE_STYLES[brief.bridgeStyle] ? brief.bridgeStyle : 'depends', ctaStyle: CTA_STYLES[brief.ctaStyle] ? brief.ctaStyle : 'tie',
    story: format === 'story' ? story : null, askQuestion: format === 'asked' ? askQuestion : null,
    ...(series ? { series: { id: series.id, label: series.label, part: series.parts.indexOf(part) + 1, of: series.parts.length, title: part.title, format } } : {}),
    // Told to the writer for Studio's helpers (v15), so filled-in lines stay on the video's product.
    productLine: (() => { const l = (nicheOf(cfg).productLines || []).find(x => x.id === (painPoint?.product || audience?.product)); return l ? `${l.label} (${l.note})` : ''; })(),
    noFact, recent: [], breaks: [], problems,
  };
}

// Every check a Studio video goes through: the same rules as written scripts (at the 'draft' levels: only
// locked compliance rules stop a render; style and craft are notes), plus the ones that matter when a
// person writes it: the teaching scenes say the confirmed fact (most of its key words), and no number or
// price appears that the facts don't have. Returns { ok, problems (what stops it), soft (notes),
// findings (structured, with one-tap fixes) }.
export function studioChecks(scenes0, cfg, picks) {
  // In captions mode the spoken line isn't used, so it can't pass (or fail) a check.
  const scenes = isVoice(cfg) ? scenes0 : scenes0.map(({ say, ...x }) => x);
  const n = scenes.length, c = { ...cfg, output: { ...cfg.output, scenes: n } }, R = rulesOf(cfg);
  const r = validateScript({ scenes }, c, { ...picks, manualFootage: true, person: true });
  const findings = [...r.findings];
  const add = (rule, text, scene = null, fix = null) => { const lvl = R.level(rule, 'draft'); if (lvl !== 'off') findings.push({ rule, kind: lvl === 'block' ? 'stop' : 'warn', scene, text, ...(fix ? { fix } : {}) }); };
  const facts = factsOf(picks);
  const plan = beatPlan(n, picks.format, Math.max(1, facts.length), picks.structure || 'classic');
  const bodyScenes = plan.filter(b => !['Hook', 'Solution', 'Bridge', 'CTA'].includes(b.beat)).flatMap(b => Array.from({ length: b.to - b.from + 1 }, (_, k) => b.from + k));
  const body = new Set(keyWords(bodyScenes.map(i => `${scenes[i - 1]?.say || ''} ${scenes[i - 1]?.text || ''}`).join(' ')));
  facts.forEach(f => {
    const need = keyWords(f.text);
    const have = need.filter(w => body.has(w)).length;
    if (need.length && have / need.length < R.setting('factMatch')) add('factMatch', `The teaching scenes (${bodyScenes.length > 1 ? `scenes ${bodyScenes[0]}-${bodyScenes.at(-1)}` : `scene ${bodyScenes[0]}`}) don’t say your confirmed fact closely enough: “${f.text}”. Keep its key words, or make this a video that doesn’t teach a specific fact.`, bodyScenes[0] - 1, rewriteFix(bodyScenes[0] - 1, 'Rewrite it with the fact’s words'));
  });
  // A brief that can't work (a fact no longer confirmed, say) stops it too, with the way out.
  (picks.problems || []).forEach(p => add('facts', p, null, /fact/i.test(p) ? { label: 'Check the facts in Content', action: 'facts' } : null));
  const problems = findings.filter(f => f.kind === 'stop').map(f => f.text), soft = findings.filter(f => f.kind === 'warn').map(f => f.text);
  return { ok: !problems.length, problems, soft, findings };
}
// The scenes with every 'fix' the app makes by itself applied (a highlight picked from the caption, a
// footage search filled in). Used before rendering a person's draft.
export function applyAutoFixes(scenes, findings) {
  const out = scenes.map(s => ({ ...s }));
  for (const f of findings || []) if (f.kind === 'fix') for (const e of f.fix?.edits || []) if (out[e.i]) out[e.i][e.field] = e.value;
  return out;
}

// Every check a Studio video must pass before it renders: the same rules as written scripts, plus two
// that matter when a person writes it: the teaching scenes must say the confirmed fact (most of its key
// words), and no number may appear that the facts don't contain.
const keyWords = t => [...contentWords(t)].filter(w => !QUALIFIERS.includes(w) && w.length > 2).map(w => w.replace(/(ies|es|s)$/, ''));
// What one new line would bring to a Studio board, even a partly written one: findings ({ rule, kind,
// text, fix? }). Problems the board already had elsewhere don't count against it, but on a half-empty
// board the whole-video rules still have to be met by what's there: a teaching line carries its share of
// the fact's key words, and the qualifier word when no other teaching scene has it yet.
// line: { text, accent?, say? }.
export function lineFindings(scenes, i, line, cfg, picks) {
  const voice = isVoice(cfg);
  const next = scenes.map((s, k) => (k === i ? { ...s, text: line.text, accent: line.accent || s.accent || '', ...(line.say ? { say: line.say } : {}) } : s));
  const before = new Set(studioChecks(scenes, cfg, picks).findings.map(f => f.text));
  // Not the line's doing: the scene has no footage search (or spoken line) yet; the app fixes the rest.
  const notTheLine = f => f.kind === 'fix' || (f.scene === i && (/has no "keyword"|no footage search/.test(f.text) || (/has no "say"/.test(f.text) && !line.say)));
  const out = studioChecks(next, cfg, picks).findings.filter(f => !notTheLine(f) && (f.scene === i || (f.scene === null && !before.has(f.text))));
  const facts = factsOf(picks), n = scenes.length;
  const plan = beatPlan(n, picks.format, Math.max(1, facts.length), picks.structure || 'classic');
  const teach = plan.filter(b => !['Hook', 'Solution', 'Bridge', 'CTA'].includes(b.beat)).flatMap(b => Array.from({ length: b.to - b.from + 1 }, (_, k) => b.from + k - 1));
  const R = rulesOf(cfg);
  if (teach.includes(i) && facts.length) {
    const own = `${voice ? line.say || '' : ''} ${line.text}`;
    const others = teach.filter(k => k !== i), othersText = others.map(k => `${voice ? scenes[k]?.say || '' : ''} ${scenes[k]?.text || ''}`).join(' ');
    const othersEmpty = others.some(k => !String(scenes[k]?.text || '').trim());
    facts.forEach(f => {
      const need = qualifiersIn(f.text);
      if (need.length && QUALIFIER_GROUPS.some(gr => gr.some(q => need.includes(q)) && !gr.some(q => qualifiersIn(othersText).includes(q)) && !gr.some(q => qualifiersIn(line.text).includes(q))))
        out.push({ rule: 'qualifier', kind: 'stop', scene: i, text: `Dropped the qualifier of the insight ("${need.join('", "')}"). Without it the claim may be inaccurate.` });
      const words = keyWords(f.text), have = new Set(keyWords(own));
      if (othersEmpty && words.length && R.level('factMatch', 'draft') !== 'off' && words.filter(w => have.has(w)).length < Math.ceil((words.length * R.setting('factMatch')) / teach.length))
        out.push({ rule: 'factMatch', kind: R.level('factMatch', 'draft') === 'block' ? 'stop' : 'warn', scene: i, text: `The teaching scenes don’t say your confirmed fact closely enough: “${f.text}”.` });
    });
  }
  const seen = new Set();
  return out.filter(f => (seen.has(f.text) ? false : seen.add(f.text)));
}
// The problems that keep a line from being offered at all: only what would stop a render (locked
// compliance rules, and rules set to block). Notes travel with the line instead (lineFindings).
export function lineProblems(scenes, i, line, cfg, picks) {
  return lineFindings(scenes, i, line, cfg, picks).filter(f => f.kind === 'stop').map(f => f.text);
}

// Why a suggested line was hidden, in a few words ("dropped 'usually'", "added a number"), from the
// first problem the checks found. Shown so the agent knows what to keep if they write it themselves.
const REASONS = [
  [/qualifier of .*\("([^"]+)/i, m => `dropped “${m[1]}”`], [/qualifier/i, () => 'dropped the qualifier word'],
  [/confirmed fact closely/i, () => 'lost the fact’s key words'], [/has the number "([^"]+)"/i, m => `added a number (${m[1]})`],
  [/talks about price|price or percentage/i, () => 'mentioned a price'], [/words; the limit/i, () => 'too long'],
  [/accent/i, () => 'no word to highlight'], [/qualify/i, () => 'implied they’d qualify'], [/absolute claim/i, () => 'made an absolute claim'],
  [/banned phrase|overused/i, () => 'used banned or overused wording'], [/government/i, () => 'government wording'],
  [/is a question/i, () => 'became a question'], [/too close to a recent/i, () => 'too close to a recent video'], [/emoji|hashtag/i, () => 'emoji or hashtag'],
];
export function shortReason(problem) {
  for (const [re, f] of REASONS) { const m = String(problem).match(re); if (m) return f(m); }
  return 'broke a rule';
}
// "2 hidden: one dropped “usually”, one added a number (50)."
export function hiddenNote(reasons = []) {
  if (!reasons.length) return '';
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
  const counts = [...reasons.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map())];
  return `${reasons.length} hidden: ${counts.map(([r, k]) => `${words[k] || k} ${r}`).join(', ')}.`;
}

// Is this a usable highlight for this caption (in it, 1-2 words, not a weak word)?
export const okAccent = (acc, text, cfg = null) => { const a = String(acc || '').trim(); return !!a && countWords(a) <= 2 && String(text).toLowerCase().includes(a.toLowerCase()) && !wordsIn(a).every(w => accentBanned(nicheOf(cfg)).includes(w)); };
// A word worth highlighting in a caption the agent wrote: the longest one that isn't a weak word.
export function suggestAccent(text, cfg = null) {
  const bannedW = new Set(accentBanned(nicheOf(cfg)));
  const words = (String(text).match(/[A-Za-z’']+/g) || []).filter(w => w.length > 3 && !bannedW.has(w.toLowerCase()) && !STOP.has(w.toLowerCase()));
  return words.sort((a, b) => b.length - a.length)[0] || '';
}
const NUMBER_WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'dozen', 'half'];
const COUNT_WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
// Price wording: money words, an amount per month (or year…), a cost said per month, or "small monthly
// payments". Not "once a year", "it takes a day" or "you pay your mortgage each month".
const PRICE_WORDS = /\b(?:dollars?|bucks?|cents?|(?:\d[\d,.]*|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|few|couple)\s+(?:a|per|each) (?:month|year|week|day)|(?:costs?|costing|premiums?|priced?)\b[^.?!]{0,25}?\b(?:a|per|each) (?:month|year|week|day)|(?:small|low|tiny|affordable|cheap|cheaper|lower)\s+(?:monthly|yearly|weekly) (?:payments?|premiums?|costs?|price))\b/i;
// Affordability claims, with no amount: "costs less than you think", "pennies", "pocket change".
export const PRICE_CLAIM = /\b(?:costs?|costing|priced?|premiums?|plans?|coverage|it(?:'s|’s| is)|(?:is|are|be|can be))\b[^.?!]{0,20}?\b(?:less|cheaper|lower|more affordable) than you(?:'d)? (?:think|expect|imagine|might think)\b|\b(?:just |only |mere |a few )?(?:pennies|pocket change|spare change)\b|\b(?:small|tiny|low|little) payments? (?:a|per|each|every) (?:month|year|week|day)\b/i;
// Number words that aren't a count of anything ("the two of you", "one or two questions").
const NOT_A_NUMBER = /\b(?:the two of (?:you|us|them)|you two|one or two|a couple of)\b/gi;

/* ---------------- Proactive: what to make next, before anyone asks ---------------- */
const DAY_MS = 86400000;
export const EXPIRY_WARN_DAYS = 7;
// Gaps worth filling, most useful first, each with the one tap that fills it:
//   { kind, text, act: { make: { painId?, format?, count? } } | { tab } }
// season: a tagged worry whose season starts within 2 weeks · expiring: facts due for review within a
// week · stale: a worry with no video in 30 days · untried: a format on but unused in 60 days ·
// stuck: an audience with no confirmed facts.
export function gaps(cfg, videos = [], now = Date.now()) {
  const s = cfg.story, U = usableRoutes(cfg, now), out = [];
  const made = (pred, days) => videos.some(v => pred(v) && now - Date.parse(v.createdAt || 0) < days * DAY_MS);
  // Season soon: tagged for next month, not this one, and this month ends within 14 days.
  const m = monthIn(cfg.profile?.timezone, now), next = (m % 12) + 1, soon = monthIn(cfg.profile?.timezone, now + 14 * DAY_MS) === next;
  if (soon) U.pains.filter(p => (p.months || []).includes(next) && !(p.months || []).includes(m)).slice(0, 2)
    .forEach(p => out.push({ kind: 'season', text: `“${p.text}” comes into season in ${MONTHS[next - 1]}. Have a few ready before it starts.`, act: { make: { painId: p.id, count: 3 } } }));
  const expiring = s.insights.filter(i => insightStatus(i, now) === 'confirmed' && (now - Date.parse(i.confirmedAt)) / DAY_MS > FACT_REVIEW_DAYS - EXPIRY_WARN_DAYS);
  if (expiring.length) out.push({ kind: 'expiring', text: `${expiring.length} fact${expiring.length > 1 ? 's are' : ' is'} due for review within a week. Re-confirm ${expiring.length > 1 ? 'them' : 'it'} so videos don’t stop.`, act: { tab: 'insights' } });
  if (videos.length) {
    U.pains.filter(p => !made(v => v.meta?.painId === p.id, 30)).slice(0, 3)
      .forEach(p => out.push({ kind: 'stale', text: `No video on “${p.text}” in a month.`, act: { make: { painId: p.id } } }));
    const fits = f => f !== 'local' || cityOf(cfg);
    (cfg.output.formats || []).filter(f => FORMATS[f] && fits(f) && !made(v => v.meta?.format === f, 60)).slice(0, 2)
      .forEach(f => out.push({ kind: 'untried', text: `You haven’t tried the ${FORMATS[f].label} format lately.`, act: { make: { format: f } } }));
  }
  s.audiences.filter(a => s.painPoints.some(p => p.links.includes(a.id)) && !U.audiences.some(x => x.id === a.id)).slice(0, 2)
    .forEach(a => {
      // Facts that would reach this audience, but only through links that don't fit, explain themselves.
      const viaBlocked = s.painPoints.some(p => p.links.includes(a.id) && (U.blocked?.has(linkKey(p.id, a.id)) || s.insights.some(i => i.links.includes(p.id) && U.blocked?.has(linkKey(i.id, p.id)))));
      out.push(viaBlocked ? { kind: 'stuck', text: `“${a.text}” only reaches its facts through links that don’t fit, so no videos are made for them.`, act: { tab: 'routes' } } : { kind: 'stuck', text: `“${a.text}” has no confirmed facts yet, so no videos are made for them.`, act: { tab: 'insights' } });
    });
  return out;
}

// Day of the week (0 = Sunday) in the agent's time zone.
export function weekdayIn(tz, t = Date.now()) {
  try { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Denver', weekday: 'short' }).format(new Date(t))); }
  catch { return new Date(t).getUTCDay(); }
}
// Posting plan running low: fewer videos the plan can post (the same ones it picks: approved, file
// still there, not already scheduled) than posting days in the next `days`. `postedToday`: today's
// plan post already went out, so today doesn't count. Returns { approved, needed } when low, else null.
// The next `n` local dates (today first) in a time zone, stepped by the calendar: adding 24 hours
// instead would skip a day (or repeat one) when the clocks change.
export function localDates(tz, now = Date.now(), n = 7) {
  let today;
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); } catch { today = new Date(now).toISOString().slice(0, 10); }
  return Array.from({ length: n }, (_, d) => new Date(Date.parse(`${today}T12:00:00Z`) + d * DAY_MS).toISOString().slice(0, 10));
}
export const weekdayOfDate = date => new Date(`${date}T12:00:00Z`).getUTCDay();
export function runningLow(cfg, videos = [], now = Date.now(), days = 3, { postedToday = false } = {}) {
  const ap = cfg.schedule?.autopost;
  if (!ap?.on || !ap.days?.length) return null;
  let needed = 0;
  for (const date of localDates(cfg.profile?.timezone, now, days).slice(postedToday ? 1 : 0)) if (ap.days.includes(weekdayOfDate(date))) needed++;
  const approved = videos.filter(v => planReady(v, ap.platforms)).length;
  return approved < needed ? { approved, needed } : null;
}

// Week-ahead: the next 7 days, what each posting day already has, and how far ahead the agent is set.
// With the posting plan on: its days, filled first by posts already scheduled for that day, then by
// approved videos the plan can post (in order), then by videos still in review (likely, not certain).
// With it off: the agent's own weekly goal (`goal` posts); only the count matters, not the days. `postedToday`: today's plan post already went out.
//   { plan, days: [{ date, wd, post, has: 'scheduled'|'approved'|'review'|'' }], through, whole, short, ready, review }
const WD_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function weekAhead(cfg, videos = [], now = Date.now(), { postedToday = false, goal = 3 } = {}) {
  const tz = cfg.profile?.timezone || 'America/Denver', ap = cfg.schedule?.autopost || {};
  const dateIn = t => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); } catch { return new Date(t).toISOString().slice(0, 10); } };
  // Seven local dates, stepped by calendar day (so a daylight-saving change never repeats or skips one).
  const today = dateIn(now), dates = Array.from({ length: 7 }, (_, d) => new Date(Date.parse(`${today}T12:00:00Z`) + d * DAY_MS).toISOString().slice(0, 10));
  const places = ap.platforms?.length ? ap.platforms : ['instagram'];
  // Each scheduled video once (on Instagram and Facebook it's still one video), on its first date, inside the week.
  const schedDate = new Map();
  videos.forEach(v => [v.autopost, v.fbpost].filter(p => p?.status === 'scheduled' || p?.status === 'processing').forEach(p => {
    const d = dateIn(Date.parse(p.at));
    if (dates.includes(d) && (!schedDate.has(v.id) || d < schedDate.get(v.id))) schedDate.set(v.id, d);
  }));
  const sched = [...schedDate.values()];
  const ready = videos.filter(v => planReady(v, places)).length, review = videos.filter(v => v.status === 'pending').length;
  const plan = !!(ap.on && ap.days?.length);
  let a = ready, r = review;
  // With the plan on, each plan day posts one approved video (posts scheduled by hand are extra).
  const days = dates.map((date, d) => {
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay(), extra = sched.includes(date);
    const post = plan ? ap.days.includes(wd) && !(d === 0 && postedToday) : extra;
    let has = '';
    if (plan && post) { if (a > 0) { a--; has = 'approved'; } else if (r > 0) { r--; has = 'review'; } }
    else if (extra) has = 'scheduled';
    return { date, wd, day: WD_NAMES[wd], post: post || extra, has, extra };
  });
  const posting = plan ? days.filter(x => x.post && ap.days.includes(x.wd) && !(x.date === today && postedToday)) : [];
  const firstGap = posting.findIndex(x => x.has !== 'approved');
  const covered = firstGap < 0 ? posting : posting.slice(0, firstGap);
  return {
    plan, days, ready, review, scheduled: sched.length, goal,
    through: plan && covered.length ? covered[covered.length - 1].day : '',
    whole: plan ? posting.length > 0 && firstGap < 0 : ready + sched.length >= goal,
    short: plan ? posting.filter(x => !x.has).length : Math.max(0, goal - ready - sched.length - review),
  };
}

// When this agent's posts do best, from Instagram results: the local hour with the most views per
// post, once there's enough to tell (8+ posts with results, 3+ at that hour, 25%+ above average).
export function bestPostingHour(videos = [], tz = 'America/Denver') {
  // Only posts the app made itself: a post marked by hand has the time of the tap, not of the post.
  const posts = videos.filter(v => v.status === 'posted' && v.posted?.auto && v.posted?.at && Number.isFinite(v.results?.views));
  if (posts.length < 8) return null;
  const hourOf = at => { try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at))); } catch { return new Date(at).getUTCHours(); } };
  const by = {};
  posts.forEach(v => { (by[hourOf(v.posted.at)] ||= []).push(v.results.views + 150 * (v.results.messages || 0)); });
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const overall = avg(posts.map(v => v.results.views + 150 * (v.results.messages || 0)));
  const best = Object.entries(by).filter(([, a]) => a.length >= 3).map(([h, a]) => ({ hour: Number(h), score: avg(a), n: a.length })).sort((x, y) => y.score - x.score)[0];
  if (!best || !overall || best.score < overall * 1.25) return null;
  return { hour: best.hour, lift: Math.round((best.score / overall) * 10) / 10, n: best.n, total: posts.length };
}

/* ---------------- Shot list: what to film for the agent's own clips ---------------- */
// The niche's shot list, each marked done when one of the agent's clips is described with one of its
// words. `clips`: [{ description }] from Brand → Your own clips. Not-yet-filmed shots come first.
export function shotList(cfg, clips = []) {
  const said = new Set(clips.flatMap(c => wordsIn(c.description || '')));
  return (nicheOf(cfg).shotList || []).map(x => ({ ...x, done: x.words.some(w => said.has(w)) })).sort((a, b) => a.done - b.done);
}

/* ---------------- Learning from results ---------------- */
const opening = v => String(v.scenes?.[0]?.say || v.scenes?.[0]?.text || '').trim();
// Openings of posted videos that brought messages, best first.
export function winnersFrom(videos = [], n = 4) {
  return videos.filter(v => v.status === 'posted' && (v.results?.messages || 0) > 0 && opening(v))
    .sort((a, b) => b.results.messages - a.results.messages || (b.results.views || 0) - (a.results.views || 0))
    .map(v => ({ hook: opening(v).slice(0, 160), messages: v.results.messages, format: v.meta?.format || '' }))
    .slice(0, n);
}
// What rejections have in common: counts by reason, most common first.
export function rejectionSummary(videos = [], days = 60, now = Date.now()) {
  const m = {};
  videos.filter(v => v.rejection?.reason && now - Date.parse(v.rejection.at || 0) < days * 86400000)
    .forEach(v => { m[v.rejection.reason] = (m[v.rejection.reason] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
}
// Posted videos that are a few days old and still have no results.
export const RESULTS_AFTER_DAYS = 3;
export const needsResults = (videos = [], now = Date.now()) => videos.filter(v => v.status === 'posted' && !v.results && v.posted?.at && now - Date.parse(v.posted.at) > RESULTS_AFTER_DAYS * 86400000);

/* ---------------- Coach suggestions → config changes ---------------- */
// One place that turns a checked coach suggestion into a config change, used by the portal
// (Apply) and the server (Try it). Returns the changed config; never touches the input.
export const CONFIG_SUGGESTIONS = ['add_fact', 'edit_fact', 'link_fact', 'add_worry', 'edit_worry', 'add_audience', 'edit_audience', 'add_question', 'add_rule', 'set_voice', 'set_formats', 'set_cta', 'set_output', 'add_search', 'set_style'];
// A new item gets its id once (kept on the suggestion), so applying the same suggestion twice, to what's
// saved and to what's on screen, gives both the same item.
export function applySuggestionTo(cfg0, sg) {
  const c = migrate(cfg0), s = c.story;
  const find = (list, id) => list.find(x => x.id === id);
  const uid = p => (sg.newId ||= newUid(p));
  switch (sg.type) {
    case 'add_fact': s.insights.unshift({ id: uid('i'), text: sg.text, links: sg.painIds || [], confirmed: false, confirmedAt: '', source: '', ai: true }); break;
    case 'edit_fact': { const f = find(s.insights, sg.id); if (f && sg.text && f.text !== sg.text) Object.assign(f, { text: sg.text, confirmed: false, confirmedAt: '', confirmedBy: '' }); break; }
    case 'link_fact': { const f = find(s.insights, sg.id); if (f) f.links = uniq([...f.links, ...(sg.painIds || [])]); break; }
    case 'add_worry': s.painPoints.unshift({ id: uid('p'), text: sg.text, question: sg.question || '', links: sg.audienceIds || [] }); break;
    case 'edit_worry': { const p = find(s.painPoints, sg.id); if (p) { if (sg.text) p.text = sg.text; if (sg.question) p.question = sg.question; } break; }
    case 'add_audience': s.audiences.unshift({ id: uid('a'), text: sg.text, visual: sg.visual || '', searches: [] }); break;
    case 'edit_audience': { const a = find(s.audiences, sg.id); if (a) { if (sg.text) a.text = sg.text; if (sg.visual) a.visual = sg.visual; } break; }
    case 'add_question': c.bank.questions.unshift({ id: uid('q'), text: sg.text, links: sg.painIds || [] }); break;
    case 'add_rule': if (!c.guardrails[sg.list].includes(sg.text)) c.guardrails[sg.list].push(sg.text); break;
    case 'set_voice': if (sg.energy) c.voice.energy = sg.energy; if (sg.tone) c.voice.tone = sg.tone; break;
    case 'set_formats': c.output.formats = sg.formats.slice(); break;
    case 'set_cta': s.ctaAction = sg.text; break;
    case 'set_output': ['scenes', 'maxWords', 'drafts'].forEach(k => { if (sg[k]) c.output[k] = sg[k]; }); break;
    case 'add_search': { const a = find(s.audiences, sg.audienceId); if (a && !a.searches.includes(sg.text)) a.searches = [sg.text, ...a.searches].slice(0, 8); break; }
    case 'set_style': { const a = find(s.audiences, sg.audienceId); if (a) a.style = normStyle(sg.style); break; }
    default: throw new Error('That suggestion can’t be applied.');
  }
  return migrate(c);
}

/* ---------------- Analyze: problems an agent can fix before generating ---------------- */
export function analyze(cfg, now = Date.now()) {
  const s = cfg.story, o = cfg.output, voice = isVoice(cfg), warnings = [], N = nicheOf(cfg);
  const w = (msg, kind = 'route', bus = 'story') => warnings.push({ kind, bus, msg });
  const insightScenes = Math.max(1, o.scenes - 4);
  const perScene = voice ? o.maxSpoken : o.maxWords;
  const U = usableRoutes(cfg, now);

  const unconfirmed = s.insights.filter(x => insightStatus(x, now) === 'unconfirmed').length;
  const stale = s.insights.filter(x => insightStatus(x, now) === 'stale').length;
  if (!U.insights.length) w('No confirmed facts yet. Videos can only use facts you have confirmed.', 'facts');
  else if (unconfirmed) w(`${unconfirmed} fact${unconfirmed > 1 ? 's are' : ' is'} waiting for your confirmation and won't be used until then.`, 'facts');
  const promises = s.insights.filter(x => x.text.trim() && factNotes(x.text).length).length;
  if (promises) w(`${promises} fact${promises > 1 ? 's read' : ' reads'} as true for everyone. Adding “usually”, “often”, “many” or “may” keeps ${promises > 1 ? 'them' : 'it'} accurate.`, 'facts');
  const soon = s.insights.filter(x => insightStatus(x, now) === 'confirmed' && (now - Date.parse(x.confirmedAt)) / 86400000 > FACT_REVIEW_DAYS - EXPIRY_WARN_DAYS).length;
  if (soon) w(`${soon} fact${soon > 1 ? 's are' : ' is'} due for review within ${EXPIRY_WARN_DAYS} days. Re-confirm ${soon > 1 ? 'them' : 'it'} now so videos don’t stop.`, 'facts');
  if (stale) w(`${stale} fact${stale > 1 ? 's were' : ' was'} confirmed over ${FACT_REVIEW_DAYS} days ago. Re-confirm ${stale > 1 ? 'them' : 'it'} to keep using ${stale > 1 ? 'them' : 'it'}.`, 'facts');

  s.audiences.forEach(a => {
    if (!s.painPoints.some(p => p.links.includes(a.id))) w(`Audience "${a.text}" has no worries linked to it.`);
    if (!a.visual) w(`Audience "${a.text}" has no footage description, so clips may show the wrong age group.`, 'fit');
  });
  s.painPoints.forEach(p => {
    if (!p.links.length) w(`Worry "${p.text}" isn’t linked to any audience, so it’s never used.`);
    const n = s.insights.filter(x => x.links.includes(p.id)).length;
    if (!n) w(`Worry "${p.text}" has no confirmed facts answering it, so it’s not used yet.`, 'value');
    else if (n < 2) w(`Worry "${p.text}" has only one fact. Add another so videos don’t repeat.`, 'value');
  });
  s.insights.forEach(x => {
    if (!x.links.length) w(`Fact "${x.text}" isn’t linked to any worry, so it’s never used.`);
    if (!s.solutions.some(sol => sol.links.includes(x.id))) w(`Fact "${x.text}" has no solution linked to it.`);
    if (countWords(x.text) > perScene * insightScenes) w(`Fact "${x.text}" is ${countWords(x.text)} words, more than ${insightScenes} fact scene${insightScenes > 1 ? 's' : ''} can hold. Shorten it or add a scene.`, 'fit');
    const bad = checkInsightText(x.text);
    if (bad.length) w(`Fact "${x.text}": ${bad[0]}`, 'clash');
  });
  s.solutions.forEach(x => {
    if (!x.links.length) w(`Solution "${x.text}" isn’t linked to any fact, so it’s never used.`);
    if (!x.plain && cfg.voice.tone !== 'high') w(`Solution "${x.text}" has no plain-language name. ${cfg.specs.tone[cfg.voice.tone].label} tone needs one.`, 'clash');
    N.absolutes.forEach(([re, label]) => { if (re.test(x.plain || '')) w(`Solution "${x.text}" is named with an absolute claim ("${label}"). Name it without promises.`, 'clash'); });
  });
  const links = linkChecks(cfg), blocked = links.filter(l => l.state === 'blocked' && !l.override), weak = links.filter(l => l.state === 'weak');
  if (blocked.length) w(`${blocked.length} link${blocked.length > 1 ? 's don’t' : ' doesn’t'} fit (like “${blocked[0].child.text.slice(0, 40)}” → “${blocked[0].parent.text.slice(0, 40)}”: ${blocked[0].reason}) and ${blocked.length > 1 ? 'aren’t' : 'isn’t'} used in videos until fixed.`, 'clash');
  if (weak.length) w(`${weak.length} link${weak.length > 1 ? 's are' : ' is'} only loosely related. Videos still use ${weak.length > 1 ? 'them' : 'it'}; check ${weak.length > 1 ? 'they make' : 'it makes'} sense.`, 'value');
  if (!s.ctaAction) w('The call to action is empty.', 'route');
  else if (countWords(s.ctaAction) > o.maxWords - 3) w(`The call to action is ${countWords(s.ctaAction)} words, leaving no room to point to the open question in a ${o.maxWords}-word caption. Shorten it or raise max words.`, 'fit');
  if (cfg.voice.energy === 'high' && o.maxWords > 12) w('High energy reads best in short captions. Consider 12 words or fewer.', 'clash', 'voice');
  if (!cfg.look?.name) w('Your name is missing from Brand, so the end card and scripts can’t introduce you.', 'route', 'brand');
  const fm = cfg.output.formats || [], bank = cfg.bank || {};
  if (fm.includes('story') && !(bank.stories || []).some(x => x.confirmed)) w('The Mini-story format is on, but there are no confirmed stories yet. Add one in Content → Your voice.', 'value', 'voice');
  if ((fm.includes('list') || fm.includes('compare')) && !U.pains.some(p => U.insights.filter(i => i.links.includes(p.id)).length >= 2)) w('“Things to know” and “This or that” need a worry with 2 or more confirmed facts.', 'value');
  if (!(bank.samples || []).length) w('Add something you’ve written in Content → Your voice, so scripts sound like you.', 'value', 'voice');
  const noStyle = U.audiences.filter(a => !a.style).length;
  if (noStyle) w(`${noStyle} audience${noStyle > 1 ? 's have' : ' has'} no communication style yet. Set ${noStyle > 1 ? 'them' : 'it'} in Communicate, so scripts speak the way ${noStyle > 1 ? 'they listen' : 'it listens'}.`, 'value', 'voice');
  return { warnings };
}

/* ---------------- How many distinct videos the routing allows (confirmed facts only) ---------------- */
export function countMixes(cfg, now = Date.now()) {
  const s = cfg.story, U = usableRoutes(cfg, now);
  let n = 0;
  U.audiences.forEach(a => U.pains.filter(p => p.links.includes(a.id)).forEach(p => U.insights.filter(i => i.links.includes(p.id)).forEach(i => {
    n += Math.max(1, routedFrom(U.solutions, i).length);
  })));
  return n;
}

// Why no video can be made yet, in plain words, with the Content tab that fixes it. null when videos can be made.
export function whyNoVideos(cfg, now = Date.now()) {
  if (countMixes(cfg, now)) return null;
  const s = cfg.story, U = usableRoutes(cfg, now);
  if (!U.insights.length) return { tab: 'insights', msg: s.insights.length ? 'None of your facts are confirmed yet. Confirm at least one in Content → Facts.' : 'Add and confirm at least one fact in Content → Facts.' };
  if (!s.painPoints.length) return { tab: 'painPoints', msg: 'Add at least one worry in Content → Worries.' };
  if (U.blocked?.size && (!U.pains.length || !U.audiences.length)) return { tab: 'routes', msg: 'The links between your content don’t fit, so no video can be made. Content → Routes shows which, and why.' };
  if (!U.pains.length) return { tab: 'insights', msg: 'Your confirmed facts aren’t linked to a worry yet. In Content → Facts, open “Answers 0 worries” under a fact and tap the worries it answers.' };
  return { tab: 'painPoints', msg: 'Your worries aren’t linked to an audience yet. In Content → Worries, open each worry and tap who it’s for.' };
}

/* ---------------- Instagram post text (the caption under the Reel) ---------------- */
export const POST_FIRST_LINE = 125;   // characters Instagram shows before "more"

// AI voice disclosure: voiceover videos use a synthetic voice. With Brand → "Say it's an AI voice" on,
// this line goes into the post text, just above the agent's small print (which stays the last line).
export const AI_VOICE_NOTE = 'Voiceover: AI-generated voice.';
// Where a video can be posted automatically.
export const PLATFORMS = ['instagram', 'facebook'];
// The agent's booking page (Brand → Booking link): a plain https address.
export const okBookingUrl = u => { const t = String(u ?? '').trim(); if (!/^https:\/\/[^\s"'<>`]{3,300}$/.test(t)) return false; try { const x = new URL(t); return x.protocol === 'https:' && !!x.hostname.includes('.'); } catch { return false; } };
// The line a post gets for its tracking link, just above the agent's small print (which stays last).
export const LINK_LINE = link => `Pick a time to talk with me: ${link}`;
export function withTrackingLink(text, cfg, link) {
  const t = String(text || '').trim();
  if (!t || !link || t.includes(link)) return t;
  // Above the small print wherever it is (hashtags after it stay after it), so the small print is
  // never pushed above the link. With no small print in the post, the link goes last.
  const lines = t.split('\n'), small = String(cfg.look?.disclaimer || '').trim();
  const at = small ? lines.map(l => l.includes(small)).lastIndexOf(true) : -1;
  if (at >= 0) { lines.splice(at, 0, LINK_LINE(link)); return lines.join('\n'); }
  return `${t}\n${LINK_LINE(link)}`;
}
// What a posted video brought in: messages count fully, clicks on its booking link count half
// (a click is interest; a message is a conversation).
// Clicks are capped at 20 per video here, so a burst of clicks (or someone clicking on purpose) can't steer topics.
// Keepsakes (v15): the words a private birthday or welcome video starts with (the agent can change them).
export function keepsakeLines(kind, name) {
  const n = String(name || '').trim().split(/\s+/)[0].slice(0, 30) || 'friend';
  return kind === 'birthday'
    ? [`Happy birthday, ${n}!`, 'Wishing you a year full of good days.', 'Thinking of you today.']
    : [`Welcome, ${n}!`, 'I’m so glad we’re working together.', 'Call or text me anytime you have a question.'];
}
export const resultValue = v => (v.results?.messages || 0) + Math.min(20, v.leads?.total || 0) + Math.min(20, v.clicks?.total || 0) / 2 + 3 * Math.min(10, v.bookings?.total || 0);   // (v15: a lead from the video's page counts like a message, a booking like three)
// Posting plan: a video can go out when none of the plan's places has it already (scheduled, posting,
// posted, or failed there: a failed post isn't retried automatically).
// Signed off by the compliance reviewer for exactly this version and file of the video (lib/signoff.js).
export const signedOff = v => v?.signoff?.status === 'ok' && v.signoff.version === (v.version || 1) && v.signoff.file === v.file;
export const planReady = (v, places = ['instagram']) => v.status === 'approved' && !v.fileDeleted && !!v.file
  && !(places.includes('instagram') && v.autopost) && !(places.includes('facebook') && v.fbpost);
export const aiNoteOn = (cfg, mode = cfg.output?.mode) => mode === 'voiceover' && (cfg.voice?.aiNote || 'on') === 'on';
export function withAiVoiceNote(text, cfg, mode = cfg.output?.mode) {
  const t = String(text || '').trim();
  if (!t || !aiNoteOn(cfg, mode) || t.includes(AI_VOICE_NOTE)) return t;
  const lines = t.split('\n'), small = String(cfg.look?.disclaimer || '').trim();
  if (small && lines[lines.length - 1].trim() === small) { lines.splice(lines.length - 1, 0, AI_VOICE_NOTE); return lines.join('\n'); }
  return `${t}\n${AI_VOICE_NOTE}`;
}
export function validatePost(raw, cfg, picks = null) {
  let data = raw;
  try { if (typeof raw === 'string') data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { ok: false, problems: ['The post reply isn’t valid JSON.'], text: '' }; }
  const text = String(data && data.caption || '').trim();
  const problems = [], N = nicheOf(cfg);
  if (!text) problems.push('The post text is empty.');
  const lower = text.toLowerCase();
  guardrailsFor(cfg).neverUse.forEach(w => { if (new RegExp(`\\b${escRe(w.toLowerCase())}\\b`).test(lower)) problems.push(`Post uses the banned phrase "${w}".`); });
  if (N.eligibility.some(re => re.test(text))) problems.push('Post implies the viewer will qualify.');
  if (/\$\s?\d|\d+\s?%/.test(text)) problems.push('Post contains a price or percentage.');
  govHits(text, N).forEach(t => problems.push(`Post uses "${t}", which can make ${N.govSubject} sound government-backed.`));
  const insightText = factsOf(picks).map(f => f.text).join(' ').toLowerCase();
  N.absolutes.forEach(([re, label]) => { if (re.test(text) && !re.test(insightText)) problems.push(`Post makes an absolute claim ("${label}").`); });
  if (/\p{Extended_Pictographic}/u.test(text)) problems.push('Post contains an emoji.');
  const cl = clicheHits(text);
  if (cl.length) problems.push(`Post uses overused ad wording ("${cl.join('", "')}").`);
  const first = text.split('\n')[0] || '';
  if (first.length > POST_FIRST_LINE) problems.push(`The first line is ${first.length} characters; keep it to ${POST_FIRST_LINE} or fewer so it shows before "more".`);
  const L = cfg.look || {};
  if (L.disclaimer && !text.includes(L.disclaimer)) problems.push(`The last line must be exactly: ${L.disclaimer}`);
  return { ok: problems.length === 0, problems, text };
}

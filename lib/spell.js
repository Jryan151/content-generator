// lib/spell.js — the spelling check on captions (v15): words that aren't in the dictionary or the agent's
// own words, each with a one-tap correction, and the common mix-ups a dictionary can't catch ("its" for
// "it's", "your" for "you're"). A note, never a block (Admin → Render rules: Spelling).
//
// The dictionary is assets/words.txt: about 79,000 American English words (ESDB size 60, the standard
// spell-checker size), most common first, so the likeliest correction wins. Licence: assets/words-LICENSE.txt.
// Names and other capitalized words (not at the start of a sentence) aren't checked; neither are the
// agent's own words (their name, city, facts, worries and audiences), numbers, links or @handles.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let rank = null;   // word → how common (0 = most)
function dictionary() {
  if (rank) return rank;
  rank = new Map();
  try { fs.readFileSync(path.join(ROOT, 'assets', 'words.txt'), 'utf8').split('\n').forEach((w, i) => { if (w) rank.set(w, i); }); } catch { /* no dictionary: nothing is flagged */ }
  return rank;
}
export const known = w => dictionary().has(w) || EXTRA.has(w);

// Mix-ups only the words around them give away. Each: the pattern, and the correction for what it matched.
// Only words that can't follow a possessive ("its the", "your not"): "their will", "your right",
// "your in-laws" and "at its best" are correct, so they're not here.
const MIXUPS = [
  [/\bits (a|an|the|not|never|been|going|so|too|just|really|still|about|here|there|what|how|why|who|when|my|your|our|their|okay|ok)\b/gi, m => `it’s ${m[1]}`],
  [/(?<!\bat )\bits (important|easy|hard|true|worth|simple|normal|natural|smart|wise|good|fine|possible|likely|best|better|time)(?= to\b| that\b| if\b| when\b)/gi, m => `it’s ${m[1]}`],
  [/\byour (welcome|going|not|never|ready|getting|probably|sure|able|done|here|there|the|a|an)\b/gi, m => `you’re ${m[1]}`],
  [/\btheir (is|are|was|were|has|have)\b/gi, m => `there ${m[1]}`],
  [/\bthere (kids|children|family|families|home|homes|house|policy|policies|coverage|mortgage|loved ones|spouse|wishes|money|bills|own)\b/gi, m => `their ${m[1]}`],
  [/\bthey(?:'|’)re (kids|children|family|families|home|homes|house|policy|policies|coverage|mortgage|loved ones|spouse|wishes|money|bills|own)\b/gi, m => `their ${m[1]}`],
  [/\b(could|should|would|must|might) of\b/gi, m => `${m[1]} have`],
  [/\balot\b/gi, () => 'a lot'],
  [/\bloose (your|their|my|the|it|them|track|sleep)\b/gi, m => `lose ${m[1]}`],
  [/\bless (people|families|clients|kids|children|bills|worries)\b/gi, m => `fewer ${m[1]}`],
];
// Words the dictionary doesn't have that agents use (insurance terms, everyday short forms).
const EXTRA = new Set(['ok', 'okay', 'preneed', 'pre-need', 'insurability', 'coverages', 'policyowner', 'policyowners', 'copay', 'copays', 'telehealth', 'prequalify', 'prequalified', 'dms', 'dm', 'medigap', 'annuitants', 'nonmedical', 'underwriter', 'underwriters', 'payout', 'payouts', 'beneficiary', 'beneficiaries', 'grandkids', 'website', 'online', 'email', 'emails', 'reels', 'livestream']);

const ALPHA = 'abcdefghijklmnopqrstuvwxyz', VOWEL = new Set('aeiouy');
// Every word one change away, with how likely that slip is: two letters swapped (0) is the commonest
// typing slip, then a letter too many or missing (1), then a wrong letter (2).
function edits1(w) {
  const out = new Map(), put = (c, cost) => { if (c !== w && (!out.has(c) || out.get(c) > cost)) out.set(c, cost); };
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b.length > 1) put(a + b[1] + b[0] + b.slice(2), 0);
    if (b) put(a + b.slice(1), 1);
    for (const c of ALPHA) { put(a + c + b, 1); if (b) put(a + c + b.slice(1), VOWEL.has(c) && VOWEL.has(b[0]) ? 1 : 2); }   // (a vowel for a vowel is as common as a missing letter)
  }
  return out;
}
// How common a word is, in bands (the list is sorted by band, alphabetically within one).
const BANDS = [38703, 43538, 61705, Infinity];
const band = r => BANDS.findIndex(b => r < b);
// The likeliest correction: one change away if there is one, else two; the likelier slip, then the more
// common word, then the same first letter.
// Two changes away costs tens of milliseconds a word, so it's only tried for words of up to 10 letters,
// at most `budget.deep` times per request; answers are remembered.
const CACHE = new Map(), CACHE_MAX = 3000, DEEP_MAX_LEN = 10;
const remember = (w, s) => { if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value); CACHE.set(w, s); return s; };
export const newBudget = () => ({ deep: 6, notes: 30 });
export function suggest(word, budget = null) {
  const w = word.toLowerCase(), d = dictionary();
  if (CACHE.has(w)) return CACHE.get(w);
  const best = cands => [...cands].filter(([c]) => d.has(c)).sort(([a, x], [b, y]) => x - y || band(d.get(a)) - band(d.get(b)) || (a[0] !== w[0]) - (b[0] !== w[0]) || d.get(a) - d.get(b))[0]?.[0] || '';
  if (w.length > 30) return '';
  const one = edits1(w);
  const first = best(one);
  if (first || w.length > DEEP_MAX_LEN) return remember(w, first);
  if (budget && budget.deep <= 0) return '';   // (not remembered: another request may look further)
  if (budget) budget.deep--;
  const two = new Map();
  for (const [e, c1] of one) for (const [f, c2] of edits1(e)) if (d.has(f) && (!two.has(f) || two.get(f) > c1 + c2)) two.set(f, c1 + c2);
  return remember(w, best(two));
}
const keepCase = (from, to) => (/^[A-Z]/.test(from) ? to[0].toUpperCase() + to.slice(1) : to);

// The agent's own words (never flagged): from their config.
export function ownWords(cfg) {
  const s = cfg?.story || {}, L = cfg?.look || {}, b = cfg?.bank || {};
  const texts = [L.name, L.title, L.location, L.endCta, L.handle, s.ctaAction, ...(s.insights || []).map(x => x.text), ...(s.painPoints || []).map(x => `${x.text} ${x.question || ''}`),
    ...(s.audiences || []).map(x => `${x.text} ${x.visual || ''}`), ...(s.solutions || []).map(x => x.text), ...(b.stories || []).map(x => x.text), ...(cfg?.guardrails?.mustUse || [])];
  return new Set(texts.join(' ').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z']+/g) || []);
}

// The spelling notes for one caption: [{ word, suggestion }] (suggestion '' when nothing close is known).
// At most 6 notes a caption, and `budget.notes` across a request: past that it's not a caption with
// typos but pasted text, and listing every word helps no one.
const PER_TEXT = 6;
export function checkSpelling(text, own = new Set(), budget = newBudget()) {
  const t = String(text || '').slice(0, 600), out = [], seen = new Set();
  if (!dictionary().size) return out;
  for (const [re, fix] of MIXUPS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const at = m.index, end = at + m[0].length;
      if (out.some(o => at < o.at + o.word.length && o.at < end)) continue;   // one note for one slip ("Its never")
      if (!seen.has(m[0].toLowerCase()) && out.length < PER_TEXT && budget.notes > 0) { seen.add(m[0].toLowerCase()); budget.notes--; out.push({ word: m[0], at, suggestion: keepCase(m[0], fix(m)) }); }
    }
  }
  // Words, with where each starts (a capital after a full stop, or at the start, is still checked).
  const re = /(https?:\/\/\S+|@\w+|#\w+|\S*\d\S*)|([A-Za-z][A-Za-z’']*)/g;
  let m, sentenceStart = true, last = 0;
  while ((m = re.exec(t))) {
    const between = t.slice(last, m.index);
    if (/[.!?:]\s*$/.test(between)) sentenceStart = true;
    last = m.index + m[0].length;
    if (m[1]) { sentenceStart = false; continue; }
    const raw = m[2], word = raw.replace(/[’']+$/, '').replace(/’/g, "'");
    const start = sentenceStart; sentenceStart = false;
    if (word.length < 2) continue;
    if (/[A-Z]/.test(word.slice(1)) || (/^[A-Z]/.test(word) && !start)) continue;   // a name, an acronym
    const lower = word.toLowerCase(), base = lower.replace(/'s$/, '');
    if (known(lower) || known(base) || own.has(lower) || own.has(base) || seen.has(lower)) continue;
    seen.add(lower);
    if (out.length >= PER_TEXT || budget.notes <= 0) break;
    budget.notes--;
    const s = suggest(base, budget);
    out.push({ word: raw, at: m.index, suggestion: s ? keepCase(raw, s + (lower.endsWith("'s") ? '’s' : '')) : '' });
  }
  return out;
}

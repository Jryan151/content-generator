// lib/onboarding.js — guided setup.
// The agent answers a few questions; their topics start from the vetted starter topics (templates.js);
// AI rewords each topic's worry and question to fit their clients and may suggest a few extra topics.
// Facts are never rewritten, and nothing is used in a video until the agent checks each topic's fact.
import { migrate, checkInsightText, QUALIFIERS, GOV_TERMS, uid, countWords } from '../mixer-core.js';
import { starterTopics } from '../templates.js';
import { chatJSON } from './ai.js';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (a, n = 10) => (Array.isArray(a) ? a.map(x => clip(x, 60)).filter(Boolean).slice(0, n) : []);
// Who appears in the footage when the agent hasn't said.
export const DEFAULT_VISUAL = 'older adults in their 60s and 70s';

// What the setup form shows, prefilled from the current config.
export function answersFrom(cfg) {
  return {
    name: cfg.look.name, title: cfg.look.title || 'Licensed Agent', location: cfg.look.location, handle: cfg.look.handle,
    states: cfg.profile.states, timezone: cfg.profile.timezone,
    about: cfg.profile.about, clients: cfg.profile.clients,
    energy: cfg.voice.energy, tone: cfg.voice.tone, mode: cfg.output.mode, ttsVoice: cfg.voice.ttsVoice,
    ctaAction: cfg.story.ctaAction,
    sample: (cfg.bank?.samples || [])[0] || '',
  };
}

// Answers → a config draft. keepContent: keep the existing topics instead of the starter ones.
export function draftConfig(base, a, { keepContent = false } = {}) {
  const cfg = migrate(base);
  cfg.look = { ...cfg.look, name: clip(a.name, 60), title: clip(a.title, 40) || 'Licensed Agent', location: clip(a.location, 60), handle: clip(a.handle, 40) };
  cfg.profile = { ...cfg.profile, states: list(a.states, 50), timezone: clip(a.timezone, 60) || cfg.profile.timezone, about: clip(a.about, 160), clients: clip(a.clients, 200) };
  cfg.voice = { ...cfg.voice, energy: ['low', 'mid', 'high'].includes(a.energy) ? a.energy : cfg.voice.energy, tone: ['low', 'mid', 'high'].includes(a.tone) ? a.tone : cfg.voice.tone, ttsVoice: clip(a.ttsVoice, 20) || cfg.voice.ttsVoice };
  cfg.output = { ...cfg.output, mode: a.mode === 'voiceover' ? 'voiceover' : 'captions' };
  const cta = clip(a.ctaAction, 60) || 'Message me';
  if (!keepContent || !cfg.topics.length) {
    cfg.topics = starterTopics();
    cfg.voice.role = '';   // built from the profile, so it stays in step with name and city
  }
  if (!cfg.audience.visual) cfg.audience.visual = DEFAULT_VISUAL;
  cfg.story.ctaAction = cta;
  const sample = String(a.sample || '').trim().slice(0, 800);
  if (sample && !cfg.bank.samples.includes(sample)) cfg.bank.samples = [sample, ...cfg.bank.samples].slice(0, 8);
  cfg.look.endCta = cta.split(',')[0].trim();
  return migrate(cfg);
}

const cleanLine = (s, n) => {
  const t = clip(String(s || '').replace(/^["“]|["”]$/g, ''), n);
  if (!t || /\$\s?\d|\d+\s?%/.test(t) || GOV_TERMS.some(([re]) => re.test(t))) return '';
  return t;
};
const okFact = text => {
  const words = text.toLowerCase().match(/[a-z’']+/g) || [];
  return !!text && !checkInsightText(text).length && QUALIFIERS.some(q => words.includes(q)) && countWords(text) <= 25;
};

// AI rewording for this agent's clients: each topic's worry and question, and who's in the footage.
// Ids, facts and offers never change.
export async function personalize(cfg, { meter = null, log = () => {} } = {}) {
  const input = cfg.topics.map(t => ({ id: t.id, worry: t.worry, question: t.question, fact: t.fact }));
  const agent = [cfg.look.name && `Name: ${cfg.look.name}`, cfg.look.location && `City: ${cfg.look.location}`, cfg.profile.states.length && `Licensed in: ${cfg.profile.states.join(', ')}`,
    cfg.profile.about && `How they describe themselves: ${cfg.profile.about}`, cfg.profile.clients && `Their clients: ${cfg.profile.clients}`, 'Product: final expense life insurance'].filter(Boolean).join('\n');
  const user = `${agent}

Starter topics (each is one video: a worry, the fact that answers it, and the question only the agent can answer):
${JSON.stringify(input)}

Reword so it fits this agent's clients:
- topics: keep every id. "worry": the client's worry in their own words, first person, under 14 words, and still answered by that topic's fact. "question": the personal question only the agent can answer, lowercase, under 14 words, like "how much coverage would cover your final expenses". Never change the facts.
- "visual": who should appear in stock footage for these clients, as age range and relationship in 4-10 words. Never mention ethnicity, religion or health conditions.
- No prices, numbers, promises, company names or government programs.

Then suggest up to 3 extra topics ("suggestions") these clients would find useful, each a worry and a fact that answers it. Facts are general, widely true statements about final expense insurance, under 25 words, each using one of: usually, often, many, some, generally, may. If you're not sure a fact is true everywhere, leave it out.

Return ONLY JSON: {"visual":"","topics":[{"id":"","worry":"","question":""}],"suggestions":[{"worry":"","fact":"","question":""}]}`;
  const out = JSON.parse(await chatJSON({
    temperature: 0.4, meter,
    messages: [
      { role: 'system', content: 'You help a licensed life insurance agent set up short educational videos. You reword content to fit their clients. You never invent product details, prices or promises.' },
      { role: 'user', content: user },
    ],
  }));
  const next = migrate(cfg);
  let changed = 0, added = 0;
  const visual = cleanLine(out.visual, 90);
  if (visual) next.audience.visual = visual;
  for (const x of out.topics || []) {
    const t = next.topics.find(y => y.id === x.id); if (!t) continue;
    const worry = cleanLine(x.worry, 110), q = cleanLine(x.question, 110).replace(/[.?]$/, '');
    if (worry) { t.worry = worry; changed++; }
    if (q) t.question = q.charAt(0).toLowerCase() + q.slice(1);
  }
  for (const sug of (out.suggestions || []).slice(0, 3)) {
    const fact = clip(sug.fact, 200), worry = cleanLine(sug.worry, 110), q = cleanLine(sug.question, 110).replace(/[.?]$/, '');
    if (!worry || !okFact(fact) || next.topics.some(t => t.fact.toLowerCase() === fact.toLowerCase())) continue;
    next.topics.push({ id: uid('t'), worry, fact, question: q ? q.charAt(0).toLowerCase() + q.slice(1) : '', offer: '', mention: '', who: '', confirmed: false, confirmedAt: '', confirmedBy: '', ai: true });
    added++;
  }
  log(`Setup: reworded ${changed} topic(s), suggested ${added}.`);
  return migrate(next);
}

// Server-side rules for checking facts, used by setup and by every config save.
// The server stamps who checked a topic's fact and when. A check sent with the old timestamp for a
// fact whose wording has since changed doesn't count: changed wording must be checked again (the
// portal clears the timestamp when the agent ticks it).
export function stampFacts(prev, next, accountId, now = new Date()) {
  const before = new Map((prev?.topics || []).map(t => [t.id, t]));
  const unconfirm = t => { t.confirmed = false; t.confirmedAt = ''; t.confirmedBy = ''; };
  const stamp = t => { t.confirmedAt = now.toISOString(); t.confirmedBy = accountId; };
  for (const t of next.topics) {
    const p = before.get(t.id);
    const textChanged = !!p && p.fact !== t.fact;
    if (!t.confirmed || !t.fact || checkInsightText(t.fact).length) unconfirm(t);
    else if (!p) stamp(t);
    else if (!textChanged && p.confirmed && t.confirmedAt && t.confirmedAt === p.confirmedAt) t.confirmedBy = p.confirmedBy || '';
    else if (textChanged && t.confirmedAt) unconfirm(t);
    else stamp(t);
  }
  return migrate(next);
}

export const confirmedCount = cfg => cfg.topics.filter(t => t.confirmed && t.confirmedAt && t.fact).length;

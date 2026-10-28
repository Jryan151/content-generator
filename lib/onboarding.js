// lib/onboarding.js — guided setup.
// The agent answers a few questions; their content starts from the vetted templates for the
// products they sell; AI rewords audiences and worries to fit their clients and may suggest a
// few extra facts. Nothing is used in a video until the agent confirms each fact.
import { migrate, checkInsightText, insightStatus, QUALIFIERS, GOV_TERMS, PRODUCT_LINES, uid, countWords } from '../mixer-core.js';
import { starterStory } from '../templates.js';
import { chatJSON } from './ai.js';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (a, n = 10) => (Array.isArray(a) ? a.map(x => clip(x, 60)).filter(Boolean).slice(0, n) : []);

// What the setup form shows, prefilled from the current config.
export function answersFrom(cfg) {
  return {
    name: cfg.look.name, title: cfg.look.title || 'Licensed Agent', location: cfg.look.location, handle: cfg.look.handle,
    states: cfg.profile.states, timezone: cfg.profile.timezone, products: cfg.profile.products,
    about: cfg.profile.about, clients: cfg.profile.clients,
    energy: cfg.voice.energy, tone: cfg.voice.tone, mode: cfg.output.mode, ttsVoice: cfg.voice.ttsVoice,
    ctaAction: cfg.story.ctaAction,
    sample: (cfg.bank?.samples || [])[0] || '',
  };
}

// Answers → a config draft. keepContent: keep the existing story instead of the templates.
export function draftConfig(base, a, { keepContent = false } = {}) {
  const cfg = migrate(base);
  const products = list(a.products, 3).filter(p => PRODUCT_LINES.some(x => x.id === p));
  cfg.look = { ...cfg.look, name: clip(a.name, 60), title: clip(a.title, 40) || 'Licensed Agent', location: clip(a.location, 60), handle: clip(a.handle, 40) };
  cfg.profile = { ...cfg.profile, states: list(a.states, 50), timezone: clip(a.timezone, 60) || cfg.profile.timezone, products, about: clip(a.about, 160), clients: clip(a.clients, 200) };
  cfg.voice = { ...cfg.voice, energy: ['low', 'mid', 'high'].includes(a.energy) ? a.energy : cfg.voice.energy, tone: ['low', 'mid', 'high'].includes(a.tone) ? a.tone : cfg.voice.tone, ttsVoice: clip(a.ttsVoice, 20) || cfg.voice.ttsVoice };
  cfg.output = { ...cfg.output, mode: a.mode === 'voiceover' ? 'voiceover' : 'captions' };
  const cta = clip(a.ctaAction, 60) || 'Message me';
  if (!keepContent || !cfg.story.insights.length) {
    cfg.story = { ...cfg.story, ...starterStory(products) };
    cfg.voice.role = '';   // built from the profile, so it stays in step with name and city
  }
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

// AI rewording for this agent's clients. Ids and routing never change; facts are never rewritten.
export async function personalize(cfg, { meter = null, log = () => {} } = {}) {
  const s = cfg.story;
  const input = {
    audiences: s.audiences.map(a => ({ id: a.id, text: a.text, visual: a.visual })),
    painPoints: s.painPoints.map(p => ({ id: p.id, text: p.text, question: p.question })),
  };
  const agent = [cfg.look.name && `Name: ${cfg.look.name}`, cfg.look.location && `City: ${cfg.look.location}`, cfg.profile.states.length && `Licensed in: ${cfg.profile.states.join(', ')}`,
    cfg.profile.about && `How they describe themselves: ${cfg.profile.about}`, cfg.profile.clients && `Their clients: ${cfg.profile.clients}`,
    `Products: ${cfg.profile.products.map(p => PRODUCT_LINES.find(x => x.id === p)?.label).filter(Boolean).join(', ') || 'Final expense'}`].filter(Boolean).join('\n');
  const user = `${agent}

Starter content:
${JSON.stringify(input)}

Rewrite the wording so it fits this agent's clients:
- audiences: keep every id. "text": who they are in 3-8 plain words. "visual": who should appear in stock footage, as age range and relationship in 4-10 words. Never mention ethnicity, religion or health conditions.
- painPoints: keep every id. "text": the worry in the client's own words, first person, under 14 words. "question": the personal question only the agent can answer for them, lowercase, under 14 words, like "how much coverage would cover your final expenses".
- Keep the same meaning and number of items. No prices, numbers, promises, company names or government programs.

Then suggest up to 3 extra facts ("suggestions") these clients would find useful: general, widely true statements about these products, under 25 words, each using one of: usually, often, many, some, generally, may. "links": the pain point ids each one answers. If you're not sure a fact is true everywhere, leave it out.

Return ONLY JSON: {"audiences":[{"id":"","text":"","visual":""}],"painPoints":[{"id":"","text":"","question":""}],"suggestions":[{"text":"","links":[""]}]}`;
  const out = JSON.parse(await chatJSON({
    temperature: 0.4, meter,
    messages: [
      { role: 'system', content: 'You help a licensed life insurance agent set up short educational videos. You reword content to fit their clients. You never invent product details, prices or promises.' },
      { role: 'user', content: user },
    ],
  }));
  const next = migrate(cfg), st = next.story;
  let changed = 0;
  for (const a of out.audiences || []) {
    const t = st.audiences.find(x => x.id === a.id); if (!t) continue;
    const text = cleanLine(a.text, 70), visual = cleanLine(a.visual, 90);
    if (text) { t.text = text; changed++; }
    if (visual) t.visual = visual;
  }
  for (const p of out.painPoints || []) {
    const t = st.painPoints.find(x => x.id === p.id); if (!t) continue;
    const text = cleanLine(p.text, 110), q = cleanLine(p.question, 110).replace(/[.?]$/, '');
    if (text) { t.text = text; changed++; }
    if (q) t.question = q.charAt(0).toLowerCase() + q.slice(1);
  }
  const painIds = new Set(st.painPoints.map(p => p.id));
  let added = 0;
  for (const sug of (out.suggestions || []).slice(0, 3)) {
    const text = clip(sug.text, 200);
    const links = (sug.links || []).filter(l => painIds.has(l));
    const words = text.toLowerCase().match(/[a-z’']+/g) || [];
    if (!text || !links.length || checkInsightText(text).length || !QUALIFIERS.some(q => words.includes(q)) || countWords(text) > 25) continue;
    if (st.insights.some(i => i.text.toLowerCase() === text.toLowerCase())) continue;
    const id = uid('i');
    st.insights.push({ id, text, links, confirmed: false, confirmedAt: '', source: '', ai: true });
    // Route it to the solutions that already answer the same worries.
    st.solutions.forEach(sol => { if (sol.links.some(l => st.insights.find(i => i.id === l)?.links.some(p => links.includes(p)))) sol.links.push(id); });
    added++;
  }
  log(`Setup: reworded ${changed} item(s), suggested ${added} fact(s).`);
  return next;
}

// Server-side rules for confirming facts, used by setup and by every config save.
// The server stamps who confirmed a fact and when. A confirmation sent with the old timestamp
// for wording that has since changed doesn't count: changed wording must be confirmed again
// (the portal clears the timestamp when the agent confirms).
export function stampFacts(prev, next, accountId, now = new Date()) {
  const before = new Map((prev?.story?.insights || []).map(i => [i.id, i]));
  const unconfirm = i => { i.confirmed = false; i.confirmedAt = ''; i.confirmedBy = ''; };
  const stamp = i => { i.confirmedAt = now.toISOString(); i.confirmedBy = accountId; };
  for (const i of next.story.insights) {
    const p = before.get(i.id);
    i.source = clip(i.source, 80);
    const textChanged = !!p && p.text !== i.text;
    if (!i.confirmed || checkInsightText(i.text).length) unconfirm(i);
    else if (!p) stamp(i);
    else if (!textChanged && p.confirmed && i.confirmedAt && i.confirmedAt === p.confirmedAt) i.confirmedBy = p.confirmedBy || '';
    else if (textChanged && i.confirmedAt) unconfirm(i);
    else stamp(i);
  }
  return next;
}

export const confirmedCount = cfg => cfg.story.insights.filter(i => insightStatus(i) === 'confirmed').length;

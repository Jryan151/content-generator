// lib/content.js — the smart Content tab: links that make themselves, a fit check on every link,
// and ✦ Generate for each kind of item. The AI judges whether things belong together; it never judges
// whether a fact is true. Facts it writes always start unconfirmed, and everything it writes passes
// the same checks as the agent's own words before it's shown.
import { chatJSON } from './ai.js';
import { linkChecks, linkKey, textKey, checkInsightText, QUALIFIERS, countWords, clicheHits, GOV_TERMS, PLATFORM_GUARDRAILS, PRODUCT_LINES } from '../mixer-core.js';
import { nicheOf } from '../niches/index.js';
import { STYLES, normStyle } from '../comms-core.js';

const clip = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = t => { try { return JSON.parse(t); } catch { return {}; } };
const NEVER = PLATFORM_GUARDRAILS.neverUse.map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
// Plain, rule-safe text: no prices, government words, overused ad phrases or banned words.
const safe = (t, n) => { const x = clip(t, n); return !x || /\$\s?\d|\d+\s?%/.test(x) || GOV_TERMS.some(([re]) => re.test(x)) || clicheHits(x).length || NEVER.some(re => re.test(x)) ? '' : x; };
const okFact = t => !!t && !checkInsightText(t).length && QUALIFIERS.some(q => (t.toLowerCase().match(/[a-z’']+/g) || []).includes(q)) && countWords(t) <= 30 && !clicheHits(t).length;
const products = () => PRODUCT_LINES.map(p => `${p.id} (${p.label}: ${p.note})`).join('; ');
const KINDS = { 'worry-audience': ['worry', 'audience it’s for'], 'fact-worry': ['fact', 'worry it answers'], 'solution-fact': ['solution', 'fact it follows'] };
export const BATCH = 25;

/* ---------------- Fit check: does each link make sense? ---------------- */
// Links without a current verdict (new, or one of the texts changed), up to `max`.
export const linksToJudge = (cfg, max = 75) => linkChecks(cfg).filter(l => l.score === null && !l.product).slice(0, max);

// Judges links in batches: { key: { s, r, k } }. A failed batch is skipped (those stay unchecked).
export async function judgeLinks(cfg, links, meter) {
  const out = {};
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    try {
      const text = await chatJSON({
        job: 'quick', temperature: 0, maxTokens: 60 + 45 * batch.length, meter,
        messages: [
          { role: 'system', content: `You check the content of ${nicheOf(cfg).agentNoun}'s short videos. Each video is built from linked pieces: an audience, a worry they have, a fact that answers it, and a solution that follows from the fact. You judge whether each linked pair belongs together, so a video never pairs a fact with a worry it doesn't answer. You don't judge whether facts are true.` },
          { role: 'user', content: `Score each pair from 1 to 5:
5 = clearly belongs together. 4 = fits. 3 = loosely related (a video would feel off-topic). 2 = doesn't fit (a video would confuse or mislead). 1 = contradicts or is about something else entirely (for example a different product line: ${products()}).
Give a reason of under 15 words, written for the agent.

${batch.map((l, k) => `${k + 1}. ${KINDS[l.kind][0]}: "${clip(l.child.text, 220)}"${l.child.question ? ` (their question: ${clip(l.child.question, 100)})` : ''} → ${KINDS[l.kind][1]}: "${clip(l.parent.text, 220)}"`).join('\n')}

Return ONLY JSON: {"pairs":[{"n":1,"score":4,"reason":"…"}]}` },
        ],
      });
      const r = parse(text).pairs || [];
      batch.forEach((l, k) => {
        // By number; by position only if the reply has no numbers at all (never another pair's score).
        const x = r.some(y => y && y.n != null) ? r.find(y => Number(y.n) === k + 1) : r[k];
        const s = Math.round(Number(x?.score));
        if (s >= 1 && s <= 5) out[l.key] = { s, r: clip(x.reason, 160), k: textKey(l.child.text, l.parent.text) };
      });
    } catch { /* this batch stays unchecked; it's tried again next time */ }
  }
  return out;
}

/* ---------------- Automatic links for one new or edited item ---------------- */
// kind: audiences | painPoints | insights | solutions. Returns the links it should have in every
// direction, each judged: { parents: [ids], children: [ids], product, fit: { key: verdict } }.
// Only pairs scored 4+ are linked; the verdicts come along, so they're checked already.
export async function autoLink(cfg, kind, item, meter) {
  const s = cfg.story;
  const up = { painPoints: 'audiences', insights: 'painPoints', solutions: 'insights' }[kind];
  const down = { audiences: 'painPoints', painPoints: 'insights', insights: 'solutions' }[kind];
  const label = { audiences: 'audience', painPoints: 'worry', insights: 'fact', solutions: 'solution' };
  const list = (k, n) => (s[k] || []).filter(x => x.id !== item.id && x.text.trim()).slice(0, n).map(x => `${x.id}: ${clip(x.text, 160)}`).join('\n');
  if (!item?.text?.trim() || (!up && !down)) return { parents: [], children: [], product: '', fit: {} };
  const text = await chatJSON({
    job: 'quick', temperature: 0, maxTokens: 700, meter,
    messages: [
      { role: 'system', content: `You organize the content of ${nicheOf(cfg).agentNoun}'s short videos. Audiences have worries; facts answer worries; solutions follow from facts. You link a new ${label[kind]} to the pieces it truly belongs with. Link only clear fits.` },
      { role: 'user', content: `The new ${label[kind]}: "${clip(item.text, 300)}"${item.question ? ` (their question: ${clip(item.question, 120)})` : ''}
${up ? `\n${label[up].toUpperCase()}S it could belong under:\n${list(up, 40) || '(none)'}\n` : ''}${down ? `\n${label[down].toUpperCase()}S that could belong under it:\n${list(down, 40) || '(none)'}\n` : ''}
Product lines: ${products()}.
Score each fitting pair 1-5 (5 = clearly belongs together, 4 = fits; leave out anything below 4) with a reason under 15 words.
Return ONLY JSON: {"product":"a product line id, or empty if it serves several","parents":[{"id":"…","score":5,"reason":"…"}],"children":[{"id":"…","score":4,"reason":"…"}]}` },
    ],
  });
  const r = parse(text), fit = {};
  const prodOf = item.product || (PRODUCT_LINES.some(p => p.id === r.product) && ['insights', 'solutions'].includes(kind) ? r.product : '');
  // Never a link the product rule would block (fact ↔ worry, solution ↔ fact from different product lines).
  const clash = (other, pool) => kind !== 'audiences' && pool !== 'audiences' && prodOf && other?.product && other.product !== prodOf;
  const take = (arr, pool, isParent) => (Array.isArray(arr) ? arr : []).filter(x => (s[pool] || []).some(y => y.id === x?.id) && Number(x.score) >= 4 && !clash(s[pool].find(y => y.id === x.id), pool)).slice(0, 6).map(x => {
    const other = s[pool].find(y => y.id === x.id), [child, parent] = isParent ? [item, other] : [other, item];
    fit[linkKey(child.id, parent.id)] = { s: Math.min(5, Math.round(Number(x.score))), r: clip(x.reason, 160), k: textKey(child.text, parent.text) };
    return x.id;
  });
  const parents = up ? take(r.parents, up, true) : [], children = down ? take(r.children, down, false) : [];
  const product = item.product ? '' : PRODUCT_LINES.some(p => p.id === r.product) && kind !== 'audiences' && kind !== 'painPoints' ? r.product : '';
  return { parents: [...new Set(parents)], children: [...new Set(children)], product, fit };
}

/* ---------------- Link everything ---------------- */
// Looks at the whole Content tab at once and proposes links that are missing (for items with few or
// none) and flags existing ones that look wrong. Nothing changes until the agent applies it.
export async function linkEverything(cfg, meter) {
  const s = cfg.story;
  const ids = k => (s[k] || []).filter(x => x.text.trim()).slice(0, 40).map(x => `${x.id}: ${clip(x.text, 140)}${x.links?.length ? ` [linked: ${x.links.join(', ')}]` : ''}`).join('\n');
  const text = await chatJSON({
    job: 'coach', temperature: 0, maxTokens: 1800, meter,
    messages: [
      { role: 'system', content: `You organize the content of ${nicheOf(cfg).agentNoun}'s short videos. Worries link to the audiences that have them; facts link to the worries they answer; solutions link to the facts they follow from. You add the links that are clearly missing. You don't judge whether facts are true.` },
      { role: 'user', content: `AUDIENCES:\n${ids('audiences') || '(none)'}\n\nWORRIES (linked to audiences):\n${ids('painPoints') || '(none)'}\n\nFACTS (linked to worries):\n${ids('insights') || '(none)'}\n\nSOLUTIONS (linked to facts):\n${ids('solutions') || '(none)'}

Product lines: ${products()}.
Propose missing links where a pair clearly belongs together (score 4 or 5), most useful first, up to 30. Each: the item that links ("from") and what it links to ("to"), with a reason under 15 words. Prefer items with no links yet.
Return ONLY JSON: {"add":[{"from":"…","to":"…","score":5,"reason":"…"}]}` },
    ],
  });
  const all = Object.fromEntries(['audiences', 'painPoints', 'insights', 'solutions'].flatMap(k => (s[k] || []).map(x => [x.id, { list: k, x }])));
  const ups = { painPoints: 'audiences', insights: 'painPoints', solutions: 'insights' };
  const seen = new Set();
  const add = (parse(text).add || []).map(a => ({ from: all[a?.from], to: all[a?.to], score: Math.round(Number(a?.score)), reason: clip(a?.reason, 160) }))
    .filter(a => a.from && a.to && ups[a.from.list] === a.to.list && a.score >= 4 && !a.from.x.links.includes(a.to.x.id))
    .filter(a => { const k = linkKey(a.from.x.id, a.to.x.id); if (seen.has(k)) return false; seen.add(k); return true; })
    .filter(a => !(a.from.list !== 'painPoints' && a.from.x.product && a.to.x.product && a.from.x.product !== a.to.x.product))
    .slice(0, 30)
    .map(a => ({ list: a.from.list, id: a.from.x.id, pid: a.to.x.id, from: a.from.x.text, to: a.to.x.text, reason: a.reason, fit: { s: Math.min(5, a.score), r: a.reason, k: textKey(a.from.x.text, a.to.x.text) } }));
  return { add };
}

/* ---------------- ✦ Generate ---------------- */
// Three options for one kind of item, written from what it would link to. Each is checked; facts
// start unconfirmed (marked as AI suggestions) and say they need the agent's confirmation and source.
// for: { painId } for a fact, { audienceId } for a worry, { factId } for a solution, { audienceId }
// for a call to action; nothing for an audience.
export async function generateItems(cfg, kind, ctx = {}, meter) {
  const s = cfg.story, N = nicheOf(cfg);
  const pain = s.painPoints.find(p => p.id === ctx.painId), aud = s.audiences.find(a => a.id === ctx.audienceId), fact = s.insights.find(i => i.id === ctx.factId);
  const have = (k, n = 12) => (s[k] || []).slice(0, n).map(x => `- ${clip(x.text, 140)}`).join('\n') || '- (none yet)';
  const prof = cfg.profile, where = cfg.look?.location ? ` in ${cfg.look.location}` : '';
  const sells = (prof.products || []).map(id => PRODUCT_LINES.find(p => p.id === id)?.label).filter(Boolean).join(', ') || N.defaultProduct;
  const brief = {
    insights: [`3 facts that answer this worry${aud ? ` for ${aud.text}` : ''}: "${pain?.text || ''}". General and widely true for ${sells}, one claim each, under 25 words, each with a qualifier word (usually, often, many, may). No numbers, prices, company names or government programs. Different from these existing facts:\n${have('insights')}`, '{"options":[{"text":"…","product":"a product line id or empty"}]}'],
    painPoints: [`3 worries ${aud ? `“${aud.text}”` : 'their clients'} really have about ${sells}, in their own words, first person, under 14 words, plus the open question only the agent can answer for each person (no question mark). Different from these:\n${have('painPoints')}`, '{"options":[{"text":"…","question":"…"}]}'],
    audiences: [`3 specific audiences for an agent who sells ${sells}${where}${prof.clients ? `, whose clients are usually ${clip(prof.clients, 120)}` : ''}: who they are in plain words (under 8 words), and who should appear in the footage (age and situation). Different from these:\n${have('audiences')}`, '{"options":[{"text":"…","visual":"…"}]}'],
    solutions: [`3 ways to name the solution that follows from this fact: "${fact?.text || ''}". Each: a short name, how it's said in plain words (no promises, no prices), and a phrase that must always be said with it if one is needed (like "waiting period"), else empty. Products sold: ${sells}. Different from these:\n${have('solutions')}`, '{"options":[{"text":"…","plain":"…","mustMention":"","product":"a product line id or empty"}]}'],
    cta: [`3 calls to action for the last scene of the agent's videos${aud ? `, for ${aud.text}${aud.style ? ` (who like to be spoken to as ${normStyle(aud.style).split('').map(k => STYLES[k]?.name).filter(Boolean).join(' and ')})` : ''}` : ''}. Each starts with a simple action like "Message me", under 6 words, warm, no urgency or pressure. Now: "${s.ctaAction}".`, '{"options":[{"text":"…"}]}'],
  }[kind];
  if (!brief) throw Object.assign(new Error('Pick what to generate.'), { user: true });
  if (kind === 'insights' && !pain) throw Object.assign(new Error('Pick the worry the facts should answer.'), { user: true });
  if (kind === 'solutions' && !fact) throw Object.assign(new Error('Pick the fact the solution follows from.'), { user: true });
  const text = await chatJSON({
    job: 'coach', temperature: 0.7, maxTokens: 800, meter,
    messages: [
      { role: 'system', content: `You help ${N.agentNoun} write the building blocks of their short videos. Plain, warm, honest words. Never promises, guarantees, prices, percentages, eligibility claims, fear, urgency, government programs or overused ad phrases.` },
      { role: 'user', content: `${brief[0]}\nReturn ONLY JSON: ${brief[1]}` },
    ],
  });
  const opts = parse(text).options || [];
  const prod = x => (PRODUCT_LINES.some(p => p.id === x) ? x : '');
  const seen = new Set((s[kind] || []).map(x => String(x.text).toLowerCase()));
  const uniq = o => { const k = o.text.toLowerCase(); if (!o.text || seen.has(k)) return false; seen.add(k); return true; };
  switch (kind) {
    case 'insights': return opts.map(o => ({ text: clip(o?.text, 220), product: prod(o?.product), links: [pain.id] })).filter(o => okFact(o.text)).filter(uniq).slice(0, 3);
    case 'painPoints': return opts.map(o => ({ text: safe(o?.text, 120), question: safe(o?.question, 120).replace(/[.?]$/, ''), links: aud ? [aud.id] : [] })).filter(o => o.text && !N.eligibility.some(re => re.test(o.text))).filter(uniq).slice(0, 3);
    case 'audiences': return opts.map(o => ({ text: safe(o?.text, 80), visual: safe(o?.visual, 100) })).filter(o => o.text).filter(uniq).slice(0, 3);
    case 'solutions': return opts.map(o => ({ text: safe(o?.text, 80), plain: safe(o?.plain, 140), mustMention: safe(o?.mustMention, 40), product: prod(o?.product), links: [fact.id] }))
      .filter(o => o.text && o.plain && ![o.text, o.plain].some(t => N.absolutes.some(([re]) => re.test(t)) || N.eligibility.some(re => re.test(t)))).filter(uniq).slice(0, 3);
    case 'cta': return opts.map(o => ({ text: safe(o?.text, 60).replace(/[.!]+$/, '') })).filter(o => o.text && countWords(o.text) <= 8 && o.text.toLowerCase() !== s.ctaAction.toLowerCase()).slice(0, 3);
    default: return [];
  }
}

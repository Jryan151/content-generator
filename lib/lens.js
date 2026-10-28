// lib/lens.js — the Mindset tab's AI tools: the persuasion lens (which honest principles a draft
// uses, with an honesty check) and 80/20 time-audit advice. The lens also tags each video's script,
// so Review can show "Uses: reciprocity, authority" and the weekly reflection can show which
// principles brought messages.
import { chatJSON } from './ai.js';
import { PERSUASION, PRESSURE } from '../mindset-core.js';

const clip = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = t => { try { return JSON.parse(t); } catch { return {}; } };

// Whether `words` are really in `body`: without punctuation and capitals ("act now." for "Act now!"), and a
// quote shortened with "…" counts when each part is there, in order. Whole words only.
const bare = t => norm(t).replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function quotes(body, words) {
  const where = ` ${bare(body)} `, parts = String(words).split(/…|\.\.\.+/).map(bare).filter(Boolean);
  let at = 0;
  for (const part of parts) { const k = where.indexOf(` ${part} `, at); if (k < 0) return false; at = k + part.length; }
  return parts.length > 0;
}
// The persuasion lens (v15: precise, and never contradicting the rules).
//   principles  the honest principles the draft uses, each with where
//   flags       [{ kind, words }]: every flag quotes the exact words that set it off (a flag whose words
//               aren't in the draft is dropped). Kinds: urgency (deadlines, "now"), scarcity ("only a few
//               left"), testimonial (a client story or review: not allowed) and fear (fear or guilt: "being
//               a burden"). Fear is a gentle note, not pressure: naming a real worry is often fine.
//   pressure    the kinds that are pressure (not fear), for the review card; pressureWords their quotes
//   strengths   what the draft does well (a qualifier kept, plain words, a real worry named)
//   advice      one way to give more value first, and rewrite { principle, text }: a sample using one
//               honest principle. Both are checked against the same rules as scripts before they're
//               shown, so the lens never suggests a testimonial, a client story, a number or a promise.
// Runs on the coach model.
export const FLAG_KINDS = { urgency: 'Urgency', scarcity: 'Scarcity', testimonial: 'A testimonial', fear: 'Fear or guilt' };
const GENTLE = new Set(['fear']);
const norm = t => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
// Advice and sample lines can't break the rules scripts follow.
const ADVICE_BAD = /\b(testimonials?|reviews?|client stor(?:y|ies)|success stor(?:y|ies)|case stud(?:y|ies)|(?:a|one of my|my) clients?\b|helped (?:others|families|people|clients)|families i(?:'ve| have) helped|statistics?|percent|guarantee\w*|promise\w*|you(?:'ll| will) (?:qualify|get approved|be covered))|\d/i;
let mc = null;
export function adviceOk(text, cfg = null) {
  const t = String(text || '');
  if (!t.trim() || ADVICE_BAD.test(t)) return false;
  // The platform's rules for stories (no prices, no government wording, no banned phrases).
  return !(mc && mc.checkStoryText(t, cfg).filter(p => !/80 words/.test(p)).length);
}
export async function lens({ text, meter, forScript = false, cfg = null }) {
  const body = clip(text, 3000);
  if (!body) throw Object.assign(new Error('Paste a draft first.'), { user: true });
  mc ||= await import('../mixer-core.js');
  const out = await chatJSON({
    job: 'coach', temperature: 0, maxTokens: 700, meter,
    messages: [
      { role: 'system', content: 'You read drafts written by licensed life insurance agents and name which persuasion principles they honestly use (from Robert Cialdini\'s work), so the agent learns to persuade with integrity: serve first, never pressure. You are precise: you only flag what the words actually do, and you quote them.' },
      { role: 'user', content: `The ${forScript ? 'video script' : 'draft'}:\n"""${body}"""\n\nPrinciples (only mark one when the draft clearly uses it, and only honestly):\n${Object.entries(PERSUASION).map(([k, p]) => `- ${k}: ${p.how}`).join('\n')}\n\nFlags, each with the EXACT words from the draft that set it off (copied character for character), and only when they're really there:\n- urgency: a deadline or "act now" pressure (not just the word "now" in passing)\n- scarcity: "only a few left", limited spots or time\n- testimonial: a client story, review or "people I've helped" (not allowed; the agent's own true story is fine)\n- fear: fear or guilt, like "being a burden" or "leave your family with bills" (a gentle note: naming a real worry is often fine)\nA calm draft has no flags. Don't flag urgency unless there's a deadline or a push to act right away.\n\nAlso: what the draft does well ("works": a qualifier kept, plain words, a real worry named), one way to give more value first ("advice": no testimonials, client stories, numbers, statistics or promises), and a short sample rewrite using ONE honest principle ("rewrite", the same rules).\nReturn ONLY JSON: {"principles":[{"id":"reciprocity","how":"under 15 words: where the draft does it"}],"flags":[{"kind":"fear","words":"exact words"}],"works":["short"],"note":"one sentence: is this honest persuasion?","advice":"one sentence","rewrite":{"principle":"reciprocity","text":"the sample"}}` },
    ],
  });
  const r = parse(out);
  const principles = (Array.isArray(r.principles) ? r.principles : []).filter(x => Object.hasOwn(PERSUASION, String(x?.id))).map(x => ({ id: x.id, how: clip(x.how, 140) }))
    .filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
  // Every flag quotes words that are really in the draft: compared without punctuation and capitals
  // ("act now." for "Act now!"), and a quote shortened with "…" counts when each part is there, in order.
  const quoted = words => quotes(body, words);
  const flags = (Array.isArray(r.flags) ? r.flags : []).map(x => ({ kind: String(x?.kind || '').toLowerCase(), words: clip(x?.words, 120).replace(/^["“']|["”']$/g, '') }))
    .filter(x => Object.hasOwn(FLAG_KINDS, x.kind) && x.words && quoted(x.words))
    .filter((x, i, a) => a.findIndex(y => y.kind === x.kind && norm(y.words) === norm(x.words)) === i).slice(0, 6);
  const pressing = flags.filter(f => !GENTLE.has(f.kind));
  // Credit where it's due: some of it checked here, the rest from the read.
  const strengths = [];
  const quals = mc.QUALIFIERS.filter(q => new RegExp(`\\b${q}\\b`, 'i').test(body));
  if (quals.length) strengths.push(`Keeps the qualifier “${quals[0]}”, so it stays accurate.`);
  const grade = mc.readingGrade(body.split(/\n+/));
  if (grade && grade <= 7) strengths.push('Plain words: easy to take in.');
  for (const w of Array.isArray(r.works) ? r.works : []) { const t = clip(w, 120); if (t && adviceOk(t) && strengths.length < 4 && !strengths.some(x => norm(x).includes(norm(t).slice(0, 20)))) strengths.push(t); }
  const advice = adviceOk(r.advice, cfg) ? clip(r.advice, 240) : 'Give something useful first: one plain tip they can use today, before any ask.';
  const rw = r.rewrite && typeof r.rewrite === 'object' && Object.hasOwn(PERSUASION, String(r.rewrite.principle)) && adviceOk(r.rewrite.text, cfg) ? { principle: r.rewrite.principle, text: clip(r.rewrite.text, 400) } : null;
  return {
    principles, flags, pressure: [...new Set(pressing.map(f => f.kind))], pressureWords: pressing.map(f => `${f.kind}: “${f.words}”`), honest: !pressing.length,
    note: clip(r.note, 240), strengths, advice, addValue: advice, rewrite: rw,
  };
}

// 80/20 advice from a week's log: [{ activity, hours, deals, appts }] → { keep, cut, automate, delegate }
export async function auditAdvice({ rows, meter }) {
  const lines = rows.map(r => `- ${r.activity}: ${r.hours} h, ${r.appts} appointments, ${r.deals} closed`).join('\n');
  const out = await chatJSON({
    job: 'quick', temperature: 0.3, maxTokens: 450, meter,
    messages: [
      { role: 'system', content: 'You coach a licensed life insurance agent on where their week goes, in the spirit of the 80/20 rule: a few activities bring most results. Plain, kind, specific. Never advice on products, compliance or law.' },
      { role: 'user', content: `This week:\n${lines}\n\nReturn ONLY JSON: {"keep":"the one or two activities to protect, and why","cut":"what to drop or shrink","automate":"what to automate or batch","delegate":"what someone else could do"} (each one or two sentences).` },
    ],
  });
  const r = parse(out);
  return { keep: clip(r.keep, 300), cut: clip(r.cut, 300), automate: clip(r.automate, 300), delegate: clip(r.delegate, 300) };
}

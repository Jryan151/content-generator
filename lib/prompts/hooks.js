// lib/prompts/hooks.js — the openings: eight written, then ranked by a critic.
import {
  FORMATS, GOV_TERMS, CLICHES, ABSTRACT_KEYWORDS, POST_FIRST_LINE, beatPlan, guardrailsFor, roleText, firstName, cityOf,
  factsOf, solutionsOf, isVoice, accentOn, qualifiersIn, firstWords, SHOT_TYPES,
} from '../../mixer-core.js';
import { nicheOf } from '../../niches/index.js';
import { normStyle, styleLabel, styleRules, styleGuide } from '../../comms-core.js';
import { fill, voiceLines, obj, str, num, int } from './shared.js';
import { FORMAT_HOOKS } from './script.js';

const hookOf = picks => FORMAT_HOOKS[FORMATS[picks?.format] ? picks.format : 'question'];

/* ---------------- Hooks: write many openings, keep the best ---------------- */
// The first line decides whether the right person keeps watching, so it gets its own step.
// Their interests first (Mindset): the real questions and objections the agent hears about this worry.
const theirWords = (cfg, picks) => [...(cfg.bank?.questions || []), ...(cfg.mindset?.objections || []).filter(o => o.topic)]
  .filter(q => q.text && (!q.links?.length || (picks.painPoint && q.links.includes(picks.painPoint.id)))).map(q => q.text).slice(0, 4);
export function buildHookPrompt(cfg, picks, count = 8) {
  const voice = isVoice(cfg), o = cfg.output, fmt = FORMATS[picks.format] || FORMATS.question, agent = firstName(cfg);
  const facts = factsOf(picks);
  const rec = (picks.recent || []).filter(r => r.hook).slice(0, 8);
  const system = `${roleText(cfg)}

You write the opening line (the hook) of short vertical videos. The hook decides whether the right person keeps watching. It must be honest: never promise what the facts can't deliver.`;
  const user = `[THIS VIDEO]
Audience: ${picks.audience?.text}
Their worry: ${picks.painPoint?.text}
${facts.map((f, i) => `${facts.length > 1 ? `Fact ${i + 1}` : 'Fact'}: ${f.text}`).join('\n')}
Format: ${fmt.label}. ${fill(hookOf(picks), cfg, picks)}${picks.story ? `\n${agent}'s true story: ${picks.story.text}` : ''}${picks.askQuestion ? `\nA real question ${agent} hears: ${picks.askQuestion.text}` : ''}

[WHAT MAKES A HOOK WORK]
- Speak to one person, in their situation and their own words. Name the situation, never a label like "seniors".
- Sound like ${agent} saying it out loud to that one person, not like an ad headline. Plain words, no wordplay.
- Open a loop: make them need the next scene, and make sure the facts above close it.
- Be specific and concrete. Short: ${o.maxWords} words or fewer on screen.
- Vary the angle across the ${count}: a direct question, a sharp statement, the surprising part of the fact (keep its qualifier), the moment the worry shows up in real life.${cfg.mindset?.why?.why ? `\n- Make one of them open from why ${agent} does this work ("${cfg.mindset.why.why}"), in ${agent}'s own words, like "I do this because…". Never a promise.` : ''}${theirWords(cfg, picks).length ? `\n- Use their real words where they fit. Things clients actually say to ${agent}: ${theirWords(cfg, picks).map(q => `"${q}"`).join(', ')}.` : ''}

${(picks.winners || []).length ? `[OPENINGS THAT WORKED FOR ${agent.toUpperCase()}: THEY BROUGHT MESSAGES OR WON A TEST]
Learn what made these work (the situation, the wording, the angle). Never copy them.
${picks.winners.map(w => (w.tested ? `- "${w.hook}" (won a side-by-side test against "${w.beat}"${w.ratio ? `: ${w.ratio}× the views` : ''})` : `- "${w.hook}" (${w.messages} message${w.messages === 1 ? '' : 's'})`)).join('\n')}

` : ''}[AVOID]
${rec.length ? rec.map(r => `- Too close to a recent hook: "${r.hook}"${r.rejected ? ` (rejected: ${r.rejected})` : ''}`).join('\n') + '\n' : ''}${(picks.turnedDown || []).length ? picks.turnedDown.map(h => `- Like an opening the agent turned down as weak: "${h}"`).join('\n') + '\n' : ''}- Fear, urgency, promises, or saying they'll qualify.
- Numbers, prices or percentages that aren't in the facts.
- Government words (${GOV_TERMS.map(t => t[1]).slice(0, 6).join(', ')}…) and overused ad phrases (${CLICHES.slice(0, 8).join(', ')}…).
- Words from this list: ${guardrailsFor(cfg).neverUse.map(x => `"${x}"`).join(', ')}.

[VOICE]
${cfg.specs.energy[cfg.voice.energy].rules} ${cfg.specs.tone[cfg.voice.tone].rules}${normStyle(picks.audience?.style) ? `\nThis audience leans ${styleLabel(picks.audience.style)}: ${styleRules(picks.audience.style)}` : ''}
${voiceLines(cfg).map(l => l.join('')).join('\n')}

Write ${count} different hooks. Return ONLY JSON: {"hooks":[{"text":"on-screen words"${voice ? `,"say":"the spoken version, ${o.maxSpoken} words or fewer"` : ''}}]}`;
  return { system, user };
}

/* ---------------- Critics: rank hooks and drafts ---------------- */
export function buildHookCriticPrompt(cfg, picks, hooks) {
  const system = `You are a short-form video strategist for ${cfg.look?.name || nicheOf(cfg).agentNoun}. Judge hooks honestly and strictly.`;
  const user = `Audience: ${picks.audience?.text}${normStyle(picks.audience?.style) ? ` (they lean ${styleLabel(picks.audience.style)}: ${styleRules(picks.audience.style)})` : ''}
Their worry: ${picks.painPoint?.text}
What the video teaches: ${factsOf(picks).map(f => f.text).join(' / ')}

Score each hook from 1 to 10: would this exact person stop scrolling, AND does the video deliver on it honestly? Prefer specific, plain, human lines over clever ones.

${hooks.map((h, i) => `${i + 1}. ${h.text}`).join('\n')}

Return ONLY JSON: {"ranked":[{"n":1,"score":8,"why":"a few words"}]} with every hook, best first.`;
  return { system, user };
}

export const hookSchema = cfg => ({ name: 'hooks', schema: obj({ hooks: { type: 'array', items: obj({ text: str, ...(isVoice(cfg) ? { say: str } : {}) }) } }) });
export const hookCriticSchema = () => ({ name: 'hook_ranking', schema: obj({ ranked: { type: 'array', items: obj({ n: int, score: num, why: str }) } }) });

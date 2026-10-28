// lib/prompts/critic.js — picks the best of several drafts that all passed the checks.
import {
  FORMATS, GOV_TERMS, CLICHES, ABSTRACT_KEYWORDS, POST_FIRST_LINE, beatPlan, guardrailsFor, roleText, firstName, cityOf,
  factsOf, solutionsOf, isVoice, accentOn, qualifiersIn, firstWords, SHOT_TYPES,
} from '../../mixer-core.js';
import { nicheOf } from '../../niches/index.js';
import { normStyle, styleLabel, styleRules, styleGuide } from '../../comms-core.js';
import { obj, str, num, int } from './shared.js';

/* ---------------- Critic: pick the best of several valid drafts ---------------- */
export function buildCriticPrompt(cfg, picks, drafts) {
  const voice = isVoice(cfg), style = normStyle(picks.audience?.style);
  const recent = (picks.recent || []).filter(r => r.hook).slice(0, 5);
  const list = drafts.map((d, i) => `DRAFT ${i + 1}\n` + d.scenes.map((s, j) => `${j + 1}. ${voice ? s.say : s.text}`).join('\n')).join('\n\n');
  const system = `You review short-form videos for ${cfg.look?.name || nicheOf(cfg).agentNoun}${cfg.look?.location ? ` in ${cfg.look.location}` : ''}. Score honestly and strictly.`;
  const user = `These drafts were written for:
Audience: ${picks.audience?.text}
What they must teach accurately: ${factsOf(picks).map(f => f.text).join(' / ')}
Open question the bridge and CTA must point to: ${picks.question}
Format: ${FORMATS[picks.format]?.label || 'Question'}

Score each draft from 1 to 5 on:
- hook: would this exact audience stop scrolling at scene 1?
- insight: is it taught clearly and accurately, with its qualifiers, and does the middle deliver what the hook promised?
- bridge: does the viewer finish feeling their own answer is still open?
- cta: does the last scene make reaching out feel easy and worth it?
- flow: does it sound like one warm, honest person from start to finish, not like an ad?
- fresh: would someone who saw the agent's recent videos feel this one is new, not the same shape and phrases again?${style ? `
- styleFit: does it speak the way this audience listens (${styleLabel(style)}: ${styleRules(style)})?` : ''}
${recent.length ? `
Recent videos opened and closed like this:
${recent.map(r => `- "${r.hook}"${r.bridge ? ` … "${r.bridge}"` : ''}${r.cta ? ` … "${r.cta}"` : ''}`).join('\n')}
` : ''}
${list}

Return ONLY JSON: {"scores":[{"draft":1,"hook":0,"insight":0,"bridge":0,"cta":0,"flow":0,"fresh":0,${style ? '"styleFit":0,' : ''}"note":"one sentence"}],"best":1}`;
  return { system, user };
}

export function criticSchema(picks) {
  const style = normStyle(picks?.audience?.style);
  const row = { draft: int, hook: num, insight: num, bridge: num, cta: num, flow: num, fresh: num, ...(style ? { styleFit: num } : {}), note: str };
  return { name: 'draft_scores', schema: obj({ scores: { type: 'array', items: obj(row) }, best: int }) };
}

// lib/prompts/post.js — the Instagram and Facebook post text under the Reel.
import {
  FORMATS, GOV_TERMS, CLICHES, ABSTRACT_KEYWORDS, POST_FIRST_LINE, beatPlan, guardrailsFor, roleText, firstName, cityOf,
  factsOf, solutionsOf, isVoice, accentOn, qualifiersIn, firstWords, SHOT_TYPES,
} from '../../mixer-core.js';
import { nicheOf } from '../../niches/index.js';
import { normStyle, styleLabel, styleRules, styleGuide } from '../../comms-core.js';
import { obj, str } from './shared.js';

/* ---------------- Instagram post text ---------------- */
const hashCity = cfg => String(cfg.look?.location || '').replace(/[^A-Za-z]/g, '');

export function buildPostPrompt(cfg, picks, scenes) {
  const L = cfg.look || {}, g = guardrailsFor(cfg), states = cfg.profile?.states || [];
  const script = scenes.map((s, i) => `${i + 1}. ${s.say || s.text}`).join('\n');
  const role = roleText(cfg);
  const system = `${role}\n\nYou write the Instagram post text that goes under the Reel. Follow the same rules as the video.`;
  const tags = [hashCity(cfg) && `#${hashCity(cfg)}`].filter(Boolean);
  const user = `The Reel says:\n${script}\n\nWhat it teaches (keep the meaning and qualifiers): ${factsOf(picks).map(f => f.text).join(' / ')}\n\nWrite the post text:
- The first line is a hook of ${POST_FIRST_LINE} characters or fewer that works on its own (it's all people see before "more").
- Then 1 to 3 short sentences in first person, warm and plain, at a 6th grade level: restate the insight a fresh way and invite them to ${String(cfg.story.ctaAction || 'message me').toLowerCase()}${L.handle ? ` (${L.handle})` : ''}.${states.length && states.length <= 2 ? `\n- Mention that you serve ${states.join(' and ')}.` : ''}
- Never use: ${g.neverUse.map(x => `"${x}"`).join(', ')}, or words suggesting a government connection (${GOV_TERMS.map(t => t[1]).join(', ')}). ${g.neverDo.filter(x => !/hashtag|emoji/i.test(x)).join('. ')}.
- End with 3 to 5 relevant hashtags${tags.length ? `, including ${tags.join(' ')}` : ''}. No emojis.${L.disclaimer ? `\n- Last line, exactly: ${L.disclaimer}` : ''}
Return ONLY JSON: {"caption":"..."}`;
  return { system, user };
}

export const postSchema = () => ({ name: 'post', schema: obj({ caption: str }) });

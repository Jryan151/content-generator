// lib/prompts/shared.js — small helpers every prompt in this folder uses.
import { cityOf, firstName } from '../../mixer-core.js';

// {city}, {first} and {count} in prompt text are filled in when the prompt is built.
export const fill = (t, cfg, picks = {}) => String(t).replace(/\{city\}/g, cityOf(cfg) || 'your town').replace(/\{first\}/g, firstName(cfg)).replace(/\{count\}/g, String(picks.insights?.length || 2));
export const plainOf = sol => (sol ? sol.plain || sol.text : '');

// What the agent's own writing adds to a prompt (the script and the hooks).
export function voiceLines(cfg) {
  const samples = (cfg.bank?.samples || []).slice(0, 3);
  if (!samples.length) return [];
  return [[`How ${firstName(cfg)} writes. Match this word choice and rhythm; never copy these lines or their topics:`],
    ...samples.map(t => [`- "${String(t).replace(/\s+/g, ' ').trim().slice(0, 300)}"`])];
}

// How every script should sound, whatever the format. These are the lines that keep a script from
// reading like an ad or like captions stitched together.
export const SOUND_RULES = [
  'Write it the way {first} would say it out loud to one person across the kitchen table: everyday words, contractions, short complete sentences.',
  'Each scene is one complete thought that makes sense on its own screen. Never split one sentence across two scenes.',
  'Read top to bottom, it sounds like one warm person talking, not a list of slogans. Each scene follows from the one before it.',
  'Plain beats clever. No wordplay, no "Here’s the thing", no "Let’s talk about", no "Did you know" unless the format opens that way.',
  'Say the fact the way a person would explain it, keeping its meaning and its qualifier. Don’t read it out like a brochure.',
];

/* ---------------- Reply shapes (OpenAI structured outputs) ---------------- */
// With OPENAI_STRUCTURED on (the default), each call says exactly which JSON it must return, so a
// reply can't come back malformed or with fields missing. lib/openai.js falls back to plain JSON mode
// for a model that doesn't support it. Strict schemas: every field listed is required.
export const obj = (props, req = Object.keys(props)) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
export const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' };

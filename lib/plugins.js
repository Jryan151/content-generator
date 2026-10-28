// lib/plugins.js — standard mounts. Three kinds of part plug into the engine the same way, so a new one
// (TikTok, YouTube Shorts, another stock site, a second niche) is added by writing the part, not by
// changing the engine:
//
//   platform  where approved videos post        lib/platforms.js: Instagram, Facebook
//   footage   where stock clips come from       stages/broll.js: Pixabay, Pexels
//   niche     what the videos are about         niches/index.js: life insurance
//
// Each kind has a declared shape (below), checked when the part is registered, and a test kit in
// test/kits/ that every part of that kind must pass (test/v15-plugins.test.js runs them all).
export const SHAPES = {
  platform: {
    id: 'string', label: 'string',
    on: 'function',            // () → is it set up on this server (its app keys in .env)?
    account: 'function',       // (ws) → { connected, problem? }
    schedulePost: 'function',  // (ws, videoId, at|'now', by, now?) → the post's record on the video
    cancelPost: 'function',    // (ws, videoId) → true if a scheduled post was called off
    tick: 'function',          // (now?) → posts what's due, checks what's going; every minute
    stateOf: 'function',       // (video) → '' | 'scheduled' | 'processing' | 'posted' | 'failed' | 'unsure'
  },
  footage: {
    id: 'string', label: 'string',
    on: 'function',            // () → set up (its key in .env)?
    search: 'function',        // (query, { people }) → hits: [{ id, tags, videos: { medium, large } }]
    byId: 'function',          // (id) → one hit, or null
    owns: 'function',          // (id) → is this clip id one of this source's?
  },
  niche: {
    id: 'string', label: 'string', agentNoun: 'string', productLines: 'array', defaultProduct: 'string',
    platformGuardrails: 'object', govTerms: 'array', eligibility: 'array', absolutes: 'array',
    abstractKeywords: 'array', accentBanned: 'array', seasons: 'array', series: 'array', shotList: 'array', defaults: 'object',
  },
};
const typeOf = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
// What's wrong with a part (an empty list when it fits its mount).
export function problemsOf(kind, part) {
  const shape = SHAPES[kind];
  if (!shape) return [`unknown kind of part: ${kind}`];
  if (!part || typeof part !== 'object') return [`a ${kind} must be an object`];
  const out = [];
  for (const [k, t] of Object.entries(shape)) if (typeOf(part[k]) !== t) out.push(`${kind} ${part.id || '?'}: ${k} should be ${t === 'array' ? 'a list' : `a ${t}`}, not ${typeOf(part[k])}`);
  if (part.id && !/^[a-z][a-z0-9_]{1,30}$/.test(part.id)) out.push(`${kind} id "${part.id}" should be short lowercase letters, digits and _`);
  return out;
}
const mounts = { platform: new Map(), footage: new Map(), niche: new Map() };
// Registers a part. A part that doesn't fit its mount is refused (a bug: the checks catch it first).
export function register(kind, part) {
  const p = problemsOf(kind, part);
  if (p.length) throw new Error(`This ${kind} doesn’t fit its mount: ${p.join('; ')}`);
  mounts[kind].set(part.id, part);
  return part;
}
export const list = kind => [...(mounts[kind]?.values() || [])];
export const get = (kind, id) => mounts[kind]?.get(id) || null;

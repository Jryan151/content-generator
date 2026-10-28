// lib/shapes.js — the declared shape of each kind of saved record, checked on every save.
//
// Like a part checked against its drawing before it goes in the engine: a bug that tries to save a
// video without a status, or a login with a number for an email, is caught where it happens instead of
// breaking a page weeks later. Fields not listed here are allowed and always kept (an older version
// running after a rollback never strips what a newer one added).
//
// In the checks (npm test) a wrong shape throws, so it's fixed before release. On a real server the
// save goes ahead (the agent's action is never lost over a missing field) and you get one alert a day
// per problem, with where it came from.
//
// Types: 'string' 'number' 'boolean' 'array' 'object' 'null' 'iso' (a date string), joined with '|'
// for either; a trailing '?' makes the field optional; an array of strings is a list of allowed values.
export const SHAPES = {
  video: { v: 1, fields: {
    id: 'string', status: ['pending', 'approved', 'posted', 'rejected'],
    createdAt: 'iso?', updatedAt: 'iso?', file: 'string?', cover: 'string?', source: 'string?', mode: 'string?',
    scenes: 'array?', clips: 'array?', meta: 'object?', post: 'string|null?', duration: 'number?',
    approval: 'object|null?', rejection: 'object|null?', posted: 'object|null?', autopost: 'object|null?', fbpost: 'object|null?',
    cost: 'number?', version: 'number?', fixes: 'number?', fileDeleted: 'boolean?', igTried: 'array?',
    versions: 'array?', needsChanges: 'object|null?', updated: 'boolean?', by: 'string?',
    signoff: 'object|null?', signoffs: 'array?', abtest: 'object|null?', bookings: 'object?', leads: 'object?',   // v15 Phase 9
  } },
  workspace: { v: 1, fields: {
    id: 'string', name: 'string', createdAt: 'iso', onboarded: 'boolean?', comped: 'boolean?', suspended: 'boolean?', managed: 'boolean?',
    limits: 'object?', billing: 'object?', switches: 'object?',
    away: 'object|null?', awayLast: 'object|null?', busy: 'object|null?',   // v15: Away mode, the busy week
    signoff: 'object?', bookingHook: 'object?',   // v15 Phase 9: the compliance reviewer, booking confirmations
  } },
  account: { v: 1, fields: {
    id: 'string', email: 'string', role: ['admin', 'agent'], hash: 'string?', name: 'string?', workspaceId: 'string|null?',
    memberships: 'array?', disabled: 'boolean?', createdAt: 'iso?',
  } },
  client: { v: 1, fields: {
    id: 'string', name: 'string', createdAt: 'iso', updatedAt: 'iso?', stage: 'string', next: 'string?', last: 'string?',
    careDone: 'array?', birthday: 'string?', since: 'string?', bookedAt: 'string?', igsid: 'string?', videoId: 'string?', stageAt: 'string?',
  } },
  handoff: { v: 1, fields: {
    id: 'string', kind: ['reply', 'video', 'lead', 'note', 'changes'], status: ['open', 'done'], at: 'iso', title: 'string?', message: 'string?', draft: 'string?', checklist: 'array?', draftId: 'string?',
  } },
};

const isIso = v => typeof v === 'string' && v.length >= 10 && Number.isFinite(Date.parse(v));
function typeOk(t, v) {
  if (t === 'iso') return isIso(v);
  if (t === 'null') return v === null;
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return !!v && typeof v === 'object' && !Array.isArray(v);
  return typeof v === t;
}
// The problems with one record (an empty list when it's fine).
export function problemsOf(kind, rec) {
  const shape = SHAPES[kind];
  if (!shape) return [`unknown kind of record: ${kind}`];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return [`a ${kind} must be an object`];
  const out = [];
  for (const [k, spec] of Object.entries(shape.fields)) {
    const v = rec[k];
    if (Array.isArray(spec)) { if (!spec.includes(v)) out.push(`${kind}.${k} is ${JSON.stringify(v)} (allowed: ${spec.join(', ')})`); continue; }
    const optional = spec.endsWith('?'), types = spec.replace(/\?$/, '').split('|');
    if (v === undefined) { if (!optional) out.push(`${kind}.${k} is missing`); continue; }
    if (!types.some(t => typeOk(t, v))) out.push(`${kind}.${k} should be ${types.join(' or ')}, not ${v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v}`);
  }
  return out;
}

let reportHook = null;
export const onShapeProblem = fn => { reportHook = fn; };
const reported = new Map();   // problem → day it was reported
export class ShapeError extends Error { constructor(msg) { super(msg); this.shape = true; } }
// Checks records about to be saved. `where`: what saved them (for the alert).
export function check(kind, recs, where = '') {
  const list = Array.isArray(recs) ? recs : [recs];
  const problems = [...new Set(list.flatMap(r => problemsOf(kind, r)))];
  if (!problems.length) return true;
  if (process.env.NODE_ENV === 'test' && process.env.SHAPES !== 'warn') throw new ShapeError(`Wrong shape (${where || kind}): ${problems.join('; ')}`);
  const day = new Date().toISOString().slice(0, 10);
  for (const p of problems) {
    if (reported.get(p) === day) continue;
    reported.set(p, day);
    console.error(`[shape] ${where || kind}: ${p}`);
    try { reportHook?.(p, where || kind); } catch { /* a report must never stop the save */ }
  }
  return false;
}

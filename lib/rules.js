// lib/rules.js — Admin → Render rules (v15): change the checks without new code.
//
// Every check Studio, Fix a scene and automatic videos run is in mixer-core.js RULES. Here Admin sets, for
// everyone or for one workspace:
//   levels    each style rule's level in drafts people write and in automatic videos: block, warn or off
//             (locked compliance rules can't be changed: they always stop a render)
//   settings  the adjustable numbers, held to safe ranges (how closely teaching scenes must say the fact,
//             word limits, how many recent videos count for "too close")
//   lists     words added to or taken off the built-in lists (overused phrases, abstract footage words,
//             words never highlighted), so a built-in list's own updates still arrive
// Kept in data/render-rules.json with every change (who, when, before and after), so any earlier version
// is one tap away. store.loadConfig puts the rules in force on each workspace's config (cfg.rules), so
// every check (server and portal, from the same mixer-core.js) reads the same ones.
import path from 'path';
import { DIRS, readJSON, updateJSON, docVersion, randomId } from './paths.js';
import { RULES, RULE_SETTINGS, RULE_LISTS, LEVELS_OK } from '../mixer-core.js';

const FILE = () => path.join(DIRS.data, 'render-rules.json');
const EMPTY = () => ({ global: {}, workspaces: {}, history: [] });
export const KEEP_HISTORY = 100;
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Only what can be set, within its range: unknown rules, locked rules and bad values are dropped.
export function clean(input = {}) {
  const out = {};
  const levels = {};   // (only known ids are kept, checked with Object.hasOwn: "constructor" or "__proto__" never are)
  for (const [id, v] of Object.entries(input.levels || {})) {
    if (!Object.hasOwn(RULES, id) || RULES[id].locked || !v || typeof v !== 'object') continue;
    const x = {};
    for (const ctx of ['draft', 'auto']) if (LEVELS_OK.includes(v[ctx])) x[ctx] = v[ctx];
    if (Object.keys(x).length) levels[id] = x;
  }
  if (Object.keys(levels).length) out.levels = levels;
  const settings = {};
  for (const [k, v] of Object.entries(input.settings || {})) {
    const s = Object.hasOwn(RULE_SETTINGS, k) ? RULE_SETTINGS[k] : null;
    if (!s) continue;
    if (v === null || v === '') { settings[k] = null; continue; }
    const n = Number(v);
    if (Number.isFinite(n)) settings[k] = Math.round(Math.min(s.max, Math.max(s.min, n)) * 1000) / 1000;
  }
  if (Object.keys(settings).length) out.settings = settings;
  const lists = {};
  for (const [k, v] of Object.entries(input.lists || {})) {
    if (!Object.hasOwn(RULE_LISTS, k) || !v || typeof v !== 'object') continue;
    const words = a => [...new Set((Array.isArray(a) ? a : []).map(w => t(w, 60).toLowerCase()).filter(Boolean))].slice(0, 200);
    const add = words(v.add), remove = words(v.remove);
    if (add.length || remove.length) lists[k] = { add, remove };
  }
  if (Object.keys(lists).length) out.lists = lists;
  return out;
}

let cache = { key: null, data: null };
export function read() {
  const key = docVersion(FILE());
  if (cache.data && cache.key === key && key !== null) return cache.data;
  const data = { ...EMPTY(), ...(readJSON(FILE(), null) || {}) };
  cache = { key, data };
  return data;
}
// The rules in force for a workspace: everyone's, with the workspace's own on top.
export const effective = (wsId = '') => effectiveFrom(read(), wsId);
function effectiveFrom(d, wsId) {
  const g = d.global || {}, w = (wsId && d.workspaces?.[wsId]) || {};
  const levels = {};
  for (const id of new Set([...Object.keys(g.levels || {}), ...Object.keys(w.levels || {})])) levels[id] = { ...(g.levels?.[id] || {}), ...(w.levels?.[id] || {}) };
  const settings = { ...(g.settings || {}) };
  for (const [k, v] of Object.entries(w.settings || {})) if (v !== null) settings[k] = v;
  const lists = {};
  for (const k of new Set([...Object.keys(g.lists || {}), ...Object.keys(w.lists || {})])) {
    const add = [...new Set([...(g.lists?.[k]?.add || []), ...(w.lists?.[k]?.add || [])])];
    const remove = [...new Set([...(g.lists?.[k]?.remove || []), ...(w.lists?.[k]?.remove || [])])].filter(x => !(w.lists?.[k]?.add || []).includes(x));
    lists[k] = { add, remove };
  }
  return { levels, settings, lists };
}
export const scopeOf = (scope = 'global') => (scope === 'global' ? read().global || {} : read().workspaces?.[scope] || {});

// The rules a workspace would have if `scope` were set to `proposed` (for Try it first, before saving).
export function effectiveWith(wsId, scope, proposed) {
  const d = read();
  const g = scope === 'global' ? clean(proposed) : d.global || {}, w = scope === 'global' ? (wsId && d.workspaces?.[wsId]) || {} : clean(proposed);
  return effectiveFrom({ ...d, global: g, workspaces: { ...(d.workspaces || {}), ...(wsId ? { [wsId]: w } : {}) } }, wsId);
}
// Saves the rules for everyone ('global') or one workspace (its id). Returns the history entry.
export function save(scope, rules, { by = '', byName = '' } = {}) {
  const next = clean(rules);
  let entry = null;
  updateJSON(FILE(), EMPTY(), d => {
    d.global ||= {}; d.workspaces ||= {}; d.history ||= [];
    const before = scope === 'global' ? d.global : d.workspaces[scope] || {};
    entry = { id: randomId('rr', 5), at: new Date().toISOString(), by, byName: t(byName, 80), scope, before, after: next };
    if (scope === 'global') d.global = next;
    else if (Object.keys(next).length) d.workspaces[scope] = next;
    else delete d.workspaces[scope];
    d.history = [entry, ...d.history].slice(0, KEEP_HISTORY);
    return d;
  });
  cache = { key: null, data: null };
  return entry;
}
// Back to an earlier version: the rules as they were after (or before) a recorded change.
export function restore(id, which = 'after', who = {}) {
  const h = read().history.find(x => x.id === id);
  if (!h) return null;
  return save(h.scope, which === 'before' ? h.before : h.after, who);
}
// What changed between two versions, in words ("Overused ad wording: drafts warn → block").
export function describe(before = {}, after = {}) {
  const out = [];
  for (const id of new Set([...Object.keys(before.levels || {}), ...Object.keys(after.levels || {})])) for (const ctx of ['draft', 'auto']) {
    const a = before.levels?.[id]?.[ctx] || RULES[id]?.[ctx], b = after.levels?.[id]?.[ctx] || RULES[id]?.[ctx];
    if (a !== b) out.push(`${RULES[id]?.label || id}: ${ctx === 'draft' ? 'drafts' : 'automatic videos'} ${a} → ${b}`);
  }
  for (const k of new Set([...Object.keys(before.settings || {}), ...Object.keys(after.settings || {})])) {
    const a = before.settings?.[k] ?? RULE_SETTINGS[k]?.def, b = after.settings?.[k] ?? RULE_SETTINGS[k]?.def;
    if (a !== b) out.push(`${RULE_SETTINGS[k]?.label || k}: ${a ?? 'default'} → ${b ?? 'default'}`);
  }
  for (const k of new Set([...Object.keys(before.lists || {}), ...Object.keys(after.lists || {})])) {
    const ba = new Set(before.lists?.[k]?.add || []), aa = new Set(after.lists?.[k]?.add || []), br = new Set(before.lists?.[k]?.remove || []), ar = new Set(after.lists?.[k]?.remove || []);
    const added = [...aa].filter(x => !ba.has(x)), unadded = [...ba].filter(x => !aa.has(x)), removed = [...ar].filter(x => !br.has(x)), back = [...br].filter(x => !ar.has(x));
    if (added.length) out.push(`${RULE_LISTS[k].label}: added ${added.map(x => `“${x}”`).join(', ')}`);
    if (removed.length) out.push(`${RULE_LISTS[k].label}: took off ${removed.map(x => `“${x}”`).join(', ')}`);
    if (unadded.length || back.length) out.push(`${RULE_LISTS[k].label}: back to the built-in for ${[...unadded, ...back].map(x => `“${x}”`).join(', ')}`);
  }
  return out;
}

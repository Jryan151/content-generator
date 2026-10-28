// lib/memory.js — what the app remembers about an agent's taste, per workspace (memory.json), so the
// same miss isn't repeated and nobody has to say it twice:
//   music      tracks they turned down (a video rejected as "Wrong music"); never picked again
//   openings   openings of videos rejected as "Weak opening"; new hooks steer clear of them
//   milestones which milestones they've already seen (and when the list started, so an upgrade
//              doesn't throw a pile of old ones at them)
// Formats are remembered from approvals and rejections themselves (mixer-core tasteFrom).
import path from 'path';
import { readJSON, updateJSON } from './paths.js';
import { wsDir } from './store.js';

const file = ws => path.join(wsDir(ws), 'memory.json');
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const KEEP_MUSIC = 60, KEEP_OPENINGS = 25;

export function clean(m = {}) {
  const seen = m.milestones?.seen && typeof m.milestones.seen === 'object' ? m.milestones.seen : {};
  return {
    music: [...new Set((Array.isArray(m.music) ? m.music : []).map(x => path.basename(t(x, 200))).filter(Boolean))].slice(-KEEP_MUSIC),
    openings: (Array.isArray(m.openings) ? m.openings : []).filter(o => t(o?.text, 200)).slice(-KEEP_OPENINGS).map(o => ({ text: t(o.text, 200), at: t(o.at, 30) })),
    milestones: { started: t(m.milestones?.started, 30), seen: Object.fromEntries(Object.entries(seen).filter(([k]) => /^[a-z0-9_]{1,30}$/.test(k)).slice(0, 100).map(([k, v]) => [k, t(v, 30)])) },
  };
}
export const read = ws => clean(readJSON(file(ws), {}));
export function update(ws, fn) {
  let out = null;
  updateJSON(file(ws), {}, cur => { out = clean(fn(clean(cur)) || cur); return out; });
  return out;
}

// A rejection teaches the matching seat. Returns what was remembered (for the reply), or ''.
export function learnFromRejection(ws, v, reason) {
  const at = new Date().toISOString();
  if (reason === 'Wrong music' && v.meta?.music) { update(ws, m => ({ ...m, music: [...m.music.filter(x => x !== v.meta.music), v.meta.music] })); return 'music'; }
  const hook = String(v.scenes?.[0]?.text || '').trim();
  if (reason === 'Weak opening' && hook) { update(ws, m => ({ ...m, openings: [...m.openings.filter(o => o.text.toLowerCase() !== hook.toLowerCase()), { text: hook, at }] })); return 'opening'; }
  return '';
}
// Reopening a rejected video takes its lesson back, unless another rejected video (`others`) still
// teaches the same thing.
export function unlearn(ws, v, others = []) {
  const hookOf = x => String(x.scenes?.[0]?.text || '').trim().toLowerCase(), hook = hookOf(v), why = v.rejection?.reason;
  const still = others.some(o => o.rejection?.reason === why && (why === 'Wrong music' ? o.meta?.music === v.meta?.music : hookOf(o) === hook));
  if (still) return;
  update(ws, m => ({ ...m, music: why === 'Wrong music' ? m.music.filter(x => x !== v.meta?.music) : m.music, openings: why === 'Weak opening' ? m.openings.filter(o => o.text.toLowerCase() !== hook) : m.openings }));
}
// What Settings shows: counts only, plus a way to forget.
export const summary = ws => { const m = read(ws); return { music: m.music.length, openings: m.openings.map(o => o.text).slice(-5).reverse(), openingsCount: m.openings.length }; };
export const forget = (ws, what) => update(ws, m => ({ ...m, ...(what === 'music' || what === 'all' ? { music: [] } : {}), ...(what === 'openings' || what === 'all' ? { openings: [] } : {}) }));

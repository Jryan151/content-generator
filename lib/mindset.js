// lib/mindset.js — the Mindset tab's own records, per workspace (mindset.json): habits and their
// check-offs, the daily principle, the mastery path's practice log, the 80/20 time audit, the
// strategy board, closer check, worthy rival and weekly reflections. The parts that shape videos
// (the why, the hedgehog, objections) live in the config (cfg.mindset), so scripts can read them.
// Relationship notes (client details) are in lib/clients.js.
import path from 'path';
import { readJSON, updateJSON, randomId } from './paths.js';
import { wsDir } from './store.js';
import { SKILLS, PRINCIPLES, AUTO_HABITS } from '../mindset-core.js';

const file = ws => path.join(wsDir(ws), 'mindset.json');
const t = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const okDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
const okId = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
const list = (v, n, len) => (Array.isArray(v) ? v : []).map(x => t(x, len)).filter(Boolean).slice(0, n);

export const DEFAULT_HABITS = [
  { id: 'h_calls', text: 'Make 20 prospecting calls' },
  { id: 'h_follow', text: 'Follow up with every open lead' },
  { id: 'h_give', text: 'Send one helpful thing, no ask' },
  { id: 'h_read', text: 'Read or listen 20 minutes' },
  { id: 'h_post', text: 'Post 3 reels this week', auto: 'post', target: 3 },
];

// Every section in the shape the tab expects, with caps, whatever was stored or sent.
export function clean(m = {}) {
  const habits = (Array.isArray(m.habits) ? m.habits : DEFAULT_HABITS).filter(h => h && t(h.text, 80)).slice(0, 12)
    .map(h => ({ id: okId(h.id) ? h.id : randomId('h', 4), text: t(h.text, 80), ...(Object.hasOwn(AUTO_HABITS, String(h.auto)) ? { auto: h.auto, target: Math.max(1, Math.min(14, Math.round(Number(h.target) || 3))) } : {}) }));
  const ids = new Set(habits.map(h => h.id));
  const checks = Object.fromEntries(Object.entries(m.checks && typeof m.checks === 'object' ? m.checks : {}).filter(([k]) => ids.has(k))
    .map(([k, v]) => [k, [...new Set((Array.isArray(v) ? v : []).filter(okDay))].sort().slice(-400)]));
  const offsets = Object.fromEntries(Object.entries(m.principles?.offsets || {}).filter(([d, n]) => okDay(d) && Number.isInteger(n)).slice(-30));
  return {
    identity: t(m.identity ?? 'always follows up', 80),
    habits, checks,
    principles: { done: (Array.isArray(m.principles?.done) ? m.principles.done : []).filter(x => okDay(x?.date) && PRINCIPLES.some(p => p.id === x.id)).slice(-400), offsets },
    skills: Object.fromEntries(Object.keys(SKILLS).map(k => [k, Math.max(1, Math.min(5, Math.round(Number(m.skills?.[k]) || 1)))])),
    practice: (Array.isArray(m.practice) ? m.practice : []).filter(p => Object.hasOwn(SKILLS, String(p?.skill)) && t(p.what, 200)).slice(-500)
      .map(p => ({ id: okId(p.id) ? p.id : randomId('pr', 4), at: /^\d{4}-\d{2}-\d{2}/.test(String(p.at)) ? String(p.at).slice(0, 30) : new Date().toISOString(), skill: p.skill, what: t(p.what, 200), note: t(p.note, 300) })),
    mentor: { name: t(m.mentor?.name, 80), next: okDay(m.mentor?.next) ? m.mentor.next : '', learning: t(m.mentor?.learning, 300) },
    audit: (Array.isArray(m.audit) ? m.audit : []).filter(w => okDay(w?.week)).slice(-26).map(w => ({ week: w.week,
      rows: (Array.isArray(w.rows) ? w.rows : []).filter(r => t(r?.activity, 80)).slice(0, 30).map(r => ({ activity: t(r.activity, 80), hours: Math.max(0, Math.min(100, Math.round((Number(r.hours) || 0) * 10) / 10)), deals: Math.max(0, Math.min(1000, Math.round(Number(r.deals) || 0))), appts: Math.max(0, Math.min(1000, Math.round(Number(r.appts) || 0))) })) })),
    strategy: { strengths: list(m.strategy?.strengths, 12, 160), weaknesses: list(m.strategy?.weaknesses, 12, 160), competitors: list(m.strategy?.competitors, 12, 160), shifts: list(m.strategy?.shifts, 12, 160) },
    closer: (Array.isArray(m.closer) ? m.closer : []).filter(c => t(c?.text, 160)).slice(0, 40)
      .map(c => ({ id: okId(c.id) ? c.id : randomId('c', 4), text: t(c.text, 160), dread: Math.max(1, Math.min(5, Math.round(Number(c.dread) || 3))), done: okDay(String(c.done).slice(0, 10)) ? String(c.done).slice(0, 30) : '' })),
    rival: { name: t(m.rival?.name, 80), better: t(m.rival?.better, 200), learn: t(m.rival?.learn, 300), note: t(m.rival?.note, 300) },
    reflections: (Array.isArray(m.reflections) ? m.reflections : []).filter(r => okDay(r?.week)).slice(-60)
      .map(r => ({ week: r.week, win: t(r.win, 400), number: t(r.number, 300), matched: t(r.matched, 400), change: t(r.change, 300), at: String(r.at || '').slice(0, 30) })),
  };
}

export const read = ws => clean(readJSON(file(ws), {}));
export function update(ws, fn) {
  let out = null;
  updateJSON(file(ws), {}, cur => { out = clean(fn(clean(cur)) || cur); return out; });
  return out;
}

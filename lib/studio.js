// lib/studio.js — Studio drafts: videos the agent (or their assistant) builds by hand in Create →
// Studio. A draft keeps its brief (audience, worry, confirmed facts, format, structure, series), the
// openings written for it, its scene cards and the clip chosen for each scene, so work can stop and
// pick up later. Rendering goes through the same checks and pipeline as every other video.
import path from 'path';
import { readJSON, updateJSON, randomId } from './paths.js';
import { wsDir } from './store.js';
import { BRIDGE_STYLES, CTA_STYLES, LIMITS, studioPicks, FORMATS } from '../mixer-core.js';

export const MAX_DRAFTS = 20;
const file = ws => path.join(wsDir(ws), 'studio.json');
const clip = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const okId = id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);
// A clip chosen for a scene: a Pixabay id (number), a Pexels id ("px123") or one of the agent's own ("own:<id>").
const okClip = id => (typeof id === 'number' && Number.isInteger(id) && id > 0) || (typeof id === 'string' && /^(px\d{1,12}|own:[\w-]{1,40}|\d{1,12})$/.test(id));

export function cleanBrief(b = {}) {
  return {
    audienceId: okId(b.audienceId) ? b.audienceId : '', painId: okId(b.painId) ? b.painId : '',
    insightIds: (Array.isArray(b.insightIds) ? b.insightIds : []).filter(okId).slice(0, 3),
    format: FORMATS[b.format] ? b.format : 'question', structure: clip(b.structure, 20) || 'classic',
    scenes: Math.min(LIMITS.scenes[1], Math.max(LIMITS.scenes[0], Math.round(Number(b.scenes) || 6))),
    bridgeStyle: BRIDGE_STYLES[b.bridgeStyle] ? b.bridgeStyle : '', ctaStyle: CTA_STYLES[b.ctaStyle] ? b.ctaStyle : '',
    seriesId: okId(b.seriesId) ? b.seriesId : '', part: Math.max(0, Math.min(20, Math.round(Number(b.part) || 0))),
    ...(b.noFact === true ? { noFact: true } : {}),   // "This video doesn't teach a specific fact" (v15)
  };
}
export function cleanScenes(list) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.scenes[1]).map(s => {
    const c = s && typeof s === 'object' ? s : {};
    const id = typeof c.clip?.id === 'string' && /^\d+$/.test(c.clip.id) ? Number(c.clip.id) : c.clip?.id;
    return {
      say: clip(c.say, 300), text: clip(c.text, 200), accent: clip(c.accent, 40), keyword: clip(c.keyword, 60),
      ...(clip(c.note, 160) ? { note: clip(c.note, 160) } : {}),
      ...(okClip(id) ? { clip: { id, query: clip(c.clip.query, 60), thumb: /^https:\/\/[^\s"'<>]+$/.test(String(c.clip.thumb || '')) || /^\/api\/library\/[\w-]+\/thumb$/.test(String(c.clip.thumb || '')) ? c.clip.thumb : '', note: clip(c.clip.note, 120) } } : {}),
    };
  });
}
const cleanHooks = list => (Array.isArray(list) ? list : []).slice(0, 12).map(h => ({ text: clip(h?.text, 200), say: clip(h?.say, 300), score: Number(h?.score) || 0, why: clip(h?.why, 160) })).filter(h => h.text);

export const list = ws => readJSON(file(ws), []);
export const get = (ws, id) => list(ws).find(d => d.id === id) || null;

// A title from what the video is about, for the drafts list.
const titleOf = (cfg, brief) => { const p = studioPicks(cfg, brief); return [p.series ? `${p.series.label} · Part ${p.series.part}` : '', p.painPoint?.text || 'New video'].filter(Boolean).join(': ').slice(0, 120); };

export function create(ws, cfg, brief, rng = Math.random) {
  const b = cleanBrief(brief);
  // The ending styles are picked once, so the draft reads the same each time it's opened.
  if (!b.bridgeStyle) b.bridgeStyle = Object.keys(BRIDGE_STYLES)[Math.floor(rng() * Object.keys(BRIDGE_STYLES).length)];
  if (!b.ctaStyle) b.ctaStyle = Object.keys(CTA_STYLES)[Math.floor(rng() * Object.keys(CTA_STYLES).length)];
  const now = new Date().toISOString();
  const d = { id: randomId('sd', 6), createdAt: now, updatedAt: now, title: titleOf(cfg, b), brief: b, hooks: [], scenes: [], status: 'draft', videoId: '', error: '' };
  let full = false;
  updateJSON(file(ws), [], all => { if (all.length >= MAX_DRAFTS) { full = true; return all; } return [d, ...all]; });
  if (full) throw Object.assign(new Error(`You have ${MAX_DRAFTS} Studio drafts. Delete one to start another.`), { status: 409 });
  return d;
}

export function save(ws, id, patch = {}, cfg = null) {
  let out = null;
  updateJSON(file(ws), [], all => {
    const d = all.find(x => x.id === id);
    if (!d) return all;
    if (patch.brief) { d.brief = { ...cleanBrief({ ...d.brief, ...patch.brief }) }; if (!d.brief.bridgeStyle) d.brief.bridgeStyle = 'depends'; if (!d.brief.ctaStyle) d.brief.ctaStyle = 'tie'; if (cfg) d.title = titleOf(cfg, d.brief); }
    if (patch.scenes) d.scenes = cleanScenes(patch.scenes);
    if (patch.hooks) d.hooks = cleanHooks(patch.hooks);
    ['status', 'videoId', 'error', 'jobId'].forEach(k => { if (k in patch) d[k] = clip(patch[k], 300); });
    d.updatedAt = new Date().toISOString();
    out = { ...d };
    return all;
  });
  return out;
}

export function remove(ws, id) {
  let gone = false;
  updateJSON(file(ws), [], all => { const rest = all.filter(d => d.id !== id); gone = rest.length !== all.length; return rest; });
  return gone;
}

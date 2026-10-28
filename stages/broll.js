// stages/broll.js — Stage 2: pick and download one stock clip per scene: Pixabay, plus Pexels when
// PEXELS_API_KEY is set (more variety, many vertical clips). Pexels clip ids start with "px".
// Searches people footage first, skips green screen / animals / abstract clips, prefers vertical
// clips, avoids clips this agent used recently, and (optionally) has the AI look at each one.
// Search results are cached for 24 hours (Pixabay's terms ask for this), and so are downloads.
// Each scene keeps a few unused alternates, so one bad clip can be swapped without a new video.
import { SHOT_TYPES } from '../mixer-core.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DIRS } from '../lib/paths.js';
import * as breaker from '../lib/breaker.js';
import { register, list as listParts } from '../lib/plugins.js';
import { jobSignal, checkStopped } from '../lib/proc.js';

const API = () => process.env.PIXABAY_BASE_URL || 'https://pixabay.com/api/videos/';
const CACHE = path.join(DIRS.cache, 'pixabay');
const CLIPS = path.join(DIRS.cache, 'clips');
const DAY = 86400000;
const BATCH = 6;          // clips compared side by side per search
const ALTS = 6;           // spare clips kept per scene for "swap clip"
// Clips tagged with any of these are never used.
const BAD_TAGS = ['green screen', 'greenscreen', 'chroma', 'chroma key', 'animal', 'animals', 'bird', 'birds', 'dog', 'cat', 'monkey', 'wildlife', 'insect', 'abstract', 'animation', 'cartoon', '3d', 'render', 'cgi', 'particles', 'loop background', 'funeral', 'cemetery', 'hospital', 'church', 'prayer', 'bikini'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = s => crypto.createHash('sha1').update(s).digest('hex');

function fresh(file) {
  try { return Date.now() - fs.statSync(file).mtimeMs < DAY; } catch { return false; }
}

// Pixabay and Pexels each have a breaker (lib/breaker.js): while one isn't answering, searches use the
// other (or the agent's own clips, pipeline.js), and nothing waits on its timeouts.
// An answer that came back but can't be read is the site answering oddly, not the site being down (it
// doesn't count toward its breaker); a full disk when caching it only means it isn't cached.
async function readAnswer(res, site) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw Object.assign(new Error(`${site} sent an answer that couldn’t be read.`), { status: res.status, retry: true }); }
}
function keepAnswer(data, cacheFile) {
  try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch (e) { console.error('[footage] not cached:', e.message); }
  return data;
}
async function getJSON(params) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw Object.assign(new Error('PIXABAY_API_KEY is missing from .env'), { permanent: true });
  const cacheFile = path.join(CACHE, sha(JSON.stringify(params)) + '.json');
  if (fresh(cacheFile)) { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {} }
  const url = API() + '?' + new URLSearchParams({ key, ...params });
  return breaker.guard('pixabay', async () => {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { signal: jobSignal(20000) });
        if (res.ok) return keepAnswer(await readAnswer(res, 'Pixabay'), cacheFile);
        last = Object.assign(new Error(`Pixabay answered ${res.status}`), { status: res.status, retry: res.status === 429 || res.status >= 500 });
        if (res.status === 400 || res.status === 401 || res.status === 403) throw Object.assign(last, { permanent: res.status !== 400 });
      } catch (e) { checkStopped(); if (e.permanent !== undefined) throw e; last = e.status ? e : Object.assign(new Error(`Pixabay didn’t answer (${e.name === 'TimeoutError' ? 'no answer in time' : e.cause?.code || e.message}).`), { unknown: true }); }
      if (i < 2) await sleep(1500 * 3 ** i);
    }
    throw Object.assign(last, { outage: breaker.isServiceFailure(last) });
  });
}

/* ---------------- Pexels (optional second source) ---------------- */
// Free API key: pexels.com/api. Search results are cached for a day like Pixabay's. If Pexels is down
// or the key is wrong, videos carry on with Pixabay alone (and the log says so).
const PEXELS = () => (process.env.PEXELS_BASE_URL || 'https://api.pexels.com/videos/').replace(/\/?$/, '/');
export const pexelsOn = () => !!process.env.PEXELS_API_KEY;
const isPexels = id => /^px\d+$/.test(String(id));
async function getPexels(route, params = {}) {
  const cacheFile = path.join(CACHE, 'px-' + sha(route + JSON.stringify(params)) + '.json');
  if (fresh(cacheFile)) { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {} }
  const url = PEXELS() + route + (Object.keys(params).length ? '?' + new URLSearchParams(params) : '');
  return breaker.guard('pexels', async () => {
    let last;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: jobSignal(20000) });
        if (res.ok) return keepAnswer(await readAnswer(res, 'Pexels'), cacheFile);
        last = Object.assign(new Error(`Pexels answered ${res.status}`), { status: res.status, retry: res.status === 429 || res.status >= 500 });
        if (res.status === 401 || res.status === 403 || res.status === 404) break;
      } catch (e) { checkStopped(); last = e.status ? e : Object.assign(new Error(`Pexels didn’t answer (${e.name === 'TimeoutError' ? 'no answer in time' : e.cause?.code || e.message}).`), { unknown: true }); }
      if (i < 1) await sleep(1500);
    }
    throw last;
  });
}
// A Pexels video in the same shape as a Pixabay hit, so the rest of this stage treats them alike.
export function fromPexels(v) {
  const files = (v.video_files || []).filter(f => f.link && /mp4/i.test(f.file_type || 'video/mp4') && f.width && f.height);
  if (!files.length) return null;
  const byH = [...files].sort((a, b) => a.height - b.height);
  const upTo = max => [...byH].reverse().find(f => Math.max(f.width, f.height) <= max) || byH[0];
  const shape = f => ({ url: f.link, width: f.width, height: f.height, thumbnail: v.image || '' });
  // Pexels has no tags; its page address names the clip (".../video/woman-praying-in-church-123/"),
  // which is enough for the same blocked-content filter Pixabay clips go through.
  const slug = (String(v.url || '').match(/\/video\/([^/?#]+)/) || [])[1] || '';
  const tags = slug.replace(/-?\d+$/, '').split('-').filter(Boolean).join(' ');
  return { id: `px${v.id}`, source: 'pexels', tags: tags ? `${tags}, ${tags.split(' ').join(', ')}` : '', videos: { small: shape(upTo(640)), medium: shape(upTo(1280)), large: shape(upTo(1920)) } };
}
async function searchPexels(q) {
  if (!pexelsOn()) return [];
  try { return ((await getPexels('search', { query: q, per_page: '30', orientation: 'portrait' })).videos || []).map(fromPexels).filter(Boolean); }
  catch (e) { console.warn('[pexels]', e.message); return []; }
}
// Each source's results, alternating, so every source gets a fair look.
const mixAll = lists => { const out = []; for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]); return out; };

/* ---------------- The footage sources, on their standard mount (lib/plugins.js) ---------------- */
// `primary`: the source a video can't do without (its errors are the video's errors). The others add
// choice, and carry the search alone while the primary isn't answering.
register('footage', {
  id: 'pixabay', label: 'Pixabay', primary: true,
  on: () => !!process.env.PIXABAY_API_KEY,
  search: async (q, { people = true } = {}) => (await getJSON({ q, per_page: '30', video_type: 'film', safesearch: 'true', ...(people ? { category: 'people' } : {}) })).hits || [],
  byId: async id => ((await getJSON({ id: String(id) })).hits || [])[0] || null,
  owns: id => /^\d+$/.test(String(id)),
});
register('footage', {
  id: 'pexels', label: 'Pexels',
  on: () => pexelsOn(),
  // (Pexels has no "people" filter: it's searched for scenes with people, and when it carries a search alone.)
  search: async (q, { people = true, alone = false } = {}) => (people || alone ? searchPexels(q) : []),
  byId: async id => { try { return fromPexels(await getPexels(`videos/${String(id).slice(2)}`)); } catch { return null; } },
  owns: id => isPexels(id),
});
export const footageSources = () => listParts('footage');

const tagsOf = h => String(h.tags || '').toLowerCase().split(',').map(t => t.trim());
const clean = hits => (hits || []).filter(h => !tagsOf(h).some(t => BAD_TAGS.includes(t) || BAD_TAGS.some(b => b.includes(' ') && t.includes(b))));

// Every source at once. Limp mode: when the primary (Pixabay) isn't answering, the others (Pexels, if
// set up) carry the search alone.
async function search(q, people = true) {
  const srcs = footageSources();
  const results = await Promise.all(srcs.map(s => (s.primary || s.on() ? s.search(q, { people }).then(v => ({ s, ok: v || [] }), e => ({ s, e })) : Promise.resolve({ s, ok: [] }))));
  const primary = results.find(r => r.s.primary);
  if (primary?.e) {
    if (!breaker.isServiceFailure(primary.e)) throw primary.e;
    let alone = results.filter(r => !r.s.primary && r.ok?.length).flatMap(r => r.ok);
    if (!alone.length) alone = (await Promise.all(srcs.filter(s => !s.primary && s.on()).map(s => s.search(q, { people: true, alone: true }).catch(() => [])))).flat();
    if (!alone.length) throw primary.e;
    console.warn(`[footage] ${primary.s.label} isn’t answering; using ${srcs.filter(s => !s.primary && s.on()).map(s => s.label).join(' and ')} alone for this search.`);
    return clean(alone);
  }
  return clean(mixAll(results.map(r => r.ok || [])));
}
async function hitById(id) {
  const src = footageSources().find(s => s.owns(id));
  if (!src) return null;
  if (!src.primary && !src.on()) return null;
  return src.byId(id);
}

const isVertical = h => (h.videos?.medium?.height || 0) > (h.videos?.medium?.width || 0);
const thumb = h => h.videos?.medium?.thumbnail || h.videos?.small?.thumbnail || h.videos?.large?.thumbnail || null;
const summary = (h, query) => ({ id: h.id, query, thumb: thumb(h), vertical: isVertical(h) });

// Candidates in order: vertical first (no awkward crop), then Pixabay's relevance; the top few shuffled for variety.
function candidates(hits, avoid) {
  const ok = hits.filter(h => !avoid.has(h.id));
  const ranked = [...ok.filter(isVertical), ...ok.filter(h => !isVertical(h))];
  const top = ranked.slice(0, 5).sort(() => Math.random() - 0.5);
  return [...top, ...ranked.slice(5)];
}

// Download once, keep for a day (a swap or re-render the same day reuses it).
export async function downloadClip(hitOrId) {
  let hit = typeof hitOrId === 'object' ? hitOrId : await hitById(hitOrId);
  if (!hit) throw new Error(`Clip ${hitOrId} is no longer available${isPexels(hitOrId) ? ' on Pexels' : ' on Pixabay'}.`);
  const file = path.join(CLIPS, `${hit.id}.mp4`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10000) { fs.utimesSync(file, new Date(), new Date()); return file; }
  fs.mkdirSync(CLIPS, { recursive: true });
  const pick = h => (isVertical(h) ? h.videos?.large?.url : null) || h.videos?.medium?.url || h.videos?.large?.url || h.videos?.small?.url;
  let url = pick(hit), last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: jobSignal(120000) });
      if (!res.ok) throw Object.assign(new Error(`Clip download answered ${res.status}`), { status: res.status, retry: res.status === 429 || res.status >= 500 });
      const tmp = file + '.part';
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, file);
      return file;
    } catch (e) {
      last = e;
      if (i === 0 && typeof hitOrId === 'object') { const again = await hitById(hit.id).catch(() => null); if (again) { hit = again; url = pick(hit); } }
      await sleep(1500 * 3 ** i);
    }
  }
  throw new Error(`Couldn't download clip ${hit.id}: ${last?.message || last}`);
}

// Extra searches that match the audience, used when a scene's keyword finds nothing new.
export function fallbackQueries(visual) {
  const v = String(visual || '').toLowerCase();
  if (/grandparent|grandchild|grandkid/.test(v)) return ['grandparents grandchildren', 'grandmother grandchild', 'grandfather grandson'];
  if (/elderly parent|aging parent|daughter|son with/.test(v)) return ['adult daughter elderly mother', 'elderly parent family', 'son elderly father'];
  if (/60s|70s|80s|older|senior|elderly|retire/.test(v)) return ['senior woman home', 'elderly couple kitchen', 'senior man smiling'];
  if (/50s|middle/.test(v)) return ['middle aged woman home', 'middle aged couple', 'middle aged man home'];
  if (/single (mom|dad|parent)|mom or dad/.test(v)) return ['mother child home', 'father child home', 'single mother kids'];
  if (/kid|child|parent|famil/.test(v)) return ['parents children home', 'family kitchen', 'mother child home'];
  if (/couple|newlywed/.test(v)) return ['young couple home', 'couple kitchen table', 'couple talking'];
  return ['family home', 'woman smiling home', 'man smiling home'];
}

export const GOOD = 4;       // take a clip this good right away
export const OK = 3;         // after a few searches, the best clip at this score or better is fine
const RANK_QUERIES = 4;      // searches ranked per scene before settling for the best seen

// One scene: rank a batch from the keyword search, then a shorter keyword, then audience
// fallbacks. Takes the first clip scored GOOD; otherwise the best seen. Never unchecked unless
// the check itself failed.
// `saved`: searches the agent saved for this audience because they found great footage.
async function pickForScene(scene, i, { avoid, visual, saved = [], rank, log, stats }) {
  const keyword = String(scene.keyword || '').trim();
  // A shot without people (a street, a photo frame, light) falls back to its own kind of shot, not to people.
  const shot = SHOT_TYPES[scene.shot];
  const fallbacks = shot && !shot.human ? [shot.example] : [...saved.slice(0, 2), ...fallbackQueries(visual)];
  // The script's own second search for this scene ("backup") comes before anything generic, so a
  // scene keeps looking for what it's about before settling for the audience's stock moments.
  const backup = String(scene.backup || '').trim();
  const queries = [keyword, backup, keyword.split(' ').slice(0, 2).join(' '), ...fallbacks].filter((q, j, a) => q && a.indexOf(q) === j);
  let best = null, ranked = 0;
  for (const q of queries) {
    let list = candidates(await search(q), avoid);
    if (q === keyword && list.length < 3) list = [...list, ...candidates(await search(q, false), avoid).filter(h => !list.some(x => x.id === h.id))];
    if (!list.length) continue;
    const spares = (except, n = ALTS) => list.filter(h => h.id !== except).slice(0, n).map(h => summary(h, q));
    if (!rank) return { hit: list[0], query: q, checked: false, alts: spares(list[0].id) };
    const batch = list.slice(0, BATCH);
    const scores = await rank(batch, scene);
    if (!scores) {
      log(`  Clip check unavailable for scene ${i + 1}; using the top match unchecked.`);
      return { hit: batch[0], query: q, checked: false, alts: spares(batch[0].id) };
    }
    ranked++; stats.checks += batch.length;
    batch.forEach((h, k) => { if (scores[k].score <= 1) avoid.add(h.id); });
    const top = batch.map((h, k) => ({ hit: h, ...scores[k] })).sort((a, b) => b.score - a.score)[0];
    if (!best || top.score > best.score) best = { ...top, query: q, alts: list.filter(h => h.id !== top.hit.id && !avoid.has(h.id)).slice(0, ALTS).map(h => summary(h, q)) };
    if (top.score >= GOOD) break;
    log(`  Scene ${i + 1}, "${q}": best clip ${top.score}/5 (${top.reason}). Trying another search.`);
    if (ranked >= RANK_QUERIES) break;
  }
  if (!best) return null;
  if (best.score < OK) { stats.weak++; log(`  Scene ${i + 1}: no strong match; using the best one found (${best.score}/5: ${best.reason}).`); }
  return { hit: best.hit, query: best.query, checked: true, score: best.score, reason: best.reason, alts: best.alts };
}

// `used`: clip ids this agent used before. `rank(hits, scene)`: optional AI check → [{ score, reason }] or null.
// `own`: { sceneIndex: { id, file, description, vertical } } — the agent's own clips for some scenes.
// `shared`: clips other agents on this server used recently. Avoided too, but more gently than the
// agent's own: if they leave nothing for a scene, it searches again allowing them before reusing one.
// `chosen`: { sceneIndex: clipId } picked by hand in Studio; those scenes use that clip as is.
export async function findClips(scenes, { used = [], shared = [], visual = '', saved = [], check: rank = null, log = console.log, own = {}, chosen = {} } = {}) {
  const avoid = new Set(used), others = new Set(shared.filter(id => !avoid.has(id)));
  // Clips picked by hand are kept for their own scenes, so an earlier scene's search can't take them.
  const reserved = new Set(Object.values(chosen).filter(id => id !== undefined && id !== null && id !== '').map(id => (typeof id === 'number' ? id : /^\d+$/.test(String(id)) ? Number(id) : String(id))));
  reserved.forEach(id => { avoid.add(id); others.delete(id); });
  const stats = { checks: 0, weak: 0 };
  const out = [], downloads = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i], keyword = String(scene.keyword || '').trim();
    if (own[i]) {
      const c = own[i];
      out.push({ id: `own:${c.id}`, file: null, query: 'your own clip', checked: true, score: null, reason: c.description || '', vertical: !!c.vertical, alts: [] });
      downloads.push(Promise.resolve(c.file));
      log(`Clip ${i + 1}/${scenes.length}: your own clip${c.description ? ` (“${c.description}”)` : ''}`);
      continue;
    }
    if (chosen[i] !== undefined && chosen[i] !== null && chosen[i] !== '') {
      const hit = await hitById(chosen[i]).catch(() => null);
      if (hit && !out.some(c => c.id === hit.id)) {
        avoid.add(hit.id);
        const dl = downloadClip(hit); dl.catch(() => {}); downloads.push(dl);
        out.push({ id: hit.id, file: null, query: 'chosen in Studio', checked: false, chosen: true, score: null, reason: 'chosen by you', vertical: isVertical(hit), alts: [] });
        log(`Clip ${i + 1}/${scenes.length}: the clip you chose`);
        continue;
      }
      log(`  Scene ${i + 1}: the clip you chose isn’t available any more; finding another.`);
    }
    let got = null;
    if (others.size) {
      const both = new Set([...avoid, ...others]);
      got = await pickForScene(scene, i, { avoid: both, visual, saved, rank, log, stats });
      both.forEach(id => { if (!others.has(id)) avoid.add(id); });   // keep what the clip check ruled out
      if (!got) log(`  Scene ${i + 1}: the clips left were all used by other agents lately; allowing those.`);
    }
    if (!got) got = await pickForScene(scene, i, { avoid, visual, saved, rank, log, stats });
    if (!got) {
      // Everything was used: allow clips from older videos, never twice in this one.
      const thisVideo = new Set(out.map(c => c.id));
      const h = candidates(await search(keyword || fallbackQueries(visual)[0]), thisVideo)[0];
      if (h) { got = { hit: h, query: keyword, checked: false, alts: [] }; log(`  Every clip for scene ${i + 1} was used before; reusing one.`); }
    }
    if (!got) throw new Error(`Pixabay returned no usable clips for "${keyword}".`);
    avoid.add(got.hit.id);
    // Picking stays in order (each scene avoids the clips before it); downloads run alongside.
    const dl = downloadClip(got.hit);
    dl.catch(() => {});   // awaited below; this only stops an early failure being reported twice
    downloads.push(dl);
    out.push({ id: got.hit.id, file: null, query: got.query, checked: got.checked, score: got.score ?? null, reason: got.reason || '', vertical: isVertical(got.hit), alts: got.alts });
    log(`Clip ${i + 1}/${scenes.length}: "${got.query}"${got.query !== keyword ? ` (instead of "${keyword}")` : ''}${got.score ? `, ${got.score}/5` : ''}${rank && !got.checked ? ', unchecked' : ''}`);
  }
  const files = await Promise.allSettled(downloads);
  // A clip that won't download (a source hiccup, a removed clip) is replaced with one of its spares.
  for (let i = 0; i < files.length; i++) {
    if (files[i].status === 'fulfilled') { out[i].file = files[i].value; continue; }
    const taken = new Set(out.map(c => c.id));
    let file = null;
    for (const alt of (out[i].alts || []).filter(a => !taken.has(a.id))) {
      try { file = await downloadClip(alt.id); Object.assign(out[i], { id: alt.id, query: alt.query, checked: false, score: null, reason: '', vertical: !!alt.vertical, alts: out[i].alts.filter(a => a.id !== alt.id) }); break; } catch { /* try the next spare */ }
    }
    if (!file) throw files[i].reason;
    log(`  Scene ${i + 1}'s clip wouldn't download; used a spare instead (unchecked).`);
    out[i].file = file;
  }
  if (rank) log(`Clip check: ${stats.checks} clips compared${stats.weak ? `, ${stats.weak} scene(s) with only a weak match` : ''}.`);
  return out;
}

// Swap one scene's clip: rank its spares together, or search again if none fit.
export async function swapClip(scene, current, { used = [], visual = '', saved = [], check: rank = null, log = console.log } = {}) {
  const avoid = new Set([...used, current.id]);
  const alts = (current.alts || []).filter(a => !avoid.has(a.id)).slice(0, BATCH);
  if (alts.length) {
    const scores = rank ? await rank(alts.map(a => ({ id: a.id, videos: { medium: { thumbnail: a.thumb } } })), scene) : null;
    const order = alts.map((a, k) => ({ a, score: scores ? scores[k].score : 3, reason: scores ? scores[k].reason : '' })).sort((x, y) => y.score - x.score);
    const pick = order[0];
    if (pick && pick.score >= OK) {
      const hit = await hitById(pick.a.id).catch(() => null);
      if (hit) {
        const file = await downloadClip(hit);
        return { id: hit.id, file, query: pick.a.query, checked: !!scores, score: scores ? pick.score : null, reason: pick.reason, vertical: isVertical(hit), alts: (current.alts || []).filter(x => x.id !== hit.id && x.id !== current.id) };
      }
    }
    alts.forEach(a => avoid.add(a.id));
    log('  The spare clips weren’t a good fit; searching again.');
  }
  const got = await pickForScene(scene, 0, { avoid, visual, saved, rank, log, stats: { checks: 0, weak: 0 } });
  if (!got) throw new Error('No other clip fits this scene. Try editing its footage search.');
  const file = await downloadClip(got.hit);
  return { id: got.hit.id, file, query: got.query, checked: got.checked, score: got.score ?? null, reason: got.reason || '', vertical: isVertical(got.hit), alts: got.alts };
}

// For the portal's footage test: what the clip check sees for one search, best first.
// `manual`: a Studio search, scored on what it asks for (people optional). Content's footage test checks
// searches agents may save for an audience, which are used for people shots, so it keeps asking for people.
export async function testFootage({ keyword, caption, visual, rank, manual = false }) {
  const list = candidates(await search(keyword), new Set()).slice(0, BATCH);
  if (!list.length) return [];
  const scores = rank ? await rank(list, { text: caption || keyword, keyword, manual }) : null;
  return list.map((h, k) => ({ id: h.id, thumb: thumb(h), vertical: isVertical(h), score: scores ? scores[k].score : null, reason: scores ? scores[k].reason : 'not checked' }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// Fix a scene's clip picker (v15): about ten clips for a footage search, each scored by the clip check,
// with a small preview to play muted. Clips the check says never to use (score 1: a funeral, a church,
// text in the footage…) are left out. `seen`: ids already shown, so Refresh brings ten more.
export const PICKER_SIZE = 10;
export async function pickerClips({ keyword, caption, visual, rank, seen = [] }) {
  const skip = new Set(seen.map(String));
  const list = candidates(await search(keyword, false), new Set()).filter(h => !skip.has(String(h.id))).slice(0, PICKER_SIZE);
  if (!list.length) return [];
  const scores = rank ? await rank(list, { text: caption || keyword, keyword, manual: true }) : null;
  const preview = h => h.videos?.tiny?.url || h.videos?.small?.url || h.videos?.medium?.url || '';
  return list.map((h, k) => ({ id: h.id, thumb: thumb(h), preview: preview(h), vertical: isVertical(h), score: scores ? scores[k].score : null, reason: scores ? scores[k].reason : 'not checked' }))
    .filter(c => c.score !== 1)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// The file for a clip chosen earlier (re-downloads if the day-long cache was cleared).
export const clipFile = clip => downloadClip(clip.id);

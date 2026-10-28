// lib/library.js — an agent's own clips (them at their desk, their office, their town), mixed into
// videos alongside stock footage. Brand → Your own clips: upload, describe, delete, and choose how
// often they're used. Clips live in videos/<workspace>/library/ (deleted with the workspace); the list
// is a document (library.json) like everything else.
//
// Every upload is re-encoded on arrival (H.264, no sound, at most 1080 wide, at most 60 seconds), so
// a phone's HEVC .mov works and nothing unexpected reaches the renderer.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runProc, tail } from './proc.js';
import { readJSON, updateJSON } from './paths.js';
import * as store from './store.js';

export const MAX_CLIPS = () => Math.max(1, Number(process.env.LIBRARY_MAX_CLIPS) || 40);
export const MAX_UPLOAD_MB = () => Math.max(5, Number(process.env.CLIP_UPLOAD_MAX_MB) || 200);
export const USE = { off: 'Off', few: 'A little (the first and last scenes)', many: 'A lot (about half the scenes)' };
const listFile = ws => path.join(store.wsDir(ws), 'library.json');
export const dirOf = ws => { const d = path.join(store.videoDir(ws), 'library'); fs.mkdirSync(d, { recursive: true }); return d; };
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export const list = ws => readJSON(listFile(ws), []);
export const get = (ws, id) => list(ws).find(c => c.id === id) || null;
export const fileOf = (ws, id) => { const c = get(ws, id); const f = c && path.join(dirOf(ws), c.file); return f && fs.existsSync(f) ? f : null; };
export const thumbOf = (ws, id) => { const c = get(ws, id); const f = c && path.join(dirOf(ws), c.thumb); return f && fs.existsSync(f) ? f : null; };

async function run(bin, args, { timeout = 180000 } = {}) {
  const r = await runProc(bin, args, { timeoutMs: timeout, maxOutput: 1024 * 1024 });
  if (r.code !== 0) throw new Error(tail(r.stderr, 2) || `exit ${r.code}`);
  return r.stdout;
}
async function probe(file) {
  const out = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeout: 30000 });
  const j = JSON.parse(out), s = j.streams?.[0] || {};
  return { width: Number(s.width) || 0, height: Number(s.height) || 0, duration: Number(j.format?.duration) || 0 };
}

// How bright the clip is on average (0-255), from a few frames; null if it can't be measured.
async function brightness(file) {
  try {
    const out = await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', file, '-vf', "select='not(mod(n\\,15))',scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", '-an', '-f', 'null', '-'], { timeout: 60000 });
    const v = [...out.matchAll(/YAVG=([\d.]+)/g)].map(m => Number(m[1]));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  } catch { return null; }
}
// What an agent should know about a clip they uploaded: each check says what's fine or what will
// happen (it's still added; they decide). Shown under the clip in Brand → Your own clips.
export function clipChecks(meta, src = meta, luma = null) {
  const out = [];
  const add = (ok, label) => out.push({ ok, label });
  add(meta.height > meta.width, meta.height > meta.width ? 'Vertical, like a reel.' : 'Sideways: it will be cropped to the middle. Keep yourself centered, or film it holding the phone upright.');
  add(meta.width >= 540, meta.width >= 540 ? 'Sharp enough.' : 'Low resolution: it may look soft next to stock footage.');
  add(meta.duration >= 3, meta.duration >= 3 ? `${Math.round(meta.duration)} seconds, enough for a scene.` : 'Under 3 seconds: a long scene will slow it down to fit.');
  if (src.duration > 60) add(false, 'Longer than a minute: only the first 60 seconds were kept.');
  if (luma !== null) add(luma >= 45, luma >= 45 ? (luma > 225 ? 'Very bright: captions may be hard to read over it.' : 'Light is good.') : 'Quite dark: captions will read fine, but faces may be hard to see. Film near a window if you can.');
  if (luma !== null && luma > 225) out[out.length - 1].ok = false;
  return out;
}

// Takes an uploaded file (any video ffmpeg can read), stores a clean copy and a thumbnail.
export async function add(ws, upload, { description = '' } = {}) {
  if (list(ws).length >= MAX_CLIPS()) throw Object.assign(new Error(`You have ${MAX_CLIPS()} clips. Delete some before adding more.`), { status: 409 });
  let src;
  try { src = await probe(upload); } catch { throw Object.assign(new Error('That file isn’t a video we can read. Try an MP4 or a video straight from your phone.'), { status: 400 }); }
  if (!src.width || !src.height || src.duration < 1) throw Object.assign(new Error('That video is empty or too short (at least 1 second).'), { status: 400 });
  const id = 'c' + crypto.randomBytes(5).toString('hex'), dir = dirOf(ws);
  const file = `${id}.mp4`, thumb = `${id}.jpg`;
  const ff = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await run(ff, ['-y', '-v', 'error', '-i', upload, '-t', '60', '-an', '-vf', "scale='min(1080,iw)':-2,fps=30", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, file)]);
    await run(ff, ['-y', '-v', 'error', '-ss', String(Math.min(1, src.duration / 2)), '-i', path.join(dir, file), '-frames:v', '1', '-vf', 'scale=360:-2', path.join(dir, thumb)]);
  } catch (e) {
    [file, thumb].forEach(f => fs.rmSync(path.join(dir, f), { force: true }));
    throw Object.assign(new Error('That video couldn’t be converted. Try a different file. (' + clean(e.message, 120) + ')'), { status: 400 });
  }
  const meta = await probe(path.join(dir, file));
  const checks = clipChecks(meta, src, await brightness(path.join(dir, file)));
  const item = { id, file, thumb, description: clean(description, 120), width: meta.width, height: meta.height, duration: Math.round(meta.duration * 10) / 10, vertical: meta.height > meta.width, addedAt: new Date().toISOString(), usedAt: '', uses: 0, checks };
  updateJSON(listFile(ws), [], l => [...l, item]);
  return item;
}
export function describe(ws, id, description) {
  let out = null;
  updateJSON(listFile(ws), [], l => l.map(c => (c.id === id ? (out = { ...c, description: clean(description, 120) }) : c)));
  return out;
}
export function remove(ws, id) {
  const c = get(ws, id);
  if (!c) return false;
  [c.file, c.thumb].forEach(f => fs.rmSync(path.join(dirOf(ws), f), { force: true }));
  updateJSON(listFile(ws), [], l => l.filter(x => x.id !== id));
  return true;
}

// Which scenes get one of the agent's clips. "few": the last scene (the call to action, where their
// face builds trust) and the first; "many": about half, first and last included. Least-used clips
// first, a clip whose description shares words with the scene's footage search wins its scene, and
// no clip appears twice in one video. Returns { sceneIndex: clip }.
const words = t => new Set(String(t || '').toLowerCase().match(/[a-z]{3,}/g) || []);
export function planFor(ws, cfg, scenes) {
  const mode = cfg.output?.ownClips || 'off', lib = list(ws).filter(c => fileOf(ws, c.id));
  if (mode === 'off' || !lib.length || !scenes.length) return {};
  const n = scenes.length, want = mode === 'many' ? Math.max(2, Math.round(n / 2)) : Math.min(2, n);
  const order = [n - 1, 0, ...Array.from({ length: n }, (_, i) => i).filter(i => i % 2 === 1 && i !== n - 1)].filter((x, i, a) => a.indexOf(x) === i).slice(0, Math.min(want, lib.length));
  const pool = [...lib].sort((a, b) => (a.uses || 0) - (b.uses || 0) || String(a.usedAt).localeCompare(String(b.usedAt)));
  const out = {};
  for (const i of order) {
    const kw = words(`${scenes[i].keyword || ''} ${scenes[i].text || ''}`);
    const best = pool.map((c, k) => ({ c, k, hit: [...words(c.description)].filter(w => kw.has(w)).length })).sort((a, b) => b.hit - a.hit || a.k - b.k)[0];
    if (!best) break;
    out[i] = best.c;
    pool.splice(best.k, 1);
  }
  return out;
}
// Limp mode (the stock sites aren't answering): one of the agent's own clips for every scene, if they
// have enough (each used once), best matches first. Returns null if there aren't enough.
export function planAll(ws, scenes) {
  const lib = list(ws).filter(c => fileOf(ws, c.id));
  if (!scenes.length || lib.length < scenes.length) return null;
  const pool = [...lib].sort((a, b) => (a.uses || 0) - (b.uses || 0) || String(a.usedAt).localeCompare(String(b.usedAt)));
  const out = {};
  scenes.forEach((sc, i) => {
    const kw = words(`${sc.keyword || ''} ${sc.text || ''}`);
    const best = pool.map((c, k) => ({ c, k, hit: [...words(c.description)].filter(w => kw.has(w)).length })).sort((a, b) => b.hit - a.hit || a.k - b.k)[0];
    out[i] = best.c;
    pool.splice(best.k, 1);
  });
  return out;
}
export function markUsed(ws, ids) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  updateJSON(listFile(ws), [], l => l.map(c => (ids.includes(c.id) ? { ...c, uses: (c.uses || 0) + 1, usedAt: now } : c)));
}

// stages/craft.js — the finishing work on a video (v15 Phase 6): what a careful editor measures before a
// video leaves the cutting room. Each piece measures with FFmpeg and decides in plain code, so it can be
// tested without a person watching:
//
//   clip looks    each clip's brightness and color (to even them out from clip to clip), how bright the
//                 caption area is (a stronger shadow when it's bright), and where a fade-in from black
//                 ends (so no scene, and never the first frame, opens on black)
//   beats         where the music's beats fall, so cuts can land on them
//   loudness      a measured level, so the final mix lands on Instagram's (-14 LUFS, peaks under -1.5 dBTP)
//                 without the pumping a one-pass leveler gives
//   safe zones    every frame of the captions checked against the parts of the screen Instagram covers
//                 (the like, comment and share buttons; the name, post text and audio line)
//
// Nothing here can stop a video: a measurement that fails returns null and the render goes ahead as
// before (the safe-zone check says it couldn't run on the review card).
import fs from 'fs';
import path from 'path';
import { runProc } from '../lib/proc.js';
import { DIRS, readJSON, writeJSON } from '../lib/paths.js';

const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r3 = n => Math.round(n * 1000) / 1000;

// Reads raw frames from FFmpeg one at a time (however long the video), calling each(frame, index).
async function frames(args, size, each, { timeoutMs = 60000 } = {}) {
  let held = Buffer.alloc(0), n = 0;
  const r = await runProc(ffmpeg(), args, {
    timeoutMs, maxOutput: 16000,
    onData: d => {
      held = held.length ? Buffer.concat([held, d]) : d;
      let at = 0;
      while (held.length - at >= size) { each(held.subarray(at, at + size), n++); at += size; }
      held = at ? held.subarray(at) : held;
    },
  });
  if (r.code !== 0) throw new Error('FFmpeg couldn’t read it: ' + String(r.stderr).trim().split('\n').slice(-2).join(' '));
  return n;
}

// ---------------------------------------------------------------------------------------------------
// Clip looks.
const LW = 54, LH = 96, LFPS = 4;
// The caption area, as rows of the small frame: the block sits between about y=960 and y=1360 of 1920.
const CAP_ROWS = [Math.round(LH * 960 / 1920), Math.round(LH * 1360 / 1920)];
// Each frame (4 a second, from the clip's first `seconds`): its brightness (Y), color (U, V; 128 is
// neutral) and the caption area's brightness, all 0-255. The clip is framed as the render frames it
// (filled to 9:16 and centered), so what's measured is what's seen.
export async function clipLook(file, { seconds = 14 } = {}) {
  const plane = LW * LH, out = [];
  await frames(['-hide_banner', '-loglevel', 'error', '-t', String(seconds), '-i', file, '-an',
    '-vf', `fps=${LFPS},scale=${LW}:${LH}:force_original_aspect_ratio=increase,crop=${LW}:${LH},format=yuv444p`,
    '-f', 'rawvideo', '-'], plane * 3, f => {
    let y = 0, u = 0, v = 0, cap = 0;
    for (let i = 0; i < plane; i++) { y += f[i]; u += f[plane + i]; v += f[2 * plane + i]; }
    for (let row = CAP_ROWS[0]; row < CAP_ROWS[1]; row++) for (let x = 0; x < LW; x++) cap += f[row * LW + x];
    out.push({ y: y / plane, u: u / plane, v: v / plane, cap: cap / ((CAP_ROWS[1] - CAP_ROWS[0]) * LW) });
  });
  return out.length ? { fps: LFPS, frames: out } : null;
}

// Where a clip's fade-in from black ends (seconds), so the scene starts on picture. 0 when it opens on
// picture; a clip that is dark all the way through isn't "fading in" and starts where it starts.
export function fadeInEnd(look, { most = 1.5 } = {}) {
  if (!look?.frames?.length) return 0;
  const ys = look.frames.map(f => f.y), mid = median(ys);
  if (mid < 24) return 0;
  const first = ys.findIndex(y => y >= Math.max(24, mid * 0.55));
  const at = first / look.fps;
  return first > 0 && at <= most ? at : 0;
}

// Where a scene should start in its clip: past the fade-in, but only as far as the clip allows without
// looping back into the fade before the scene ends (a short clip loops). A clip shorter than the scene
// loops anyway, so it starts at its beginning, as before.
export function openingOffset(look, seconds, opts = {}) {
  const off = fadeInEnd(look, opts);
  if (!off) return 0;
  const sampled = look.frames.length / look.fps;
  // Measured to its end (it's shorter than what was read): how long it really is, give or take a sample.
  const len = look.frames.length < (opts.read || 14) * look.fps - 1 ? sampled - 1 / look.fps : Infinity;
  if (len >= off + seconds) return off;
  if (len > seconds) return Math.round((len - seconds) * 100) / 100;
  return 0;
}

// The averages over the part of a clip a scene uses (from `start`, for `seconds`; a short clip loops).
export function lookOver(look, start = 0, seconds = 4) {
  if (!look?.frames?.length) return null;
  const n = look.frames.length, from = Math.round(start * look.fps), count = Math.max(1, Math.round(seconds * look.fps));
  const pick = Array.from({ length: Math.min(count, n) }, (_, k) => look.frames[(from + k) % n]);
  return { y: mean(pick.map(f => f.y)), u: mean(pick.map(f => f.u)), v: mean(pick.map(f => f.v)), cap: mean(pick.map(f => f.cap)) };
}

// Evening the clips out: each is nudged toward the group's middle brightness (itself kept in a
// comfortable range) and toward the group's middle color, gently, so stock from different shoots reads
// as one. Returns { brightness, rm, bm } per clip (FFmpeg eq and colorbalance amounts), or null for a clip
// that couldn't be measured. A clip already close is left alone.
export function matchPlan(looks) {
  const ok = looks.filter(Boolean);
  if (ok.length < 2) return looks.map(() => null);
  const ty = clamp(median(ok.map(l => l.y)), 92, 150), tu = median(ok.map(l => l.u)), tv = median(ok.map(l => l.v));
  return looks.map(l => {
    if (!l) return null;
    const brightness = r3(clamp(((ty - l.y) / 255) * 0.7, -0.08, 0.08));
    // V above the middle is redder: less red in the midtones. U above is bluer: less blue.
    const rm = r3(clamp((-(l.v - tv) / 128) * 0.8, -0.05, 0.05)), bm = r3(clamp((-(l.u - tu) / 128) * 0.8, -0.05, 0.05));
    return { brightness: Math.abs(brightness) < 0.01 ? 0 : brightness, rm: Math.abs(rm) < 0.006 ? 0 : rm, bm: Math.abs(bm) < 0.006 ? 0 : bm };
  });
}
export const matchFilter = m => (!m ? '' : `${m.brightness ? `,eq=brightness=${m.brightness}` : ''}${m.rm || m.bm ? `,colorbalance=rm=${m.rm}:bm=${m.bm}` : ''}`);

// How much shadow the caption needs: 0 as designed, 1 stronger (bright footage behind it), 2 strongest
// (a white wall, a bright sky).
export const shadowLevel = cap => (!(cap >= 0) ? 0 : cap >= 185 ? 2 : cap >= 145 ? 1 : 0);

// ---------------------------------------------------------------------------------------------------
// Beats.
const SR = 8000, HOP = 80;   // 10 ms steps
const BEATS = () => path.join(DIRS.data, 'beats.json');
// Where a track's beats fall: { period, phase } in seconds (beat k is at phase + k × period), or null if
// it has no steady beat worth cutting to. Found by testing every tempo from 70 to 180 BPM, and every
// starting point, against the track's onsets (the moments it gets suddenly louder). Remembered per
// track (data/beats.json), so it's worked out once.
export async function musicBeats(file, { seconds = 75 } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${path.basename(file)}|${st.size}|${Math.round(st.mtimeMs)}`;
  const cache = readJSON(BEATS(), {});
  if (cache[key] !== undefined) return cache[key];
  const energy = [];
  let acc = 0, k = 0;
  await frames(['-hide_banner', '-loglevel', 'error', '-t', String(seconds), '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], 2, s => {
    const v = s.readInt16LE(0) / 32768;
    acc += v * v;
    if (++k === HOP) { energy.push(acc / HOP); acc = 0; k = 0; }
  }, { timeoutMs: 60000 });
  const found = findBeat(energy);
  const keys = Object.keys(cache);
  if (keys.length >= 200) for (const old of keys.slice(0, keys.length - 199)) delete cache[old];
  cache[key] = found;
  try { writeJSON(BEATS(), cache); } catch { /* remembered next time instead */ }
  return found;
}

// The beat in a list of 10 ms energies (exported for the tests).
export function findBeat(energy) {
  if (energy.length < 600) return null;   // under 6 seconds: nothing to go on
  const env = energy.map(e => Math.log(1e-7 + e));
  const onset = env.map((e, i) => (i ? Math.max(0, e - env[i - 1]) : 0));
  // Slightly widened, so a beat a step early or late still counts.
  const sm = onset.map((_, i) => Math.max(onset[i], 0.6 * (onset[i - 1] || 0), 0.6 * (onset[i + 1] || 0)));
  const avg = mean(sm);
  if (!(avg > 0)) return null;
  let best = null;
  for (let p = 33.3; p <= 86; p += 0.1) {           // 180 down to 70 BPM, in steps
    const beats = Math.floor((sm.length - 1) / p);
    if (beats < 6) continue;
    const bpm = 6000 / p, prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);   // nudges octave ties toward ~110
    for (let ph = 0; ph < p; ph++) {
      let sum = 0;
      for (let m = 0; m < beats; m++) sum += sm[Math.round(ph + m * p)] || 0;
      const score = (sum / beats / avg) * (0.85 + 0.15 * prior);
      if (!best || score > best.score) best = { score, p, ph };
    }
  }
  if (!best || best.score < 2.2) return null;   // nothing steady stands out from the noise
  return { period: Math.round(best.p * 10) / 1000, phase: Math.round(best.ph * 10) / 1000, strength: Math.round(best.score * 10) / 10 };
}
export const beatTimes = (b, upTo) => { const out = []; if (!b?.period) return out; for (let t = b.phase; t <= upTo + b.period; t += b.period) out.push(Math.round(t * 1000) / 1000); return out; };

// Moves each cut to the nearest beat, within limits: a scene may grow by up to `stretch` seconds, and
// shrink only down to its `mins` (so a spoken line is never cut short). `most`: the body may not grow
// past this (the one-minute limit). Returns the new scene lengths (unchanged where no beat is close).
export function snapCuts(durs, beats, { mins = durs.map(() => 0), stretch = 0.4, most = Infinity } = {}) {
  if (!beats?.length) return durs.slice();
  const out = [];
  let start = 0, total = durs.reduce((a, b) => a + b, 0);
  durs.forEach((d, i) => {
    const cut = start + d, lo = start + Math.max(mins[i] || 0, 0.8), hi = cut + stretch;
    let pick = null;
    for (const b of beats) if (b >= lo && b <= hi && (pick === null || Math.abs(b - cut) < Math.abs(pick - cut))) pick = b;
    let nd = pick === null ? d : Math.round((pick - start) * 100) / 100;
    if (total - d + nd > most) nd = d;   // never pushed over the limit
    total += nd - d;
    out.push(nd);
    start += nd;
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Loudness.
export const TARGET = { I: -14, TP: -1.5, LRA: 11 };
// The first pass: how loud the mix is. Returns the numbers the second pass needs, or null (silence, or the
// measurement failed: the render then levels in one pass, as before).
export async function measureLoudness(file) {
  const r = await runProc(ffmpeg(), ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}:print_format=json`, '-f', 'null', '-'], { timeoutMs: 60000, maxOutput: 64000 });
  if (r.code !== 0) return null;
  const m = String(r.stderr).match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const out = { I: Number(j.input_i), TP: Number(j.input_tp), LRA: Number(j.input_lra), thresh: Number(j.input_thresh), offset: Number(j.target_offset) };
    return Object.values(out).every(Number.isFinite) && out.I > -60 ? out : null;
  } catch { return null; }
}
// The second pass. With the measurement, the mix is simply turned up or down to the target (an exact,
// even change, nothing pumping); if that would push its peaks past the limit, a fast limiter catches
// just those peaks. Without one, the one-pass leveler (as before v15).
export function levelFilter(m, { limiter = true } = {}) {
  if (!m) return `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=${TARGET.LRA}`;
  const gain = Math.round(clamp(TARGET.I - m.I, -30, 30) * 100) / 100;
  if (m.TP + gain <= TARGET.TP - 0.3) return `volume=${gain}dB`;
  if (limiter) return `volume=${gain}dB,alimiter=limit=${r3(10 ** ((TARGET.TP - 0.5) / 20))}:attack=5:release=60:level=false`;
  return `loudnorm=I=${TARGET.I}:TP=${TARGET.TP}:LRA=20:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`;
}
// The whole second pass, worked out: where the limiter has to catch peaks it takes a little loudness with
// it, so the limited mix is measured once more and turned up by what was lost (then limited again).
// Returns { filter, measured } (measured false: the one-pass leveler, the mix couldn't be measured).
export async function levelPlan(file, workDir) {
  const m = await measureLoudness(file);
  if (!m) return { filter: levelFilter(null), measured: false };
  const limiter = await limiterAvailable();
  let filter = levelFilter(m, { limiter });
  if (!filter.includes('alimiter')) return { filter, measured: true };
  // Up to three rounds (each limited mix measured, the shortfall added); very spiky sound may still end a
  // little under the target: as loud as it can be without the peaks distorting.
  const out = path.join(workDir, 'level-check.wav');
  let extra = 0;
  try {
    for (let round = 0; round < 3; round++) {
      const r = await runProc(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-af', filter, '-c:a', 'pcm_f32le', out], { timeoutMs: 60000 });
      const m2 = r.code === 0 ? await measureLoudness(out) : null;
      const short = m2 ? TARGET.I - m2.I : 0;
      if (!(short > 0.3) || extra >= 9) break;
      extra = Math.min(9, extra + short);
      filter = levelFilter({ ...m, I: m.I - extra }, { limiter });
    }
  } finally { fs.rmSync(out, { force: true }); }
  return { filter, measured: true };
}
// Does this FFmpeg's limiter have the switch for its automatic level (FFmpeg 4.4 and later)? Asked once.
let limiterOk = null;
export async function limiterAvailable() {
  if (limiterOk !== null) return limiterOk;
  try { const r = await runProc(ffmpeg(), ['-hide_banner', '-h', 'filter=alimiter'], { timeoutMs: 15000 }); limiterOk = /^\s*level\s/m.test(r.stdout + r.stderr); } catch (e) { if (e.aborted) throw e; limiterOk = false; }
  return limiterOk;
}

// ---------------------------------------------------------------------------------------------------
// Safe zones: the parts of a 1080×1920 Reel that Instagram's own screen covers. Captions and the end
// card stay out of them.
export const SAFE = {
  top: 200,                                  // the Reels header and camera button
  bottom: 1540,                              // the name, Follow, the post text and the audio line
  right: { x: 960, from: 1040, to: 1540 },   // like, comment, share, send and more
  edge: 32,                                  // kept off the very edges (some phones crop them)
};
export const ZONE_WORDS = { top: 'under the Reels header', bottom: 'under the post text', right: 'under the like and comment buttons', edge: 'off the edge of the screen' };
const SW = 108, SH = 192, SCALE = 1080 / SW;   // checked at a tenth of the size: every frame, in under a second
// Plays the captions (and nothing else) over black, frame by frame at 30 a second, and notes every
// frame where lit text falls in a zone. `groups`: [{ label, from, to }] (a scene, the end card), so a
// problem can be put right where it is. Returns { frames, problems: { label: [zones] } }.
export async function checkSafeZones({ assPath, fontDir, seconds, groups = [], fps = 30 }) {
  const esc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const z = { top: Math.floor(SAFE.top / SCALE), bottom: Math.ceil(SAFE.bottom / SCALE), rx: Math.ceil(SAFE.right.x / SCALE), rFrom: Math.floor(SAFE.right.from / SCALE), rTo: Math.ceil(SAFE.right.to / SCALE), edge: Math.floor(SAFE.edge / SCALE) };
  const found = {};
  const note = (t, zone) => {
    const g = groups.filter(x => t >= x.from - 1e-6 && t < x.to).at(-1);
    const label = g ? g.label : 'other';
    (found[label] ||= new Set()).add(zone);
  };
  const n = await frames(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=black:s=${SW}x${SH}:r=${fps}:d=${seconds}`,
    '-vf', `subtitles='${esc(assPath)}':fontsdir='${esc(fontDir)}',format=gray`, '-f', 'rawvideo', '-'], SW * SH, (f, k) => {
    let top = false, bottom = false, right = false, edge = false;
    for (let y = 0; y < SH; y++) {
      const row = y * SW;
      for (let x = 0; x < SW; x++) {
        if (f[row + x] < 96) continue;   // lit text only (the shadow and outline are dark)
        if (y < z.top) top = true;
        if (y >= z.bottom) bottom = true;
        if (x >= z.rx && y >= z.rFrom && y < z.rTo) right = true;
        if (x < z.edge || x >= SW - z.edge) edge = true;
      }
    }
    const t = k / fps;
    if (top) note(t, 'top'); if (bottom) note(t, 'bottom'); if (right) note(t, 'right'); if (edge) note(t, 'edge');
  }, { timeoutMs: 120000 });
  return { frames: n, problems: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]])) };
}

// ---------------------------------------------------------------------------------------------------
// Frames for the second look (stages/vision.js secondLook): one still per time, small, as data URLs.
export async function sampleFrames(file, times, dir, { width = 360 } = {}) {
  const out = [];
  for (const [k, t] of times.entries()) {
    const jpg = path.join(dir, `look_${k}.jpg`);
    const r = await runProc(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', jpg], { timeoutMs: 30000 });
    out.push(r.code === 0 && fs.existsSync(jpg) ? `data:image/jpeg;base64,${fs.readFileSync(jpg).toString('base64')}` : null);
    fs.rmSync(jpg, { force: true });
  }
  return out;
}

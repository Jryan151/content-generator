// lib/reference.js — the nightly reference render. The same short video, from the same made-up footage
// and captions, is rendered every night with the real FFmpeg and fonts, and compared with the one saved
// the first time. An operating-system update that changes FFmpeg (or a font file that changed) shows up
// here the next morning, before an agent notices their captions look different.
//
// No AI and no outside services: the footage is FFmpeg's own test pattern. What's compared:
//   - the picture at five moments (a small greyscale copy: the average difference, 0–255);
//   - the length, size, frame rate and codec.
// Kept in data/reference/: reference.mp4 and reference.json (the saved one), latest.mp4 (tonight's).
// If a change is expected (you updated FFmpeg on purpose and the video looks right), accept the new one:
//   node admin.js reference --accept
import fs from 'fs';
import path from 'path';
import { DIRS, readJSON, writeJSON } from './paths.js';
import { runProc } from './proc.js';
import { notify } from './alerts.js';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// What else could change the picture: the app's own version and its render code (an update that changes
// the look on purpose is told apart from FFmpeg changing under it).
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || ''; } catch { return ''; } };
// (stages/craft.js too, since v15: it measures and finishes every render.)
const renderCode = () => { try { const h = crypto.createHash('sha256'); for (const f of ['render.js', 'craft.js']) h.update(fs.readFileSync(path.join(ROOT, 'stages', f))); return h.digest('hex').slice(0, 12); } catch { return ''; } };

const DIR = () => path.join(DIRS.data, 'reference');
const FF = () => process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';
export const LIMIT = () => Number(process.env.REFERENCE_LIMIT) > 0 ? Number(process.env.REFERENCE_LIMIT) : 6;
const W = 36, H = 64;
const SCENES = [
  { text: 'Here is a question I hear a lot.', accent: 'question' },
  { text: 'Planning ahead can often be simpler than it sounds.', accent: 'simpler' },
  { text: 'Your own answer depends on your situation.', accent: 'situation' },
  { text: 'Message me and we can talk it through.', accent: 'talk' },
];
const PATTERNS = ['testsrc2', 'smptebars', 'rgbtestsrc', 'testsrc'];

async function makeClips(dir) {
  const out = [];
  for (let i = 0; i < SCENES.length; i++) {
    const f = path.join(dir, `clip${i}.mp4`);
    const r = await runProc(FF(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${PATTERNS[i]}=size=720x1280:rate=30:duration=4`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', f], { timeoutMs: 120000, signal: null });
    if (r.code !== 0) throw new Error(`Couldn’t make the test footage: ${String(r.stderr).slice(-200)}`);
    out.push(f);
  }
  return out;
}
async function probe(file) {
  const r = await runProc(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,pix_fmt,r_frame_rate:format=duration', '-of', 'json', file], { timeoutMs: 30000, signal: null });
  const j = JSON.parse(r.stdout || '{}'), s = j.streams?.[0] || {};
  return { width: s.width, height: s.height, codec: s.codec_name, pix: s.pix_fmt, fps: s.r_frame_rate, duration: Math.round(Number(j.format?.duration || 0) * 100) / 100 };
}
async function frames(file, duration) {
  const at = [0.15, 0.3, 0.5, 0.7, 0.9].map(f => Math.round(f * duration * 100) / 100);
  const out = [];
  for (const t of at) {
    const r = await runProc(FF(), ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { timeoutMs: 60000, binary: true, maxOutput: W * H, signal: null });
    out.push(Buffer.from(r.stdout).toString('base64'));
  }
  return out;
}
// Average difference per pixel between two sets of frames (0 = identical, 255 = opposite).
export function difference(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = Buffer.from(a[i], 'base64'), y = Buffer.from(b[i], 'base64');
    for (let k = 0; k < Math.min(x.length, y.length); k++) { sum += Math.abs(x[k] - y[k]); n++; }
  }
  return n ? Math.round((sum / n) * 100) / 100 : 255;
}

// Renders the reference video into `file` and returns its fingerprint.
export async function renderReference(file, log = () => {}, { font = '' } = {}) {
  const { renderVideo } = await import('../stages/render.js');
  const { DEFAULT_CONFIG } = await import('../mixer-core.js');
  const work = path.join(DIRS.work, `reference-${process.pid}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const clips = await makeClips(work);
    const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    cfg.output = { ...cfg.output, mode: 'captions', music: 'none', scenes: SCENES.length };
    cfg.look = { ...cfg.look, ...(font ? { font } : {}), name: 'Reference Agent', location: 'Anytown, USA', logo: 'off', disclaimer: 'Licensed agent. Not affiliated with any government agency.' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await renderVideo({ scenes: SCENES.map(s => ({ ...s })), clips, cfg, outFile: file, workDir: work, voice: null, music: null, logo: null, log });
    const info = await probe(file);
    return { ...info, frames: await frames(file, info.duration) };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

const versionOf = async () => { try { return (/ffmpeg version (\S+)/.exec((await runProc(FF(), ['-version'], { timeoutMs: 10000, signal: null })).stdout) || [])[1] || ''; } catch { return ''; } };

// The nightly check. The first run saves the reference. Returns { ok, saved?, diff, problems }.
export async function check({ now = Date.now(), accept = false, log = () => {}, font = '' } = {}) {
  const dir = DIR();
  fs.mkdirSync(dir, { recursive: true });
  const latest = path.join(dir, 'latest.mp4');
  const got = await renderReference(latest, log, { font });
  const ffmpeg = await versionOf();
  const refFile = path.join(dir, 'reference.json');
  const ref = readJSON(refFile, null);
  if (!ref || accept) {
    fs.copyFileSync(latest, path.join(dir, 'reference.mp4'));
    writeJSON(refFile, { savedAt: new Date(now).toISOString(), ffmpeg, node: process.version, app: appVersion(), renderCode: renderCode(), ...got });
    return { ok: true, saved: true, diff: 0, problems: [], ffmpeg };
  }
  const problems = [];
  const diff = difference(ref.frames || [], got.frames);
  if (diff > LIMIT()) problems.push(`the picture changed (difference ${diff}, limit ${LIMIT()})`);
  for (const k of ['width', 'height', 'codec', 'pix', 'fps']) if (ref[k] !== got[k]) problems.push(`${k} was ${ref[k]}, now ${got[k]}`);
  if (Math.abs((ref.duration || 0) - got.duration) > 0.15) problems.push(`the length was ${ref.duration}s, now ${got.duration}s`);
  const out = { ok: !problems.length, diff, problems, ffmpeg, was: ref.ffmpeg || '' };
  if (problems.length) {
    const changed = [ref.ffmpeg !== ffmpeg ? `FFmpeg ${ref.ffmpeg || '?'} → ${ffmpeg || '?'}` : '', ref.app && ref.app !== appVersion() ? `the app ${ref.app} → ${appVersion()}` : '', ref.renderCode && ref.renderCode !== renderCode() ? 'the app’s render code changed' : ''].filter(Boolean);
    out.changed = changed;
    notify({ level: 'warning', kind: 'server', title: 'Tonight’s reference render came out different',
      text: `Compared with the one saved ${String(ref.savedAt).slice(0, 10)}: ${problems.join('; ')}. Since then: ${changed.length ? changed.join(', ') : 'nothing in the app or FFmpeg changed (fonts or the operating system, then)'}.`,
      did: 'Kept making videos as usual; tonight’s render is saved as data/reference/latest.mp4 next to reference.mp4.',
      run: 'Watch both. If the new one looks right: node admin.js reference --accept' }, now);
  }
  return out;
}

// stages/voice.js — voiceover mode: turn each scene's "say" line into speech.
// One audio file per scene, so each scene lasts exactly as long as its line.
//
// Single take (VOICE_TAKE=single, the default): the whole script is read in one go, so the voice
// flows from scene to scene instead of restarting at every cut. The take is then cut into scenes:
//   1. word timings from a transcription (OPENAI_TRANSCRIBE_MODEL, default whisper-1), matched to
//      the script, which also time word-by-word captions to the voice;
//   2. if that isn't available, the pauses between sentences (FFmpeg silencedetect), only when each
//      pause sits close to where its scene should end.
// If neither gives clean cuts, or the voice skipped a line, the video is recorded scene by scene
// (as in v12) instead: a voiceover is never cut mid-word or missing a line.
// VOICE_TAKE=scene records each scene separately, as before.
import fs from 'fs';
import path from 'path';
import { runProc, tail } from '../lib/proc.js';
import { speech, transcribeWords, parseRung, rungKey, isGoneError } from '../lib/ai.js';
import { AIError } from '../lib/openai.js';
import { styleGuide } from '../comms-core.js';
import { sayIt } from '../mixer-core.js';

// The voice's speaking style: the agent's own setting (Brand), plus pacing for the audience's
// communication style (comms-core.js), so a Steady audience hears a slower, gentler read.
export const voiceInstructions = (cfg, style) => [String(cfg.voice?.ttsStyle || '').trim(), styleGuide(style)?.tts || ''].filter(Boolean).join(' ');

export async function probeDuration(file) {
  const r = await runProc(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeoutMs: 30000, maxOutput: 4000 });
  const s = parseFloat(r.stdout);
  if (r.code === 0 && s > 0) return s;
  throw new Error('Could not read the length of ' + path.basename(file));
}

// `rung`: the voice to use (lib/ai.js), so every scene of a video sounds the same. Returns { file, duration, rung }.
export async function speakScene(text, cfg, file, meter = null, style = '', rung = null) {
  // Spoken with the agent's pronunciations (Brand → Voice); captions keep the real spelling.
  const r = await speech({ input: sayIt(String(text).trim(), cfg), voice: cfg.voice.ttsVoice || 'coral', instructions: voiceInstructions(cfg, style), rung });
  fs.writeFileSync(file, r.audio);
  const duration = await probeDuration(file);
  meter?.tts(r.model, duration, String(text).length);
  return { file, duration, rung: rungKey(r.rung) };
}

// `only`: scene indexes to record (others are kept from `previous`), used when fixing a scene.
// `rung`: the voice the kept scenes were recorded with. If it can't be used any more, every scene is
// recorded again with the voice that can, so a video never mixes two voices.
export async function speakScenes(scenes, cfg, dir, log = console.log, meter = null, { only = null, previous = [], style = '', rung = null } = {}) {
  const one = async (i, use) => {
    const r = await speakScene(scenes[i].say || scenes[i].text, cfg, path.join(dir, `voice_${i}.mp3`), meter, style, use);
    log(`Voice ${i + 1}/${scenes.length}: ${r.duration.toFixed(1)}s`);
    return r;
  };
  const keep = i => only && !only.includes(i) && previous[i] && fs.existsSync(previous[i].file);
  if (only && rung) {
    // Every call is waited for before deciding, so a slow one can't overwrite a file afterwards.
    const tries = await Promise.allSettled(scenes.map((_, i) => (keep(i) ? previous[i] : one(i, parseRung(rung)))));
    const bad = tries.find(t => t.status === 'rejected');
    if (!bad) return tries.map(t => t.value);
    const e = bad.reason;
    if (!(e instanceof AIError) || !(e.outage || isGoneError(e) || ['config', 'insufficient_quota'].includes(e.code))) throw e;
    log(`Voice: the original voice can't be used now (${String(e.message).slice(0, 80)}); recording every scene again so they match.`);
    only = null;
  }
  const todo = scenes.map((_, i) => i).filter(i => !keep(i));
  if (!todo.length) return scenes.map((_, i) => previous[i]);
  // The first line picks the voice (the first rung that works); the rest use the same one.
  const first = await one(todo[0], null);
  const settled = await Promise.allSettled(todo.slice(1).map(i => one(i, parseRung(first.rung))));
  const failed = settled.find(t => t.status === 'rejected');
  if (failed) throw failed.reason;
  const rest = settled.map(t => t.value);
  const made = new Map([[todo[0], first], ...todo.slice(1).map((i, k) => [i, rest[k]])]);
  return scenes.map((_, i) => made.get(i) || previous[i]);
}

/* ---------------- Single take ---------------- */
export const takeMode = () => (/^scene/i.test(String(process.env.VOICE_TAKE || '')) ? 'scene' : 'single');
const tokens = t => (String(t).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || []);

// Resolves with FFmpeg's messages (silencedetect prints its findings there). A minute at most: these
// are short audio files.
async function run(bin, args) {
  const r = await runProc(bin, args, { timeoutMs: 60000, maxOutput: 400000 });
  if (r.code !== 0) throw new Error(tail(r.stderr, 3) || `${bin} exited ${r.code}`);
  return r.stderr;
}
const FF = () => process.env.FFMPEG_PATH || 'ffmpeg';

// Matches the script's words to the transcript's (longest common subsequence), so a misheard or
// skipped word doesn't throw the timing off. Returns, per scene, its first and last matched word
// times and the matched words { i: index in the scene's line, start, end }, or null if too little
// matched to trust (under 60% of the words, or a scene with none).
export function alignScenes(lines, words) {
  const S = [], sceneOf = [], idxIn = [];
  lines.forEach((l, k) => tokens(l).forEach((t, i) => { S.push(t); sceneOf.push(k); idxIn.push(i); }));
  // A transcript word like "40-year-old" becomes several tokens sharing its time, split the same way
  // as the script, so they still match.
  const T = [], TW = [];
  words.forEach(w => tokens(w.word).forEach(t => { T.push(t); TW.push(w); }));
  words = TW;
  const n = S.length, m = T.length;
  if (!n || !m) return null;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = S[i] === T[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = lines.map(() => ({ first: null, last: null, words: [] }));
  let matched = 0;
  for (let i = 0, j = 0; i < n && j < m;) {
    if (S[i] === T[j]) {
      const o = out[sceneOf[i]], w = words[j];
      if (o.first === null) o.first = w.start;
      o.last = w.end; o.words.push({ i: idxIn[i], start: w.start, end: w.end });
      matched++; i++; j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  if (matched / n < 0.6) return null;
  // A scene with no spoken words at all: the voice skipped that line. Never cut around it.
  if (out.some(o => o.first === null)) return Object.assign([], { skipped: out.findIndex(o => o.first === null) });
  for (let k = 0; k < out.length; k++) {
    const o = out[k], count = tokens(lines[k]).length;
    // Times must rise, and each scene must last long enough for its words.
    if (o.words.some((w, j) => j && w.start < o.words[j - 1].start - 0.01)) return null;
    if (o.last - o.first < Math.max(0.2, 0.08 * count)) return null;
    if (k && o.first < out[k - 1].last) return null;
  }
  return out;
}

// Cut points between scenes from the alignment. Cuts touch (no gap), halfway between one scene's last
// matched word and the next scene's first, so a word the transcript misheard at a boundary is never
// dropped: it stays with one scene or the other.
const cutsFromAlignment = (al, total) => {
  const at = al.slice(1).map((o, k) => (al[k].last + o.first) / 2);
  return al.map((_, k) => ({ from: k === 0 ? 0 : at[k - 1], to: k === al.length - 1 ? total : at[k] }));
};

// Pauses in the take (FFmpeg silencedetect) → the n-1 pauses closest to where each scene should end
// by word count. Returns cut ranges, or null if there aren't enough clear pauses.
export async function cutsFromSilence(file, lines, total) {
  let err;
  try { err = await run(FF(), ['-hide_banner', '-i', file, '-af', 'silencedetect=n=-35dB:d=0.18', '-f', 'null', '-']); } catch (e) { if (e.aborted) throw e; return null; }
  // Each silence_end pairs with the silence_start just before it. Some FFmpeg builds print tiny negative starts.
  const gaps = [];
  let open = null;
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+(?:e-?\d+)?)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === 'start') open = t; else if (open !== null) { if (t > open) gaps.push({ a: open, b: t }); open = null; }
  }
  if (open !== null) gaps.push({ a: open, b: total });
  const inner = gaps.filter(g => g.a > 0.05 && g.b < total - 0.05);
  const need = lines.length - 1;
  if (inner.length < need) return null;
  const counts = lines.map(l => Math.max(1, tokens(l).length)), all = counts.reduce((x, y) => x + y, 0);
  const picked = [];
  let used = 0, after = 0;
  for (let k = 0; k < need; k++) {
    used += counts[k];
    const want = (total * used) / all, sceneLen = (total * counts[k]) / all;
    const options = inner.filter(g => g.a > after && !picked.includes(g));
    const left = need - k - 1;
    const pool = options.slice(0, Math.max(1, options.length - left));
    if (!pool.length) return null;
    const g = pool.reduce((best, x) => (Math.abs((x.a + x.b) / 2 - want) < Math.abs((best.a + best.b) / 2 - want) ? x : best));
    // Too far from where this scene should end: it's probably a pause inside a sentence. Don't guess.
    if (Math.abs((g.a + g.b) / 2 - want) > Math.max(0.5, sceneLen * 0.35)) return null;
    picked.push(g); after = g.b;
  }
  return lines.map((_, k) => ({ from: k === 0 ? 0 : Math.max(0, picked[k - 1].b - 0.05), to: k === need ? total : Math.min(total, picked[k].a + 0.08) }));
}


async function cut(src, from, to, file) {
  await run(FF(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-ss', from.toFixed(3), '-to', to.toFixed(3), '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '3', file]);
  return probeDuration(file);
}

// Records the whole script in one take and cuts it into one file per scene: [{ file, duration, words }].
// words (when the transcription worked): [{ i, start, end }] per scene, seconds from the scene's start,
// i = the word's position in the scene's spoken line. Used to time word-by-word captions.
export async function speakTake(scenes, cfg, dir, log = console.log, meter = null, { style = '' } = {}) {
  const lines = scenes.map(sc => String(sc.say || sc.text).trim());
  const take = path.join(dir, 'voice_take.mp3');
  const instructions = [voiceInstructions(cfg, style), 'This is one short video script read straight through. Leave a short, natural pause between paragraphs.'].filter(Boolean).join(' ');
  // The take says the agent's pronunciations; timing still lines up with the written lines.
  const sp = await speech({ input: lines.map(l => sayIt(l, cfg)).join('\n\n'), voice: cfg.voice.ttsVoice || 'coral', instructions });
  fs.writeFileSync(take, sp.audio);
  const total = await probeDuration(take);
  meter?.tts(sp.model, total, lines.join(' ').length);
  let ranges = null, how = '', al = null;
  if (lines.length === 1) { ranges = [{ from: 0, to: total }]; how = 'one scene'; }
  if (!ranges) {
    // A voice company that times its own words (ElevenLabs) needs no transcription.
    try { al = alignScenes(lines, sp.words?.length ? sp.words : (await transcribeWords({ file: take, meter })).words); } catch (e) { if (e.aborted) throw e; log(`Voice timing: transcription unavailable (${String(e.message).slice(0, 80)}).`); }
    if (al && al.skipped !== undefined) throw new Error(`the voice skipped scene ${al.skipped + 1}'s line`);
    if (al) { ranges = cutsFromAlignment(al, total); how = 'word timings'; }
  }
  if (!ranges) { ranges = await cutsFromSilence(take, lines, total); if (ranges) how = 'pauses'; }
  if (!ranges) throw new Error('no clean places to cut the take between scenes');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const r = ranges[i], file = path.join(dir, `voice_${i}.mp3`);
    const duration = await cut(take, r.from, Math.max(r.from + 0.3, r.to), file);
    const words = al ? al[i].words.map(w => ({ i: w.i, start: Math.max(0, w.start - r.from), end: Math.max(0, w.end - r.from) })) : null;
    out.push({ file, duration, rung: rungKey(sp.rung), ...(words ? { words } : {}) });
  }
  log(`Voice: one take, ${total.toFixed(1)}s, cut into ${lines.length} scenes by ${how}.`);
  return out;
}

// The voiceover for a video, in the configured mode. Falls back to one take per scene if the
// single take fails, so a voice problem never costs the whole video.
export async function speakVoice(scenes, cfg, dir, log = console.log, meter = null, { style = '' } = {}) {
  if (takeMode() === 'single') {
    try { return await speakTake(scenes, cfg, dir, log, meter, { style }); }
    catch (e) { if (e.permanent || e.aborted || e.code === 'config' || e.code === 'insufficient_quota') throw e; log(`Voice: the single take didn't work (${String(e.message).slice(0, 100)}); recording scene by scene.`); }
  }
  return speakScenes(scenes, cfg, dir, log, meter, { style });
}

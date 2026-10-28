// stages/render.js — Stage 3: cut the clips, add the look, burn in captions, mix the audio.
//
// Look (all settings in the portal's Brand tab):
//   - Captions: Poppins SemiBold, off-white, soft blurred shadow, hair-thin outline, no box.
//     One accent word per caption in italic with a soft sand tint. Gentle fade in/out.
//   - Scrim: a soft dark gradient over the lower part of the frame so text reads on any footage.
//   - Grade: the same warm, soft color on every clip so stock looks like one shoot.
//   - Motion: a slow drift on each clip.
//   - End card: name, title, city and call to action (and the agent's logo) over a blurred, darkened last shot.
//   - Word-by-word captions (optional): words appear as they're read or spoken. Scene 1 always
//     shows whole, so the cover and the first frame carry the full hook.
// Timing: captions mode = reading time per caption; voiceover mode = length of each spoken line.
// Audio: voice and/or music; music ducks under the voice; final mix leveled to -14 LUFS.
// Videos with no voice or music get a silent track, so they meet Instagram's Reels specs.
//
// The finishing touches (v15; the measuring is in stages/craft.js). Each can be switched off in the
// workspace's look settings (look.match, beat, loop, shadow, opening, safezones: 'off'):
//   - Caption craft: real apostrophes and quotes, and lines broken where they read well (never
//     "Social / Security" or a line ending on "the").
//   - Safe zones: every frame of the captions is checked against the parts of the screen Instagram covers
//     (its buttons, the post text); a caption that strays in is made a little smaller and checked again.
//   - Shadow: stronger behind a caption when the footage there is bright.
//   - Even footage: each clip nudged toward the others' brightness and color.
//   - The opening: a scene starts past its clip's fade-in from black, so the first frame is picture.
//   - On the beat: cuts move (a little, never cutting a spoken line short) to the music's beats.
//   - The loop: the last moment cross-fades back to the first frame, so Instagram's loop has no jump.
//   - Sound: each spoken line with soft edges (no clicks), the music fading and dipping under the voice,
//     measured and then leveled in one exact step to Instagram's loudness, peaks held under -1.5 dBTP.
import fs from 'fs';
import path from 'path';
import { DIRS } from '../lib/paths.js';
import { runProc, tail } from '../lib/proc.js';
import { readingSeconds, END_CARD_SECONDS, accentHex } from '../mixer-core.js';
import { ensureFont } from './fonts.js';
import { clipLook, lookOver, matchPlan, matchFilter, shadowLevel, musicBeats, beatTimes, snapCuts, levelPlan, levelFilter, checkSafeZones, openingOffset } from './craft.js';

const W = 1080, H = 1920;
const SIZE = 126;            // caption size (Poppins renders small; 126 ≈ 100px of most fonts)
const LINE_H = 128;
const MAX_CHARS = 19;        // per line, balanced
const BOTTOM_Y = 1350;       // bottom of the caption block: lower third, clear of Instagram's buttons
const OFF_WHITE = '&H00ECF2F5&';
const SAND = '&H00A8D2EE&';
// "#EED2A8" → "&H00A8D2EE&" (ASS colors are blue, green, red).
export const assColor = hex => { const h = String(hex || '').replace('#', '').toUpperCase(); return /^[0-9A-F]{6}$/.test(h) ? `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&` : SAND; };
const accentOf = cfg => assColor(accentHex(cfg)) || SAND;
const SCRIM = path.join(DIRS.data, 'scrim.png');

const r2 = n => Math.round(n * 100) / 100;
const fpath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const assTime = s => { const cs = Math.round(s * 100); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assEsc = t => String(t).replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\n/g, ' ');

// Every FFmpeg run has a time limit (lib/proc.js): a frozen FFmpeg is stopped instead of holding up
// every agent's videos. Short jobs (a cover, a logo) get a minute; the render gets RENDER_TIMEOUT_MIN.
const SHORT_MS = 60000;
export const renderTimeoutMs = seconds => {
  const set = Number(process.env.RENDER_TIMEOUT_MIN);
  if (set > 0) return set * 60000;
  return Math.max(5 * 60000, Math.round((Number(seconds) || 60) * 10000));   // 10s of work per second of video, 5 minutes at least
};
async function run(args, { timeoutMs = SHORT_MS, bin = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  const r = await runProc(bin, args, { timeoutMs, maxOutput: 16000 });
  if (r.code !== 0) throw new Error('FFmpeg failed: ' + tail(r.stderr));
}

// Real apostrophes and quotes for the screen: it's → it’s, "plan" → “plan”, '90s → ’90s.
export const smartQuotes = t => String(t)
  .replace(/(^|[\s(\[—–-])'(\d\d)s\b/g, '$1’$2s')
  .replace(/(\w)'(\w)/g, '$1’$2')
  .replace(/(^|[\s(\[—–-])'/g, '$1‘')
  .replace(/'/g, '’')
  .replace(/(^|[\s(\[—–-])"/g, '$1“')
  .replace(/"/g, '”');

// Words that read badly left hanging at the end of a line ("the / plan", "your / family"), worst first.
const WEAK_END = new Map([
  ...['a', 'an', 'the', 'your', 'my', 'our', 'their', 'his', 'her', 'its', 'this', 'these', 'those', 'no'].map(w => [w, 55]),
  ...['to', 'of', 'and', 'or', 'but', 'nor', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'about', 'as', 'if', 'than', 'so', 'that', 'too', 'very'].map(w => [w, 40]),
  ...['not', 'is', 'are', 'was', 'be', 'can', 'will', 'would', 'could', 'should', 'may', 'might', 'do', 'does', 'more', 'most', 'less', 'just', 'i', 'we',
    'you’ll', 'you’re', 'it’s', 'don’t', 'won’t', 'can’t', 'who', 'what', 'when', 'how'].map(w => [w, 20]),
]);
// Words that belong on one line: names of programs and products, and set phrases.
export const KEEP_TOGETHER = ['social security', 'life insurance', 'final expense', 'term life', 'whole life', 'universal life', 'living benefits', 'mortgage protection',
  'burial insurance', 'cash value', 'death benefit', 'long term care', 'long-term care', 'fixed income', 'next of kin', 'peace of mind', 'real estate', 'open house',
  'first home', 'fair housing', 'closing costs', 'down payment'];
const bare = w => String(w).toLowerCase().replace(/[‘’]/g, '’').replace(/^[^a-z0-9’]+|[^a-z0-9’]+$/g, '');
// The cost of breaking the line after each word: high inside a pair that belongs together or after a
// word that can't end a line, lower after punctuation (where a reader pauses anyway).
function breakCosts(words) {
  const n = words.length, cost = new Array(n).fill(0);
  const low = words.map(bare);
  for (let i = 0; i < n - 1; i++) {
    const w = words[i], next = words[i + 1];
    cost[i] += WEAK_END.get(low[i]) || 0;
    if (/[,.;:!?—–]$/.test(w)) cost[i] -= 12;
    // A name: two capitalized words in a row ("Social Security", "Medicare Advantage").
    else if (/^[“‘"']?[A-Z]/.test(w) && /^[A-Z]/.test(next) && i > 0) cost[i] += 60;
    // A number and what it counts ("10 years", "$50 a month").
    if (/^[$£€]?\d[\d,.%]*$/.test(w)) cost[i] += 60;
  }
  for (const phrase of KEEP_TOGETHER) {
    const parts = phrase.split(' ');
    for (let i = 0; i + parts.length <= n; i++) if (parts.every((p, j) => low[i + j] === p)) for (let j = 0; j < parts.length - 1; j++) cost[i + j] += 60;
  }
  return cost;
}
// Split words into balanced lines. Returns arrays of word indexes. The best split is chosen, not the first
// that fits: lines close in length, none over `maxChars` if it can be helped, no lonely last word, and
// no break that reads badly ("Social / Security", "the / plan"); one more line is used only when every
// split with fewer reads badly.
export function balanceLines(words, maxChars = MAX_CHARS) {
  const n = words.length;
  if (n <= 1) return [n ? [0] : []];
  const len = words.map(w => w.length), total = words.join(' ').length;
  const k0 = Math.min(n, Math.max(1, Math.ceil(total / maxChars)));   // (never more lines than words)
  const brk = breakCosts(words);
  const lineLen = (a, b) => { let l = b - a - 1; for (let i = a; i < b; i++) l += len[i]; return l; };
  const solve = k => {
    if (k > n) return null;
    const target = total / k;
    const lineCost = (a, b, last) => {
      const L = lineLen(a, b);
      let c = ((L - target) ** 2) / 2;
      if (a > 0 && !last && L < target * 0.6) c += 15;   // a thin middle line ("Social Security / survivor / benefits…")
      if (L > maxChars && b - a > 1) c += (L - maxChars) * 25;
      if (last && k > 1 && b - a === 1) c += 45;   // a lonely last word
      if (!last) c += brk[b - 1];
      return c;
    };
    // best[m][j]: the cheapest way to put the first j words on m lines.
    const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity)), from = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
    best[0][0] = 0;
    for (let m = 1; m <= k; m++) for (let j = m; j <= n - (k - m); j++) for (let i = m - 1; i < j; i++) {
      if (best[m - 1][i] === Infinity) continue;
      const c = best[m - 1][i] + lineCost(i, j, m === k);
      if (c < best[m][j]) { best[m][j] = c; from[m][j] = i; }
    }
    const lines = [];
    for (let m = k, j = n; m > 0; m--) { const i = from[m][j]; lines.unshift(Array.from({ length: j - i }, (_, x) => i + x)); j = i; }
    return { cost: best[k][n], lines };
  };
  const a = solve(k0), b = k0 < 3 ? solve(k0 + 1) : null;
  return (b && b.cost + 30 + 10 * k0 < a.cost ? b : a).lines;
}

// How long each word waits before it appears (centiseconds), weighted by its length, spread over
// `seconds`. Used for word-by-word captions.
export function wordTimings(text, seconds) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const weight = words.map(w => w.length + 2), total = weight.reduce((a, b) => a + b, 0) || 1;
  return weight.map(x => Math.max(1, Math.round((seconds * 100 * x) / total)));
}

// Word-by-word captions timed to the voice: each caption word appears when it's spoken.
// `words`: the scene's spoken word times from the single take ([{ i, start, end }], i = position in
// the spoken line's words). Caption words are matched to the spoken line in order; ones that aren't
// spoken get a time between their neighbours. Returns centiseconds per word like wordTimings, or
// null when too few match (then the length-weighted timing is used).
const toks = t => (String(t).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || []);
export function spokenTimings(text, say, words, seconds) {
  if (!Array.isArray(words) || !words.length) return null;
  const capWords = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const sayToks = toks(say), at = new Map(words.map(w => [w.i, w.start]));
  const times = new Array(capWords.length).fill(null);
  let from = 0;
  capWords.forEach((w, j) => {
    const t = toks(w)[0];
    if (!t) return;
    for (let k = from; k < sayToks.length; k++) if (sayToks[k] === t) { if (at.has(k)) times[j] = at.get(k); from = k + 1; break; }
  });
  const known = times.filter(x => x !== null).length;
  if (known < Math.max(1, Math.ceil(capWords.length * 0.6))) return null;
  // Fill gaps by interpolating; keep times rising.
  const t0 = times.find(x => x !== null);
  for (let j = 0; j < times.length; j++) {
    if (times[j] !== null) continue;
    const prev = j ? times[j - 1] : t0, nextIdx = times.findIndex((x, k) => k > j && x !== null);
    const next = nextIdx >= 0 ? times[nextIdx] : Math.max(prev + 0.25, seconds);
    times[j] = prev + (next - prev) / ((nextIdx >= 0 ? nextIdx : times.length) - j + 1);
  }
  for (let j = 1; j < times.length; j++) times[j] = Math.max(times[j], times[j - 1] + 0.05);
  // The caption appears 0.05s into the scene, with its first word; each later word appears when spoken.
  const rel = times.map((x, j) => (j ? Math.max(0, x - 0.05) : 0));
  for (let j = 1; j < rel.length; j++) rel[j] = Math.max(rel[j], rel[j - 1] + 0.05);
  const out = rel.map((x, j) => Math.max(1, Math.round(((j + 1 < rel.length ? rel[j + 1] : Math.max(x + 0.3, seconds)) - x) * 100)));
  return out;
}

// Caption text with the accent word(s) styled. Returns { text, shadow } in ASS markup.
// `color`: the accent color (ASS). `karaoke`: centiseconds per word for word-by-word captions.
export function captionMarkup(text, accent, { color = SAND, karaoke = null } = {}) {
  const words = smartQuotes(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const flag = new Array(words.length).fill(false);
  if (accent) {
    const acc = smartQuotes(accent).toLowerCase().split(/\s+/).filter(Boolean);
    const norm = w => w.toLowerCase().replace(/[‘’']/g, '’').replace(/^[^a-z0-9’]+|[^a-z0-9’]+$/g, '');
    for (let i = 0; i + acc.length <= words.length; i++) {
      if (acc.every((a, j) => norm(words[i + j]) === norm(a))) { for (let j = 0; j < acc.length; j++) flag[i + j] = true; break; }
    }
  }
  const lines = balanceLines(words);
  // Karaoke: \ko hides a word (fill and outline) until its turn; the styles' secondary color is transparent.
  const k = i => (karaoke ? `{\\ko${karaoke[i] ?? 1}}` : '');
  const build = styled => lines.map(idx => idx.map(i => {
    const w = assEsc(words[i]);
    if (!flag[i]) return k(i) + w;
    return k(i) + (styled ? `{\\i1\\1c${color}}${w}{\\i0\\1c${OFF_WHITE}}` : `{\\i1}${w}{\\i0}`);
  }).join(' ')).join('\\N');
  return { text: build(true), shadow: build(false), lines: lines.length };
}

export function sceneDurations(scenes, cfg, voice) {
  return scenes.map((s, i) => voice
    ? r2(Math.max(cfg.output.minSeconds, voice[i].duration + 0.35))
    : readingSeconds(s.text, cfg));
}

// The caption's shadow, by how bright the footage behind it is (stages/craft.js shadowLevel): as designed,
// stronger, strongest. Outline too, at the strongest.
const SHADOW_TAGS = ['\\blur20', '\\blur22\\1a&H20&', '\\blur26\\1a&H08&'];
const OUTLINE_TAGS = ['', '\\3a&H60&', '\\bord2.2\\3a&H40&'];
// The last LOOP_SECONDS cross-fade back to the first frame (with the first caption), so when Instagram
// loops the Reel it runs on without a jump.
export const LOOP_SECONDS = 0.4;
// End card layout (the top of the name, and where the logo's bottom sits).
const END_TOP = 760, LOGO_BOTTOM = 720;

// `fit`: captions made smaller to keep out of Instagram's zones ({ scale: { sceneIndex: 0.9 }, end: 0.9 }).
// `shadow`: a shadow level per scene. `loop`: seconds of the loop seam at the end (0: none).
export function assFile({ scenes, starts, durs, cfg, family, endAt, voice = null, fit = {}, shadow = [], loop = 0, total = 0 }) {
  const L = cfg.look || {};
  const accentOn = (L.accent || 'on') === 'on';
  const accent = accentOf(cfg);
  const words = L.captionStyle === 'words';
  let out = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Shadow,${family},${SIZE},&H38000000,&HFF000000,&HFF000000,&HFF000000,0,0,0,0,100,100,0.5,0,1,0,0,2,60,60,0,1
Style: Text,${family},${SIZE},${OFF_WHITE.slice(0, -1)},&HFF000000,&H80000000,&HFF000000,0,0,0,0,100,100,0.5,0,1,1.6,0,2,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = (layer, style, a, b, tags, text, margins = '0,0,0') => { out += `Dialogue: ${layer},${assTime(a)},${assTime(b)},${style},,${margins},,{${tags}}${text}\n`; };
  const sizeOf = i => { const f = fit.scale?.[i]; return f && f < 1 ? `\\fscx${Math.round(f * 100)}\\fscy${Math.round(f * 100)}` : ''; };
  const caption = (i, a, b, fad, karaoke = null) => {
    const s = scenes[i], lvl = shadow[i] || 0;
    const m = captionMarkup(s.text, accentOn ? s.accent : null, { color: accent, karaoke });
    ev(0, 'Shadow', a, b, `\\an2\\pos(546,${BOTTOM_Y + 9})${sizeOf(i)}${SHADOW_TAGS[lvl]}${fad}`, m.shadow);
    ev(1, 'Text', a, b, `\\an2\\pos(540,${BOTTOM_Y})${sizeOf(i)}${OUTLINE_TAGS[lvl]}${fad}`, m.text);
  };

  scenes.forEach((s, i) => {
    // The first caption is fully visible on frame 1 (Instagram previews and autoplay start there).
    const first = i === 0;
    // Word by word: spread over the spoken line, or over the first part of the reading time.
    const span = voice ? Math.min(durs[i] - 0.3, voice[i].duration * 0.92) : Math.min(durs[i] - 0.3, Math.max(0.6, durs[i] * 0.55));
    const karaoke = words && !first ? (voice?.[i]?.words && spokenTimings(s.text, s.say || s.text, voice[i].words, Math.max(0.3, span))) || wordTimings(s.text, Math.max(0.3, span)) : null;
    const fad = first ? '\\fad(0,120)' : karaoke ? '\\fad(0,120)' : '\\fad(180,120)';
    let a = first ? 0 : starts[i] + 0.05, b = starts[i] + durs[i] - 0.05;
    // Without an end card, the last caption is gone before the loop seam (the first one fades in there).
    if (loop && endAt == null && i === scenes.length - 1) b = Math.max(a + 0.3, Math.min(b, total - loop));
    caption(i, a, b, fad, karaoke);
  });

  if (endAt != null) {
    const f = fit.end && fit.end < 1 ? fit.end : 1;
    const a = endAt + 0.1, b = loop ? total - 0.02 : endAt + END_CARD_SECONDS;
    const fad = `\\fad(250,${loop ? Math.round(loop * 1000) : 0})`;
    const lines = [
      [L.name, 132, OFF_WHITE, '', 0],
      [smartQuotes([L.title, L.location].filter(Boolean).join('  ·  ')), 66, accent, '\\fsp2', 0],
      [L.endCta && smartQuotes(L.endCta), 86, OFF_WHITE, '\\i1', 1],
      [L.handle, 62, OFF_WHITE, '', 0],
    ].filter(l => l[0]);
    // A long name or line is sized down to fit across the screen (the safe-zone check then confirms it):
    // the name sits above Instagram's buttons and may use the full width; the lines below keep clear of them.
    const room = (t, size, k) => Math.min(size, Math.floor((k === 0 ? 960 : 840) / (0.335 * Math.max(1, [...String(t)].length))));
    let y = END_TOP;
    lines.forEach(([t, size, color, extra, gap], k) => {
      const fs_ = Math.round(room(t, size, k) * f);
      y += gap ? Math.round(70 * f) : 0;
      ev(0, 'Shadow', a, b, `\\an8\\pos(545,${y + 7})\\fs${fs_}${extra}\\blur18${fad}`, assEsc(t));
      ev(1, 'Text', a, b, `\\an8\\pos(540,${y})\\fs${fs_}${extra}\\1c${color}${fad}`, assEsc(t));
      y += Math.round(fs_ * 1.35);
    });
    // The small print wraps (\q0) inside the area clear of Instagram's buttons, and sits above the post text.
    // (Sized by its length so it wraps to three lines at most, clear of the handle above.)
    const small = smartQuotes(L.disclaimer || ''), smallSize = Math.max(24, Math.min(44, Math.floor((3 * 840) / (0.335 * Math.max(1, [...small].length)))));
    if (L.disclaimer) ev(1, 'Text', a, b, `\\an2\\pos(510,1500)\\q0\\fs${Math.round(smallSize * f)}\\bord1\\1c${OFF_WHITE}\\alpha&H30&${fad}`, assEsc(small), '90,150,0');
  }
  // The loop seam: the first caption fades in again over the cross-fade to the first frame.
  if (loop) caption(0, total - loop, total, `\\fad(${Math.round(loop * 1000) - 50},0)`);
  return out;
}

async function ensureScrim() {
  if (fs.existsSync(SCRIM)) return SCRIM;
  await run(['-y', '-f', 'lavfi', '-i', `color=black:s=${W}x${H},format=rgba`, '-vf',
    `geq=r=0:g=0:b=0:a='if(gt(Y,H*0.42),175*pow((Y-H*0.42)/(H*0.58),0.9),0)'`, '-frames:v', '1', SCRIM]);
  return SCRIM;
}

// Measures what the finishing touches need, a few clips at a time. Never fails the render: a clip that
// can't be measured is simply left as it is.
async function measureClips(clips, log) {
  const files = [...new Set(clips)], looks = new Map();
  for (let i = 0; i < files.length; i += 3) {
    await Promise.all(files.slice(i, i + 3).map(f => clipLook(f).then(l => looks.set(f, l)).catch(e => { if (e.aborted) throw e; log(`(Couldn’t measure a clip’s look: ${e.message})`); })));
  }
  return clips.map(c => looks.get(c) || null);
}

// The audio, mixed on its own first: each spoken line with a soft edge (no clicks at the cuts) and the low
// rumble taken out, the music faded in and out and dipping under the voice. Written as a 32-bit float
// file so nothing clips before it's leveled. Returns the file.
async function mixAudio({ voice, music, durs, total, workDir }) {
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const args = ['-y'], f = [];
  if (voice) voice.forEach(v => args.push('-i', v.file));
  const musicIn = voice ? voice.length : 0;
  if (music) args.push('-stream_loop', '-1', '-i', music);
  let out = null;
  if (voice) {
    voice.forEach((v, i) => {
      const len = Math.max(0.1, Math.min(Number(v.duration) || durs[i] - 0.35, durs[i]));
      f.push(`[${i}:a]${fmt},highpass=f=70,atrim=0:${r2(len)},afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, r2(len - 0.03))}:d=0.03,apad=whole_dur=${durs[i]},atrim=0:${durs[i]},asetpts=PTS-STARTPTS[a${i}]`);
    });
    f.push(voice.map((_, i) => `[a${i}]`).join('') + `concat=n=${voice.length}:v=0:a=1,acompressor=threshold=0.125:ratio=2.5:attack=8:release=120,apad=whole_dur=${total}[voice]`);
    out = '[voice]';
  }
  if (music) {
    const fadeOut = Math.max(0, r2(total - 2));
    f.push(`[${musicIn}:a]${fmt},atrim=0:${total},asetpts=PTS-STARTPTS,volume=${voice ? 0.35 : 0.6},afade=t=in:d=0.8,afade=t=out:st=${fadeOut}:d=2[mus]`);
    if (voice) {
      f.push('[voice]asplit=2[vo][key]');
      f.push('[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=400[duck]');
      f.push('[vo][duck]amix=inputs=2:duration=first:normalize=0[mix]');
      out = '[mix]';
    } else out = '[mus]';
  }
  const file = path.join(workDir, 'mix.wav');
  args.push('-filter_complex', f.join(';'), '-map', out, '-t', String(total), '-c:a', 'pcm_f32le', '-ar', '48000', file);
  await run(args, { timeoutMs: renderTimeoutMs(total) });
  return file;
}

export async function renderVideo({ scenes, clips, cfg, outFile, workDir, voice = null, music = null, logo = null, log = console.log }) {
  if (clips.length !== scenes.length) throw new Error(`Have ${clips.length} clips for ${scenes.length} scenes.`);
  const L = cfg.look || {};
  const { dir: fontDir, family } = await ensureFont(L.font || 'Poppins SemiBold', log);
  const scrim = await ensureScrim();
  const endCard = (L.endCard || 'on') === 'on';
  const on = k => (L[k] || 'on') !== 'off';
  const finish = { matched: 0, opened: 0, beat: false, loop: false, shadow: [] };

  // The finishing measurements (stages/craft.js): each clip's look, and the music's beat.
  const looks = on('match') || on('shadow') || on('opening') ? await measureClips(clips, log) : clips.map(() => null);
  let durs = sceneDurations(scenes, cfg, voice);
  if (music && on('beat')) {
    const beat = await musicBeats(music).catch(e => { if (e.aborted) throw e; log(`(Couldn’t find the music’s beat: ${e.message})`); return null; });
    if (beat) {
      const body0 = durs.reduce((a, b) => a + b, 0);
      // A scene never shrinks below its spoken line (or the shortest scene, with captions only). Without an
      // end card, the last line also keeps clear of the very end's quarter-second fade.
      const mins = durs.map((d, i) => (voice ? Number(voice[i].duration) + 0.2 + (!endCard && i === durs.length - 1 ? 0.25 : 0) : Math.min(d, Math.max(d * 0.88, Number(cfg.output.minSeconds) || 0))));
      const snapped = snapCuts(durs, beatTimes(beat, body0 + 2), { mins, stretch: voice ? 0.4 : 0.35, most: Math.max(body0, 60 - (endCard ? END_CARD_SECONDS : 0)) });
      finish.beat = snapped.some((d, i) => d !== durs[i]);
      durs = snapped;
    }
  }
  // Whole frames (30 a second), so every cut lands exactly where it's meant to (on the beat, in step with
  // the captions and the voice).
  durs = durs.map(d => Math.max(1 / 30, Math.round(d * 30) / 30));
  const starts = durs.map((_, i) => r2(durs.slice(0, i).reduce((a, b) => a + b, 0)));
  const body = r2(durs.reduce((a, b) => a + b, 0));
  // Each scene starts on picture: past a stock clip's fade-in from black (the first frame most of all),
  // as long as the clip is long enough not to loop back into it before the scene ends.
  const offs = looks.map((l, i) => (on('opening') ? openingOffset(l, durs[i]) : 0));
  const endOff = endCard ? (on('opening') ? openingOffset(looks.at(-1), END_CARD_SECONDS) : 0) : 0;
  finish.opened = offs.filter(Boolean).length;
  const total = r2(body + (endCard ? END_CARD_SECONDS : 0));
  const loop = on('loop') && total > 3 ? LOOP_SECONDS : 0;
  finish.loop = !!loop;

  const over = looks.map((l, i) => lookOver(l, offs[i], durs[i]));
  if (endCard) over.push(lookOver(looks.at(-1), endOff, END_CARD_SECONDS));
  const match = on('match') ? matchPlan(over) : over.map(() => null);
  finish.matched = match.filter(m => m && (m.brightness || m.rm || m.bm)).length;
  const shadow = on('shadow') ? over.slice(0, scenes.length).map(o => shadowLevel(o?.cap)) : [];
  finish.shadow = shadow;

  // Captions, checked frame by frame against Instagram's zones; a caption that strays in is made a
  // little smaller (up to three times) and checked again.
  const assPath = path.join(workDir, 'captions.ass');
  const fit = { scale: {}, end: 1 }, steps = {}, STEP = [1, 0.9, 0.8, 0.7];
  const groups = scenes.map((_, i) => ({ label: String(i), from: i ? starts[i] : 0, to: starts[i] + durs[i] }));
  if (endCard) groups.push({ label: 'end', from: body, to: total });
  if (loop) groups.push({ label: 'seam', from: total - loop, to: total + 1 });
  const name = l => (l === 'end' ? 'the end card' : `scene ${Number(l) + 1}`);
  let safe = on('safezones') ? null : undefined;   // undefined: the check is switched off
  for (let round = 0; ; round++) {
    const ass = assFile({ scenes, starts, durs, cfg, family, endAt: endCard ? body : null, voice, fit, shadow, loop, total });
    fs.writeFileSync(assPath, ass);
    if (!on('safezones')) break;
    // Checked with every word in white, so a dark accent color is seen like the rest.
    const checkPath = path.join(workDir, 'captions-check.ass');
    fs.writeFileSync(checkPath, ass.split(`\\1c${accentOf(cfg)}`).join(`\\1c${OFF_WHITE}`));
    const res = await checkSafeZones({ assPath: checkPath, fontDir, seconds: total, groups }).catch(e => { if (e.aborted) throw e; log(`(The safe-zone check couldn’t run: ${e.message})`); return null; });
    if (!res) { safe = null; break; }
    // The seam shows the first caption and the end card, each already checked on its own.
    const bad = Object.entries(res.problems).filter(([l]) => l !== 'seam' && l !== 'other' && (steps[l] || 0) < STEP.length - 1);
    const stuck = Object.entries(res.problems).filter(([l]) => l !== 'seam' && l !== 'other' && (steps[l] || 0) >= STEP.length - 1);
    if (!bad.length || round >= 3) {
      const left = [...bad, ...stuck].map(([l, zones]) => ({ where: name(l), zones }));
      safe = { frames: res.frames, fixed: Object.keys(steps).filter(l => !left.some(x => x.where === name(l))).map(name), left };
      break;
    }
    for (const [l] of bad) { steps[l] = (steps[l] || 0) + 1; if (l === 'end') fit.end = STEP[steps[l]]; else fit.scale[l] = STEP[steps[l]]; }
  }
  if (safe?.fixed.length) log(`Made ${safe.fixed.join(', ')} a little smaller to keep clear of Instagram’s buttons and text.`);
  const useLogo = endCard && logo && fs.existsSync(logo);

  // Audio first (its own quick pass), then measured, so the final level is set in one even step.
  const mix = voice || music ? await mixAudio({ voice, music, durs, total, workDir }) : null;
  const level = mix ? await levelPlan(mix, workDir).catch(e => { if (e.aborted) throw e; return null; }) : null;
  const loud = !!level?.measured;
  finish.loud = loud;

  // Inputs: clips, (last clip again for the end card), scrim, the mixed audio, the logo.
  const args = ['-y'];
  clips.forEach(c => args.push('-stream_loop', '-1', '-i', c));
  if (endCard) args.push('-stream_loop', '-1', '-i', clips[clips.length - 1]);
  const scrimIn = clips.length + (endCard ? 1 : 0);
  args.push('-loop', '1', '-i', scrim);
  const mixIn = scrimIn + 1;
  if (mix) args.push('-i', mix);
  const logoIn = mixIn + (mix ? 1 : 0);
  if (useLogo) args.push('-framerate', '30', '-loop', '1', '-i', logo);
  const silentIn = logoIn + (useLogo ? 1 : 0);

  const grade = (L.grade || 'on') === 'on' ? ',eq=contrast=1.03:saturation=0.9:gamma=1.02,colorbalance=rs=0.04:gs=0.01:bs=-0.04:rm=0.03:bm=-0.03' : '';
  const motion = (L.motion || 'on') === 'on';
  // Slow drift: frame is 8% larger than the screen and pans across it, alternating direction per scene.
  const MW = Math.round(W * 1.08), MH = Math.round(H * 1.08), dx = MW - W, dy = MH - H;
  const drift = (i, d) => {
    const p = `min(t/${d},1)`;
    const dirs = [[`${dx}*${p}`, `${dy / 2}`], [`${dx}*(1-${p})`, `${dy / 2}`], [`${dx / 2}`, `${dy}*${p}`], [`${dx / 2}`, `${dy}*(1-${p})`]];
    const [x, y] = dirs[i % 4];
    return `scale=${MW}:${MH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${MW}:${MH},crop=${W}:${H}:'${x}':'${y}'`;
  };
  const fit_ = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;
  const cut = (i, d) => `trim=start=${r2(offs[i])}:end=${r2(offs[i] + d)},setpts=PTS-STARTPTS`;

  const f = [];
  clips.forEach((_, i) => f.push(`[${i}:v]${cut(i, durs[i])},fps=30,${motion ? drift(i, durs[i]) : fit_}${grade}${matchFilter(match[i])},setsar=1,format=yuv420p,settb=1/30[v${i}${i === 0 && loop ? 's' : ''}]`));
  if (loop) {
    // The loop seam: scene 1's first frame, held, to cross-fade into at the very end.
    f.push('[v0s]split=2[v0][v0f]');
    f.push(`[v0f]trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${LOOP_SECONDS + 0.3},settb=1/30[vfirst]`);
  }
  const segs = clips.map((_, i) => `[v${i}]`);
  if (endCard) {
    f.push(`[${clips.length}:v]trim=start=${r2(endOff)}:end=${r2(endOff + END_CARD_SECONDS)},setpts=PTS-STARTPTS,fps=30,${fit_}${grade}${matchFilter(match[clips.length])},boxblur=24:2,eq=brightness=-0.34:saturation=0.6,setsar=1,format=yuv420p,settb=1/30[vend]`);
    segs.push('[vend]');
  }
  f.push(segs.join('') + `concat=n=${segs.length}:v=1:a=0${loop ? ',settb=1/30[vcat0]' : '[vcat]'}`);
  if (loop) f.push(`[vcat0][vfirst]xfade=transition=fade:duration=${LOOP_SECONDS}:offset=${r2(total - LOOP_SECONDS)}[vcat]`);
  f.push(`[${scrimIn}:v]format=rgba,setsar=1[scrim]`);
  if (useLogo) {
    // The logo fades in with the end card, centered above the name (and out again over the loop seam).
    f.push(`[${logoIn}:v]scale=420:300:force_original_aspect_ratio=decrease,format=rgba,fade=t=in:st=${r2(body + 0.1)}:d=0.25:alpha=1${loop ? `,fade=t=out:st=${r2(total - loop)}:d=${loop}:alpha=1` : ''}[logo]`);
    f.push(`[vcat][scrim]overlay=0:0:shortest=1[vs]`);
    f.push(`[vs][logo]overlay=(W-w)/2:${LOGO_BOTTOM}-h:shortest=1:enable='gte(t,${r2(body)})',format=yuv420p,subtitles='${fpath(assPath)}':fontsdir='${fpath(fontDir)}'[outv]`);
  } else f.push(`[vcat][scrim]overlay=0:0:shortest=1,format=yuv420p,subtitles='${fpath(assPath)}':fontsdir='${fpath(fontDir)}'[outv]`);

  // Audio: leveled to Instagram's loudness with the measured numbers (one pass if they couldn't be had),
  // then a short fade at the very end, so the loop back to the start doesn't click.
  let audio = null;
  if (mix) { f.push(`[${mixIn}:a]${level?.filter || levelFilter(null)},aresample=48000,afade=t=out:st=${Math.max(0, r2(total - 0.25))}:d=0.25[afinal]`); audio = '[afinal]'; }

  if (!audio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push('-filter_complex', f.join(';'), '-map', '[outv]');
  args.push('-map', audio || `${silentIn}:a`, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000');
  args.push('-t', String(total), '-c:v', 'libx264', '-crf', '21', '-preset', 'fast', '-bf', '0', '-movflags', '+faststart', '-use_editlist', '0', '-pix_fmt', 'yuv420p', outFile);

  await run(args, { timeoutMs: renderTimeoutMs(total) });
  log(`Rendered ${scenes.length} scenes${endCard ? ' + end card' : ''}${useLogo ? ' with logo' : ''}, ${total}s${voice ? ', with voiceover' : ''}${music ? ', with music' : ''}${cfg.look?.captionStyle === 'words' ? ', word-by-word captions' : ''}${finish.beat ? ', cut on the beat' : ''}${loud ? ', leveled in two passes' : ''}.`);
  const lines = scenes.map(s => captionMarkup(s.text, null).lines);
  return { file: outFile, duration: total, lines, sceneSeconds: durs, safe, finish };
}

// An uploaded logo, re-encoded as a clean PNG no bigger than 800×800 (drops metadata and anything odd).
export async function normalizeImage(input, output) {
  await run(['-y', '-i', input, '-vf', "scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease", '-frames:v', '1', '-f', 'image2', '-c:v', 'png', output]);
  return output;
}

// The agent's photo for their video pages (v15): a 400×400 square from the middle of the picture, as JPEG
// (re-encoding also drops anything hidden in the upload, like location data).
export async function squarePhoto(input, output) {
  await run(['-y', '-i', input, '-vf', 'scale=400:400:force_original_aspect_ratio=increase,crop=400:400', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', output]);
  return output;
}
// A still from the first scene (its caption is fully visible from frame 1), for the Reel cover
// and for the review list, so phones don't have to load every video to show it.
// `at`: the second to take it from (the agent can pick another frame in Review). `width`: smaller
// copies for the frame picker.
export async function makeCover(videoFile, coverFile, { at = 0.5, width = 0 } = {}) {
  await run(['-y', '-ss', String(Math.max(0, Number(at) || 0)), '-i', videoFile, '-frames:v', '1', ...(width ? ['-vf', `scale=${width}:-2`] : []), '-q:v', '3', coverFile]);
  return coverFile;
}

// The final check on a finished video: black stretches, frozen picture and (with a voiceover)
// long silences. Returns { black, frozen, silent } as [start, end] second pairs, or null if
// the check itself couldn't run (the video still goes to review, with a note).
// A check that can't finish in INSPECT_TIMEOUT (3 minutes) is reported as "couldn't run", like any
// other failed check; a job stopped by the watchdog still stops here.
export async function inspectVideo(file, { voice = false } = {}) {
  const args = ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0.4:pix_th=0.08,freezedetect=n=0.001:d=2.5'];
  if (voice) args.push('-af', 'silencedetect=n=-45dB:d=2');
  args.push('-f', 'null', '-');
  let r;
  try { r = await runProc(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeoutMs: 3 * 60000, maxOutput: 400000 }); }
  catch (e) { if (e.aborted) throw e; return null; }
  if (r.code !== 0) return null;
  const err = r.stderr;
  const num = re => [...err.matchAll(re)].map(m => Number(m[1]));
  const pairs = (starts, ends) => starts.map((s, i) => [s, Number.isFinite(ends[i]) ? ends[i] : s]);
  const black = [...err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  const frozen = pairs(num(/freeze_start: ([\d.]+)/g), num(/freeze_end: ([\d.]+)/g));
  const silent = voice ? pairs(num(/silence_start: ([\d.]+)/g), num(/silence_end: ([\d.]+)/g)) : [];
  return { black, frozen, silent };
}

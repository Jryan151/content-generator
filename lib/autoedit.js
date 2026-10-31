// lib/autoedit.js — a lesson video edits itself, so the leader just teaches and never thinks about editing.
//
// From the transcript's word timings it works out which parts of the recording to keep:
//   Long pauses get shorter, not removed: a 3-second gap becomes about a third of a second, so she still
//     sounds like a person breathing and thinking. Short, natural pauses are left alone.
//   Voice commands, said while recording. One trigger word nobody says in a final expense lesson, then
//   one word for what to do. The command itself is always cut too.
//     "Mango start"  cut everything before this point     (the fumbly start)
//     "Mango back"   cut the last sentence                 (back to her last short pause)
//     "Mango redo"   cut back to her last long pause       (the whole point, to say it again)
//     "Mango end"    cut everything after this point       (reaching for the stop button)
// Nothing here judges what she said: only pauses and her own commands are cut. The original is always kept.
//
// plan() is pure (words in, the parts to keep out), so it's tested without any video. render() cuts the
// video with ffmpeg, with a short fade at every join so there's no click.
import { execFile } from 'child_process';
import fs from 'fs';

export const TRIGGER = () => String(process.env.LESSON_TRIGGER_WORD || 'mango').trim().toLowerCase();
export const COMMANDS = Object.freeze(['start', 'back', 'redo', 'end']);
export const PAUSE = Object.freeze({
  long: 0.8,       // a gap longer than this gets shortened
  keep: 0.35,      // what a shortened gap becomes (half on each side of the join)
  sentence: 0.5,   // "back" goes back to the last gap at least this long (the end of a sentence)
  point: 1.5,      // "redo" goes back to the last gap at least this long (the end of a point)
});

const norm = (w) => String(w || '').toLowerCase().replace(/[^a-z]/g, '');
const ENDS = /[.?!]["'”’)\]]*$/;

/** How far "back" and "redo" may ever reach, in seconds, and when a "start" cut is big enough to point out. */
export const REACH = Object.freeze({ back: 15, redo: 30, startWarn: 30 });
/** One of these between the trigger and the command is fine: "Mango, um, back". */
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'ah', 'so', 'okay', 'ok']);
/** At most this many stretches in one video (render joins them all in one go). */
export const MAX_PARTS = 400;
// Which words end a sentence. Word timings usually come without punctuation, so it's read from the
// transcript text and matched to the words in order.
function markSentenceEnds(w, text) {
  for (const x of w) if (ENDS.test(String(x.word).trim())) x.endsSentence = true;
  let j = 0;
  for (const tok of String(text || '').split(/\s+/)) {
    const n = norm(tok);
    if (!n) continue;
    let k = j;
    while (k < w.length && k < j + 4 && w[k].n !== n) k++;
    if (k < w.length && w[k].n === n) { if (ENDS.test(tok)) w[k].endsSentence = true; j = k + 1; }
  }
}
// The trigger as the transcript may write it: "mango", "Mango,", "mangos", "mangoes", or split "man go".
function triggerAt(w, i, t) {
  const n = w[i].n;
  if (n === t || n === `${t}s` || n === `${t}es`) return 1;
  if (i + 1 < w.length && n.length >= 2 && n + w[i + 1].n === t) return 2;
  return 0;
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * words: [{ word, start, end }] in order; duration: seconds; text: the transcript (its punctuation marks
 * where sentences end, and it checks the timings cover what was said). Returns { keep: [[from, to], …],
 * commands: [{ cmd, at }], pauses, cut, changed, wordsKept, spokenCut, warnings }.
 *   changed: false means "use the video as it is" (nothing to cut, or the timings can't be trusted).
 *   spokenCut: true when words were removed (not just silence), so the transcript needs writing again.
 *   warnings: plain lines for the leader about cuts worth a second look.
 */
export function plan(words, duration, { text = '', trigger = TRIGGER() } = {}) {
  const none = { keep: [[0, duration]], commands: [], pauses: 0, cut: 0, changed: false, wordsKept: words || [], spokenCut: false, warnings: [] };
  if (!Array.isArray(words) || !words.length || !(duration > 0)) return none;
  // The timings must cover what was said, or a "pause" may really be speech the timings missed.
  const spoken = String(text || '').split(/\s+/).filter(Boolean).length;
  if (spoken && words.length < spoken * 0.8) return none;

  const w = words.map((x, i) => ({ ...x, i, n: norm(x.word), keep: true }));
  markSentenceEnds(w, text);
  const commands = [], warnings = [];
  // "back" and "redo" never reach past a "start" (everything before it is already gone).
  let floor = 0;
  const prevKept = (k) => { let p = k - 1; while (p >= floor && !w[p].keep) p--; return p; };
  for (let i = 0; i < w.length - 1; i++) {
    const len = triggerAt(w, i, trigger);
    if (!len) continue;
    let j = i + len;
    if (j < w.length && FILLERS.has(w[j].n)) j++;
    if (j >= w.length || !COMMANDS.includes(w[j].n)) continue;
    const cmd = w[j].n, at = w[i].start;
    commands.push({ cmd, at: Math.round(at * 10) / 10 });
    for (let k = i; k <= j; k++) w[k].keep = false;
    if (cmd === 'start') {
      for (let k = 0; k < i; k++) w[k].keep = false;
      if (at > REACH.startWarn) warnings.push(`“Mango start” cut the first ${mmss(at)} of the recording. If that was by accident, use the original.`);
      floor = j + 1;
    }
    if (cmd === 'end') { for (let k = j; k < w.length; k++) w[k].keep = false; break; }
    if (cmd === 'back' || cmd === 'redo') {
      const limit = REACH[cmd];
      let k = prevKept(i);
      // "redo" goes back to her last long pause. With none within reach, it cuts the last sentence instead.
      let mode = cmd;
      if (cmd === 'redo') {
        let found = false;
        for (let a = k; a >= floor; a = prevKept(a)) { const p = prevKept(a); if (p < floor || at - w[p].start > limit) break; if (w[a].start - w[p].end >= PAUSE.point) { found = true; break; } }
        if (!found) mode = 'back';
      }
      const gap = mode === 'back' ? PAUSE.sentence : PAUSE.point;
      while (k >= floor) {
        w[k].keep = false;
        const p = prevKept(k);
        if (p < floor) break;
        if (w[k].start - w[p].end >= gap || (mode === 'back' && w[p].endsSentence)) break;
        if (at - w[p].start > limit) { warnings.push(`“Mango ${cmd}” at ${mmss(at)} found no clear start, so it stopped ${limit} seconds back. Check that part.`); break; }
        k = p;
      }
    }
    i = j;
  }

  const kept = w.filter((x) => x.keep);
  if (!kept.length) return { ...none, commands, warnings, changed: false };
  // Join kept words into stretches. Neighbours that were next to each other in the recording, with a
  // natural gap, stay one stretch (the pause plays as it was). Anything else is a join. A very slow
  // talker can need more joins than one video takes: then only the longest pauses are shortened.
  const half = PAUSE.keep / 2;
  const build = (long) => {
    const keep = [];
    let pauses = 0, from = kept[0], to = kept[0];
    const close = () => keep.push([Math.max(0, from.start - half), Math.min(duration, to.end + half)]);
    for (let k = 1; k < kept.length; k++) {
      const a = to, b = kept[k];
      if (b.i === a.i + 1 && b.start - a.end <= long) { to = b; continue; }
      if (b.i === a.i + 1) pauses++;
      close(); from = to = b;
    }
    close();
    // Overlapping edges (two stretches closer than a joined pause) are one stretch.
    const merged = [];
    for (const s of keep) { const last = merged.at(-1); if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]); }
    return { merged, pauses };
  };
  let long = PAUSE.long, out = build(long);
  while (out.merged.length > MAX_PARTS - 20 && long < 60) { long *= 1.25; out = build(long); }
  const total = out.merged.reduce((t, [a, b]) => t + (b - a), 0);
  const cut = Math.max(0, duration - total);
  const spokenCut = kept.length < w.length;
  return { keep: out.merged, commands, pauses: out.pauses, cut: Math.round(cut * 10) / 10, changed: cut >= 0.5 || spokenCut, wordsKept: kept.map(({ word, start, end }) => ({ word, start, end })), spokenCut, warnings };
}

/** Where the time ends up after the cut: lets a frame from the original be found in the edit (thumbnails). */
export const keptSeconds = (keep) => keep.reduce((t, [a, b]) => t + (b - a), 0);

const FADE = 0.012; // seconds: enough to stop a click at a join, too short to hear

/** Cuts `src` down to the `keep` stretches into `out` (H.264 + AAC, starts playing at once). */
export async function render(src, out, keep, { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', timeout = 20 * 60_000, workFile } = {}) {
  if (!keep.length) throw new Error('Nothing left to keep.');
  if (keep.length > MAX_PARTS) throw new Error('Too many cuts to make in one video.');
  const parts = keep.map(([a, b], i) => {
    const len = Math.max(0.05, b - a), f = Math.min(FADE, len / 4);
    return `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`
      + `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${f.toFixed(3)},afade=t=out:st=${(len - f).toFixed(3)}:d=${f.toFixed(3)}[a${i}];`;
  }).join('');
  const graph = `${parts}${keep.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${keep.length}:v=1:a=1[v][a]`;
  const script = workFile || `${out}.filter.txt`;
  fs.writeFileSync(script, graph);
  try {
    await new Promise((resolve, reject) => execFile(ffmpeg, ['-y', '-v', 'error', '-i', src, '-filter_complex_script', script, '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out],
    { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(-300))) : resolve())));
  } finally { fs.rmSync(script, { force: true }); }
}

/** One line for the leader: what the editor did, in plain words. */
export function summary(p) {
  if (!p?.changed) return '';
  const bits = [];
  if (p.pauses) bits.push(`shortened ${p.pauses} long pause${p.pauses === 1 ? '' : 's'}`);
  const said = p.commands.map((c) => `“${c.cmd}”`);
  if (said.length) bits.push(`followed ${said.length === 1 ? 'your' : `your ${said.length}`} Mango command${said.length === 1 ? '' : 's'} (${said.join(', ')})`);
  const s = bits.join(' and ');
  return s ? `Edited for you: ${s}. ${Math.round(p.cut)} seconds shorter.` : '';
}

/**
 * The same sound on every lesson, whatever phone or room it was recorded in. Applied once, when the
 * phone-friendly copy is made, so the original and the edited version sound alike.
 *   highpass   takes out rumble (traffic, AC, handling the phone) below the voice
 *   afftdn     lowers the steady background hiss and hum, gently (no underwater sound)
 *   equalizer  a little warmth at 200 Hz and a little clarity at 3 kHz, so every voice sits the same way
 *   acompressor evens out loud and quiet moments, so nobody reaches for the volume
 *   loudnorm   one loudness for every lesson (-16 LUFS, the level phones and podcasts use), no clipping
 */
export const MASTER = 'highpass=f=80,afftdn=nf=-25:tn=1,equalizer=f=200:t=q:w=1:g=1.5,equalizer=f=3000:t=q:w=1.2:g=2,'
  + 'acompressor=threshold=-20dB:ratio=3:attack=10:release=150:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000';

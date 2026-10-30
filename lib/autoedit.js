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

/**
 * words: [{ word, start, end }] in order; duration: seconds; text: the transcript (to check the timings
 * cover what was said). Returns { keep: [[from, to], …], commands: [{ cmd, at }], pauses, cut, changed,
 * wordsKept, spokenCut }.
 *   changed: false means "use the video as it is" (nothing to cut, or the timings can't be trusted).
 *   spokenCut: true when words were removed (not just silence), so the transcript needs writing again.
 */
export function plan(words, duration, { text = '', trigger = TRIGGER() } = {}) {
  const none = { keep: [[0, duration]], commands: [], pauses: 0, cut: 0, changed: false, wordsKept: words || [], spokenCut: false };
  if (!Array.isArray(words) || !words.length || !(duration > 0)) return none;
  // The timings must cover what was said, or a "pause" may really be speech the timings missed.
  const spoken = String(text || '').split(/\s+/).filter(Boolean).length;
  if (spoken && words.length < spoken * 0.8) return none;

  const w = words.map((x, i) => ({ ...x, i, n: norm(x.word), keep: true }));
  const commands = [];
  // Where "back" or "redo" may reach back to: never past the last command (it already decided that part).
  let floor = 0;
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i].n !== trigger || !COMMANDS.includes(w[i + 1].n)) continue;
    const cmd = w[i + 1].n, at = w[i].start;
    commands.push({ cmd, at: Math.round(at * 10) / 10 });
    w[i].keep = w[i + 1].keep = false;
    if (cmd === 'start') for (let k = 0; k < i; k++) w[k].keep = false;
    if (cmd === 'end') { for (let k = i; k < w.length; k++) w[k].keep = false; break; }
    if (cmd === 'back' || cmd === 'redo') {
      const gap = cmd === 'back' ? PAUSE.sentence : PAUSE.point;
      // The last kept word before the command, then back through kept words until a gap that big.
      let k = i - 1;
      while (k >= floor && !w[k].keep) k--;
      while (k >= floor && w[k].keep) {
        w[k].keep = false;
        let p = k - 1;
        while (p >= floor && !w[p].keep) p--;
        if (p < floor || w[k].start - w[p].end >= gap) break;
        k = p;
      }
    }
    floor = i + 2;
    i++;
  }

  const kept = w.filter((x) => x.keep);
  if (!kept.length) return { ...none, commands, changed: false };
  // Join kept words into stretches. Neighbours that were next to each other in the recording, with a
  // natural gap, stay one stretch (the pause plays as it was). Anything else is a join.
  const half = PAUSE.keep / 2, keep = [];
  let pauses = 0, from = kept[0], to = kept[0];
  const close = () => keep.push([Math.max(0, from.start - half), Math.min(duration, to.end + half)]);
  for (let k = 1; k < kept.length; k++) {
    const a = to, b = kept[k];
    if (b.i === a.i + 1 && b.start - a.end <= PAUSE.long) { to = b; continue; }
    if (b.i === a.i + 1) pauses++;
    close(); from = to = b;
  }
  close();
  // Overlapping edges (two stretches closer than a joined pause) are one stretch.
  const merged = [];
  for (const s of keep) { const last = merged.at(-1); if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]); }
  const total = merged.reduce((t, [a, b]) => t + (b - a), 0);
  const cut = Math.max(0, duration - total);
  const spokenCut = kept.length < w.length;
  return { keep: merged, commands, pauses, cut: Math.round(cut * 10) / 10, changed: cut >= 0.5 || spokenCut, wordsKept: kept.map(({ word, start, end }) => ({ word, start, end })), spokenCut };
}

/** Where the time ends up after the cut: lets a frame from the original be found in the edit (thumbnails). */
export const keptSeconds = (keep) => keep.reduce((t, [a, b]) => t + (b - a), 0);

const FADE = 0.012; // seconds: enough to stop a click at a join, too short to hear
const MAX_PARTS = 400;

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

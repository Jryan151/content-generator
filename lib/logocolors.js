// lib/logocolors.js — the main colors of an agent's logo, offered in Brand as a highlight color.
// The logo is shrunk to 24×24 by FFmpeg and its pixels counted: see-through, near-white, near-black and
// grey pixels are skipped (they're backgrounds and outlines, not the brand), the rest are grouped and
// the three biggest groups that look different from each other come back as '#RRGGBB'.
import { runProc } from './proc.js';

async function pixels(file) {
  const r = await runProc(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=24:24:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { timeoutMs: 15000, binary: true, maxOutput: 24 * 24 * 4 });
  if (r.code !== 0) throw new Error('The logo couldn’t be read.');
  return r.stdout;
}
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
export function colorsFrom(buf, max = 3) {
  const groups = new Map();
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const [r, g, b, a] = [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
    if (a < 128) continue;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 35 || lo > 225 || hi - lo < 28) continue;   // black, white, grey
    const k = `${r >> 5},${g >> 5},${b >> 5}`;
    const x = groups.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    x.n++; x.r += r; x.g += g; x.b += b; groups.set(k, x);
  }
  const ranked = [...groups.values()].sort((a, b) => b.n - a.n).map(x => [x.r / x.n, x.g / x.n, x.b / x.n]);
  const out = [];
  for (const c of ranked) {
    if (out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 60)) out.push(c);
    if (out.length >= max) break;
  }
  return out.map(hex);
}
export async function logoColors(file) {
  try { return colorsFrom(await pixels(file)); } catch { return []; }
}

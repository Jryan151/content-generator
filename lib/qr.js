// lib/qr.js — a small QR code maker (byte mode, error correction level M, versions 1–10), so the
// two-factor setup screen can show a code to scan without any package or outside service.
// qrMatrix(text) → rows of booleans (true = dark); qrSvg(text) → an <svg> string.
const VERSIONS = [
  // [total codewords, EC codewords per block, [[blocks, data codewords per block], …]]  (level M)
  null,
  [26, 10, [[1, 16]]], [44, 16, [[1, 28]]], [70, 26, [[1, 44]]], [100, 18, [[2, 32]]], [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]], [196, 18, [[4, 31]]], [242, 22, [[2, 38], [2, 39]]], [292, 22, [[3, 36], [2, 37]]], [346, 26, [[4, 43], [1, 44]]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/* ---------------- Reed–Solomon over GF(256) ---------------- */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    g = next;
  }
  return g;
}
function ecBytes(data, n) {
  const g = generator(n), r = [...data, ...new Array(n).fill(0)];
  for (let i = 0; i < data.length; i++) { const f = r[i]; if (f) for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], f); }
  return r.slice(data.length);
}

/* ---------------- Data codewords ---------------- */
function codewords(bytes, v) {
  const [total, ec, groups] = VERSIONS[v];
  const dataLen = total - ec * groups.reduce((a, [b]) => a + b, 0);
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; data.length < dataLen; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  // Split into blocks, add error correction, interleave.
  const blocks = [];
  let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { const d = data.slice(at, at + size); at += size; blocks.push({ d, e: ecBytes(d, ec) }); }
  const out = [];
  const maxD = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < ec; i++) blocks.forEach(b => out.push(b.e[i]));
  return out;
}

/* ---------------- Matrix ---------------- */
const bch = (val, poly, shift) => { let v = val << shift; const top = Math.floor(Math.log2(poly)); while (v && Math.floor(Math.log2(v)) >= top) v ^= poly << (Math.floor(Math.log2(v)) - top); return (val << shift) | v; };
const MASKS = [
  (r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function build(v, words, mask) {
  const n = 17 + 4 * v;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));   // null = not yet set
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, dark) => { m[r][c] = dark; fixed[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Reserve format and version areas (filled below).
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); set(n - 1 - i, 8, false); }
  set(n - 8, 8, true);   // the dark module
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, n - 11 + j, false); set(n - 11 + j, i, false); }
  // Data, in the zigzag order.
  const bits = [];
  words.forEach(w => { for (let i = 7; i >= 0; i--) bits.push((w >>> i) & 1); });
  let k = 0, up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fixed[r][c]) continue;
        const bit = k < bits.length ? bits[k++] : 0;
        m[r][c] = (bit === 1) !== MASKS[mask](r, c);
      }
    }
    up = !up;
  }
  // Format info (level M = 00), BCH(15,5), masked.
  const fmt = bch((0b00 << 3) | mask, 0x537, 10) ^ 0x5412;
  const fbit = i => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fbit(14 - i);
  m[8][7] = fbit(8); m[8][8] = fbit(7); m[7][8] = fbit(6);
  for (let i = 9; i < 15; i++) m[14 - i][8] = fbit(14 - i);
  for (let i = 0; i < 8; i++) m[n - 1 - i][8] = fbit(14 - i);
  for (let i = 8; i < 15; i++) m[8][n - 15 + i] = fbit(14 - i);
  if (v >= 7) {
    const ver = bch(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) { const b = ((ver >>> i) & 1) === 1, r = Math.floor(i / 3), c = n - 11 + (i % 3); m[r][c] = b; m[c][r] = b; }
  }
  return m;
}

// Lower is better: the standard four penalty rules.
function penalty(m) {
  const n = m.length;
  let p = 0;
  const lines = [...m, ...m[0].map((_, c) => m.map(row => row[c]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    const s = line.map(x => (x ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) { let at = s.indexOf(pat); while (at !== -1) { p += 40; at = s.indexOf(pat, at + 1); } }
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const x = m[r][c]; if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) p += 3; }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const v = VERSIONS.findIndex((x, i) => i && bytes.length <= (x[0] - x[1] * x[2].reduce((a, [b]) => a + b, 0)) - (i < 10 ? 2 : 3));
  if (v < 1) throw new Error('Too long for a QR code here.');
  const words = codewords(bytes, v);
  let best = null;
  for (let mask = 0; mask < 8; mask++) { const m = build(v, words, mask), p = penalty(m); if (!best || p < best.p) best = { m, p }; }
  return best.m;
}

export function qrSvg(text, { scale = 5, margin = 4 } = {}) {
  const m = qrMatrix(text), n = m.length, size = (n + margin * 2) * scale;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${(c + margin) * scale} ${(r + margin) * scale}h${scale}v${scale}h-${scale}z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

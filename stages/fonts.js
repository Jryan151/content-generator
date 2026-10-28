// stages/fonts.js — makes sure the caption font files are on the server, exactly as released.
//
// v15: the fonts ship with each release (assets/fonts/, with Google Fonts' licence, OFL.txt) and every
// file is checked against its SHA-256 below, so a release always renders with the fonts it was tested
// with, and a damaged or swapped font file is caught. Where a file comes from, in order:
//   1. fonts/ (where renders read them), if it's already there and matches;
//   2. assets/fonts/ in this release;
//   3. the app folder itself (Poppins-Bold.ttf is kept there on your server, not in the release zip);
//   4. Google Fonts' repository at the exact commit these were taken from (never "whatever is newest").
// A file that doesn't match its checksum is never used.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS, ROOT, HOME } from '../lib/paths.js';
import { FONTS } from '../mixer-core.js';

export const SHA256 = {
  'Poppins-SemiBold.ttf': 'd3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286',
  'Poppins-SemiBoldItalic.ttf': '16bb118aa232c9a13fa238027d24d7854dd1a1d9cbaf99b17fec4388d56b432c',
  'Poppins-Medium.ttf': '90373e7d838d32468438fc3e152dca0bdb12edcab99ea639f158790b1ba1fd05',
  'Poppins-MediumItalic.ttf': '765addf6c7c11ec3c54325cacd68cabd05df8e4b6455302d812a9b9bafd1c614',
  'Poppins-Bold.ttf': '983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c',
  'Poppins-BoldItalic.ttf': '3572ac8116a0ac7317d342262b29937bcbaf94d8f03f90df6fe666fa7e2fb43a',
};
// google/fonts, the commit the files above were taken from (October 2026).
const COMMIT = '47d54ca1ebb14fd864695f1d39dc734f39017c33';
const SOURCE = () => (process.env.FONT_SOURCE_URL || `https://github.com/google/fonts/raw/${COMMIT}/ofl/poppins/`).replace(/\/?$/, '/');
export const SHIPPED = path.join(ROOT, 'assets', 'fonts');

const shaOf = buf => crypto.createHash('sha256').update(buf).digest('hex');
const matches = (file, buf) => !SHA256[file] || shaOf(buf) === SHA256[file];
const readIf = p => { try { return fs.readFileSync(p); } catch { return null; } };

// Puts one font file in place. Returns where it came from ('in place', 'release', 'app folder', 'download').
async function place(file, log) {
  const dest = path.join(DIRS.fonts, file);
  const have = readIf(dest);
  if (have && have.length > 10000 && matches(file, have)) return 'in place';
  if (have) log(`The font ${file} on the server doesn’t match its checksum; replacing it.`);
  fs.mkdirSync(DIRS.fonts, { recursive: true });
  for (const [where, p] of [['release', path.join(SHIPPED, file)], ['app folder', path.join(HOME, file)], ['app folder', path.join(ROOT, file)]]) {
    const buf = readIf(p);
    if (buf && matches(file, buf)) { fs.writeFileSync(dest, buf); return where; }
  }
  log(`Downloading font ${file}…`);
  let res;
  try { res = await fetch(SOURCE() + file, { signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw new Error(`Couldn't download the caption font ${file} (${e.cause?.code || e.message}). Put it in ${DIRS.fonts} by hand.`); }
  if (!res.ok) throw new Error(`Couldn't download ${file} (${res.status}). Put it in ${DIRS.fonts} by hand.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000 || !matches(file, buf)) throw new Error(`The download for ${file} isn’t the expected font file (its checksum doesn’t match). Put it in ${DIRS.fonts} by hand.`);
  fs.writeFileSync(dest, buf);
  return 'download';
}

export async function ensureFont(name, log = console.log) {
  const f = FONTS[name] || FONTS['Poppins SemiBold'];
  for (const file of [f.file, f.italic]) await place(file, log);
  return { dir: DIRS.fonts, family: name in FONTS ? name : 'Poppins SemiBold' };
}

// The start-up check: every font in fonts/ that's one of ours matches its checksum (a mismatched one is
// put back from the release). Returns { ok: [...], fixed: [...], bad: [...] }.
export function checkFonts() {
  const out = { ok: [], fixed: [], bad: [] };
  for (const file of Object.keys(SHA256)) {
    const p = path.join(DIRS.fonts, file), have = readIf(p);
    if (!have) continue;
    if (matches(file, have)) { out.ok.push(file); continue; }
    const good = [path.join(SHIPPED, file), path.join(HOME, file), path.join(ROOT, file)].map(readIf).find(b => b && matches(file, b));
    // No good copy to put back: set aside (never deleted), so it's fetched again, checked, when needed.
    if (good) { fs.writeFileSync(p, good); out.fixed.push(file); } else { try { fs.renameSync(p, `${p}.bad`); } catch { /* left */ } out.bad.push(file); }
  }
  return out;
}

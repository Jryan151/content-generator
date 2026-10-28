// tools/build-sheet.mjs — the build sheet that comes with every release (BUILD.json), like the sheet a
// hand-built engine ships with: a SHA-256 for every file, the checks it passed, and the Node and FFmpeg
// versions it was certified on. update.sh refuses a release whose files don't match their sheet (a
// damaged download, a file changed by hand, a zip that isn't a release).
//
//   node tools/build-sheet.mjs write <dir> [--tests "npm test: 302 passed, 0 failed; …"]
//   node tools/build-sheet.mjs verify <dir>      exit 0: every file matches; 1: it doesn't (says which)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const [cmd, dirArg, ...rest] = process.argv.slice(2);
const dir = path.resolve(dirArg || '.');
const SHEET = 'BUILD.json';
// What's never part of a release (your data and keys, and the folders the app fills itself).
const SKIP = /^(data|videos|backups|prompts|fonts|music|node_modules|releases|current|\.git)(\/|$)|^\.env$|^\.app-key(\.old)?$|^Poppins-Bold\.ttf$|^BUILD\.json$/;
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function walk(d, base = '') {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) out.push(...walk(path.join(d, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}
const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : ''; };

if (cmd === 'write') {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const ff = (/ffmpeg version (\S+)/.exec(spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { encoding: 'utf8' }).stdout || '') || [])[1] || '';
  const commit = flag('--commit') || spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || '';
  const files = Object.fromEntries(walk(dir).map(f => [f, sha(path.join(dir, f))]));
  const sheet = { app: pkg.name, version: pkg.version, builtAt: new Date().toISOString(), commit, certifiedOn: { node: process.version, ffmpeg: ff, platform: `${process.platform}-${process.arch}` }, tests: flag('--tests') || '', files };
  fs.writeFileSync(path.join(dir, SHEET), JSON.stringify(sheet, null, 1) + '\n');
  console.log(`Wrote ${SHEET}: ${pkg.version}, ${Object.keys(files).length} files, Node ${process.version}, FFmpeg ${ff || '?'}.`);
} else if (cmd === 'verify') {
  let sheet;
  try { sheet = JSON.parse(fs.readFileSync(path.join(dir, SHEET), 'utf8')); } catch { console.error(`No readable ${SHEET} in this release.`); process.exit(1); }
  const bad = [];
  for (const [f, want] of Object.entries(sheet.files || {})) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) bad.push(`missing: ${f}`);
    else if (sha(p) !== want) bad.push(`changed: ${f}`);
  }
  if (!Object.keys(sheet.files || {}).length) bad.push('the sheet lists no files');
  if (bad.length) { console.error(`This release doesn’t match its build sheet (${bad.length} file${bad.length === 1 ? '' : 's'}):\n  ${bad.slice(0, 20).join('\n  ')}`); process.exit(1); }
  console.log(`Build sheet OK: version ${sheet.version}, ${Object.keys(sheet.files).length} files match. Certified on Node ${sheet.certifiedOn?.node}, FFmpeg ${sheet.certifiedOn?.ffmpeg || '?'}${sheet.tests ? `; checks: ${sheet.tests}` : ''}.`);
} else { console.error('Usage: node tools/build-sheet.mjs write|verify <dir>'); process.exit(2); }

// test/coverage.mjs — the coverage floor (npm run test:coverage).
//
// Runs every check with Node's own coverage (no extra packages) and compares the share of the code the
// checks exercise with test/coverage-floor.json. The number can only go up:
//   - lower than the floor (by more than 0.2 points): it fails, naming what dropped;
//   - higher: the floor is raised to the new number (commit the file).
// Test files themselves don't count, nor do the browser files in public/ (they run in the browser).
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FLOOR = path.join(here, 'coverage-floor.json');
const SLACK = 0.2;

const r = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', '--test-coverage-exclude=test/**', '--test-coverage-exclude=public/**', 'test/*.test.js'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_DOTENV: '1', COVERAGE_RUN: '1' }, maxBuffer: 256 * 1024 * 1024 });
const out = `${r.stdout || ''}${r.stderr || ''}`;
const fails = /^# fail (\d+)/m.exec(out);
if (r.status !== 0 || !fails || Number(fails[1]) > 0) { console.error(out.split('\n').filter(l => /^not ok|^# (pass|fail)/.test(l)).join('\n')); console.error('The checks failed, so coverage wasn’t measured.'); process.exit(1); }
// "# all files                  |  81.23 |    72.10 |   80.55 |"
const all = /^# all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m.exec(out);
if (!all) { console.error('Couldn’t find the coverage summary in the output.'); process.exit(1); }
const now = { lines: Number(all[1]), branches: Number(all[2]), functions: Number(all[3]) };
const floor = fs.existsSync(FLOOR) ? JSON.parse(fs.readFileSync(FLOOR, 'utf8')) : null;

console.log(`Coverage: lines ${now.lines}%, branches ${now.branches}%, functions ${now.functions}%`);
if (!floor) { fs.writeFileSync(FLOOR, JSON.stringify({ ...now, setAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'); console.log('First run: saved as the floor.'); process.exit(0); }
const dropped = Object.keys(now).filter(k => now[k] < floor[k] - SLACK);
if (dropped.length) {
  console.error(`Below the floor: ${dropped.map(k => `${k} ${now[k]}% (floor ${floor[k]}%)`).join(', ')}.\nNew code needs checks of its own (see the files with the lowest numbers above).`);
  // The files with the least covered lines, to start with.
  const rows = [...out.matchAll(/^# (\S+\.m?js)\s*\|\s*([\d.]+)\s*\|/gm)].map(m => [m[1], Number(m[2])]).sort((a, b) => a[1] - b[1]).slice(0, 8);
  if (rows.length) console.error('Least covered:\n' + rows.map(([f, p]) => `  ${p}%  ${f}`).join('\n'));
  process.exit(1);
}
const raised = Object.keys(now).filter(k => now[k] > floor[k]);
if (raised.length) {
  fs.writeFileSync(FLOOR, JSON.stringify({ ...Object.fromEntries(Object.keys(now).map(k => [k, Math.max(now[k], floor[k])])), setAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`Floor raised: ${raised.map(k => `${k} ${floor[k]}% → ${now[k]}%`).join(', ')}. Commit test/coverage-floor.json.`);
} else console.log('At or above the floor.');

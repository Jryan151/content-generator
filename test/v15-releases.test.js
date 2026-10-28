// v15 Phase 5: side-by-side releases, the build sheet and the try-out on a copy of the data, with the
// real app code (a fake pm2 and a fake public health address; the try-out starts the real server).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasTools = ['curl', 'unzip', 'zip', 'tar', 'git'].every(t => spawnSync('which', [t]).status === 0) && spawnSync('git', ['-C', ROOT, 'rev-parse'], { stdio: 'ignore' }).status === 0;
const skip = !hasTools && 'needs curl, zip, tar and a git checkout';
let health;
test.before(async () => {
  health = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise(r => health.listen(0, '127.0.0.1', r));
});
test.after(() => health?.close());
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
// The app's files, as a release has them.
const files = () => spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
  .filter(f => !/^(data|videos|backups|prompts|fonts|music|node_modules)\//.test(f) && !/^(\.env|\.app-key|Poppins-Bold\.ttf)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
function copyApp(to, edit = {}) {
  for (const f of files()) { fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(to, f)); }
  for (const [f, fn] of Object.entries(edit)) fs.writeFileSync(path.join(to, f), fn(fs.readFileSync(path.join(to, f), 'utf8')));
}
// A clean environment: nothing from the test runner's own temporary folders.
function cleanEnv(extra) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NO_DOTENV: '1', KEEP_ROOT: '1', ...extra };
  return env;
}
function run(cwd, args, env) {
  return new Promise(resolve => {
    const p = spawn('bash', ['update.sh', ...args], { cwd, env });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', status => resolve({ status, out }));
  });
}
function releaseZip(dir, name, version, { breakStart = false, tamper = false } = {}) {
  const stage = path.join(dir, `stage-${name}`);
  copyApp(stage, { 'package.json': t => t.replace(/"version": "[^"]+"/, `"version": "${version}"`), ...(breakStart ? { 'server.js': t => `throw new Error('this release can’t start');\n${t}` } : {}) });
  const w = spawnSync(process.execPath, ['tools/build-sheet.mjs', 'write', stage, '--tests', 'test run'], { cwd: stage, encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  if (tamper) fs.appendFileSync(path.join(stage, 'lib', 'paths.js'), '\n// changed after the sheet was written\n');
  const zip = path.join(dir, `${name}.zip`);
  assert.equal(spawnSync('bash', ['-c', `cd "${stage}" && zip -qr "${zip}" .`]).status, 0);
  return zip;
}

test('the build sheet: written for a release, and every file is checked against it', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-test-'));
  copyApp(dir);
  const tool = path.join(dir, 'tools', 'build-sheet.mjs');
  assert.equal(spawnSync(process.execPath, [tool, 'write', dir, '--tests', 'npm test: all passed'], { encoding: 'utf8' }).status, 0);
  const sheet = JSON.parse(fs.readFileSync(path.join(dir, 'BUILD.json'), 'utf8'));
  assert.equal(sheet.certifiedOn.node, process.version);
  assert.ok(sheet.files['server.js'] && sheet.files['update.sh'] && !sheet.files['BUILD.json']);
  assert.equal(sheet.tests, 'npm test: all passed');
  let v = spawnSync(process.execPath, [tool, 'verify', dir], { encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr);
  fs.rmSync(path.join(dir, 'lib', 'queue.js'));
  v = spawnSync(process.execPath, [tool, 'verify', dir], { encoding: 'utf8' });
  assert.equal(v.status, 1);
  assert.match(v.stderr, /missing: lib\/queue\.js/);
});

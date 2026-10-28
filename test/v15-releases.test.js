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

test('side-by-side releases: move once, update next to the live one after a try-out, refuse bad releases, go back instantly', { skip, timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releases-test-'));
  const home = path.join(dir, 'generator');
  copyApp(home);
  // A version 15 zip install: it has its build sheet.
  assert.equal(spawnSync(process.execPath, ['tools/build-sheet.mjs', 'write', home], { cwd: home }).status, 0);
  fs.writeFileSync(path.join(home, 'Poppins-Bold.ttf'), 'kept in the app folder');
  fs.writeFileSync(path.join(home, 'my-notes.txt'), 'the admin’s own file');
  fs.mkdirSync(path.join(home, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(home, 'prompts', 'old.txt'), 'kept');
  const pm2 = path.join(dir, 'pm2');
  fs.writeFileSync(pm2, `#!/usr/bin/env bash\necho "$@" >> "${dir}/pm2.log"\n`, { mode: 0o755 });
  const env = cleanEnv({ PM2: pm2, TEST_CMD: 'true', HEALTH_TRIES: '3', HEALTH_URL: `http://127.0.0.1:${health.address().port}/api/health`, REHEARSAL_PORT: String(await freePort()) });
  // Some real data first: an admin account (through the app's own command).
  const made = spawnSync(process.execPath, ['admin.js', 'create-admin', 'boss@example.com'], { cwd: home, env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const accounts = () => spawnSync(process.execPath, ['admin.js', 'list'], { cwd: home, env, encoding: 'utf8' }).stdout;
  assert.match(accounts(), /boss@example\.com|admin/i);

  // 1. Move to releases: the code goes to releases/15.0.0, starters stay, data stays.
  let r = await run(home, ['--use-releases'], env);
  assert.equal(r.status, 0, r.out);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.equal(fs.readlinkSync(path.join(home, 'current')), `releases/${version}`);
  assert.ok(fs.existsSync(path.join(home, 'releases', version, 'lib', 'paths.js')));
  assert.ok(!fs.existsSync(path.join(home, 'lib')), 'the code left the app folder');
  assert.match(fs.readFileSync(path.join(home, 'server.js'), 'utf8'), /current\/server\.js/);
  assert.ok(fs.existsSync(path.join(home, 'Poppins-Bold.ttf')) && fs.existsSync(path.join(home, 'data')));
  assert.ok(fs.existsSync(path.join(home, 'my-notes.txt')) && fs.existsSync(path.join(home, 'prompts', 'old.txt')), 'files that aren’t the app’s stay where they are');
  assert.ok(!fs.existsSync(path.join(home, 'releases', version, 'my-notes.txt')));
  assert.match(accounts(), /boss@example\.com|admin/i, 'node admin.js still works, on the same data');

  // 2. An update: unpacked next to it, sheet checked, tried on a copy of the data, then switched.
  r = await run(home, [releaseZip(dir, 'next', '15.0.1')], env);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Build sheet OK/);
  assert.match(r.out, /started and changed the copy cleanly/);
  assert.equal(fs.readlinkSync(path.join(home, 'current')), 'releases/15.0.1');
  assert.equal(fs.readFileSync(path.join(home, 'releases', '.previous'), 'utf8').trim(), version);
  assert.ok(!fs.existsSync(path.join(home, 'data', 'changes.json')), 'the try-out’s data changes ran on a copy, not on the live data');
  assert.ok(/restart generator/.test(fs.readFileSync(path.join(dir, 'pm2.log'), 'utf8')));

  // 3. A release changed after its sheet was written: refused, nothing changes.
  r = await run(home, [releaseZip(dir, 'tampered', '15.0.2', { tamper: true })], env);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /doesn.t match its build sheet/);
  assert.equal(fs.readlinkSync(path.join(home, 'current')), 'releases/15.0.1');
  assert.ok(!fs.existsSync(path.join(home, 'releases', '15.0.2')));

  // 4. A release that can't start on the copy of the data: refused before it goes live.
  r = await run(home, [releaseZip(dir, 'broken', '15.0.3', { breakStart: true })], env);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /didn.t run cleanly on a copy of your data/);
  assert.equal(fs.readlinkSync(path.join(home, 'current')), 'releases/15.0.1');

  // 5. Going back is one switch.
  r = await run(home, ['--rollback'], env);
  assert.equal(r.status, 0, r.out);
  assert.equal(fs.readlinkSync(path.join(home, 'current')), `releases/${version}`);
  assert.match(accounts(), /boss@example\.com|admin/i);

  // 6. A new version whose live start fails: switched back, and the way back still points where it did.
  const prevBefore = fs.readFileSync(path.join(home, 'releases', '.previous'), 'utf8');
  const updBefore = fs.readFileSync(path.join(home, 'update.sh'), 'utf8');
  r = await run(home, [releaseZip(dir, 'nolive', '15.0.4')], { ...env, HEALTH_URL: 'http://127.0.0.1:9/api/health', HEALTH_TRIES: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /switched back/);
  assert.equal(fs.readlinkSync(path.join(home, 'current')), `releases/${version}`);
  assert.equal(fs.readFileSync(path.join(home, 'releases', '.previous'), 'utf8'), prevBefore, 'the way back is unchanged');
  assert.equal(fs.readFileSync(path.join(home, 'update.sh'), 'utf8'), updBefore, 'update.sh is the live one’s');

  // 7. More releases than are kept: the oldest go, never the live one or the one before, and it ends cleanly.
  for (const v of ['15.0.5', '15.0.6']) {
    r = await run(home, [releaseZip(dir, `r${v}`, v)], env);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Done\. Now running version/);
  }
  const kept = fs.readdirSync(path.join(home, 'releases')).filter(n => !n.startsWith('.'));
  assert.ok(kept.includes('15.0.6') && kept.includes('15.0.5'), kept.join(','));
  assert.ok(kept.length <= 3, kept.join(','));
  assert.equal(fs.readFileSync(path.join(home, 'releases', '.previous'), 'utf8').trim(), '15.0.5');
});

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

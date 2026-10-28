// update.sh: git and zip updates, with rollback when the checks fail or the site doesn't come back.
// Runs the real script against a throwaway app folder, a fake pm2 and a fake health address.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasTools = ['git', 'curl', 'unzip', 'zip', 'tar'].every(t => spawnSync('which', [t]).status === 0);
const sh = (cmd, cwd) => { const r = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(cmd + '\n' + r.stderr); return r.stdout; };

let health;
test.before(async () => {
  health = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise(r => health.listen(0, '127.0.0.1', r));
});
test.after(() => health?.close());

// A tiny "app": update.sh, a version, a file the checks look for, and some data that must survive.
function app() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-test-'));
  const live = path.join(dir, 'generator');
  fs.mkdirSync(path.join(live, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'update.sh'), path.join(live, 'update.sh'));
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(live, '.gitignore'));
  fs.writeFileSync(path.join(live, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(live, 'app.js'), 'old');
  fs.writeFileSync(path.join(live, 'checks-pass'), '');
  fs.writeFileSync(path.join(live, 'data', 'accounts.json'), '[1,2,3]');
  fs.writeFileSync(path.join(live, '.env'), 'SECRET=1');
  const pm2 = path.join(dir, 'pm2');
  fs.writeFileSync(pm2, `#!/usr/bin/env bash\necho "$@" >> "${dir}/pm2.log"\n`, { mode: 0o755 });
  return { dir, live, pm2, pm2log: () => (fs.existsSync(path.join(dir, 'pm2.log')) ? fs.readFileSync(path.join(dir, 'pm2.log'), 'utf8') : '') };
}
// Async, so the fake health server in this process can answer while update.sh runs.
function sh2(args, cwd, env) {
  return new Promise(resolve => {
    const p = spawn('bash', args, { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; }); p.stderr.on('data', d => { stderr += d; });
    p.on('close', status => resolve({ status, stdout, stderr }));
  });
}
const healthUrl = ok => (ok ? `http://127.0.0.1:${health.address().port}/api/health` : 'http://127.0.0.1:9/api/health');
const run = (a, args = [], { healthy = true, test = 'test -f checks-pass' } = {}) =>
  sh2(['update.sh', ...args], a.live, { PM2: a.pm2, TEST_CMD: test, HEALTH_TRIES: '2', HEALTH_URL: healthUrl(healthy), ALLOW_NO_BUILD_SHEET: '1', REHEARSE: '0' });
const read = (a, f) => fs.readFileSync(path.join(a.live, f), 'utf8');
function gitApp() {
  const a = app();
  sh('git init -q && git config user.email t@t && git config user.name t && git add -A && git commit -qm v1', a.live);
  sh(`git clone -q --bare generator origin.git && git -C generator remote add origin ../origin.git && git -C generator fetch -q && git -C generator branch -u origin/$(git -C generator branch --show-current)`, a.dir);
  sh(`git clone -q origin.git work && cd work && git config user.email t@t && git config user.name t`, a.dir);
  a.publish = (files, msg = 'next') => { for (const [f, c] of Object.entries(files)) { if (c === null) fs.rmSync(path.join(a.dir, 'work', f)); else fs.writeFileSync(path.join(a.dir, 'work', f), c); } sh(`git add -A && git commit -qm "${msg}" && git push -q`, path.join(a.dir, 'work')); };
  return a;
}

test('update (git): pulls, checks, restarts, and keeps data and keys', { skip: !hasTools && 'needs git, curl, zip' }, async () => {
  const a = gitApp();
  a.publish({ 'app.js': 'new', 'package.json': JSON.stringify({ version: '1.1.0' }) });
  const r = await run(a);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Now running version 1\.1\.0/);
  assert.equal(read(a, 'app.js'), 'new');
  assert.match(a.pm2log(), /restart generator --update-env/);
  assert.equal(read(a, 'data/accounts.json'), '[1,2,3]');
  assert.equal(read(a, '.env'), 'SECRET=1');
  assert.ok(fs.readdirSync(path.join(a.live, 'backups')).some(f => /^pre-update-/.test(f)), 'data backed up first');
});

test('update (git): failing checks put the old code back without restarting', { skip: !hasTools && 'needs git, curl, zip' }, async () => {
  const a = gitApp();
  a.publish({ 'app.js': 'broken', 'checks-pass': null });
  const r = await run(a);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /checks failed/);
  assert.equal(read(a, 'app.js'), 'old', 'rolled back');
  assert.ok(fs.existsSync(path.join(a.live, 'checks-pass')));
  assert.equal(a.pm2log(), '', 'the running site was never restarted');
  assert.equal(read(a, 'data/accounts.json'), '[1,2,3]');
});

test('update (git): a version that won’t start is rolled back and the old one restarted', { skip: !hasTools && 'needs git, curl, zip' }, async () => {
  const a = gitApp();
  a.publish({ 'app.js': 'crashes' });
  const r = await run(a, [], { healthy: false });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /didn.t start/);
  assert.equal(read(a, 'app.js'), 'old');
  assert.equal((a.pm2log().match(/restart/g) || []).length, 2, 'new version, then the old one again');
});

test('update (git): refuses when files were changed by hand on the server', { skip: !hasTools && 'needs git, curl, zip' }, async () => {
  const a = gitApp();
  fs.writeFileSync(path.join(a.live, 'app.js'), 'hand edit');
  const r = await run(a);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /changed on the server by hand/);
  assert.equal(read(a, 'app.js'), 'hand edit', 'nothing overwritten');
});

test('update (zip): unpacks with rollback; a bad zip can’t touch data', { skip: !hasTools && 'needs git, curl, zip' }, async () => {
  const a = app();
  const z = path.join(a.dir, 'z');
  fs.mkdirSync(path.join(z, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(z, 'app.js'), 'zipped');
  fs.writeFileSync(path.join(z, 'lib', 'added.js'), 'new file');
  fs.writeFileSync(path.join(z, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  sh('zip -qr ../good.zip .', z);
  let r = await run(a, [path.join(a.dir, 'good.zip')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(a, 'app.js'), 'zipped');
  assert.match(r.stdout, /version 2\.0\.0/);
  assert.ok(fs.readdirSync(path.join(a.live, 'backups')).some(f => /^code-before-/.test(f)), 'old code saved');

  // A zip whose checks fail: the old code comes back and the file it added is removed.
  fs.writeFileSync(path.join(z, 'app.js'), 'zipped-broken');
  fs.writeFileSync(path.join(z, 'lib', 'only-in-bad.js'), 'x');
  fs.writeFileSync(path.join(a.live, 'checks-pass.bak'), '');
  fs.rmSync(path.join(a.live, 'checks-pass'));
  fs.writeFileSync(path.join(z, 'TEST'), '');
  sh('rm -f ../bad.zip && zip -qr ../bad.zip .', z);
  fs.writeFileSync(path.join(a.live, 'checks-pass'), '');
  r = await run(a, [path.join(a.dir, 'bad.zip')], { test: 'test ! -f TEST' });
  assert.notEqual(r.status, 0);
  assert.equal(read(a, 'app.js'), 'zipped', 'the version before is back');
  assert.ok(!fs.existsSync(path.join(a.live, 'lib', 'only-in-bad.js')), 'files the bad zip added are removed');
  assert.ok(!fs.existsSync(path.join(a.live, 'TEST')));
  assert.ok(fs.existsSync(path.join(a.live, 'lib', 'added.js')), 'files that were there before stay');

  // A zip that would overwrite data or keys is refused before anything changes.
  const evil = path.join(a.dir, 'evil');
  fs.mkdirSync(path.join(evil, 'data'), { recursive: true });
  fs.writeFileSync(path.join(evil, 'data', 'accounts.json'), '[]');
  sh('zip -qr ../evil.zip .', evil);
  r = await run(a, [path.join(a.dir, 'evil.zip')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /overwrite your data/);
  assert.equal(read(a, 'data/accounts.json'), '[1,2,3]');
});

test('update.sh and .gitignore keep data, media and keys out of the code', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const p of ['/data/', '/videos/', '/backups/', '/.env', '/.app-key', '/node_modules/']) assert.ok(gi.includes(p), p);
  assert.equal(spawnSync('bash', ['-n', path.join(ROOT, 'update.sh')]).status, 0, 'update.sh is valid bash');
});

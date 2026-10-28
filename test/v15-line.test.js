// v15 Phase 2: data that can't be lost, and the video line.
//   - Saves forced onto the disk; SQLite with synchronous=FULL; fresh installs start on SQLite, and a
//     JSON server is moved once by update.sh.
//   - The nightly inspection: fixes what's safe (orphan files, gone memberships, jobs for deleted
//     workspaces, records whose file vanished) and lists the rest.
//   - Record shapes checked on save; fields a newer version added are kept.
//   - The line: leases (a dead worker's job comes back, a live one is left alone), a clean stop hands
//     jobs back without using a try, a lost lease stops the worker that lost it, the disk reserve.
//   - A separate worker process (worker.js, SQLite only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tempEnv } from './helpers.js';

const root = tempEnv();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const queue = await import('../lib/queue.js');
const proc = await import('../lib/proc.js');
const alerts = await import('../lib/alerts.js');
const shapes = await import('../lib/shapes.js');
const sched = await import('../lib/scheduler.js');
const { inspect } = await import('../lib/inspect.js');
const sqlite = paths.storageEngine() === 'sqlite';
const titles = () => alerts.listAlerts().map(a => a.title);
// (NO_DOTENV: the server's own .env, if this runs on one, must not change what these children see.)
// (No colors: run from a terminal, the test runner sets FORCE_COLOR, and console.log(true) would print a colored "true".)
const runNode = (code, env) => { const e = { ...process.env, NO_DOTENV: '1', STAY_ON_JSON: '', NO_COLOR: '1', ...env }; delete e.FORCE_COLOR; return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: e, encoding: 'utf8' }); };

/* ---------------- Saves that survive a power cut ---------------- */
test('documents are forced onto the disk (the file and its folder); caches aren’t', { skip: sqlite ? 'JSON files only' : false }, () => {
  const real = fs.fsyncSync;
  let n = 0;
  fs.fsyncSync = fd => { n++; return real(fd); };
  try {
    paths.writeJSON(path.join(paths.DIRS.data, 'durable.json'), { a: 1 });
    assert.ok(n >= 2, `synced ${n} times`);
    n = 0;
    paths.writeJSON(path.join(paths.DIRS.cache, 'scratch2.json'), { a: 1 });
    assert.equal(n, 0);
  } finally { fs.fsyncSync = real; }
});

test('a save that can’t be written in full (a full disk) leaves the document as it was', { skip: sqlite ? 'JSON files only' : false }, () => {
  const f = path.join(paths.DIRS.data, 'full-disk.json');
  paths.writeJSON(f, { keep: 'me' });
  const real = fs.writeFileSync;
  fs.writeFileSync = (target, ...rest) => { if (typeof target === 'number') { const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e; } return real(target, ...rest); };
  try { assert.throws(() => paths.writeJSON(f, { keep: 'not this', pad: 'x'.repeat(100000) }), /ENOSPC/); }
  finally { fs.writeFileSync = real; }
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { keep: 'me' });
  assert.deepEqual(fs.readdirSync(paths.DIRS.data).filter(n => n.startsWith('full-disk.json.') && n.endsWith('.tmp')), [], 'no half-written temp file left');
});

test('the database waits for the disk on every save', { skip: !sqlite ? 'SQLite only' : false }, () => {
  const d = paths.openDb(paths.DB_FILE);
  try { assert.equal(d.prepare('PRAGMA synchronous').get().synchronous, 2, 'FULL'); } finally { d.close(); }
});

test('a fresh install starts on the database; an existing one stays until update.sh moves it', () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  const env = { DATA_DIR: fresh, NODE_ENV: 'production', STORAGE_ENGINE: '' };
  const r = runNode("const p = await import('./lib/paths.js'); console.log(p.storageEngine());", env);
  assert.equal(r.stdout.trim(), 'sqlite', r.stderr);
  assert.equal(fs.readFileSync(path.join(fresh, 'storage-engine'), 'utf8').trim(), 'sqlite');
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'old-'));
  fs.writeFileSync(path.join(old, 'accounts.json'), '[]');
  assert.equal(runNode("const p = await import('./lib/paths.js'); console.log(p.storageEngine());", { ...env, DATA_DIR: old }).stdout.trim(), 'json');
  const check = runNode("const s = await import('./lib/storage.js'); console.log(s.autoMoveNeeded());", { ...env, DATA_DIR: old });
  assert.equal(check.stdout.trim(), 'true', check.stderr);
  assert.equal(runNode("const s = await import('./lib/storage.js'); console.log(s.autoMoveNeeded());", { ...env, DATA_DIR: old, STAY_ON_JSON: '1' }).stdout.trim(), 'false');
  const stay = fs.mkdtempSync(path.join(os.tmpdir(), 'stay-'));
  assert.equal(runNode("const p = await import('./lib/paths.js'); console.log(p.storageEngine());", { ...env, DATA_DIR: stay, STAY_ON_JSON: '1' }).stdout.trim(), 'json');
});

test('update.sh moves a JSON server into the database once, with the app stopped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-move-'));
  const live = path.join(dir, 'app');
  fs.mkdirSync(path.join(live, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'update.sh'), path.join(live, 'update.sh'));
  fs.writeFileSync(path.join(live, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  // A stand-in admin.js: the backup works, a move is needed, and the move is recorded.
  fs.writeFileSync(path.join(live, 'admin.js'), `// pre-update-backup, storage auto
const fs = require('fs'); const [c, s, f] = process.argv.slice(2);
if (c === 'pre-update-backup') { fs.writeFileSync(s, 'x'); process.exit(0); }
if (c === 'storage' && s === 'auto') { if (f === '--check') process.exit(fs.existsSync('moved') ? 3 : 0); fs.writeFileSync('moved', 'yes'); console.log('Moved'); }
`);
  fs.writeFileSync(path.join(live, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  const pm2 = path.join(dir, 'pm2');
  fs.writeFileSync(pm2, `#!/usr/bin/env bash\necho "$@" >> "${dir}/pm2.log"\n`, { mode: 0o755 });
  const http = await import('http');
  const health = http.createServer((q, s) => { s.writeHead(200); s.end('{}'); });
  await new Promise(r => health.listen(0, '127.0.0.1', r));
  try {
    const go = () => new Promise(resolve => {
      const p = spawn('bash', ['update.sh', '--no-pull'], { cwd: live, env: { ...process.env, PM2: pm2, TEST_CMD: 'true', HEALTH_TRIES: '2', ALLOW_NO_BUILD_SHEET: '1', REHEARSE: '0', HEALTH_URL: `http://127.0.0.1:${health.address().port}/api/health` } });
      let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
      p.on('close', status => resolve({ status, out }));
    });
    // admin.js here is CommonJS: give it a package.json that says so.
    fs.writeFileSync(path.join(live, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'commonjs' }));
    const r = await go();
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Moving your data into the database/);
    const log = fs.readFileSync(path.join(dir, 'pm2.log'), 'utf8');
    assert.ok(log.indexOf('stop generator') >= 0 && log.indexOf('stop generator') < log.indexOf('restart generator'), log);
    const again = await go();
    assert.doesNotMatch(again.out, /Moving your data/, 'only once');
  } finally { health.close(); }
});

/* ---------------- The nightly inspection ---------------- */
test('the nightly inspection fixes what’s safe and lists the rest', () => {
  const ws = store.createWorkspace({ name: 'Inspected', comped: true });
  const dir = store.videoDir(ws.id);
  const old = Date.now() / 1000 - 3 * 86400;
  // An approved video whose file is gone, one waiting for review whose file is gone, one that's fine.
  store.addVideo(ws.id, { id: '20261001T100000-aaaaaa', status: 'approved', file: 'video_20261001T100000-aaaaaa.mp4', createdAt: '2026-10-01T10:00:00.000Z' });
  store.addVideo(ws.id, { id: '20261001T110000-bbbbbb', status: 'pending', file: 'video_20261001T110000-bbbbbb.mp4', createdAt: '2026-10-01T11:00:00.000Z' });
  store.addVideo(ws.id, { id: '20261001T120000-cccccc', status: 'pending', file: 'video_20261001T120000-cccccc.mp4', createdAt: '2026-10-01T12:00:00.000Z' });
  fs.writeFileSync(path.join(dir, 'video_20261001T120000-cccccc.mp4'), 'ok');
  // Files nobody has: an old one (removed) and a fresh one (could be a video being saved right now: kept).
  fs.writeFileSync(path.join(dir, 'video_20260901T100000-dddddd.mp4'), 'orphan'); fs.utimesSync(path.join(dir, 'video_20260901T100000-dddddd.mp4'), old, old);
  fs.writeFileSync(path.join(dir, 'cover_20260901T100000-eeeeee_t500.jpg'), 'fresh orphan');
  // A deleted workspace's leftovers: its videos folder, a login's membership, a video in line.
  const goneId = 'w0000000000aa';
  fs.mkdirSync(path.join(paths.DIRS.videos, goneId), { recursive: true });
  const acc = store.createAccount({ email: 'helper@example.com', role: 'agent', workspaceId: ws.id, hash: 'x' });
  store.updateAccount(acc.id, { memberships: [{ ws: ws.id, role: 'owner' }, { ws: goneId, role: 'assistant' }] });
  const lonely = store.createAccount({ email: 'lonely@example.com', role: 'agent', workspaceId: goneId, hash: 'x' });
  const job = queue.enqueue({ ws: goneId, kind: 'video' });

  const dry = inspect({ fix: false });
  assert.ok(dry.fixed.length >= 5);
  assert.ok(fs.existsSync(path.join(dir, 'video_20260901T100000-dddddd.mp4')), 'a dry run changes nothing');

  const r = inspect();
  assert.ok(r.documents > 3);
  assert.ok(!fs.existsSync(path.join(dir, 'video_20260901T100000-dddddd.mp4')), 'old orphan removed');
  assert.ok(fs.existsSync(path.join(dir, 'cover_20260901T100000-eeeeee_t500.jpg')), 'fresh file kept');
  assert.ok(fs.existsSync(path.join(dir, 'video_20261001T120000-cccccc.mp4')), 'a known file is never touched');
  assert.ok(!fs.existsSync(path.join(paths.DIRS.videos, goneId)));
  assert.equal(store.getVideo(ws.id, '20261001T100000-aaaaaa').fileDeleted, true);
  assert.deepEqual(store.getAccount(acc.id).memberships.map(m => m.ws), [ws.id]);
  assert.equal(queue.getJob(job.id).status, 'canceled');
  assert.ok(r.problems.some(p => /waiting for review .*lost its file/.test(p)));
  assert.ok(r.problems.some(p => p.includes('lonely@example.com')));
  assert.equal(store.getAccount(lonely.id).email, 'lonely@example.com', 'a login is never removed automatically');
  // A workspace whose record can't be read is still somebody's: its members keep their access.
  const hurt = store.createWorkspace({ name: 'Hurt', comped: true });
  const member = store.createAccount({ email: 'member@example.com', role: 'agent', workspaceId: hurt.id, hash: 'x' });
  if (sqlite) { const d = paths.openDb(paths.DB_FILE), k = paths.docKey(path.join(store.wsDir(hurt.id), 'workspace.json')); d.prepare('UPDATE docs SET body = ?, prev = ? WHERE key = ?').run('{bad', '', k); d.close(); }
  else { fs.writeFileSync(path.join(store.wsDir(hurt.id), 'workspace.json'), '{bad'); fs.writeFileSync(path.join(store.wsDir(hurt.id), 'workspace.json.prev'), ''); }
  paths.onDamage(() => {});
  const r2 = inspect();
  paths.onDamage(null);
  assert.equal(store.getAccount(member.id).workspaceId, hurt.id, 'not unlinked');
  assert.ok(r2.problems.some(p => p.includes('workspace.json')));
});

/* ---------------- Shapes ---------------- */
test('records are checked against their shape on save; unknown fields are kept', async () => {
  assert.deepEqual(shapes.problemsOf('video', { id: 'v', status: 'pending' }), []);
  assert.match(shapes.problemsOf('video', { id: 'v', status: 'maybe' })[0], /allowed: pending/);
  assert.match(shapes.problemsOf('video', { id: 'v', status: 'pending', createdAt: 'yesterday' })[0], /createdAt should be iso/);
  assert.match(shapes.problemsOf('account', { id: 'a', email: 5, role: 'agent' })[0], /email should be string/);
  const ws = store.createWorkspace({ name: 'Shapes', comped: true });
  assert.throws(() => store.addVideo(ws.id, { id: 'bad', status: 'unknown' }), e => e.shape);
  assert.equal(store.readVideos(ws.id).length, 0, 'nothing saved');
  // On a real server the save goes ahead and you're told once a day.
  process.env.SHAPES = 'warn';
  const seen = [];
  shapes.onShapeProblem((p, where) => seen.push([p, where]));
  try {
    store.addVideo(ws.id, { id: 'odd', status: 'pending', duration: 'long' });
    store.addVideo(ws.id, { id: 'odd2', status: 'pending', duration: 'long' });
    assert.equal(store.readVideos(ws.id).length, 2);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][1], 'addVideo');
  } finally { delete process.env.SHAPES; shapes.onShapeProblem(null); }
  // A field a newer version added survives an edit by this version.
  store.addVideo(ws.id, { id: 'fut', status: 'pending', fromTheFuture: 'keep me' });
  store.updateVideo(ws.id, 'fut', { post: 'Edited' });
  assert.equal(store.getVideo(ws.id, 'fut').fromTheFuture, 'keep me');
  assert.equal(store.getVideo(ws.id, 'fut').post, 'Edited');
});

/* ---------------- The line ---------------- */
test('leases: a dead worker’s job comes back; a live one is left alone', () => {
  const a = queue.enqueue({ ws: 'w000000000101', kind: 'video' });
  const b = queue.enqueue({ ws: 'w000000000102', kind: 'video' });
  const c = queue.enqueue({ ws: 'w000000000103', kind: 'video' });
  const future = new Date(Date.now() + 3600000).toISOString(), past = new Date(Date.now() - 1000).toISOString();
  queue._patch(a.id, { status: 'running', attempts: 1, lease: { worker: 'otherhost:1:x', until: future } });   // alive elsewhere
  queue._patch(b.id, { status: 'running', attempts: 1, lease: { worker: 'otherhost:1:x', until: past } });     // expired
  queue._patch(c.id, { status: 'running', attempts: 1, lease: { worker: `${os.hostname()}:999999:x`, until: future } });   // this machine, process gone
  queue.recover();
  assert.equal(queue.getJob(a.id).status, 'running');
  assert.equal(queue.getJob(b.id).status, 'queued');
  assert.equal(queue.getJob(c.id).status, 'queued');
  assert.match(queue.getJob(b.id).log.at(-1), /restarted/);
  for (const j of [a, b, c]) queue._patch(j.id, { status: 'canceled' });
});

test('a clean stop hands the running video back without using its try', async () => {
  let started = 0;
  queue.startWorker(async () => { started++; await proc.runProc('sleep', ['30'], { timeoutMs: 60000 }); return {}; });
  const job = queue.enqueue({ ws: 'w000000000104', kind: 'video' });
  for (let i = 0; i < 100 && !(queue.getJob(job.id).status === 'running' && proc.runningCount()); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(queue.getJob(job.id).status, 'running');
  queue.shutdown();
  const j = queue.getJob(job.id);
  assert.equal(j.status, 'queued'); assert.equal(j.attempts, 0); assert.equal(j.lease, null);
  assert.match(j.log.at(-1), /picks up from its last finished step/);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(proc.runningCount(), 0, 'its program was stopped');
  queue.startWorker(async () => ({ ok: true }));
  await queue.idle(10000);
  assert.equal(queue.getJob(job.id).status, 'done');
  assert.equal(queue.getJob(job.id).attempts, 1);
  queue.startWorker(null);
});

test('a worker never takes back its own running job, even if its lease looks expired', async () => {
  process.env.WORKER_JOBS = '2'; process.env.LEASE_SECONDS = '1';
  const calls = [];
  try {
    queue.startWorker(async (j, log) => {
      calls.push(j.id);
      const t = Date.now(); while (Date.now() - t < 1500) { /* the machine stalls: no renewal */ }
      await new Promise(r => setTimeout(r, 300));
      return { ok: true };
    });
    const job = queue.enqueue({ ws: 'w000000000107', kind: 'video' });
    await queue.idle(15000);
    assert.deepEqual(calls, [job.id], 'made once');
    assert.equal(queue.getJob(job.id).attempts, 1);
    assert.equal(queue.getJob(job.id).status, 'done');
  } finally { delete process.env.WORKER_JOBS; delete process.env.LEASE_SECONDS; queue.startWorker(null); }
});

test('a worker that loses its lease and then fails says nothing (the new owner reports)', async () => {
  const fails = [];
  queue.startWorker(async j => {
    queue._patch(j.id, { lease: { worker: 'otherhost:3:z', until: new Date(Date.now() + 3600000).toISOString(), claim: 'theirs' } });
    throw Object.assign(new Error('boom'), { permanent: true });
  }, { failed: (j, e) => fails.push(e.message) });
  const job = queue.enqueue({ ws: 'w000000000108', kind: 'video' });
  for (let i = 0; i < 100 && queue.isBusy() === false; i++) await new Promise(r => setTimeout(r, 10));
  for (let i = 0; i < 100 && queue.isBusy(); i++) await new Promise(r => setTimeout(r, 20));
  queue.startWorker(null);
  assert.deepEqual(fails, []);
  assert.equal(queue.getJob(job.id).status, 'running', 'still the other worker’s');
  queue._patch(job.id, { status: 'canceled' });
});

test('a worker that loses its lease stops, and doesn’t overwrite the new owner', async () => {
  const job = queue.enqueue({ ws: 'w000000000105', kind: 'video' });
  let stoppedWith = null;
  queue.startWorker(async (j, log, { signal }) => {
    log('started');
    queue._patch(j.id, { lease: { worker: 'otherhost:2:y', until: new Date(Date.now() + 3600000).toISOString() } });   // taken over
    await new Promise(r => signal.addEventListener('abort', r, { once: true }));
    stoppedWith = signal.reason;
    return { fromTheLoser: true };
  });
  for (let i = 0; i < 200 && !stoppedWith; i++) await new Promise(r => setTimeout(r, 20));
  queue.startWorker(null);
  assert.match(String(stoppedWith?.message), /Another worker took over/);
  const j = queue.getJob(job.id);
  assert.equal(j.status, 'running'); assert.equal(j.lease.worker, 'otherhost:2:y');
  assert.equal(j.result, undefined, 'nothing written by the loser');
  queue._patch(job.id, { status: 'canceled' });
});

test('below the disk reserve no video starts: caches are cleared and you’re told', async () => {
  fs.mkdirSync(path.join(paths.DIRS.cache, 'clips'), { recursive: true });
  fs.writeFileSync(path.join(paths.DIRS.cache, 'clips', 'c1.mp4'), 'x');
  const hourAgo = Date.now() / 1000 - 7200;
  fs.utimesSync(path.join(paths.DIRS.cache, 'clips', 'c1.mp4'), hourAgo, hourAgo);
  fs.writeFileSync(path.join(paths.DIRS.cache, 'clips', 'c2.mp4'), 'in use');
  const low = sched.diskGate(Date.now(), () => 0.4);
  assert.equal(low.ok, false);
  assert.match(low.why, /nearly out of disk space/);
  assert.ok(!fs.existsSync(path.join(paths.DIRS.cache, 'clips', 'c1.mp4')), 'old cached clips cleared');
  assert.ok(fs.existsSync(path.join(paths.DIRS.cache, 'clips', 'c2.mp4')), 'a clip a video may be using stays');
  assert.ok(titles().includes('The server is nearly out of disk space: new videos are paused'));
  assert.equal(sched.diskGate(Date.now(), () => 20).ok, true);
  // The line waits, saying why.
  let ran = 0;
  queue.startWorker(async () => { ran++; return {}; }, { gate: () => ({ ok: false, why: 'Paused: disk' }) });
  const job = queue.enqueue({ ws: 'w000000000106', kind: 'video' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(ran, 0);
  assert.equal(queue.getJob(job.id).waitReason, 'Paused: disk');
  queue.startWorker(async () => { ran++; return {}; }, { gate: () => ({ ok: true }) });
  await queue.idle(10000);
  assert.equal(ran, 1);
  assert.equal(queue.getJob(job.id).waitReason, undefined, 'the reason goes once it’s over');
  queue.startWorker(null);
});

test('night capacity: warns when overnight videos won’t fit between 1 and 6am', () => {
  for (let i = 0; i < 12; i++) {
    const w = store.createWorkspace({ name: `Night ${i}`, comped: true });
    store.updateWorkspace(w.id, { onboarded: true });
    const cfg = store.loadConfig(w.id); cfg.schedule.keepReady = 5; store.saveConfig(w.id, cfg);
  }
  const jobs = Array.from({ length: 5 }, (_, i) => ({ status: 'done', kind: 'video', startedAt: new Date(Date.now() - 600000).toISOString(), endedAt: new Date(Date.now() - 600000 + 300000).toISOString(), id: `x${i}` }));
  const r = sched.nightCapacity({ jobs, workers: 1 });
  assert.equal(r.videos, 60); assert.equal(r.minutesEach, 5);
  assert.equal(r.hours, 5); assert.equal(r.tight, true);
  assert.equal(sched.nightCapacity({ jobs, workers: 2 }).tight, false);
});

/* ---------------- A separate worker ---------------- */
test('worker.js refuses to run on JSON files', { skip: sqlite ? 'this run is on SQLite' : false }, () => {
  const r = spawnSync(process.execPath, ['worker.js'], { cwd: ROOT, env: { ...process.env, STORAGE_ENGINE: 'json' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs the SQLite storage engine/);
});

test('a separate worker takes jobs from the shared line', { skip: !sqlite ? 'SQLite only (run with npm run test:sqlite)' : false, timeout: 60000 }, async () => {
  const job = queue.enqueue({ ws: 'w0000000009ff', kind: 'video' });   // no such workspace: it fails at once, quietly
  const w = spawn(process.execPath, ['worker.js'], { cwd: ROOT, env: { ...process.env, QUEUE_POLL_MS: '100' } });
  let out = ''; w.stdout.on('data', d => { out += d; }); w.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 300 && !['failed', 'done'].includes(queue.getJob(job.id)?.status); i++) await new Promise(r => setTimeout(r, 50));
    const j = queue.getJob(job.id);
    assert.equal(j.status, 'failed', out);
    assert.match(j.error, /no longer exists/);
    assert.equal(j.lease, null);
  } finally { w.kill('SIGTERM'); await new Promise(r => w.on('close', r)); }
});

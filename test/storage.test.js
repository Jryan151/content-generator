// SQLite storage: moving data from JSON files into data/app.db and back, with every document
// checked, and backups that work with either. (`npm run test:sqlite` runs every other test on SQLite.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { tempEnv } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
delete process.env.STORAGE_ENGINE;
const env = () => { const e = { ...process.env }; delete e.STORAGE_ENGINE; return e; };
const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), ...a], { env: env(), encoding: 'utf8' });
// Each check runs in its own process, as the server and admin.js do, so the engine is read fresh.
const node = code => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env: env(), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()) : null;
};

test('storage: migrate to SQLite (dry run first), everything reads the same, then roll back with new changes kept', async () => {
  // Some real data, made with JSON files.
  const made = node(`
    const store = await import('./lib/store.js');
    const ws = store.createWorkspace({ name: 'Moving Agency', comped: true });
    store.createAccount({ email: 'mover@example.com', role: 'agent', workspaceId: ws.id, hash: 'h' });
    store.addVideo(ws.id, { id: 'v1', status: 'pending', createdAt: '2026-10-01T00:00:00.000Z', scenes: [{ text: 'Hi “quotes” 🙂' }], meta: {} });
    store.addVideo(ws.id, { id: 'v2', status: 'approved', approval: { at: 'y' }, createdAt: '2026-10-01T00:00:00.000Z', scenes: [], meta: {} });
    const cfg = store.loadConfig(ws.id); cfg.look.name = 'Mover'; store.saveConfig(ws.id, cfg);
    console.log(JSON.stringify({ ws: ws.id }));`);
  const ws = made.ws, dataDir = process.env.DATA_DIR;
  const snapshot = `const store = await import('./lib/store.js'); const ws = '${ws}';
    console.log(JSON.stringify({ accounts: store.listAccounts().map(a => a.email), w: store.getWorkspace(ws).name, videos: store.readVideos(ws), counts: store.videoCounts(ws), name: store.loadConfig(ws).look.name, history: store.listHistory(ws).length, list: store.listWorkspaces().map(w => w.id) }));`;
  const before = node(snapshot);

  // A dry run changes nothing; a broken file stops a real migration before anything moves.
  assert.match(cli('storage', 'migrate', '--dry-run').stdout, /all read correctly\. Nothing was changed/);
  assert.equal(fs.existsSync(path.join(dataDir, 'app.db')), false);
  fs.writeFileSync(path.join(dataDir, 'broken.json'), '{nope');
  const refused = cli('storage', 'migrate');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /broken\.json/);
  assert.equal(fs.existsSync(path.join(dataDir, 'app.db')), false);
  fs.rmSync(path.join(dataDir, 'broken.json'));

  // A running server blocks it.
  fs.writeFileSync(path.join(dataDir, 'server.pid'), String(process.pid));
  assert.match(cli('storage', 'migrate').stderr, /server is running/);
  fs.rmSync(path.join(dataDir, 'server.pid'));

  const m = cli('storage', 'migrate');
  assert.equal(m.status, 0, m.stderr);
  assert.match(m.stdout, /checked each one/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'storage-engine'), 'utf8').trim(), 'sqlite');
  assert.ok(!fs.existsSync(path.join(dataDir, 'accounts.json')), 'JSON files moved aside');
  const saved = fs.readdirSync(dataDir).find(n => n.startsWith('json-before-sqlite-'));
  assert.ok(fs.existsSync(path.join(dataDir, saved, 'accounts.json')), 'and kept');
  assert.deepEqual(node(snapshot), before, 'everything reads exactly the same from SQLite');
  assert.match(cli('storage', 'status').stdout, /SQLite .*documents/);

  // New changes while on SQLite, including one from a second process at the same time.
  node(`const store = await import('./lib/store.js'); store.updateVideo('${ws}', 'v1', { status: 'rejected' }); store.updateWorkspace('${ws}', { name: 'Renamed' });`);
  const writer = i => new Promise(resolve => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', `const store = await import('./lib/store.js'); for (let j = 0; j < 25; j++) store.updateAccount(store.findAccountByEmail('mover@example.com').id, { ['n${i}_' + j]: j });`], { cwd: ROOT, env: env() });
    let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', status => resolve({ status, err }));
  });
  const results = await Promise.all([0, 1, 2, 3].map(writer));
  assert.ok(results.every(r => r.status === 0), results.map(r => r.err).join(''));
  const acc = node(`const store = await import('./lib/store.js'); console.log(JSON.stringify(store.findAccountByEmail('mover@example.com')));`);
  assert.equal(Object.keys(acc).filter(k => /^n\d_/.test(k)).length, 100, 'no update lost when two processes write at once');

  // Backups on SQLite hold a consistent snapshot, and the restore check reads it.
  const b = node(`const { backup } = await import('./lib/scheduler.js'); const off = await import('./lib/offsite.js'); const f = await backup(); console.log(JSON.stringify(await off.verifyArchive(f)));`);
  assert.equal(b.storage, 'sqlite');
  assert.ok(b.accounts >= 1 && b.workspaces >= 1 && b.videos === 2);

  // Deleting a workspace removes its documents from the database too.
  node(`const store = await import('./lib/store.js'); const ws = store.createWorkspace({ name: 'Gone' }); const data = await import('./lib/data.js'); data.deleteWorkspace(ws.id); const { jsonExists } = await import('./lib/paths.js'); console.log(JSON.stringify(jsonExists(store.wsDir(ws.id) + '/workspace.json')));`) === false || assert.fail('deleted workspace still in SQLite');

  // Roll back: the JSON files come back with the changes made on SQLite.
  const r = cli('storage', 'rollback');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(dataDir, 'storage-engine'), 'utf8').trim(), 'json');
  assert.ok(fs.readdirSync(dataDir).some(n => n.startsWith('app.db.rolled-back-')), 'the database is kept');
  const after = node(snapshot);
  assert.equal(after.w, 'Renamed');
  assert.equal(after.videos.find(v => v.id === 'v1').status, 'rejected');
  assert.equal(after.name, 'Mover');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'workspaces', ws, 'workspace.json'), 'utf8')).name, 'Renamed', 'real files again');
});

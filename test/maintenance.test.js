// Passwords, links, the overnight top-up, cleanup and backups.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { tempEnv } from './helpers.js';

tempEnv();
const auth = await import('../lib/auth.js');
const store = await import('../lib/store.js');
const { keepReady, cleanup, backup, KEEP } = await import('../lib/scheduler.js');
const { verifySignature } = await import('../lib/billing.js');
const { DIRS, readJSON, writeJSON } = await import('../lib/paths.js');
const crypto = await import('crypto');

test('passwords hash and verify; wrong ones fail', async () => {
  const h = await auth.hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$/);
  assert.equal(await auth.verifyPassword('correct horse battery', h), true);
  assert.equal(await auth.verifyPassword('wrong', h), false);
  assert.equal(await auth.verifyPassword('anything', undefined), false);
  assert.ok(auth.passwordProblem('short'));
  assert.equal(auth.passwordProblem('long enough!'), null);
});

test('links are single use and expire', () => {
  const t = auth.createLink('reset', { accountId: 'u1' });
  assert.ok(auth.peekLink(t, 'reset'));
  assert.equal(auth.peekLink(t, 'invite'), null, 'kind must match');
  assert.ok(auth.useLink(t, 'reset'));
  assert.equal(auth.useLink(t, 'reset'), null);
  const file = path.join(DIRS.data, 'tokens.json');
  const t2 = auth.createLink('reset', { accountId: 'u1' });
  const list = readJSON(file);
  list.at(-1).expiresAt = Date.now() - 1;
  writeJSON(file, (list));
  assert.equal(auth.peekLink(t2, 'reset'), null);
});

test('Stripe signatures: right secret, wrong secret, too old', () => {
  const raw = '{"id":"evt"}', t = Math.floor(Date.now() / 1000);
  const sig = s => crypto.createHmac('sha256', s).update(`${t}.${raw}`).digest('hex');
  assert.equal(verifySignature(raw, `t=${t},v1=${sig('whsec_a')}`, 'whsec_a'), true);
  assert.throws(() => verifySignature(raw, `t=${t},v1=${sig('whsec_b')}`, 'whsec_a'), /doesn’t match/);
  assert.throws(() => verifySignature(raw, `t=${t - 1000},v1=${sig('whsec_a')}`, 'whsec_a'), /too old/);
});

test('overnight top-up runs once a night, in the agent’s time zone', () => {
  const ws = store.createWorkspace({ name: 'Night', comped: true });
  store.updateWorkspace(ws.id, { onboarded: true });
  const cfg = store.loadConfig(ws.id);
  cfg.schedule.keepReady = 3; cfg.profile.timezone = 'America/Denver';
  store.saveConfig(ws.id, cfg);
  store.addVideo(ws.id, { id: 'v1', file: 'video_v1.mp4', status: 'pending', createdAt: new Date().toISOString() });
  const calls = [];
  const enqueue = (id, n, source) => { calls.push({ id, n, source }); return Array.from({ length: n }); };
  keepReady(enqueue, new Date('2026-10-14T21:00:00Z'));        // 3pm in Denver: nothing
  assert.equal(calls.length, 0);
  keepReady(enqueue, new Date('2026-10-15T09:00:00Z'));        // 3am in Denver: top up 3 - 1 pending
  assert.deepEqual(calls, [{ id: ws.id, n: 2, source: 'overnight' }]);
  keepReady(enqueue, new Date('2026-10-15T10:00:00Z'));        // same night: not again
  assert.equal(calls.length, 1);
});

test('cleanup removes old rejected videos and old files but keeps approval records', () => {
  const ws = store.createWorkspace({ name: 'Clean', comped: true });
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  const mk = (id, status, extra = {}) => { fs.writeFileSync(store.videoPath(ws.id, `video_${id}.mp4`), 'x'); store.addVideo(ws.id, { id, file: `video_${id}.mp4`, status, createdAt: old, ...extra }); };
  mk('r1', 'rejected'); mk('a1', 'approved', { approval: { at: old } }); mk('p1', 'pending'); mk('fresh', 'pending');
  const vids = readJSON(path.join(store.wsDir(ws.id), 'videos.json'));
  vids.forEach(v => { v.updatedAt = v.id === 'fresh' ? new Date().toISOString() : old; });
  writeJSON(path.join(store.wsDir(ws.id), 'videos.json'), (vids));
  const r = cleanup();
  const left = store.readVideos(ws.id);
  assert.deepEqual(left.map(v => v.id).sort(), ['a1', 'fresh']);
  assert.equal(left.find(v => v.id === 'a1').fileDeleted, true);
  assert.ok(!fs.existsSync(store.videoPath(ws.id, 'video_a1.mp4')));
  assert.ok(r.videos >= 2 && r.files >= 1);
  assert.ok(KEEP.files >= 30);
});

test('backups are written and old ones pruned', async () => {
  for (let d = 1; d <= KEEP.backups + 2; d++) fs.writeFileSync(path.join(DIRS.backups, `data-2020-01-${String(d).padStart(2, '0')}.tar.gz`), 'old');
  const file = await backup();
  assert.ok(fs.statSync(file).size > 100);
  assert.equal(fs.readdirSync(DIRS.backups).length, KEEP.backups);
});

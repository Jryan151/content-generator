// v14 Phase 5: polish by moment. Days off, good news first, a gentle restart, the rejection-streak
// question, heads-ups before limits bite, the monthly recap; pronunciation, words you never use,
// logo colors and clip checks; the cover frame picker and compliance receipt; outages that wait
// instead of failing, plain errors, readable devices and the export receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
process.env.OUTAGE_WAIT_MIN = '0.002';   // outages wait as little as allowed here (0.6 seconds)
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const MC = await import('../mindset-core.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const memory = await import('../lib/memory.js');
const push = await import('../lib/push.js');
const queue = await import('../lib/queue.js');
const { colorsFrom } = await import('../lib/logocolors.js');
const { clipChecks } = await import('../lib/library.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Moments Test', comped: true });
const base = store.loadConfig(ws.id);
base.story = { ...base.story, ...starterStory() };
base.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
base.look.name = 'Rosa Diaz';
store.saveConfig(ws.id, base);
store.updateWorkspace(ws.id, { onboarded: true });
const acc = store.createAccount({ email: 'moments@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('momentspass1') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'moments@example.com', password: 'momentspass1' });
const iso = (d = 0) => new Date(Date.now() - d * 86400000).toISOString();
const vid = (id, status, extra = {}) => ({ id, status, file: `video_${id}.mp4`, cover: `cover_${id}.jpg`, createdAt: iso(), meta: { format: 'myth', painPoint: 'Funeral costs' }, scenes: [{ text: `Opening ${id}` }], clips: [], duration: 2, ...extra });

test('days off: streaks don’t break and “never miss twice” stays quiet; the score skips them', () => {
  // 2026-10-16 is a Friday. Weekends off.
  const off = [0, 6];
  assert.equal(MC.streak(['2026-10-15', '2026-10-16'], '2026-10-16', off), 2);
  assert.equal(MC.streak(['2026-10-09', '2026-10-12'], '2026-10-12', off), 2, 'Friday then Monday is unbroken');
  assert.equal(MC.streak(['2026-10-09', '2026-10-12'], '2026-10-12'), 1, 'without days off, the weekend breaks it');
  assert.equal(MC.streak(['2026-10-09', '2026-10-10', '2026-10-12'], '2026-10-12', off), 3, 'a day off done anyway counts');
  assert.equal(MC.missedOnce(['2026-10-08'], '2026-10-12', off), true, 'missed Friday, did Thursday');
  assert.equal(MC.missedOnce(['2026-10-09'], '2026-10-12', off), false);
  assert.equal(MC.missedOnce(['2026-10-15'], '2026-10-17', off), false, 'never on a day off');
  const m = { habits: [{ id: 'h1', text: 'Call' }], checks: { h1: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'] } };
  assert.equal(MC.growthScore(m, [], { today: '2026-10-16', off }), 40, 'every working day done is a full habit score');
  assert.ok(MC.growthScore(m, [], { today: '2026-10-16' }) < 40);
});

test('pronunciation: the voice says it your way, captions keep the spelling', () => {
  const cfg = M.migrate({ ...M.DEFAULT_CONFIG, voice: { ...M.DEFAULT_CONFIG.voice, say: [{ word: 'Gallup', say: 'GAL-up' }, { word: 'gallup', say: 'dupe' }, { word: '', say: 'x' }, { word: 'IUL', say: 'eye you ell' }] } });
  assert.deepEqual(cfg.voice.say.map(x => x.word), ['Gallup', 'IUL'], 'one per word, both parts needed');
  assert.equal(M.sayIt('Families in Gallup ask about IUL. Gallupe stays.', cfg), 'Families in GAL-up ask about eye you ell. Gallupe stays.');
});

test('brand colors from the logo, made readable on video', () => {
  const px = (r, g, b, a = 255, n = 50) => Array.from({ length: n }, () => [r, g, b, a]).flat();
  const buf = Buffer.from([...px(20, 60, 160, 255, 300), ...px(255, 255, 255, 255, 400), ...px(0, 0, 0, 0, 200), ...px(220, 30, 40, 255, 100), ...px(25, 62, 158, 255, 50)]);
  assert.deepEqual(colorsFrom(buf), ['#143CA0', '#DC1E28'], 'white, see-through and near-duplicates skipped');
  const light = M.readableOnVideo('#143CA0');
  assert.notEqual(light, '#143CA0');
  assert.equal(M.accentHex({ look: { accentColor: 'brand', brandColor: '#143CA0' } }), light);
  assert.equal(M.accentHex({ look: { accentColor: 'brand', brandColor: '' } }), M.ACCENT_COLORS.sand.hex);
  const m = M.migrate({ ...M.DEFAULT_CONFIG, look: { ...M.DEFAULT_CONFIG.look, accentColor: 'brand', brandColor: 'blue' } });
  assert.equal(m.look.accentColor, 'sand', 'no brand color, no brand highlight');
});

test('uploaded clips get plain checks', () => {
  const k = clipChecks({ width: 1920, height: 1080, duration: 2 }, { duration: 75 }, 30);
  assert.deepEqual(k.filter(x => !x.ok).map(x => x.label.split(':')[0].split('.')[0]), ['Sideways', 'Under 3 seconds', 'Longer than a minute', 'Quite dark']);
  assert.equal(clipChecks({ width: 1080, height: 1920, duration: 8 }, { duration: 8 }, 120).every(x => x.ok), true);
});

test('“Not my voice” can name a word you’d never say', async () => {
  store.addVideo(ws.id, vid('nv', 'pending'));
  const r = await c.post('/api/videos/nv/reject', { reason: 'Not my voice', never: 'peace of mind' });
  assert.equal(r.data.never, 'peace of mind');
  assert.ok(store.loadConfig(ws.id).guardrails.neverUse.includes('peace of mind'));
  store.addVideo(ws.id, vid('nv2', 'pending'));
  await c.post('/api/videos/nv2/reject', { reason: 'Weak opening', never: 'ignored' });
  assert.ok(!store.loadConfig(ws.id).guardrails.neverUse.includes('ignored'), 'only with Not my voice');
});

test('cover frame picker and the compliance receipt', async () => {
  const id = 'cv1';
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=#3366aa:s=360x640:d=3', '-r', '30', '-pix_fmt', 'yuv420p', store.videoPath(ws.id, `video_${id}.mp4`)]);
  fs.writeFileSync(store.videoPath(ws.id, `cover_${id}.jpg`), 'x');
  store.addVideo(ws.id, vid(id, 'pending', { duration: 3, post: 'Post text', preflight: [{ ok: true, label: 'Captions fit' }] }));
  const f = await c.get(`/api/videos/${id}/frame?t=1.5`);
  assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/jpeg'); assert.ok(f.data.length > 500);
  const r = await c.post(`/api/videos/${id}/cover`, { t: 99 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.video.cover, /^cover_cv1_t\d+\.jpg$/); assert.ok(r.data.video.coverAt <= 3);
  assert.ok(fs.existsSync(store.videoPath(ws.id, r.data.video.cover))); assert.ok(!fs.existsSync(store.videoPath(ws.id, `cover_${id}.jpg`)), 'the old cover is removed');
  // No receipt before approval; then a full one.
  assert.equal((await c.get(`/api/videos/${id}/receipt.html`)).status, 404);
  store.updateVideo(ws.id, id, { status: 'posted', approval: { at: iso(0), byName: 'Rosa', checklist: ['Watched it'], sha256: 'abc123', file: `video_${id}.mp4` }, meta: { painPoint: 'Funeral costs', insight: 'Most families plan.', principles: ['reciprocity'], pressure: [], neverUse: ['peace of mind'], say: [{ word: 'Gallup', say: 'GAL-up' }] } });
  const rc = await c.get(`/api/videos/${id}/receipt.html`);
  assert.equal(rc.status, 200);
  const html = rc.data.toString();
  for (const x of ['Compliance receipt', 'abc123', 'Captions fit', 'Rules applied', 'peace of mind', 'Reciprocity', 'No pressure tactics found', 'Gallup → said “GAL-up”']) assert.ok(html.includes(x), x);
  assert.equal((await c.post(`/api/videos/${id}/cover`, { t: 1 })).status, 409, 'not after it’s posted');
});

test('outages wait instead of failing; real failures still fail', async () => {
  assert.equal(queue.isOutage(Object.assign(new Error('OpenAI request failed: fetch failed'), { retry: true })), true);
  assert.equal(queue.isOutage(Object.assign(new Error('OpenAI 503: down'), { retry: true, status: 503 })), true);
  assert.equal(queue.isOutage(Object.assign(new Error('Out of credit'), { code: 'insufficient_quota' })), false);
  assert.equal(queue.isOutage(Object.assign(new Error('No draft passed the checks.'), {})), false);
  assert.equal(queue.isOutage(Object.assign(new Error('x'), { permanent: true, retry: true, status: 500 })), false);
  const w4 = store.createWorkspace({ name: 'Outage', comped: true });
  let runs = 0;
  queue.startWorker(async () => { runs++; throw Object.assign(new Error('OpenAI request failed: fetch failed'), { retry: true }); });
  const job = queue.enqueue({ ws: w4.id, kind: 'video', opts: {} });
  await new Promise(r => setTimeout(r, 60));
  const j1 = queue.getJob(job.id);
  assert.equal(j1.status, 'queued'); assert.equal(j1.waits, 1); assert.equal(j1.attempts, 0, 'an outage doesn’t use up a try'); assert.ok(j1.notBefore);
  assert.match(j1.waitReason, /OpenAI isn’t answering/);
  await queue.idle(20000);
  assert.equal(queue.getJob(job.id).status, 'failed');
  assert.equal(runs, queue.MAX_OUTAGE_WAITS + queue.MAX_ATTEMPTS);
});

test('plain errors: technical text never reaches people', () => {
  assert.match(S.plainError("ENOENT: no such file or directory, open '/root/generator/data/x.json'"), /^Something went wrong on our side/);
  assert.match(S.plainError("Cannot read properties of undefined (reading 'scenes')"), /^Something went wrong/);
  assert.equal(S.plainError('That topic has no confirmed facts yet.'), 'That topic has no confirmed facts yet.');
});

test('readable devices', () => {
  assert.equal(auth.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'), 'Chrome on iPhone');
  assert.equal(auth.deviceName('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36'), 'Samsung Internet on Android');
  assert.equal(auth.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15'), 'Firefox on iPhone');
});

test('a data download leaves a receipt', async () => {
  const r = await c.get('/api/data/export');
  assert.equal(r.status, 200);
  const x = r.data;
  assert.equal(x.receipt.by, 'moments@example.com'); assert.ok(x.receipt.counts.videos >= 1); assert.ok(x.memory !== undefined);
  const me = await c.get('/api/me');
  assert.equal(me.data.workspace.lastExport.counts.videos, x.receipt.counts.videos);
  assert.ok(me.data.workspace.lastExport.at);
});

test('days off keep notifications quiet', async () => {
  const cfg = store.loadConfig(ws.id), tz = cfg.profile.timezone;
  const noon = new Date('2026-10-14T18:00:00Z');   // a Wednesday, noon in Denver
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  push.subscribe(ws.id, acc.id, { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } });
  let calls = 0;
  const fetchImpl = async () => { calls++; return { status: 201, ok: true }; };
  const off = await push.send(ws.id, { title: 't' }, { tz, now: noon, daysOff: [3], fetchImpl });
  assert.equal(off.sent, 0); assert.equal(calls, 0);
  const on = await push.send(ws.id, { title: 't' }, { tz, now: noon, daysOff: [0, 6], fetchImpl });
  assert.equal(on.sent, 1); assert.equal(calls, 1, 'a working day sends');
});

test('Review knows when videos are being made', async () => {
  queue.enqueue({ ws: ws.id, kind: 'video', opts: {} });
  const r = await c.get('/api/videos');
  assert.ok(r.data.making >= 1);
});

test('offline decisions can’t approve a newer version or overturn a later decision', async () => {
  store.addVideo(ws.id, vid('off1', 'pending', { version: 2 }));
  fs.writeFileSync(store.videoPath(ws.id, 'video_off1.mp4'), 'x');
  const all = (await c.get('/api/me')).data.checklist.map(([k]) => k);
  const stale = await c.post('/api/videos/off1/approve', { checklist: all, offline: true, version: 1, decidedAt: iso(0) });
  assert.equal(stale.status, 409); assert.match(stale.data.error, /changed since you watched it offline/);
  const ok = await c.post('/api/videos/off1/approve', { checklist: all, offline: true, version: 2, decidedAt: iso(0) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.ok(store.getVideo(ws.id, 'off1').approval.decidedOfflineAt);
  const late = await c.post('/api/videos/off1/reject', { reason: 'Other', offline: true, version: 2 });
  assert.equal(late.status, 409, 'an offline rejection doesn’t undo an approval made since');
  assert.equal(store.getVideo(ws.id, 'off1').status, 'approved');
});

test('pronunciations are only ways of saying a word', () => {
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  assert.deepEqual(M.sayProblems('GAL-up', cfg), []);
  assert.ok(M.sayProblems('guaranteed approval for everyone', cfg).length);
  assert.ok(M.sayProblems('just $9 a month', cfg).length);
  const m = M.migrate({ ...cfg, voice: { ...cfg.voice, say: [{ word: 'plan', say: 'guaranteed approval plan' }, { word: 'IUL', say: 'eye you ell' }] } });
  assert.deepEqual(m.voice.say.map(x => x.word), ['IUL'], 'anything the rules would block is dropped');
});


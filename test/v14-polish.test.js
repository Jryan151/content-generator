// v14 Phase 4: the first nine polish items. Memory seats (music and openings turned down, formats
// learned), the week ahead, the greeting, milestones, honest progress, "ready" checks and Web Push
// (encrypted for the browser and signed, checked here by decrypting it like a browser would).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const P = await import('../lib/prompts.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const memory = await import('../lib/memory.js');
const push = await import('../lib/push.js');
const queue = await import('../lib/queue.js');
const { DIRS } = await import('../lib/paths.js');
const { pickMusic } = await import('../pipeline.js');
const { writeHooks } = await import('../stages/script.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });

// A stand-in push service: records what it's sent; a path ending in /gone answers 410.
const got = [];
const pushSrv = http.createServer((req, res) => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: Buffer.concat(b) }); res.writeHead(req.url.endsWith('/gone') ? 410 : 201); res.end(); }); });
await new Promise(r => pushSrv.listen(0, '127.0.0.1', r));
const pushHost = `127.0.0.1:${pushSrv.address().port}`;
process.env.PUSH_EXTRA_HOSTS = pushHost;
test.after(() => { server.close(); stubs.close(); pushSrv.close(); });

const ws = store.createWorkspace({ name: 'Polish Test', comped: true });
const base = store.loadConfig(ws.id);
base.story = { ...base.story, ...starterStory() };
base.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
base.look.name = 'Dana Ruiz';
store.saveConfig(ws.id, base);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'polish@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('polishpass1') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'polish@example.com', password: 'polishpass1' });
const vid = (id, status, extra = {}) => ({ id, status, file: `video_${id}.mp4`, cover: `cover_${id}.jpg`, createdAt: new Date().toISOString(), meta: { format: 'myth' }, scenes: [{ text: `Opening ${id}` }], clips: [], ...extra });

test('memory: a track turned down is never picked again; an opening turned down is steered clear of; reopening takes it back', async () => {
  for (const n of ['calm.mp3', 'upbeat.mp3']) fs.writeFileSync(path.join(DIRS.music, n), 'x');
  store.addVideo(ws.id, vid('m1', 'pending', { meta: { format: 'myth', music: 'upbeat.mp3' } }));
  const r = await c.post('/api/videos/m1/reject', { reason: 'Wrong music' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.learned, 'music');
  assert.deepEqual(memory.read(ws.id).music, ['upbeat.mp3']);
  for (let k = 0; k < 20; k++) assert.equal(path.basename(pickMusic(() => {}, memory.read(ws.id).music)), 'calm.mp3');
  const logs = []; assert.equal(pickMusic(l => logs.push(l), ['calm.mp3', 'upbeat.mp3']), null); assert.match(logs[0], /turned down every track/);
  // Reopened: the lesson is taken back.
  await c.post('/api/videos/m1/reopen', {});
  assert.deepEqual(memory.read(ws.id).music, []);
  // A weak opening is remembered and reaches the prompts.
  store.addVideo(ws.id, vid('m2', 'pending', { scenes: [{ text: 'Is your family really ready?' }] }));
  assert.equal((await c.post('/api/videos/m2/reject', { reason: 'Weak opening' })).data.learned, 'opening');
  const m = await c.get('/api/memory');
  assert.equal(m.data.openingsCount, 1); assert.deepEqual(m.data.openings, ['Is your family really ready?']);
  const cfg = store.loadConfig(ws.id), picks = { ...M.roll(cfg, () => 0.3), turnedDown: ['Is your family really ready?'] };
  assert.match(JSON.stringify(P.buildPrompt(cfg, picks)), /OPENINGS THE AGENT TURNED DOWN[^]*Is your family really ready/);
  assert.match(P.buildHookPrompt(cfg, picks).user, /turned down as weak: "Is your family really ready\?"/);
  // A hook that repeats it word for word is dropped before the critic sees it.
  const ask = async () => JSON.stringify({ hooks: [{ text: 'Is your family really ready?' }] });
  assert.deepEqual(await writeHooks(cfg, picks, ask, () => {}, 2), []);
  // Two videos rejected for the same opening: reopening one keeps the lesson; reopening both clears it.
  store.addVideo(ws.id, vid('m3', 'pending', { scenes: [{ text: 'Is your family really ready?' }] }));
  await c.post('/api/videos/m3/reject', { reason: 'Weak opening' });
  await c.post('/api/videos/m2/reopen', {});
  assert.equal(memory.read(ws.id).openings.length, 1, 'm3 still teaches it');
  await c.post('/api/videos/m3/reopen', {});
  assert.equal(memory.read(ws.id).openings.length, 0);
  await c.post('/api/videos/m3/reject', { reason: 'Weak opening' });
  // Forget clears it; a bad request is refused.
  assert.equal((await c.post('/api/memory/forget', { what: 'openings' })).data.openingsCount, 0);
  assert.equal((await c.post('/api/memory/forget', { what: 'x' })).status, 400);
  // Shapes only.
  assert.deepEqual(memory.clean({ music: ['../../etc/passwd', 'a.mp3', 'a.mp3', 5], openings: [{ text: '' }, 'x'], milestones: { seen: { 'Bad Key': 1, ok_1: 'y' } } }), { music: ['passwd', 'a.mp3', '5'], openings: [], milestones: { started: '', seen: { ok_1: 'y' } } });
});

test('formats learn from approvals and rejections (90 days, 3 or more decisions)', () => {
  const now = Date.now(), v = (f, status, reason) => ({ createdAt: new Date(now - 86400000).toISOString(), status, meta: { format: f }, ...(reason ? { rejection: { reason } } : {}) });
  const t = M.tasteFrom([v('myth', 'approved'), v('myth', 'posted'), v('myth', 'approved'), v('list', 'rejected', 'Weak opening'), v('list', 'rejected', 'Too salesy'), v('list', 'approved'), v('story', 'approved'), v('story', 'rejected', 'Other'), v('story', 'rejected', 'Wrong music'), v('story', 'rejected', 'Wrong footage')], now);
  assert.equal(t.myth, 1.3); assert.ok(t.list < 1 && t.list >= 0.5); assert.equal(t.story, undefined, 'music, footage and "Other" aren’t about the format, so too few to tell');
});

test('week ahead: posting days filled by scheduled, then approved, then in-review videos', () => {
  const cfg = M.migrate(store.loadConfig(ws.id));
  cfg.schedule.autopost = { on: true, time: '09:00', days: [1, 2, 3, 4, 5], platforms: ['instagram'] };
  const mon = Date.parse('2026-10-12T16:00:00Z');   // Monday morning in Denver
  const thu = new Date(Date.parse('2026-10-15T15:00:00Z')).toISOString();
  const vs = [vid('a', 'approved'), vid('b', 'approved'), vid('c', 'pending'), vid('d', 'approved', { autopost: { status: 'scheduled', at: thu } })];
  const w = M.weekAhead(cfg, vs, mon);
  // A post scheduled by hand on a plan day is extra: the plan still posts an approved video that day.
  assert.deepEqual(w.days.filter(d => d.post).map(d => [d.day, d.has, d.extra]), [['Monday', 'approved', false], ['Tuesday', 'approved', false], ['Wednesday', 'review', false], ['Thursday', '', true], ['Friday', '', false]]);
  assert.equal(w.through, 'Tuesday'); assert.equal(w.whole, false); assert.equal(w.short, 2);
  assert.equal(w.scheduled, 1);
  assert.equal(M.weekAhead(cfg, vs, mon, { postedToday: true }).days[0].post, false, 'today’s post already went out');
  const full = M.weekAhead(cfg, [...vs, vid('e', 'approved'), vid('f', 'approved'), vid('g', 'approved')], mon);
  assert.equal(full.whole, true); assert.equal(full.short, 0); assert.equal(full.through, 'Friday');
  // On Instagram and Facebook it's still one video; a post next month isn't this week.
  const both = [...vs.slice(0, 3), vid('d', 'approved', { autopost: { status: 'scheduled', at: thu }, fbpost: { status: 'scheduled', at: thu } }), vid('h', 'approved', { autopost: { status: 'scheduled', at: '2026-11-20T15:00:00Z' } })];
  assert.equal(M.weekAhead(cfg, both, mon).scheduled, 1);
  // Days are calendar days, even across a daylight-saving change (Nov 1, 2026 in Denver).
  const dst = M.weekAhead(cfg, [], Date.parse('2026-10-30T06:30:00Z'));
  assert.deepEqual(dst.days.map(d => d.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  // Without a posting plan: the weekly goal.
  cfg.schedule.autopost.on = false;
  const off = M.weekAhead(cfg, vs, mon, { goal: 5 });
  assert.equal(off.plan, false); assert.equal(off.ready, 2); assert.equal(off.short, 1, '5 − 2 ready − 1 scheduled − 1 in review'); assert.equal(off.goal, 5);
  assert.equal(M.weekAhead(cfg, both, mon, { goal: 4 }).whole, false, '2 ready + 1 scheduled (counted once) is short of 4');
});

test('honest progress: the step a job is on, a retry, and how long videos usually take', async () => {
  const p = S.phaseOf(['Format: myth', '[1/4] Writing the script…', '  1. Hi', '[2/4] Finding footage…', 'Scene 2: the clip didn’t pass; trying another']);
  assert.deepEqual([p.step, p.of, p.label, p.retry], [2, 4, 'Finding footage…', false]);
  assert.match(p.note, /trying another/);
  assert.equal(S.phaseOf(['Failed: x', 'Trying once more…']).retry, true);
  const j = (s, e) => ({ status: 'done', kind: 'video', startedAt: new Date(s).toISOString(), endedAt: new Date(e).toISOString() });
  assert.equal(S.typicalSeconds([j(0, 100000), j(0, 120000)]), null, 'needs 3');
  assert.equal(S.typicalSeconds([j(0, 100000), j(0, 120000), j(0, 300000)]), 120);
  // Finished jobs since a time; and whether anything is still going.
  queue.enqueue({ ws: ws.id, kind: 'video', opts: {}, by: 'x' });
  const f = await c.get(`/api/jobs/finished?since=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`);
  assert.equal(f.status, 200); assert.equal(f.data.active, true); assert.deepEqual(f.data.done, []); assert.ok(f.data.now);
  const o = await c.get('/api/overview');
  assert.ok('typical' in o.data);
});

/* ---------------- Web Push ---------------- */
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
function browser() {
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const authSecret = crypto.randomBytes(16);
  return { ec, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') }, authSecret };
}
// What the browser does with an aes128gcm message (RFC 8291).
function decrypt(body, b) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const shared = b.ec.computeSecret(keyid);
  const ikm = hkdf(b.authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), b.ec.getPublicKey(), keyid]), 32);
  const d = crypto.createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const out = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(out[out.length - 1], 2, 'last-record delimiter');
  return JSON.parse(out.subarray(0, out.length - 1).toString());
}
function checkVapid(header, endpoint) {
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  const [h, p, sig] = jwt.split('.');
  const raw = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'signed with the server key');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin); assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  assert.match(claims.sub, /^(mailto:[^@\s]+@[^@\s]+\.\w+|https:\/\/)/); assert.doesNotMatch(claims.sub, /localhost/);
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'ES256');
  return k;
}

test('push: only real push services; keys checked; the key pair is made once and kept', async () => {
  assert.equal(push.okEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(push.okEndpoint('https://web.push.apple.com/QG'), true);
  assert.equal(push.okEndpoint('https://evil.example.com/x'), false);
  assert.equal(push.okEndpoint('http://fcm.googleapis.com/x'), false, 'https only');
  assert.equal(push.okEndpoint('https://fcm.googleapis.com.evil.com/x'), false);
  assert.equal(push.okEndpoint('http://127.0.0.1:1/x'), false);
  const k1 = push.vapid().publicKey; push.resetForTests();
  assert.equal(push.vapid().publicKey, k1, 'kept in data/');
  assert.equal(Buffer.from(k1, 'base64url').length, 65);
  const r = await c.post('/api/push/subscribe', { subscription: { endpoint: 'https://evil.example.com/x', keys: browser().keys } });
  assert.equal(r.status, 400);
  assert.equal((await c.post('/api/push/subscribe', { subscription: { endpoint: `http://${pushHost}/a`, keys: { p256dh: 'abc', auth: 'x' } } })).status, 400);
});

test('push: a ready video reaches the browser encrypted and signed; gone browsers are dropped; quiet hours and overnight stay quiet', async () => {
  const b = browser(), endpoint = `http://${pushHost}/sub-1`;
  const r = await c.post('/api/push/subscribe', { subscription: { endpoint, keys: b.keys } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await c.get('/api/push')).data.devices.length, 1);
  // A test message (ignores quiet hours).
  got.length = 0;
  assert.equal((await c.post('/api/push/test', {})).status, 200);
  assert.equal(got.length, 1);
  assert.equal(got[0].headers['content-encoding'], 'aes128gcm');
  assert.equal(checkVapid(got[0].headers.authorization, endpoint), (await c.get('/api/push')).data.publicKey);
  assert.equal(decrypt(got[0].body, b).title, 'Notifications are on');
  // A finished video: its opening line and cover.
  store.addVideo(ws.id, vid('n1', 'pending', { scenes: [{ text: 'Most families plan for this.' }] }));
  got.length = 0;
  const noon = new Date('2026-10-14T18:00:00Z');   // noon in Denver
  const sent = await push.send(ws.id, { title: 't', body: 'b' }, { tz: 'America/Denver', now: noon });
  assert.equal(sent.sent, 1);
  got.length = 0;
  await S.notifyReady({ ws: ws.id, kind: 'video', source: 'manual' }, { videoId: 'n1' }, { now: noon });
  assert.equal(got.length, 1);
  const msg = decrypt(got[0].body, b);
  assert.equal(msg.title, 'A new video is ready to review'); assert.equal(msg.body, 'Most families plan for this.'); assert.equal(msg.image, '/media/cover_n1.jpg');
  // v15: it opens that exact video, and carries the video so the device can fetch it ahead.
  assert.equal(msg.url, '/#/review/n1'); assert.match(msg.media || '', /^\/media\/video_n1[\w-]*\.mp4$/);
  got.length = 0;
  assert.equal(await S.notifyReady({ ws: ws.id, kind: 'video', source: 'overnight' }, { videoId: 'n1' }), null, 'overnight videos are in the morning greeting instead');
  const night = await push.send(ws.id, { title: 't' }, { tz: 'America/Denver', now: new Date('2026-10-15T05:00:00Z') });   // 11pm
  assert.equal(night.sent, 0); assert.equal(got.length, 0);
  // A browser that unsubscribed (410) is removed.
  const other = store.createAccount({ email: 'other@example.com', role: 'agent', workspaceId: ws.id, hash: 'x' });
  push.subscribe(ws.id, other.id, { endpoint: `http://${pushHost}/gone`, keys: browser().keys });
  const out = await push.send(ws.id, { title: 't' }, { tz: 'America/Denver', now: noon });
  assert.equal(out.removed, 1);
  assert.ok(!push.list(ws.id).some(s => s.endpoint.endsWith('/gone')));
  // Someone who no longer belongs (disabled, or moved to another workspace) gets nothing, and their devices go.
  const left = store.createAccount({ email: 'left@example.com', role: 'agent', workspaceId: ws.id, hash: 'x' });
  push.subscribe(ws.id, left.id, { endpoint: `http://${pushHost}/left`, keys: browser().keys });
  store.updateAccount(left.id, { disabled: true });
  got.length = 0;
  const after = await push.send(ws.id, { title: 't' }, { tz: 'America/Denver', now: noon });
  assert.ok(!got.some(g => g.url === '/left')); assert.ok(after.removed >= 1);
  assert.ok(!push.list(ws.id).some(s => s.accountId === left.id));
  // A refused message (401/403) marks the device so Account can say so.
  push.subscribe(ws.id, other.id, { endpoint: `http://${pushHost}/refuse`, keys: browser().keys });
  const r403 = await push.send(ws.id, { title: 't' }, { tz: 'America/Denver', now: noon, accountIds: [other.id], fetchImpl: async () => ({ status: 403, ok: false }) });
  assert.equal(r403.rejected, 1); assert.equal(push.list(ws.id).find(s => s.endpoint.endsWith('/refuse')).problem, 'refused');
  // Turning it off on this device.
  assert.equal((await c.post('/api/push/unsubscribe', { endpoint })).data.ok, true);
  assert.equal((await c.get('/api/push')).data.devices.length, 0);
});

test('push: one browser per entry, at most ten per person', () => {
  for (let k = 0; k < 14; k++) push.subscribe(ws.id, 'acc_many', { endpoint: `https://fcm.googleapis.com/fcm/send/${k}`, keys: browser().keys });
  push.subscribe(ws.id, 'acc_many', { endpoint: 'https://fcm.googleapis.com/fcm/send/13', keys: browser().keys });
  const mine = push.forAccount(ws.id, 'acc_many');
  assert.equal(mine.length, push.MAX_PER_ACCOUNT);
  assert.equal(new Set(mine.map(s => s.endpoint)).size, mine.length);
  assert.ok(mine.some(s => s.endpoint.endsWith('/13')));
});

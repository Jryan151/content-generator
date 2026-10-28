// v15 Phase 3: breakers, limp modes, the switchboard, the outbox and one-time keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
process.env.RETRY_BASE_MS = '5';
process.env.BREAKER_COOL_SECONDS = '0.2';
const stubs = await startStubs();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const alerts = await import('../lib/alerts.js');
const breaker = await import('../lib/breaker.js');
const switches = await import('../lib/switches.js');
const outbox = await import('../lib/outbox.js');
const ai = await import('../lib/ai.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;
const titles = () => alerts.listAlerts().map(a => a.title);
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const ws = store.createWorkspace({ name: 'Safety Agent', comped: true });
{
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
}
store.createAccount({ email: 'safe@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('safepass1234') });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const raw = (c, method, p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', cookie: c.cookie, ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, replay: r.headers.get('idempotent-replay'), data: await r.json() }));

/* ---------------- Breakers ---------------- */
test('a breaker opens after failures in a row, lets one trial through after cooling, and closes when it works', async () => {
  breaker._reset();
  const down = Object.assign(new Error('Pixabay answered 503'), { status: 503 });
  for (let i = 0; i < 4; i++) breaker.failure('pixabay', down);
  assert.equal(breaker.allow('pixabay'), true, 'four isn’t enough');
  breaker.failure('pixabay', Object.assign(new Error('bad request'), { status: 400 }));
  assert.equal(breaker.allow('pixabay'), true, 'a bad request isn’t the service being down');
  breaker.failure('pixabay', down);
  assert.equal(breaker.allow('pixabay'), false, 'open');
  assert.ok(titles().includes('Pixabay isn’t answering: paused for now'));
  await wait(250);
  assert.equal(breaker.allow('pixabay'), true, 'one trial after cooling');
  assert.equal(breaker.allow('pixabay'), false, 'only one');
  breaker.failure('pixabay', down);
  const b1 = breaker.status().find(b => b.id === 'pixabay');
  assert.equal(b1.state, 'open');
  await wait(450);
  assert.equal(breaker.allow('pixabay'), true);
  breaker.success('pixabay');
  assert.equal(breaker.status().find(b => b.id === 'pixabay').state, 'closed');
  assert.ok(titles().includes('Pixabay is answering again'));
  await assert.rejects(breaker.guard('stripe', async () => { throw Object.assign(new Error('x'), { status: 502 }); }));
});

test('an AI company whose breaker is open is skipped without being called', async () => {
  breaker._reset();
  let openaiCalls = 0;
  const oai = await listen(async (req, res) => { openaiCalls++; for await (const _ of req); json(res, 200, { choices: [{ message: { content: '{"ok":1}' } }], usage: {} }); });
  const claude = await listen(async (req, res) => { for await (const _ of req); json(res, 200, { content: [{ type: 'text', text: '{"from":"claude"}' }], usage: { input_tokens: 1, output_tokens: 1 } }); });
  const keep = { ...process.env };
  Object.assign(process.env, { OPENAI_BASE_URL: `http://127.0.0.1:${oai.address().port}/v1`, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}/v1`, AI_LADDER_QUICK: 'gpt-4o-mini,anthropic:claude-haiku-5-5' });
  try {
    for (let i = 0; i < 5; i++) breaker.failure('openai', Object.assign(new Error('down'), { outage: true }));
    assert.equal(await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'quick' }), '{"from":"claude"}');
    assert.equal(openaiCalls, 0);
    delete process.env.ANTHROPIC_API_KEY;
    const e = await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'quick' }).catch(x => x);
    assert.equal(e.outage, true, 'with nothing else, it waits like an outage');
    assert.equal(openaiCalls, 0);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep); oai.close(); claude.close(); breaker._reset();
  }
});

test('limp mode: with Pixabay down, footage comes from Pexels alone', async () => {
  breaker._reset();
  const px = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/videos/search')) return json(res, 200, { videos: Array.from({ length: 6 }, (_, i) => ({ id: 900 + i, url: `https://www.pexels.com/video/family-at-home-${900 + i}/`, image: `${stubs.base}/thumb.jpg`, video_files: [{ link: `${stubs.base}/clip/${i}.mp4`, file_type: 'video/mp4', width: 720, height: 1280 }] })) });
    json(res, 404, {});
  });
  const pix = await listen(async (req, res) => json(res, 503, { error: 'down' }));
  const keep = { ...process.env };
  Object.assign(process.env, { PIXABAY_BASE_URL: `http://127.0.0.1:${pix.address().port}/`, PEXELS_API_KEY: 'pk', PEXELS_BASE_URL: `http://127.0.0.1:${px.address().port}/videos/` });
  try {
    const { findClips } = await import('../stages/broll.js');
    const clips = await findClips([{ text: 'Planning ahead helps', keyword: 'family at home' }], { log: () => {} });
    assert.equal(clips.length, 1);
    assert.match(String(clips[0].id), /^px9\d\d$/);
    assert.ok(fs.existsSync(clips[0].file));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep); px.close(); pix.close(); breaker._reset();
  }
});

test('limp mode: the agent’s own clips can cover every scene', async () => {
  const library = await import('../lib/library.js');
  const lw = store.createWorkspace({ name: 'Own clips', comped: true });
  const dir = library.dirOf(lw.id);
  const items = ['kitchen table coffee', 'front porch wave', 'office desk smile'].map((d, i) => { fs.writeFileSync(path.join(dir, `own${i}.mp4`), 'x'); return { id: `c${i}`, file: `own${i}.mp4`, thumb: '', description: d, uses: 0 }; });
  paths.writeJSON(path.join(store.wsDir(lw.id), 'library.json'), items);
  assert.equal(library.planAll(lw.id, [{ keyword: 'porch' }, { keyword: 'kitchen' }, { keyword: 'desk' }, { keyword: 'x' }]), null, 'not enough for four scenes');
  const plan = library.planAll(lw.id, [{ keyword: 'front porch' }, { keyword: 'kitchen table' }, { keyword: 'office' }]);
  assert.deepEqual(Object.values(plan).map(c => c.id), ['c1', 'c0', 'c2'], 'best match per scene, each once');
});

/* ---------------- The switchboard ---------------- */
test('the switchboard turns a part off for everyone or one workspace, with a plain line for agents', async () => {
  const agent = await login('safe@example.com', 'safepass1234');
  const boss = await login('boss@example.com', 'bosspass1234');
  // Everyone: making videos off.
  assert.equal((await boss.post('/api/admin/switches', { name: 'videos', off: true, why: 'Upgrading FFmpeg' })).status, 200);
  const r = await agent.post('/api/jobs', { count: 1 });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /paused for maintenance/);
  assert.ok((await agent.get('/api/me')).data.notices.some(n => n.id === 'videos'));
  const board = (await boss.get('/api/admin/switches')).data;
  const v = board.switches.find(s => s.id === 'videos');
  assert.equal(v.off, true); assert.equal(v.why, 'Upgrading FFmpeg'); assert.equal(v.by, 'boss@example.com');
  assert.equal((await boss.post('/api/admin/switches', { name: 'videos', off: false })).status, 200);
  assert.notEqual((await agent.post('/api/jobs', { count: 1 })).status, 503);
  // One workspace: the coach off.
  assert.equal((await boss.post(`/api/admin/workspaces/${ws.id}/switch`, { name: 'coach', off: true })).status, 200);
  assert.equal(switches.isOn('coach'), true); assert.equal(switches.isOn('coach', store.getWorkspace(ws.id)), false);
  const coach = await agent.post('/api/coach', { message: 'Hello?' });
  assert.equal(coach.status, 503);
  assert.ok((await agent.get('/api/me')).data.notices.some(n => n.id === 'coach'));
  assert.equal((await boss.get('/api/admin/switches')).data.workspaces[0].off[0].id, 'coach');
  assert.equal((await boss.post(`/api/admin/workspaces/${ws.id}/switch`, { name: 'coach', off: false })).status, 200);
  assert.equal((await boss.post('/api/admin/switches', { name: 'nope', off: true })).status, 400);
  assert.equal((await agent.post('/api/admin/switches', { name: 'videos', off: true })).status, 403);
});

/* ---------------- The outbox ---------------- */
test('the outbox sends at once, keeps what can’t go, sends it later, and never twice', async () => {
  breaker._reset();
  let up = false, sent = [];
  outbox.register('test', async p => { if (!up) throw Object.assign(new Error('provider down'), { status: 503 }); sent.push(p.n); return { id: `x${p.n}` }; });
  const r1 = await outbox.deliver('test', { n: 1 }, { key: 'k1' });
  assert.equal(r1.queued, true);
  assert.equal((await outbox.deliver('test', { n: 1 }, { key: 'k1' })).duplicate, true, 'same key: not a second message');
  up = true;
  assert.deepEqual((await outbox.drain()).sent, 0, 'not due yet');
  assert.equal((await outbox.drain(Date.now() + 61000)).sent, 1);
  assert.deepEqual(sent, [1]);
  assert.equal((await outbox.deliver('test', { n: 1 }, { key: 'k1' })).duplicate, true, 'sent ones count too');
  const r2 = await outbox.deliver('test', { n: 2 }, { key: 'k2' });
  assert.equal(r2.sent, true); assert.equal(r2.result.id, 'x2');
  // Refused for good: not kept, the caller hears about it.
  outbox.register('test2', async () => { throw Object.assign(new Error('bad address'), { status: 422, permanent: true }); });
  await assert.rejects(outbox.deliver('test2', { n: 3 }), /bad address/);
  // Too old to be useful: given up on, and you're told.
  up = false;
  await outbox.deliver('test', { n: 4 }, { key: 'k4', ttlMs: 1000 });
  const d = await outbox.drain(Date.now() + 5000);
  assert.equal(d.expired, 1);
  assert.ok(titles().some(t => /couldn’t be sent in time/.test(t)));
  assert.ok(outbox.summary().expired >= 1);
});

test('emails go through the outbox: kept while the provider is down or emails are switched off', async () => {
  breaker._reset();
  const mail = await import('../lib/email.js');
  let ok = false, got = 0;
  const pm = await listen(async (req, res) => { for await (const _ of req); if (!ok) return json(res, 503, { Message: 'down' }); got++; json(res, 200, { MessageID: `m${got}` }); });
  Object.assign(process.env, { EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm', EMAIL_FROM: 'hello@example.com', EMAIL_API_BASE: `http://127.0.0.1:${pm.address().port}` });
  try {
    const r = await mail.send({ to: 'a@example.com', subject: 'Your videos are ready', text: 't', html: 'h' }, { key: 'review:x:2026-10-19' });
    assert.equal(r.queued, true);
    ok = true;
    await outbox.drain(Date.now() + 61000);
    assert.equal(got, 1);
    assert.equal((await mail.send({ to: 'a@example.com', subject: 'Your videos are ready', text: 't', html: 'h' }, { key: 'review:x:2026-10-19' })).duplicate, true);
    // Switched off: held, then sent once it's back on.
    switches.setGlobal('emails', true);
    assert.equal((await mail.send({ to: 'b@example.com', subject: 'Held', text: 't', html: 'h' })).queued, true);
    assert.equal(got, 1);
    await outbox.drain();
    assert.equal(got, 1, 'still held');
    switches.setGlobal('emails', false);
    await outbox.drain();
    assert.equal(got, 2);
  } finally { ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_API_BASE'].forEach(k => delete process.env[k]); pm.close(); switches.setGlobal('emails', false); }
});

/* ---------------- One-time keys ---------------- */
test('one-time keys: a double tap or a resend does the change once', async () => {
  const agent = await login('safe@example.com', 'safepass1234');
  const count = () => paths.readJSON(path.join(store.wsDir(ws.id), 'coach-notes.json'), []).length;
  const before = count();
  const a = await raw(agent, 'POST', '/api/coach/notes', { text: 'Rosa Diaz' }, { 'Idempotency-Key': 'tap-1234567890' });
  const b = await raw(agent, 'POST', '/api/coach/notes', { text: 'Rosa Diaz' }, { 'Idempotency-Key': 'tap-1234567890' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.replay, 'true');
  assert.equal(a.data.note.id, b.data.note.id);
  assert.equal(count(), before + 1);
  // Two at the same moment: still once.
  const [c, d] = await Promise.all([1, 2].map(() => raw(agent, 'POST', '/api/coach/notes', { text: 'Sam Lee' }, { 'Idempotency-Key': 'tap-abcdefghij' })));
  assert.equal(c.data.note.id, d.data.note.id);
  assert.equal(count(), before + 2);
  // A different key is a different change; no key, as before.
  await raw(agent, 'POST', '/api/coach/notes', { text: 'Sam Lee again' }, { 'Idempotency-Key': 'tap-other-12345' });
  await raw(agent, 'POST', '/api/coach/notes', { text: 'Sam Lee once more' });
  assert.equal(count(), before + 4);
  // A refusal is repeated too (the same request gets the same answer).
  const e1 = await raw(agent, 'POST', '/api/coach/notes', { text: '' }, { 'Idempotency-Key': 'tap-empty-1234' });
  const e2 = await raw(agent, 'POST', '/api/coach/notes', { text: '' }, { 'Idempotency-Key': 'tap-empty-1234' });
  assert.equal(e1.status, 400); assert.equal(e2.status, 400);
  // Keys are per person.
  const assist = store.createAccount({ email: 'other@example.com', role: 'agent', workspaceId: store.createWorkspace({ name: 'Other', comped: true }).id, hash: await auth.hashPassword('otherpass1234') });
  void assist;
  const other = await login('other@example.com', 'otherpass1234');
  const o = await raw(other, 'POST', '/api/coach/notes', { text: 'Rosa Diaz' }, { 'Idempotency-Key': 'tap-1234567890' });
  assert.notEqual(o.replay, 'true');
});

/* ---------------- Review fixes ---------------- */
test('timeouts count as the service being down; an empty account or a bad setting doesn’t', () => {
  assert.equal(breaker.isServiceFailure(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), true);
  assert.equal(breaker.isServiceFailure(new Error('OpenAI didn’t answer in time')), true);
  assert.equal(breaker.isServiceFailure(Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' })), false);
  assert.equal(breaker.isServiceFailure(Object.assign(new Error('no key'), { code: 'config' })), false);
  assert.equal(breaker.isServiceFailure(Object.assign(new Error('nope'), { status: 503, permanent: true })), false);
});

test('calls already on their way when a breaker opens don’t make its cool-down longer', async () => {
  breaker._reset();
  const down = Object.assign(new Error('down'), { status: 503 });
  for (let i = 0; i < 5; i++) breaker.failure('pexels', down);
  const read = () => paths.readJSON(path.join(paths.DIRS.data, 'breakers.json'), {}).pexels;
  const first = read();
  for (let i = 0; i < 10; i++) breaker.failure('pexels', down);   // stragglers
  assert.equal(read().cool, first.cool);
  assert.equal(read().until, first.until);
  // A failed trial does make it longer (doubled).
  await wait(250);
  assert.equal(breaker.allow('pexels'), true);
  breaker.failure('pexels', down);
  assert.equal(read().cool, first.cool * 2);
  // A trial that's never used is given back (another can go at once).
  await wait(450);
  assert.equal(breaker.allow('pexels'), true);
  breaker.release('pexels');
  assert.equal(breaker.allow('pexels'), true);
  breaker._reset();
});

test('posting ticks: one trial after the cool-down, given back when nothing is due', async () => {
  breaker._reset();
  const ig = await import('../lib/instagram.js');
  const keep = { ...process.env };
  Object.assign(process.env, { INSTAGRAM_APP_ID: 'a', INSTAGRAM_APP_SECRET: 'b' });
  try {
    assert.equal(ig.igOn(), true, 'the tick really runs');
    for (let i = 0; i < 5; i++) breaker.failure('instagram', Object.assign(new Error('down'), { status: 503 }));
    assert.deepEqual(await ig.tick(), [], 'open: nothing tried');
    await wait(250);
    await ig.tick();   // the trial: nothing due here, so it's given back
    assert.equal(breaker.allow('instagram'), true, 'the trial was given back');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep); breaker._reset();
  }
});

test('a workspace’s own switches: its emails are held, its coach helpers refuse, its videos wait', async () => {
  breaker._reset();
  const agent = await login('safe@example.com', 'safepass1234');
  const boss = await login('boss@example.com', 'bosspass1234');
  let sent = 0;
  outbox.register('test3', async () => { sent++; return {}; });
  await boss.post(`/api/admin/workspaces/${ws.id}/switch`, { name: 'coach', off: true });
  try {
    for (const [p, body] of [['/api/script', { brief: 'x' }], ['/api/coach/try', { text: 'x' }]]) {
      const r = await agent.post(p, body);
      assert.equal(r.status, 503, p);
      assert.match(r.data.error, /coach is paused/);
    }
  } finally { await boss.post(`/api/admin/workspaces/${ws.id}/switch`, { name: 'coach', off: false }); }
  // Push and email: the 'emails' switch for this workspace only.
  store.updateWorkspace(ws.id, switches.workspacePatch(store.getWorkspace(ws.id), 'emails', true));
  outbox.register('email-like', async () => { sent++; return {}; });
  try {
    // (The outbox's own switch rule: emails → 'emails'; another kind → its own name.)
    const mail = await import('../lib/email.js');
    void mail;
    const held = await outbox.deliver('email', { to: 'x@example.com', subject: 's', text: 't' }, { ws: ws.id }).catch(e => e);
    assert.equal(held.queued, true); assert.equal(held.why, 'paused');
    assert.equal((await outbox.deliver('test3', { n: 1 }, { ws: ws.id })).sent, true, 'other kinds aren’t held by the email switch');
  } finally { store.updateWorkspace(ws.id, switches.workspacePatch(store.getWorkspace(ws.id), 'emails', false)); }
  // Videos: the line skips this workspace's jobs while its switch is off.
  const queue = await import('../lib/queue.js');
  store.updateWorkspace(ws.id, switches.workspacePatch(store.getWorkspace(ws.id), 'videos', true));
  try {
    const r = await agent.post('/api/jobs', { count: 1 });
    assert.equal(r.status, 503, 'can’t ask for new ones either');
    assert.equal(switches.isOn('videos', store.getWorkspace(ws.id)), false);
    assert.equal(switches.isOn('videos'), true, 'everyone else carries on');
    void queue;
  } finally { store.updateWorkspace(ws.id, switches.workspacePatch(store.getWorkspace(ws.id), 'videos', false)); }
});

test('a video made with captions only (voice down) drops the post’s AI voice note', async () => {
  const { dropAiVoiceNote } = await import('../pipeline.js');
  const { AI_VOICE_NOTE } = await import('../mixer-core.js');
  assert.equal(dropAiVoiceNote(`Plan ahead.\n${AI_VOICE_NOTE}\nLicensed in TX.`), 'Plan ahead.\nLicensed in TX.');
  assert.equal(dropAiVoiceNote('No note here.'), 'No note here.');
  assert.equal(dropAiVoiceNote(null), null);
});

test('a message caught mid-send by a restart is sent later, not stuck as a false duplicate', async () => {
  breaker._reset();
  let n = 0;
  outbox.register('test4', async () => { n++; return {}; });
  const file = path.join(paths.DIRS.data, 'outbox.json');
  const t = Date.now();
  paths.updateJSON(file, [], all => [...all, { id: 'ob_stuck', kind: 'test4', key: 'stuck-1', payload: {}, status: 'sending', sendingAt: new Date(t - 5000).toISOString(), attempts: 0, createdAt: new Date(t - 5000).toISOString(), expiresAt: new Date(t + 86400000).toISOString(), nextAt: new Date(t).toISOString() }]);
  outbox.recover(t);   // just restarted: too fresh to touch (another process may be sending it)
  assert.equal(outbox.list().find(m => m.id === 'ob_stuck').status, 'sending');
  assert.ok(outbox.summary().waiting >= 1, 'shown as waiting in Admin');
  await outbox.drain(t + 3 * 60000);
  assert.equal(n, 1);
  assert.equal(outbox.list().find(m => m.id === 'ob_stuck').status, 'sent');
});

test('footage: an unreadable answer isn’t counted as the site being down', async () => {
  breaker._reset();
  let asked = 0;
  const pix = await listen(async (req, res) => { asked++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('<html>oops'); });
  const keep = { ...process.env };
  Object.assign(process.env, { PIXABAY_BASE_URL: `http://127.0.0.1:${pix.address().port}/` });
  delete process.env.PEXELS_API_KEY;
  try {
    const { findClips } = await import('../stages/broll.js');
    for (let i = 0; i < 2; i++) await findClips([{ text: 'x', keyword: `odd answer ${i}` }], { log: () => {} }).catch(e => e);
    assert.ok(asked >= 5, `asked ${asked} times: enough that it would have opened if these counted`);
    assert.equal(breaker.status().find(b => b.id === 'pixabay').state, 'closed');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep); pix.close(); breaker._reset();
  }
});

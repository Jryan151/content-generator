// The server: logins, invites, setup, workspace isolation, approvals, records, billing and limits.
// Runs against a temp data folder with the render worker off, so nothing calls OpenAI or renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { tempEnv, client } from './helpers.js';

tempEnv();
delete process.env.OPENAI_API_KEY;
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => server.close());

const admin = client(port);
store.createAccount({ email: 'admin@example.com', name: 'Admin', role: 'admin', hash: await auth.hashPassword('adminpass123') });

async function newAgent(email, name) {
  const r = await admin.post('/api/admin/invite', { email, workspaceName: name, comped: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const token = r.data.link.split('/').pop();
  const c = client(port);
  const ok = await c.post('/api/link/accept', { token, kind: 'invite', name, password: 'agentpass123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return { c, ws: r.data.workspaceId, token };
}
async function finishSetup(c) {
  const d = await c.post('/api/setup/draft', { answers: { name: 'Jane Smith', location: 'Gallup, NM', products: ['final_expense'] } });
  assert.equal(d.status, 200);
  d.data.config.story.insights.slice(0, 3).forEach(i => { i.confirmed = true; i.source = 'Carrier guide'; });
  return c.post('/api/setup/finish', { config: d.data.config, accept: true });
}
function fakeVideo(ws, status = 'pending') {
  const id = store.newId ? store.newId() : String(Date.now());
  const file = `video_${id}.mp4`;
  fs.writeFileSync(store.videoPath(ws, file), Buffer.from('fake mp4 ' + id));
  return store.addVideo(ws, { id, file, cover: '', status, createdAt: new Date().toISOString(), duration: 25, mode: 'captions', meta: { painPoint: 'Worry', insight: 'Fact', painId: 'fe_p1', format: 'question' }, scenes: [{ text: 'Hi' }], post: 'Post', clips: [], preflight: [] });
}

test('login works and is rate limited', async () => {
  assert.equal((await admin.post('/api/login', { email: 'admin@example.com', password: 'wrong-password' })).status, 401);
  const ok = await admin.post('/api/login', { email: 'admin@example.com', password: 'adminpass123' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const me = await admin.get('/api/me');
  assert.equal(me.data.account.role, 'admin');
  const c = client(port);
  for (let i = 0; i < 8; i++) await c.post('/api/login', { email: 'nobody@example.com', password: 'x' });
  assert.equal((await c.post('/api/login', { email: 'nobody@example.com', password: 'x' })).status, 429);
});

test('requests from other sites and non-JSON posts are refused', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', cookie: admin.cookie }, body: '{}' });
  assert.equal(res.status, 403);
  const form = await fetch(`http://127.0.0.1:${port}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: admin.cookie }, body: 'a=b' });
  assert.equal(form.status, 415);
});

test('invite links are single use; setup needs a confirmed fact and the agreement', async () => {
  const { c, token } = await newAgent('jane@example.com', 'Jane Smith Insurance');
  assert.equal((await client(port).post('/api/link/accept', { token, kind: 'invite', name: 'X', password: 'anotherpass1' })).status, 410);
  assert.equal((await c.post('/api/jobs', { count: 1 })).status, 409, 'no videos before setup');
  const d = await c.post('/api/setup/draft', { answers: { name: 'Jane Smith', location: 'Gallup, NM', products: ['final_expense', 'mortgage'] } });
  assert.ok(d.data.config.story.insights.length >= 16, 'templates for both products');
  assert.ok(d.data.config.story.insights.every(i => !i.confirmed));
  assert.equal((await c.post('/api/setup/finish', { config: d.data.config, accept: true })).status, 400, 'needs a confirmed fact');
  d.data.config.story.insights[0].confirmed = true;
  d.data.config.story.insights[0].confirmedAt = '2020-01-01T00:00:00.000Z';
  assert.equal((await c.post('/api/setup/finish', { config: d.data.config, accept: false })).status, 400, 'needs the agreement');
  const f = await c.post('/api/setup/finish', { config: d.data.config, accept: true });
  assert.equal(f.status, 200);
  const fact = f.data.config.story.insights[0];
  assert.equal(fact.confirmed, true);
  assert.notEqual(fact.confirmedAt, '2020-01-01T00:00:00.000Z', 'the server stamps the time, not the browser');
  assert.ok(fact.confirmedBy);
});

test('editing a fact’s wording needs a new confirmation; banned wording can’t be confirmed', async () => {
  const { c } = await newAgent('ed@example.com', 'Ed');
  await finishSetup(c);
  const { data } = await c.get('/api/config');
  const f = data.config.story.insights.find(i => i.confirmed);
  f.text = f.text.replace('usually', 'generally');
  let r = await c.put('/api/config', { config: data.config });
  assert.equal(r.data.config.story.insights.find(i => i.id === f.id).confirmed, false);
  const g = r.data.config.story.insights.find(i => i.id === f.id);
  g.confirmed = true; g.text = 'Everyone qualifies for this plan, guaranteed.';
  r = await c.put('/api/config', { config: r.data.config });
  assert.equal(r.data.config.story.insights.find(i => i.id === f.id).confirmed, false);
});

test('one agent can never see another agent’s videos, files or settings', async () => {
  const a = await newAgent('amy@example.com', 'Amy');
  const b = await newAgent('bob@example.com', 'Bob');
  const va = fakeVideo(a.ws);
  assert.equal((await a.c.get('/api/videos')).data.videos.length, 1);
  assert.equal((await b.c.get('/api/videos')).data.videos.length, 0);
  assert.equal((await b.c.post(`/api/videos/${va.id}/reject`, { reason: 'Other' })).status, 404);
  assert.equal((await b.c.get(`/media/${va.file}`)).status, 404, 'media is looked up in your own workspace only');
  assert.equal((await a.c.get(`/media/${va.file}`)).status, 200);
  assert.equal((await client(port).get(`/media/${va.file}`)).status, 401);
  assert.equal((await b.c.get('/api/admin/overview')).status, 403);
  assert.equal((await a.c.get('/api/config')).status, 200);
});

test('approval needs every checklist item; download only after approval; records are exported', async () => {
  const { c, ws } = await newAgent('cara@example.com', 'Cara');
  await finishSetup(c);
  const v = fakeVideo(ws);
  assert.equal((await c.get(`/api/videos/${v.id}/download`)).status, 403);
  assert.equal((await c.post(`/api/videos/${v.id}/approve`, { checklist: ['watched'] })).status, 400);
  const ok = await c.post(`/api/videos/${v.id}/approve`, { checklist: ['watched', 'footage', 'facts', 'rules'] });
  assert.equal(ok.status, 200);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(store.videoPath(ws, v.file))).digest('hex');
  assert.equal(ok.data.video.approval.sha256, hash);
  const dl = await c.get(`/api/videos/${v.id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal((await c.del(`/api/videos/${v.id}`)).status, 409, 'approved videos are kept as records');
  assert.equal((await c.post(`/api/videos/${v.id}/posted`, { url: 'https://example.com/x' })).status, 400);
  assert.equal((await c.post(`/api/videos/${v.id}/posted`, { url: 'https://www.instagram.com/reel/abc/' })).status, 200);
  assert.equal((await c.post(`/api/videos/${v.id}/results`, { views: 120, messages: 3 })).status, 200);
  const csv = await c.get('/api/records.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.data.toString(), new RegExp(hash));
  const stats = (await c.get('/api/videos')).data.stats;
  assert.equal(stats.totals.messages, 3);
  assert.equal(stats.topics[0].key, 'fe_p1');
});

test('rejecting a video feeds the reason to the next scripts', async () => {
  const { c, ws } = await newAgent('dan@example.com', 'Dan');
  const v = fakeVideo(ws);
  store.addRecent(ws, { videoId: v.id, hook: 'Old hook' });
  assert.equal((await c.post(`/api/videos/${v.id}/reject`, { reason: 'Wrong footage', note: 'too young' })).status, 200);
  assert.equal(store.readRecent(ws)[0].rejected, 'Wrong footage: too young');
  const st = (await c.get('/api/videos')).data.stats;
  assert.deepEqual(st.rejections, [{ reason: 'Wrong footage', count: 1 }]);
});

test('monthly limits and the queue cap are enforced', async () => {
  const { c, ws } = await newAgent('eve@example.com', 'Eve');
  await finishSetup(c);
  await admin.post(`/api/admin/workspaces/${ws}`, { videosPerMonth: 4 });
  const r = await c.post('/api/jobs', { count: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.data.jobs.length, 3);
  const r2 = await c.post('/api/jobs', { count: 3 });
  assert.equal(r2.data.jobs.length, 1, 'only one left this month');
  assert.equal((await c.post('/api/jobs', { count: 1 })).status, 402);
  await admin.post(`/api/admin/workspaces/${ws}`, { suspended: true });
  assert.equal((await c.post('/api/jobs', { count: 1 })).status, 402);
  const job = (await c.get('/api/overview')).data.jobs[0];
  assert.equal((await c.del(`/api/jobs/${job.id}`)).status, 200);
});

test('admin can open a workspace and reset a password', async () => {
  const { ws } = await newAgent('fay@example.com', 'Fay');
  assert.equal((await admin.post('/api/admin/open', { workspaceId: ws })).status, 200);
  assert.equal((await admin.get('/api/me')).data.workspace.id, ws);
  const acc = store.findAccountByEmail('fay@example.com');
  const link = (await admin.post('/api/admin/reset', { accountId: acc.id })).data.link;
  const c = client(port);
  assert.equal((await c.post('/api/link/accept', { token: link.split('/').pop(), kind: 'reset', password: 'brandnewpass1' })).status, 200);
  assert.equal((await client(port).post('/api/login', { email: 'fay@example.com', password: 'brandnewpass1' })).status, 200);
  await admin.post('/api/admin/open', { workspaceId: null });
});

test('static pages carry a strict content security policy', async () => {
  const r = await client(port).get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(r.data.toString(), /<title>Agent Reels<\/title>/);
});

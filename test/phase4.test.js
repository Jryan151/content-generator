// Phase 4: done-for-you clients on one screen, "Make 3" across them, and re-confirming their facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, client } from './helpers.js';

tempEnv();
process.env.TWO_FACTOR = 'off';
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const queue = await import('../lib/queue.js');
const audit = await import('../lib/audit.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => server.close());

function workspace(name, { managed = true, confirmed = true, staleOne = false } = {}) {
  const ws = store.createWorkspace({ name, comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach((i, k) => { i.confirmed = confirmed; i.confirmedAt = confirmed ? new Date(Date.now() - (staleOne && k === 0 ? 200 : 1) * 86400000).toISOString() : ''; });
  cfg.look.name = name;
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true, managed });
  return ws.id;
}
async function boss() {
  store.createAccount({ email: 'dfy-boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  const c = client(port);
  await c.post('/api/login', { email: 'dfy-boss@example.com', password: 'bosspass1234' });
  return c;
}

test('managed: one row per done-for-you client, needs-attention first, and Make 3 for everyone', async () => {
  const c = await boss();
  const fine = workspace('Fine Agency');
  const stale = workspace('Stale Agency', { staleOne: true });
  const none = workspace('No Facts Agency', { confirmed: false });
  workspace('Self Serve Agency', { managed: false });
  store.addVideo(fine, { id: 'v1', status: 'pending', createdAt: new Date().toISOString(), scenes: [], meta: {} });
  store.addTime(fine, { minutes: 90, note: 'tuning', by: 'x' });
  const m = (await c.get('/api/admin/managed')).data;
  assert.deepEqual(m.rows.map(r => r.name).sort(), ['Fine Agency', 'No Facts Agency', 'Stale Agency'], 'only done-for-you workspaces');
  const row = name => m.rows.find(r => r.name === name);
  assert.equal(m.rows.at(-1).name, 'Fine Agency', 'the one that needs nothing is last');
  assert.deepEqual(row('Fine Agency').attention, []);
  assert.equal(row('Fine Agency').pending, 1);
  assert.equal(row('Fine Agency').minutes, 90);
  assert.ok(row('Stale Agency').attention.some(a => /due for review/.test(a)));
  assert.equal(row('Stale Agency').facts.stale, 1);
  assert.ok(row('No Facts Agency').attention.some(a => /no confirmed facts/.test(a)));
  assert.equal(m.totals.minutes, 90);

  // Make 3 for everyone: queued where possible, a plain reason where not.
  const r = (await c.post('/api/admin/managed/make', { count: 3 })).data;
  assert.equal(r.results.length, 3);
  assert.equal(r.results.find(x => x.id === fine).queued, 3);
  assert.match(r.results.find(x => x.id === none).error, /confirm|fact/i);
  assert.equal(queue.listJobs(fine).filter(j => j.status === 'queued').length, 3);
  assert.ok(audit.list({ action: 'admin.batch' }).length >= 1);
  // Only for done-for-you workspaces, and never past the line limit.
  const self = store.listWorkspaces().find(w => w.name === 'Self Serve Agency').id;
  assert.match((await c.post('/api/admin/managed/make', { workspaceIds: [self] })).data.results[0].error, /done-for-you/);
  await c.post('/api/admin/managed/make', { workspaceIds: [fine], count: 3 });
  const third = (await c.post('/api/admin/managed/make', { workspaceIds: [fine], count: 3 })).data.results[0];
  assert.match(third.error, /in line/);
  queue.listJobs().filter(j => j.status === 'queued').forEach(j => queue.cancel(j.ws, j.id));
  // Agents can't see any of it.
  store.createAccount({ email: 'dfy-agent@example.com', role: 'agent', workspaceId: fine, hash: await auth.hashPassword('agentpass123') });
  const a = client(port); await a.post('/api/login', { email: 'dfy-agent@example.com', password: 'agentpass123' });
  assert.equal((await a.get('/api/admin/managed')).status, 403);
});

test('managed: re-confirm facts in bulk, with an attestation, skipping any that break a rule', async () => {
  const c = client(port);
  await c.post('/api/login', { email: 'dfy-boss@example.com', password: 'bosspass1234' });
  const ws = workspace('Bulk Agency', { confirmed: false });
  const cfg = store.loadConfig(ws);
  cfg.story.insights.push({ id: 'ibad', text: 'Everyone is guaranteed approval through this government program', links: [], confirmed: false, confirmedAt: '', source: '', ai: false });
  store.saveConfig(ws, cfg);
  assert.equal((await c.post(`/api/admin/workspaces/${ws}/confirm-facts`, {})).status, 400, 'needs the attestation');
  const r = (await c.post(`/api/admin/workspaces/${ws}/confirm-facts`, { attest: true })).data;
  assert.ok(r.confirmed.length >= 3);
  assert.deepEqual(r.skipped.map(x => x.id), ['ibad'], 'a fact that breaks a rule is never confirmed');
  const boss = store.findAccountByEmail('dfy-boss@example.com');
  const after = store.loadConfig(ws).story.insights;
  assert.ok(after.filter(i => i.id !== 'ibad').every(i => i.confirmed && i.confirmedBy === boss.id && i.confirmedAt), 'stamped as confirmed by you');
  assert.equal(after.find(i => i.id === 'ibad').confirmed, false);
  assert.ok(audit.list({ ws, action: 'facts.confirmed' })[0].detail.includes('confirmed by admin'));
  const self = workspace('Not Managed', { managed: false, confirmed: false });
  assert.equal((await c.post(`/api/admin/workspaces/${self}/confirm-facts`, { attest: true })).status, 409, 'agents confirm their own facts');
});

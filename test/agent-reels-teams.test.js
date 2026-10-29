// Agent Reels teams (lib/reels.js, routes/reels.js): a leader invites agents and recruits; each one's
// log saves to the team; the leader sees who needs them; nobody else's data leaks either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const roles = await import('../lib/roles.js');
const data = await import('../lib/data.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

const mkWs = (name) => {
  const ws = store.createWorkspace({ name });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory() };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  return store.getWorkspace(ws.id);
};
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const team = mkWs('Morgan’s Team'), other = mkWs('Someone Else');
store.createAccount({ email: 'morgan@example.com', name: 'Morgan', role: 'agent', workspaceId: team.id, hash: await auth.hashPassword('morganpass12345') });
store.createAccount({ email: 'kim@example.com', name: 'Kim', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('kimpass12345') });
const tokenOf = link => link.split('/#/invite/')[1];
const iso = (minsAgo = 0) => new Date(Date.now() - minsAgo * 60_000).toISOString();

let mel, jay, jayId;

test('the teammate role opens Agent Reels and nothing else', () => {
  const t = { id: 'u1', role: 'agent', memberships: [{ ws: team.id, role: 'teammate' }] };
  assert.deepEqual(roles.capsFor(t, team), ['team']);
  assert.equal(roles.portalFor(t, team), 'teammate');
  const owner = { id: 'u2', role: 'agent', workspaceId: team.id };
  assert.ok(roles.capsFor(owner, team).includes('team') && roles.capsFor(owner, team).includes('teamlead'));
  assert.deepEqual(S.unlistedRoutes(), []);
  assert.deepEqual(S.deadCaps(), []);
});

test('a leader invites a new agent, who creates a login and lands on the team', async () => {
  mel = await login('morgan@example.com', 'morganpass12345');
  const inv = await mel.post('/api/reels/invite', { email: 'jay@example.com' });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.deepEqual(inv.data.invites.map(i => i.email), ['jay@example.com']);
  const anon = client(port);
  const check = await anon.post('/api/link/check', { token: tokenOf(inv.data.link), kind: 'invite' });
  assert.equal(check.data.role, 'teammate'); assert.equal(check.data.workspace, 'Morgan’s Team'); assert.equal(check.data.existing, false);
  jay = client(port);
  const ok = await jay.post('/api/link/accept', { token: tokenOf(inv.data.link), kind: 'invite', name: 'Jay', password: 'jaypass12345', acceptTerms: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const me = (await jay.get('/api/me')).data;
  assert.equal(me.role, 'teammate'); assert.equal(me.portal, 'teammate'); assert.deepEqual(me.caps, ['team']);
  assert.equal(me.workspace.name, 'Morgan’s Team');
  assert.equal(me.workspace.used, undefined, 'a teammate doesn’t see the workspace’s video quota or spend');
  const r = (await jay.get('/api/reels/me')).data;
  assert.equal(r.role, 'agent'); assert.equal(r.team.leaderName, 'Morgan'); assert.equal(r.rev, 0);
  jayId = r.account.id;
});

test('a teammate can’t open the workspace’s videos, settings or team', async () => {
  for (const [m, p] of [['get', '/api/videos'], ['get', '/api/config'], ['get', '/api/reels/team'], ['post', '/api/reels/invite']]) {
    const res = await jay[m](p, m === 'post' ? { email: 'x@example.com' } : undefined);
    assert.equal(res.status, 403, `${m} ${p}`);
  }
});

test('sync: the log grows, checked; another device can’t overwrite it; only fresh entries can be undone', async () => {
  const add = [
    { agent_id: 'me', type: 'dial', occurred_at: iso(5) },
    { agent_id: 'me', type: 'conversation', occurred_at: iso(5), lead_id: 'L1' },
    { agent_id: 'me', type: 'app_written', occurred_at: iso(4), lead_id: 'L1', value: 720, meta: { kitchen_check: { affordable: true } } },
  ];
  const s1 = await jay.post('/api/reels/sync', { rev: 0, acts: { base: 0, add }, leads: { upsert: [{ id: 'L1', agent_id: 'me', name: 'Mrs. Private Client', stage: 'application', premium: 720, draftOn: '2026-11-20', junk: 'dropped' }] }, profile: { licensed: true } });
  assert.equal(s1.status, 200, JSON.stringify(s1.data)); assert.deepEqual(s1.data, { rev: 1, count: 3, leads: 1 });
  const bad = await jay.post('/api/reels/sync', { rev: 1, acts: { base: 3, add: [{ type: 'hack', occurred_at: iso() }] } });
  assert.equal(bad.status, 400);
  const stale = await jay.post('/api/reels/sync', { rev: 0, acts: { base: 0, add: [] } });
  assert.equal(stale.status, 409); assert.equal(stale.data.conflict, true); assert.equal(stale.data.rev, 1); assert.equal(stale.data.doc.activities.length, 3);
  const undo = await jay.post('/api/reels/sync', { rev: 1, acts: { truncateTo: 2, base: 2, add: [] } });
  assert.equal(undo.status, 200); assert.equal(undo.data.count, 2);
  // An old entry: can't be taken back.
  await jay.post('/api/reels/sync', { rev: 2, acts: { base: 2, add: [{ type: 'dial', occurred_at: iso(60 * 24) }] } });
  const old = await jay.post('/api/reels/sync', { rev: 3, acts: { truncateTo: 2, base: 2, add: [] } });
  assert.equal(old.status, 409);
  const doc = (await jay.get('/api/reels/me')).data.log;
  assert.equal(doc.leads[0].junk, undefined, 'unknown fields are dropped');
  assert.equal(doc.leads[0].draftOn, '2026-11-20');
});

test('the leader sees who needs them, never the clients’ names', async () => {
  const res = await mel.get('/api/reels/team?tz=America/Phoenix');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const p = res.data.people.find(x => x.id === jayId);
  assert.ok(p, 'Jay is on the team'); assert.equal(p.name, 'Jay');
  assert.ok(['urgent', 'watch', 'ok'].includes(p.level)); assert.ok(p.action.includes('Jay'));
  assert.ok(!JSON.stringify(res.data).includes('Private Client'), 'client names stay with the agent');
  assert.ok('duplication' in res.data && 'counts' in res.data && Array.isArray(res.data.stages));
});

test('someone who already has a login joins after logging in', async () => {
  const inv = await mel.post('/api/reels/invite', { email: 'kim@example.com' });
  assert.equal(inv.status, 200);
  const kim = await login('kim@example.com', 'kimpass12345');
  const check = await kim.post('/api/link/check', { token: tokenOf(inv.data.link), kind: 'invite' });
  assert.equal(check.data.existing, true);
  const join = await kim.post('/api/link/join', { token: tokenOf(inv.data.link) });
  assert.equal(join.status, 200, JSON.stringify(join.data));
  const acc = store.findAccountByEmail('kim@example.com');
  assert.equal(roles.membership(acc, team.id).role, 'teammate');
  assert.equal(roles.membership(acc, other.id).role, 'owner', 'still owns her own workspace');
});

test('the workspace export carries the team’s logs; taking someone off the team deletes theirs', async () => {
  const out = data.exportWorkspace(team.id);
  assert.ok(out.agentReels.people.some(p => p.accountId === jayId && p.log.activities.length === 3));
  assert.equal(data.exportCounts(out).agentReelsLogs >= 1, true);
  const del = await mel.del(`/api/reels/team/${jayId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(store.getAccount(jayId), null, 'a login with nowhere else to go is removed');
  assert.ok(!data.exportWorkspace(team.id).agentReels.people.some(p => p.accountId === jayId));
});

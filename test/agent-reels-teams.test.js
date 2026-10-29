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

test('sync: the log grows, checked; two phones add up instead of dropping taps; only fresh entries can be undone', async () => {
  const add = [
    { agent_id: 'me', type: 'dial', occurred_at: iso(5) },
    { agent_id: 'me', type: 'conversation', occurred_at: iso(5), lead_id: 'L1' },
    { agent_id: 'me', type: 'app_written', occurred_at: iso(4), lead_id: 'L1', value: 720, meta: { kitchen_check: { affordable: true } } },
  ];
  const s1 = await jay.post('/api/reels/sync', { client: 'phone-a', rev: 0, acts: { base: 0, add }, leads: { upsert: [{ id: 'L1', agent_id: 'me', name: 'Mrs. Private Client', stage: 'application', premium: 720, draftOn: '2026-11-20', junk: 'dropped' }] }, profile: { licensed: true, dayCalls: 40, stopAt: '17:00', junk: 1 } });
  assert.equal(s1.status, 200, JSON.stringify(s1.data)); assert.deepEqual(s1.data, { rev: 1, count: 3, leads: 1 });
  const bad = await jay.post('/api/reels/sync', { rev: 1, acts: { base: 3, add: [{ type: 'hack', occurred_at: iso() }] } });
  assert.equal(bad.status, 400);
  // A second phone that last heard rev 0 sends one call: it's added after the first phone's, not dropped.
  const b = await jay.post('/api/reels/sync', { client: 'phone-b', rev: 0, acts: { base: 0, add: [{ type: 'dial', occurred_at: iso(1) }] } });
  assert.equal(b.status, 200, JSON.stringify(b.data)); assert.equal(b.data.merged, true); assert.equal(b.data.count, 4);
  assert.equal(b.data.doc.activities.length, 4); assert.equal(b.data.doc.clients, undefined, 'bookkeeping stays on the server');
  // Its reply got lost and it sends the same call again: not doubled.
  const again = await jay.post('/api/reels/sync', { client: 'phone-b', rev: 0, acts: { base: 0, add: [{ type: 'dial', occurred_at: iso(1) }] } });
  assert.equal(again.data.count, 4);
  // Undo: fresh entries, by the server's clock (logging yesterday's calls after midnight can still be undone).
  const late = await jay.post('/api/reels/sync', { client: 'phone-a', rev: 3, acts: { base: 4, add: [{ type: 'dial', occurred_at: iso(60 * 3) }] } });
  assert.equal(late.status, 200, JSON.stringify(late.data));
  const undo = await jay.post('/api/reels/sync', { client: 'phone-a', rev: 4, acts: { truncateTo: 4, base: 4, add: [] } });
  assert.equal(undo.status, 200, JSON.stringify(undo.data)); assert.equal(undo.data.count, 4);
  // An undo on an old copy: refused, and that phone takes the latest.
  const stale = await jay.post('/api/reels/sync', { client: 'phone-b', rev: 1, acts: { truncateTo: 2, base: 3, add: [] } });
  assert.equal(stale.status, 409); assert.equal(stale.data.conflict, true);
  // Half an hour later the same entries are history.
  const reels = await import('../lib/reels.js');
  assert.throws(() => reels.sync(team.id, jayId, { rev: 5, acts: { truncateTo: 3, base: 3, add: [] } }, Date.now() + 31 * 60_000), /Older log entries/);
  const doc = (await jay.get('/api/reels/me')).data.log;
  assert.equal(doc.leads[0].junk, undefined, 'unknown fields are dropped');
  assert.equal(doc.leads[0].draftOn, '2026-11-20');
  assert.deepEqual(doc.profile, { licensed: true, dayCalls: 40, stopAt: '17:00' });
  assert.equal(doc.recentAdds, undefined);
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

test('taking someone off archives their log (sales stay in the history); inviting them again brings it back', async () => {
  const out = data.exportWorkspace(team.id);
  assert.ok(out.agentReels.people.some(p => p.accountId === jayId && p.log.activities.length === 4));
  assert.equal(data.exportCounts(out).agentReelsLogs >= 1, true);
  const del = await mel.del(`/api/reels/team/${jayId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(store.getAccount(jayId), null, 'a login with nowhere else to go is removed');
  const kept = data.exportWorkspace(team.id).agentReels.people.find(p => p.accountId === jayId);
  assert.equal(kept.role, 'former'); assert.equal(kept.log.activities.length, 4, 'nothing deleted');
  const view = (await mel.get('/api/reels/team')).data;
  assert.ok(!view.people.some(p => p.id === jayId)); assert.deepEqual(view.archived.map(a => a.name), ['Jay']);
  // Back on the team: the log follows the email to the new login.
  const inv = await mel.post('/api/reels/invite', { email: 'jay@example.com' });
  const jay2 = client(port);
  const ok = await jay2.post('/api/link/accept', { token: tokenOf(inv.data.link), kind: 'invite', name: 'Jay', password: 'jaypass12345', acceptTerms: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const back = (await jay2.get('/api/reels/me')).data;
  assert.equal(back.log.activities.length, 4);
  assert.equal((await mel.get('/api/reels/team')).data.archived.length, 0);
});

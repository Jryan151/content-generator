// Roles: the agent (owner) and the compliance reviewer, memberships (one login in several workspaces),
// and the server refusing anything a role can't do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const roles = await import('../lib/roles.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

const mkWs = (name, extra = {}) => {
  const ws = store.createWorkspace({ name });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory() };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true, ...extra });
  return store.getWorkspace(ws.id);
};
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const solo = mkWs('Solo Agent'), other = mkWs('Other Agent');
store.createAccount({ email: 'solo@example.com', role: 'agent', workspaceId: solo.id, hash: await auth.hashPassword('solopass1234') });
store.createAccount({ email: 'other@example.com', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('otherpass123') });
const rev = store.createAccount({ email: 'rev@example.com', role: 'agent', workspaceId: null, hash: await auth.hashPassword('revpass12345') });
store.setMembership(rev.id, solo.id, { role: 'reviewer' });
store.setMembership(rev.id, other.id, { role: 'reviewer' });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });

test('capabilities by role', () => {
  const owner = { id: 'u1', role: 'agent', workspaceId: solo.id };
  assert.deepEqual(roles.membershipsOf(owner), [{ ws: solo.id, role: 'owner' }], 'older accounts own their one workspace');
  const s = roles.capsFor(owner, solo);
  assert.ok(s.includes('settings') && s.includes('approve') && s.includes('connect') && !s.includes('signoff'));
  const r = { id: 'u2', role: 'agent', memberships: [{ ws: solo.id, role: 'reviewer' }] };
  assert.deepEqual(roles.capsFor(r, solo), ['signoff'], 'a reviewer only signs off');
  assert.deepEqual(roles.membershipsOf({ id: 'u3', role: 'agent', memberships: [{ ws: solo.id, role: 'assistant' }] }), [], 'an old assistant seat no longer counts');
  assert.ok(roles.capsFor(owner, { ...solo, onboarded: false }).includes('setup'), 'setup comes first');
  assert.deepEqual(roles.capsFor({ role: 'admin' }, solo).sort(), Object.keys(roles.CAPS).filter(c => !['setup', 'signoff'].includes(c)).sort(), 'admins: everything (setup happens once, signing off is the reviewer’s alone)');
  assert.deepEqual(roles.capsFor({ id: 'x', role: 'agent', workspaceId: 'w000000000000' }, solo), [], 'not a member, nothing');
  assert.equal(roles.portalFor(owner, solo), 'solo'); assert.equal(roles.portalFor(r, solo), 'reviewer'); assert.equal(roles.portalFor({ role: 'admin' }, null), 'owner');
});

test('every workspace change names the capability it needs, and every name is a real route', () => {
  assert.deepEqual(S.unlistedRoutes(), []);
  assert.deepEqual(S.deadCaps(), []);
});

test('deleting a workspace keeps a login that belongs elsewhere too', () => {
  const tmp = mkWs('Temp');
  const both = store.createAccount({ email: 'both@example.com', role: 'agent', workspaceId: tmp.id, hash: 'x' });
  store.setMembership(both.id, solo.id, { role: 'reviewer' });
  const only = store.createAccount({ email: 'only@example.com', role: 'agent', workspaceId: tmp.id, hash: 'x' });
  const gone = store.removeAccountsIn(tmp.id);
  assert.deepEqual(gone.map(a => a.email), ['only@example.com']);
  const kept = store.getAccount(both.id);
  assert.equal(kept.workspaceId, solo.id); assert.deepEqual(roles.membershipsOf(kept), [{ ws: solo.id, role: 'reviewer' }]);
  assert.equal(store.getAccount(only.id), null);
});

test('a page loaded for one workspace can’t act on another after a switch in another tab', async () => {
  const c = await login('rev@example.com', 'revpass12345');
  const me = (await c.get('/api/me')).data;
  const next = me.workspaces.find(w => !w.current);
  await c.post('/api/workspaces/switch', { workspaceId: next.id });
  // The old tab still sends the workspace it was loaded for.
  const res = await fetch(`http://127.0.0.1:${port}/api/signoff/x`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c.cookie, 'X-Workspace': me.workspace.id }, body: JSON.stringify({ ok: true }) });
  assert.equal(res.status, 409); assert.equal((await res.json()).wsChanged, true);
});

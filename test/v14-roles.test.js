// v14 Phase 6: roles and portals. Capabilities per role and workspace kind, memberships (one login in
// several workspaces), solo and managed (done-for-you) portals, change requests, and the server
// refusing anything a role can't do.
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
  const ws = store.createWorkspace({ name, comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true, limits: { assistantSeats: 2 }, ...extra });   // seats for the assistants below
  return store.getWorkspace(ws.id);
};
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const solo = mkWs('Solo Agent'), managed = mkWs('Managed Agent', { managed: true });
store.createAccount({ email: 'solo@example.com', role: 'agent', workspaceId: solo.id, hash: await auth.hashPassword('solopass1234') });
store.createAccount({ email: 'managed@example.com', role: 'agent', workspaceId: managed.id, hash: await auth.hashPassword('managedpass1') });
const asst = store.createAccount({ email: 'asst@example.com', role: 'agent', workspaceId: null, hash: await auth.hashPassword('asstpass1234') });
store.setMembership(asst.id, solo.id, { role: 'assistant' });
store.setMembership(asst.id, managed.id, { role: 'assistant', canPost: true });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });

test('capabilities by role and kind of workspace', () => {
  const owner = { id: 'u1', role: 'agent', workspaceId: solo.id };
  assert.deepEqual(roles.membershipsOf(owner), [{ ws: solo.id, role: 'owner' }], 'older accounts own their one workspace');
  const s = roles.capsFor(owner, solo), m = roles.capsFor({ ...owner, workspaceId: managed.id }, managed, { managed: true });
  assert.ok(s.includes('settings') && s.includes('approve') && !s.includes('requests'));
  assert.ok(!m.includes('settings') && m.includes('approve') && m.includes('requests') && m.includes('connect'), 'the team runs settings in a managed workspace');
  const a = { id: 'u2', role: 'agent', memberships: [{ ws: solo.id, role: 'assistant' }] };
  const ac = roles.capsFor(a, solo);
  for (const c of ['approve', 'mindset', 'billing', 'data', 'people', 'post', 'settings']) assert.ok(!ac.includes(c), c);
  assert.ok(ac.includes('make') && ac.includes('replies'));
  assert.ok(roles.capsFor({ ...a, memberships: [{ ws: solo.id, role: 'assistant', canPost: true, canEdit: true }] }, solo).includes('post'));
  assert.ok(roles.capsFor({ ...a, memberships: [{ ws: solo.id, role: 'assistant', canEdit: true }] }, solo).includes('settings'));
  assert.ok(!roles.capsFor({ ...a, memberships: [{ ws: managed.id, role: 'assistant', canEdit: true }] }, managed, { managed: true }).includes('settings'), 'not in a managed workspace');
  assert.ok(roles.capsFor({ ...owner, workspaceId: managed.id }, { ...managed, onboarded: false }, { managed: true }).includes('settings'), 'setup comes first');
  assert.deepEqual(roles.capsFor({ role: 'admin' }, solo).sort(), Object.keys(roles.CAPS).filter(c => !['requests', 'setup', 'signoff'].includes(c)).sort(), 'admins: everything (requests are for done-for-you, setup happens once, signing off is the reviewer’s alone)');
  assert.ok(roles.capsFor({ role: 'admin' }, managed, { managed: true }).includes('requests'));
  assert.deepEqual(roles.capsFor({ id: 'x', role: 'agent', workspaceId: 'w000000000000' }, solo), [], 'not a member, nothing');
  assert.equal(roles.portalFor(owner, solo), 'solo'); assert.equal(roles.portalFor(owner, managed, { managed: true }), 'managed'); assert.equal(roles.portalFor(a, solo), 'assistant'); assert.equal(roles.portalFor({ role: 'admin' }, null), 'owner');
});

test('every workspace change names the capability it needs, and every name is a real route', () => {
  assert.deepEqual(S.unlistedRoutes(), []);
  assert.deepEqual(S.deadCaps(), []);
});

test('the managed portal: no settings, change requests instead, and you see them in Admin', async () => {
  const c = await login('managed@example.com', 'managedpass1');
  const me = (await c.get('/api/me')).data;
  assert.equal(me.portal, 'managed'); assert.equal(me.role, 'owner'); assert.ok(!me.caps.includes('settings'));
  const cfg = (await c.get('/api/config')).data.config;
  const put = await c.put('/api/config', { config: cfg });
  assert.equal(put.status, 403); assert.match(put.data.error, /Your team takes care of this/);
  assert.equal((await c.post('/api/content/link-all', { config: cfg })).status, 403);
  const r = await c.post('/api/requests', { area: 'content', text: 'More videos about Medicare supplements, please.' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.request.status, 'open');
  assert.equal((await c.post('/api/requests', { text: '' })).status, 400);
  const boss = await login('boss@example.com', 'bosspass1234');
  const open = (await boss.get('/api/admin/requests')).data.requests;
  const mine = open.find(x => x.ws === managed.id);
  assert.ok(mine && mine.workspaceName === 'Managed Agent');
  assert.equal((await boss.post(`/api/admin/requests/${managed.id}/${mine.id}`, { reply: 'Added three worries.' })).status, 200);
  const after = (await c.get('/api/requests')).data.requests[0];
  assert.equal(after.status, 'done'); assert.equal(after.reply, 'Added three worries.');
  // Setup happens once: finishing it again can't be used to change settings.
  const again = await c.post('/api/setup/finish', { accept: true, config: cfg });
  assert.ok([403, 409].includes(again.status), String(again.status));
  assert.equal((await c.post('/api/requests', { text: 'x', area: 'constructor' })).data.request.area, 'other');
  // A solo agent changes their own settings, and doesn't send requests.
  const sc = await login('solo@example.com', 'solopass1234');
  assert.equal((await sc.put('/api/config', { config: (await sc.get('/api/config')).data.config })).status, 200);
  assert.equal((await sc.post('/api/requests', { text: 'x' })).status, 403);
});

test('an assistant: works on videos, never approves, never sees the agent’s own pages; posts only if allowed', async () => {
  const c = await login('asst@example.com', 'asstpass1234');
  const me = (await c.get('/api/me')).data;
  assert.equal(me.role, 'assistant'); assert.equal(me.portal, 'assistant');
  assert.equal(me.workspaces.length, 2);
  store.addVideo(me.workspace.id, { id: 'av1', status: 'pending', file: 'video_av1.mp4', createdAt: new Date().toISOString(), meta: {}, scenes: [{ text: 'Hi' }], clips: [] });
  assert.equal((await c.get('/api/videos')).status, 200);
  const ap = await c.post('/api/videos/av1/approve', { checklist: [] });
  assert.equal(ap.status, 403); assert.match(ap.data.error, /Only the agent can approve/);
  assert.equal((await c.get('/api/mindset')).status, 403);
  assert.equal((await c.get('/api/billing')).status, 403);
  assert.equal((await c.get('/api/data/export')).status, 403);
  assert.equal((await c.put('/api/config', { config: {} })).status, 403);
  // The agent's why (Mindset) never reaches them, through any door.
  const owner = await login('solo@example.com', 'solopass1234');
  await owner.put('/api/mindset', { profile: { why: { why: 'My mom had nothing in place', how: '', what: '', show: 'off' } } });
  assert.equal((await owner.get('/api/today')).data.why, 'My mom had nothing in place');
  assert.equal((await c.get('/api/config')).data.config.mindset.why.why, '');
  const t = (await c.get('/api/today')).data;
  assert.equal(t.why, ''); assert.equal(t.principle, null);
  assert.equal((await c.get('/api/me')).data.workspace.billing.plan, '');
  assert.equal((await c.post('/api/videos/av1/posted', {})).status, 403, 'no posting in the solo workspace');
  // Switch to the managed workspace, where the agent let them post.
  const other = me.workspaces.find(w => !w.current);
  assert.equal((await c.post('/api/workspaces/switch', { workspaceId: other.id })).status, 200);
  const me2 = (await c.get('/api/me')).data;
  assert.equal(me2.workspace.id, other.id); assert.ok(me2.caps.includes('post'));
  assert.equal((await c.post('/api/workspaces/switch', { workspaceId: 'w000000000000' })).status, 404);
});

test('deleting a workspace keeps a login that belongs elsewhere too', () => {
  const tmp = mkWs('Temp');
  const both = store.createAccount({ email: 'both@example.com', role: 'agent', workspaceId: tmp.id, hash: 'x' });
  store.setMembership(both.id, solo.id, { role: 'assistant' });
  const only = store.createAccount({ email: 'only@example.com', role: 'agent', workspaceId: tmp.id, hash: 'x' });
  const gone = store.removeAccountsIn(tmp.id);
  assert.deepEqual(gone.map(a => a.email), ['only@example.com']);
  const kept = store.getAccount(both.id);
  assert.equal(kept.workspaceId, solo.id); assert.deepEqual(roles.membershipsOf(kept), [{ ws: solo.id, role: 'assistant' }]);
  assert.equal(store.getAccount(only.id), null);
});

test('a page loaded for one workspace can’t act on another after a switch in another tab', async () => {
  const c = await login('asst@example.com', 'asstpass1234');
  const me = (await c.get('/api/me')).data;
  const other = me.workspaces.find(w => !w.current);
  await c.post('/api/workspaces/switch', { workspaceId: other.id });
  // The old tab still sends the workspace it was loaded for.
  const res = await fetch(`http://127.0.0.1:${port}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c.cookie, 'X-Workspace': me.workspace.id }, body: JSON.stringify({ name: 'Rosa' }) });
  assert.equal(res.status, 409); assert.equal((await res.json()).wsChanged, true);
  assert.equal(store.listAccounts().length > 0, true);
});


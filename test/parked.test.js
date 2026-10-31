// v16.1: the generator stripped to what the assistant needs. Parked features are hidden for everyone by
// default (the code stays), and the assistant makes and posts but never approves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
delete process.env.PARKED;   // the default, as a real server runs
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const roles = await import('../lib/roles.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

const ws = store.createWorkspace({ name: 'Melanie' });
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'mel@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('melpass12345') });
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };

test('parked features are off for every role by default', () => {
  const w = store.getWorkspace(ws.id);
  for (const acc of [{ role: 'admin' }, { id: 'o', role: 'agent', workspaceId: ws.id }, { id: 'a', role: 'agent', memberships: [{ ws: ws.id, role: 'assistant' }] }]) {
    const caps = roles.capsFor(acc, w);
    for (const c of roles.DEFAULT_PARKED) assert.ok(!caps.includes(c), `${c} is parked`);
  }
});

test('PARKED in .env brings features back', () => {
  process.env.PARKED = 'mindset';
  try {
    const caps = roles.capsFor({ id: 'o', role: 'agent', workspaceId: ws.id }, store.getWorkspace(ws.id));
    assert.ok(caps.includes('coach') && !caps.includes('mindset'));
  } finally { delete process.env.PARKED; }
});

test('the agent invites an assistant, who makes and posts but never approves', async () => {
  const mel = await login('mel@example.com', 'melpass12345');
  const inv = await mel.post('/api/people/invite', { email: 'asst@example.com', role: 'assistant' });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.equal(inv.data.assistants.invites[0].email, 'asst@example.com');
  assert.equal(inv.data.reviewers.invites.length, 0, 'not counted as a reviewer');
  const token = inv.data.link.split('/invite/')[1];
  const pub = client(port);
  const ok = await pub.post('/api/link/accept', { kind: 'invite', token, password: 'asstpass12345', name: 'Asst', acceptTerms: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const acc = store.findAccountByEmail('asst@example.com');
  assert.equal(roles.membership(acc, ws.id).role, 'assistant');
  const a = await login('asst@example.com', 'asstpass12345');
  const me = await a.get('/api/me');
  assert.ok(me.data.caps.includes('make') && me.data.caps.includes('post') && me.data.caps.includes('settings'));
  assert.ok(!me.data.caps.includes('approve') && !me.data.caps.includes('people') && !me.data.caps.includes('coach'));
  assert.equal((await a.post('/api/videos/v1/approve', {})).status, 403, 'approving is the agent’s alone');
  const gone = await mel.del(`/api/people/${acc.id}`);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
});

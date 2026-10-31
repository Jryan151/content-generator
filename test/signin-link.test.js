// One-tap sign-in links: an admin makes one for an agent; it signs them in once, with no password,
// and lasts 30 days. Not for admins, not twice, not for a disabled account.
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('a sign-in link signs the agent in once, with no password, for 30 days', async () => {
  assert.equal((await admin.post('/api/login', { email: 'admin@example.com', password: 'adminpass123' })).status, 200);
  const inv = await admin.post('/api/admin/invite', { email: 'mel@example.com', workspaceName: 'Mel', comped: true });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.equal((await client(port).post('/api/link/accept', { token: inv.data.link.split('/').pop(), kind: 'invite', name: 'Mel', password: 'a-very-long-password-123' })).status, 200);
  const acc = store.findAccountByEmail('mel@example.com');

  const r = await admin.post('/api/admin/signin-link', { accountId: acc.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.days, 30);
  assert.match(r.data.link, /#\/signin\//);
  const token = r.data.link.split('/').pop();
  const saved = auth.peekLink(token, 'signin');
  assert.ok(saved.expiresAt - Date.now() > 29 * 86400000);

  const anon = client(port);
  const check = await anon.post('/api/link/check', { token, kind: 'signin' });
  assert.equal(check.status, 200);
  assert.equal(check.data.email, 'mel@example.com');

  const mel = client(port);
  assert.equal((await mel.post('/api/link/signin', { token })).status, 200);
  assert.equal((await mel.get('/api/me')).data.account.email, 'mel@example.com');

  // Used: a second tap (a forwarded copy) gets nothing.
  assert.equal((await client(port).post('/api/link/signin', { token })).status, 410);
  // A reset or invite token can't be used as a sign-in link.
  assert.equal((await client(port).post('/api/link/signin', { token: inv.data.link.split('/').pop() })).status, 410);
});

test('no sign-in links for admins or disabled accounts', async () => {
  const me = store.findAccountByEmail('admin@example.com');
  assert.equal((await admin.post('/api/admin/signin-link', { accountId: me.id })).status, 400);
  const acc = store.findAccountByEmail('mel@example.com');
  const token = (await admin.post('/api/admin/signin-link', { accountId: acc.id })).data.link.split('/').pop();
  store.updateAccount(acc.id, { disabled: true });
  assert.equal((await client(port).post('/api/link/signin', { token })).status, 410);
  store.updateAccount(acc.id, { disabled: false });
});

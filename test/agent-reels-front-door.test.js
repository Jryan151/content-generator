// One front door for Agent Reels: everyone signs in on the same page and lands in their own workspace.
// A recruit sees only their own log; a leader sees only her own team; nobody reaches another team by
// switching workspaces; a signed-out visitor to the team page is sent to sign in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

const mkWs = (name) => { const ws = store.createWorkspace({ name }); store.updateWorkspace(ws.id, { onboarded: true }); return store.getWorkspace(ws.id); };
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const tokenOf = link => link.split('/#/invite/')[1];
const iso = (minsAgo = 0) => new Date(Date.now() - minsAgo * 60_000).toISOString();

const team = mkWs('Melanie’s Team'), other = mkWs('Other Team');
store.createAccount({ email: 'mel@example.com', name: 'Melanie', role: 'agent', workspaceId: team.id, hash: await auth.hashPassword('melpass123456') });
store.createAccount({ email: 'otto@example.com', name: 'Otto', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('ottopass12345') });

let mel, otto, ana, ben;
async function join(leader, email, name) {
  const inv = await leader.post('/api/reels/invite', { email });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  const c = client(port);
  const ok = await c.post('/api/link/accept', { token: tokenOf(inv.data.link), kind: 'invite', name, password: `${name.toLowerCase()}pass12345`, acceptTerms: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return c;
}

test('everyone signs in on the same page, and each lands in their own place', async () => {
  mel = await login('mel@example.com', 'melpass123456');
  otto = await login('otto@example.com', 'ottopass12345');
  ana = await join(mel, 'ana@example.com', 'Ana');
  ben = await join(mel, 'ben@example.com', 'Ben');
  const leader = (await mel.get('/api/me')).data, recruit = (await ana.get('/api/me')).data;
  assert.equal(leader.portal, 'solo'); assert.ok(leader.caps.includes('teamlead'), 'the leader gets the Team link');
  assert.equal(recruit.portal, 'teammate'); assert.deepEqual(recruit.caps, ['team'], 'a recruit has Agent Reels and nothing else');
  assert.equal((await ana.get('/api/reels/me')).data.role, 'agent');
  assert.equal((await mel.get('/api/reels/me')).data.role, 'leader');
});

test('a recruit sees only their own log, never a teammate’s', async () => {
  const s = await ana.post('/api/reels/sync', { client: 'ana-phone', rev: 0, acts: { base: 0, add: [{ agent_id: 'me', type: 'dial', occurred_at: iso(3) }, { agent_id: 'me', type: 'dial', occurred_at: iso(2) }] } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const anaLog = (await ana.get('/api/reels/me')).data, benLog = (await ben.get('/api/reels/me')).data;
  assert.equal(anaLog.log.activities.length, 2);
  assert.equal(benLog.log.activities.length, 0, 'Ana’s calls never show up in Ben’s log');
  assert.notEqual(anaLog.account.id, benLog.account.id);
  for (const [m, p] of [['get', '/api/reels/team'], ['post', '/api/reels/invite'], ['get', '/api/videos'], ['get', '/api/config'], ['get', '/api/people']]) {
    const res = await ben[m](p, m === 'post' ? { email: 'x@example.com' } : undefined);
    assert.equal(res.status, 403, `a recruit can’t ${m} ${p}`);
  }
});

test('a leader sees her own team only, and another leader sees none of it', async () => {
  const mine = (await mel.get('/api/reels/team?tz=America/Phoenix')).data.people.map(p => p.name).sort();
  assert.deepEqual(mine, ['Ana', 'Ben']);
  const theirs = await otto.get('/api/reels/team?tz=America/Phoenix');
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.data.people, [], 'Otto’s team is empty: Melanie’s people never show there');
  assert.ok(!JSON.stringify(theirs.data).includes('Ana'));
});

test('nobody reaches another team by naming its workspace', async () => {
  for (const c of [ana, otto]) {
    const hop = await fetch(`http://127.0.0.1:${port}/api/reels/team?tz=America/Phoenix`, { headers: { cookie: c.cookie, 'X-Workspace': c === ana ? other.id : team.id } });
    assert.ok([403, 404, 409].includes(hop.status), `got ${hop.status}`);
    const sw = await c.post('/api/workspaces/switch', { workspaceId: c === ana ? other.id : team.id });
    assert.equal(sw.status, 404, 'can’t switch into a workspace you’re not in');
  }
});

test('signed out, the team page is told so, and it sends people to the one sign-in page', async () => {
  const anon = await client(port).get('/api/reels/me');
  assert.equal(anon.status, 401, 'the page needs a 401 to know nobody is signed in');
  const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'agent-system', 'public', 'app.js'), 'utf8');
  assert.match(page, /sync\.account\.signedOut[\s\S]{0,200}location\.replace\('\/#\/login'\)/, 'signed out on the site: off to sign in');
  assert.match(page, /\.has\('demo'\)/, '?demo keeps the demo open for showing people');
  const portal = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(portal, /can\('teamlead'\) \? '<a href="\/agent-system\/#team"/, 'the leader’s nav links to her team');
  assert.match(portal, /back === 'team' && can\('team'\)/, 'after signing in she goes back to the team page she came from');
  const page2 = fs.readFileSync(path.join(import.meta.dirname, '..', 'agent-system', 'public', 'index.html'), 'utf8');
  assert.match(page2, /id="to-content"/, 'the team page links a leader back to her content');
});

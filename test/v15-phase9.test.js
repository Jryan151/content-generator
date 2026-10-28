// v15 Phase 9: the compliance reviewer (sign-off before posting) and keyword replies on Instagram.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import { tempEnv, startStubs, client, hasFfmpeg } from './helpers.js';

tempEnv();
// A stand-in Instagram: posting (container, status, publish) and messages (what was sent is kept).
const igSeen = { media: [], sent: [], users: { 'igsid-1': { username: 'maria.g', name: 'Maria Garcia' } } };
const igServer = http.createServer(async (req, res) => {
  let raw = ''; for await (const x of req) raw += x;
  const url = new URL(req.url, 'http://x'), p = new URLSearchParams(raw), json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (req.method === 'POST' && /\/media$/.test(url.pathname)) { igSeen.media.push(Object.fromEntries(p)); return json(200, { id: `c${igSeen.media.length}` }); }
  if (req.method === 'POST' && /\/media_publish$/.test(url.pathname)) return json(200, { id: 'm1' });
  if (req.method === 'POST' && /\/messages$/.test(url.pathname)) {
    const body = raw.startsWith('{') ? JSON.parse(raw) : { recipient: JSON.parse(p.get('recipient') || '{}'), message: JSON.parse(p.get('message') || '{}') };
    if (igSeen.down) return json(503, { error: { message: 'down' } });
    igSeen.sent.push(body); return json(200, { recipient_id: body.recipient?.id || 'x', message_id: `mid.${igSeen.sent.length}` });
  }
  if (req.method === 'GET' && (m = /\/v[\d.]+\/(c\d+)$/.exec(url.pathname))) return json(200, { status_code: 'FINISHED' });
  if (req.method === 'GET' && /\/v[\d.]+\/m1$/.test(url.pathname)) return json(200, { permalink: 'https://www.instagram.com/reel/m1/' });
  if (req.method === 'GET' && (m = /\/v[\d.]+\/(igsid-\d+)$/.exec(url.pathname))) return igSeen.users[m[1]] ? json(200, igSeen.users[m[1]]) : json(404, { error: { message: 'no user' } });
  if (req.method === 'GET' && /\/media$/.test(url.pathname)) return json(200, { data: [] });
  json(404, { error: { message: `unknown ${req.method} ${url.pathname}` } });
});
await new Promise(r => igServer.listen(0, '127.0.0.1', r));
const igBase = `http://127.0.0.1:${igServer.address().port}`;
Object.assign(process.env, { INSTAGRAM_APP_ID: '123', INSTAGRAM_APP_SECRET: 'ig-secret', INSTAGRAM_AUTH_BASE: igBase, INSTAGRAM_OAUTH_BASE: igBase, INSTAGRAM_GRAPH_BASE: igBase, INSTAGRAM_ALLOW_HTTP: '1', INSTAGRAM_REPLIES: '1', INSTAGRAM_WEBHOOK_TOKEN: 'verify-me', PUBLIC_URL: process.env.PUBLIC_URL || 'http://127.0.0.1:9' });
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const roles = await import('../lib/roles.js');
const signoff = await import('../lib/signoff.js');
const links = await import('../lib/links.js');
const crypto = await import('crypto');
const M = await import('../mixer-core.js');
const replies = await import('../lib/replies.js');
const queue = await import('../lib/queue.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); igServer.close(); });
const ig = await import('../lib/instagram.js');
const paths = await import('../lib/paths.js');
const path = (await import('path')).default;
const connectIg = (w, extra = {}) => paths.writeJSON(path.join(store.wsDir(w.id), 'instagram.json'), { userId: '1789', username: 'dana.agent', token: ig.seal('tok'), expiresAt: new Date(Date.now() + 50 * 86400000).toISOString(), connectedAt: new Date().toISOString(), refreshedAt: new Date().toISOString(), problem: '', scopes: 'instagram_business_basic,instagram_business_content_publish', ...extra });

const mkWs = name => {
  const w = store.createWorkspace({ name, comped: true });
  const c = store.loadConfig(w.id);
  c.story = { ...c.story, ...starterStory() };
  c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  c.look = { ...c.look, name: 'Dana Agent', location: 'Gallup, NM', bookingUrl: 'https://calendly.com/dana/15min' };
  store.saveConfig(w.id, c);
  store.updateWorkspace(w.id, { onboarded: true });
  return w;
};
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const vid = (w, id, extra = {}) => {
  fs.writeFileSync(store.videoPath(w.id, `video_${id}.mp4`), `fake video ${id}`);
  return store.addVideo(w.id, { id, status: 'pending', file: `video_${id}.mp4`, createdAt: new Date().toISOString(), scenes: [{ text: `Who pays for your funeral, ${id}?`, keyword: 'family' }, { text: 'Second scene', keyword: 'home' }], meta: { painPoint: 'Funeral costs' }, post: 'Post text', preflight: [{ ok: true, label: 'No prices' }], version: 1, ...extra });
};
const CHECK = ['watched', 'footage', 'facts', 'rules'];

/* ---------------- 9d: the compliance reviewer ---------------- */
test('the reviewer role: only Sign-off; nobody else signs off, not the agent or an admin', () => {
  const w = mkWs('Roles');
  const r = { id: 'acc_r', role: 'agent', memberships: [{ ws: w.id, role: 'reviewer' }] };
  assert.deepEqual(roles.capsFor(r, w), ['signoff']);
  assert.equal(roles.portalFor(r, w), 'reviewer');
  const owner = { id: 'acc_o', role: 'agent', workspaceId: w.id };
  assert.ok(!roles.capsFor(owner, w).includes('signoff'));
  assert.ok(!roles.capsFor({ id: 'acc_a', role: 'admin' }, w).includes('signoff'));
});

test('sign-off: invite a reviewer, turn it on, and nothing leaves until they sign off this version', async () => {
  const w = mkWs('Signoff');
  store.createAccount({ email: 'so@example.com', name: 'Dana Agent', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('sopass123456') });
  const a = await login('so@example.com', 'sopass123456');
  // On needs a reviewer who has joined.
  assert.equal((await a.post('/api/people/signoff', { on: true })).status, 409);
  const inv = await a.post('/api/people/invite', { email: 'rita@carrier.example', role: 'reviewer' });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.equal(inv.data.reviewers.invites[0].email, 'rita@carrier.example');
  const token = inv.data.link.split('/invite/')[1], pub = client(port);
  assert.equal((await pub.post('/api/link/check', { kind: 'invite', token })).data.role, 'reviewer');
  assert.equal((await pub.post('/api/link/accept', { kind: 'invite', token, name: 'Rita Review', password: 'ritapass12345' })).status, 200);
  const rita = store.findAccountByEmail('rita@carrier.example');
  assert.equal(roles.membership(rita, w.id).role, 'reviewer');
  const r = await login('rita@carrier.example', 'ritapass12345');
  assert.equal((await r.get('/api/me')).data.portal, 'reviewer');
  assert.equal((await r.get('/api/videos')).status, 403, 'nothing but Sign-off');
  assert.equal((await r.get('/api/signoff')).status, 200);
  assert.equal((await r.get('/api/push')).status, 200, 'they can turn on notifications');
  assert.equal((await a.get('/api/signoff')).status, 403, 'the agent can’t sign off their own');
  // Turned on: an approved video waits.
  let p = await a.post('/api/people/signoff', { on: true });
  assert.equal(p.status, 200); assert.equal(p.data.reviewers.required, true);
  assert.equal((await a.get('/api/me')).data.workspace.signoff.reviewer, 'Rita Review');
  vid(w, 'sv1');
  assert.equal((await a.post('/api/videos/sv1/approve', { checklist: CHECK })).status, 200);
  assert.equal(signoff.waiting(store.getWorkspace(w.id), store.getVideo(w.id, 'sv1')), true);
  assert.equal((await a.get('/api/videos/sv1/download')).status, 409, 'not downloaded before sign-off');
  const posted = await a.post('/api/videos/sv1/posted', {});
  assert.equal(posted.status, 409); assert.match(posted.data.error, /Waiting for Rita Review to sign off/);
  let list = (await r.get('/api/signoff')).data;
  assert.deepEqual(list.waiting.map(v => v.id), ['sv1']);
  assert.equal(list.waiting[0].scenes[0].text, 'Who pays for your funeral, sv1?'); assert.equal(list.waiting[0].post, 'Post text');
  // The version they watched; sent back needs a note.
  assert.equal((await r.post('/api/signoff/sv1', { ok: true, version: 2 })).status, 409);
  assert.equal((await r.post('/api/signoff/sv1', { ok: false, note: '' })).status, 400);
  const back = await r.post('/api/signoff/sv1', { ok: false, note: 'Add the carrier name to scene 2.', version: 1 });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  let v = store.getVideo(w.id, 'sv1');
  assert.deepEqual([v.status, v.approval, v.signoff.status, v.signoff.note], ['pending', null, 'back', 'Add the carrier name to scene 2.']);
  // Approved again: waiting again; signed off: it can go.
  assert.equal((await a.post('/api/videos/sv1/approve', { checklist: CHECK })).status, 200);
  assert.equal((await r.get('/api/signoff')).data.waiting.length, 1);
  const ok = await r.post('/api/signoff/sv1', { ok: true, version: 1 });
  assert.equal(ok.status, 200); assert.equal(ok.data.waiting.length, 0); assert.equal(ok.data.recent[0].signoff.status, 'ok');
  assert.equal((await a.get('/api/videos/sv1/download')).status, 200);
  assert.equal((await r.post('/api/signoff/sv1', { ok: true })).status, 409, 'once');
  // The receipt and the records say so.
  const rec = await fetch(`http://127.0.0.1:${port}/api/videos/sv1/receipt.html`, { headers: { cookie: a.cookie } }).then(x => x.text());
  assert.match(rec, /Compliance sign-off<\/dt><dd>Sent back by Rita Review.*Add the carrier name.*<br>Signed off by Rita Review/s);
  // A new version (a fixed scene) needs signing off again.
  store.updateVideo(w.id, 'sv1', { version: 2, file: 'video_sv1-2.mp4' });
  assert.equal(signoff.waiting(store.getWorkspace(w.id), store.getVideo(w.id, 'sv1')), true);
  // The last reviewer removed: sign-off goes off, so nothing is stuck.
  p = await a.del(`/api/people/${rita.id}`);
  assert.equal(p.status, 200); assert.equal(p.data.reviewers.on, false);
  assert.equal(signoff.waiting(store.getWorkspace(w.id), store.getVideo(w.id, 'sv1')), false);
});

test('sign-off: the posting plan skips a waiting video; a waiting one already scheduled is held, not failed', async () => {
  const w = mkWs('Signoff plan');
  const rv = store.createAccount({ email: 'rv2@example.com', name: 'Rev Two', role: 'agent', workspaceId: w.id, hash: 'x' });
  store.setMembership(rv.id, w.id, { role: 'reviewer' });
  signoff.setOn(w.id, true, 'test');
  vid(w, 'pa1', { status: 'approved', approval: { at: '2026-01-01T00:00:00Z' } });
  vid(w, 'pa2', { status: 'approved', approval: { at: '2026-01-02T00:00:00Z' } });
  store.updateVideo(w.id, 'pa2', x => ({ signoff: { status: 'ok', version: 1, file: x.file, at: new Date().toISOString(), byName: 'Rev Two' } }));
  const wsRec = store.getWorkspace(w.id);
  const { planReady } = await import('../mixer-core.js');
  const ready = store.readVideos(w.id).filter(v => planReady(v) && !signoff.waiting(wsRec, v)).map(v => v.id);
  assert.deepEqual(ready, ['pa2'], 'the older one waits; the signed-off one is next');
  assert.equal(signoff.gate(wsRec, store.getVideo(w.id, 'pa2')), undefined);
  assert.throws(() => signoff.gate(wsRec, store.getVideo(w.id, 'pa1')), /Waiting for Rev Two/);
  // Scheduled while waiting: Instagram holds it (it isn't started or failed), and it goes once signed off.
  connectIg(w);
  ig.schedulePost(w.id, 'pa1', 'now', 'test');
  const before = igSeen.media.length;
  await ig.tick();
  assert.equal(store.getVideo(w.id, 'pa1').autopost.status, 'scheduled'); assert.equal(igSeen.media.length, before, 'not started');
  store.updateVideo(w.id, 'pa1', x => ({ signoff: { status: 'ok', version: 1, file: x.file, at: new Date().toISOString(), byName: 'Rev Two' } }));
  await ig.tick();
  assert.equal(store.getVideo(w.id, 'pa1').autopost.status, 'processing'); assert.equal(igSeen.media.length, before + 1);
});

/* ---------------- 9b: bookings traced to videos ---------------- */
const raw = (p, opts = {}) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', ...opts, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari', ...(opts.headers || {}) } });
const hook = (url, body, headers = {}) => fetch(url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

/* ---------------- 9c: keyword replies on Instagram ---------------- */
const signed = body => { const raw = JSON.stringify(body); return { raw, sig: `sha256=${crypto.createHmac('sha256', 'ig-secret').update(raw).digest('hex')}` }; };
const igHook = (body, sig) => fetch(`http://127.0.0.1:${port}/hooks/instagram`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await new Promise(r => setTimeout(r, 30)); } };

test('keyword replies: the wording is checked, the agent’s own are approved as written, and it can be tried first', async () => {
  const w = mkWs('Replies rules');
  store.createAccount({ email: 'rr@example.com', name: 'Dana Agent', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('rrpass123456') });
  const a = await login('rr@example.com', 'rrpass123456');
  for (const [text, why] of [['Plans start at $9 a month!', /prices/], ['You will be approved, guaranteed.', /promises/], ['See https://example.com/x', /\{link\}/], ['Medicare can help.', /government/]]) {
    const r = await a.post('/api/replies/rules', { keyword: 'plan', where: 'both', text });
    assert.equal(r.status, 400, text); assert.match(r.data.error, why, text);
  }
  assert.equal((await a.post('/api/replies/rules', { keyword: 'x', where: 'both', text: 'Hi' })).status, 400, 'a real word');
  assert.equal((await a.post('/api/replies/on', { on: true })).status, 409, 'add one first');
  // The agent's own wording is approved as written.
  let r = await a.post('/api/replies/rules', { keyword: 'Plan!', where: 'comment', text: 'Hi {name}! Here’s the checklist: {link}' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rule = r.data.rules[0];
  assert.deepEqual([rule.keyword, rule.status], ['PLAN', 'approved']); assert.equal(rule.approvedByName, 'Dana Agent');
  r = await a.post('/api/replies/rules', { id: rule.id, keyword: 'PLAN', where: 'comment', text: 'Hi {name}! Here it is: {link}' });
  assert.equal(r.data.rules[0].status, 'approved');
  // The same keyword twice is refused.
  assert.equal((await a.post('/api/replies/rules', { keyword: 'plan', where: 'dm', text: 'Hello' })).status, 409);
  // Tried first: which reply, filled in.
  const tr = (await a.post('/api/replies/try', { text: 'plan please!!', where: 'comment' })).data;
  assert.equal(tr.rule.keyword, 'PLAN'); assert.match(tr.text, /^Hi Maria! Here it is: http/);
  assert.equal((await a.post('/api/replies/try', { text: 'plan please', where: 'dm' })).data.rule, null, 'comments only');
  assert.equal((await a.post('/api/replies/try', { text: 'planning ahead', where: 'comment' })).data.rule, null, 'a whole word');
  assert.equal((await a.post('/api/replies/on', { on: true })).data.on, true);
  assert.equal(replies.fill('Hi {name}, more: {link}', {}), 'Hi there, more:');
});

test('keyword replies: a signed comment gets a private reply with the booking link, once', async () => {
  const w = mkWs('Replies live');
  connectIg(w, { userId: '1790', scopes: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments' });
  vid(w, 'rl1', { status: 'posted', autopost: { status: 'posted', mediaId: 'media-77' } });
  replies.saveRule(w.id, { keyword: 'PLAN', where: 'both', text: 'Hi {name}! Here’s the checklist: {link}' }, { by: 'x', byName: 'Dana', approve: true });
  replies.setOn(w.id, true);
  // Meta checks the address with the verify token.
  const v = await fetch(`http://127.0.0.1:${port}/hooks/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
  assert.deepEqual([v.status, await v.text()], [200, '12345']);
  assert.equal((await fetch(`http://127.0.0.1:${port}/hooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status, 403);
  const comment = (id, text, from = 'igsid-1') => ({ object: 'instagram', entry: [{ id: '1790', time: 1, changes: [{ field: 'comments', value: { id, text, from: { id: from, username: 'maria.g' }, media: { id: 'media-77' } } }] }] });
  // Unsigned or wrongly signed: refused.
  assert.equal((await igHook(comment('cm1', 'PLAN'))).status, 401);
  assert.equal((await igHook(comment('cm1', 'PLAN'), 'sha256=00')).status, 401);
  const before = igSeen.sent.length;
  let b = signed(comment('cm1', 'PLAN please 🙏'));
  assert.equal((await igHook(b.raw, b.sig)).status, 200);
  await until(() => igSeen.sent.length > before);
  const msg = igSeen.sent.at(-1);
  assert.deepEqual(msg.recipient, { comment_id: 'cm1' });
  assert.match(msg.message.text, /^Hi Maria! Here’s the checklist: https:\/\/calendly\.com\/dana\/15min$/);
  // The same comment again (Meta retries): nothing more. Another comment from her today: not answered again.
  await igHook(b.raw, b.sig);
  b = signed(comment('cm2', 'plan'));
  await igHook(b.raw, b.sig);
  await until(() => replies.log(w.id).some(x => x.why === 'Already answered today'));
  assert.equal(igSeen.sent.length, before + 1);
  // A message (DM) with the keyword: answered with the booking link; the agent's own messages never are.
  const dm = (from, text, echo = false) => ({ object: 'instagram', entry: [{ id: '1790', time: 1, messaging: [{ sender: { id: from }, recipient: { id: '1790' }, timestamp: 1, message: { mid: `m-${from}`, text, ...(echo ? { is_echo: true } : {}) } }] }] });
  b = signed(dm('igsid-2', 'Plan'));
  await igHook(b.raw, b.sig);
  await until(() => igSeen.sent.length > before + 1);
  assert.deepEqual(igSeen.sent.at(-1).recipient, { id: 'igsid-2' });
  assert.match(igSeen.sent.at(-1).message.text, /^Hi there! Here’s the checklist: https:\/\/calendly\.com\/dana\/15min$/, 'no name shared: “there”');
  b = signed(dm('1790', 'PLAN', true)); await igHook(b.raw, b.sig);
  b = signed(dm('igsid-3', 'Hello there, how are you?')); await igHook(b.raw, b.sig);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(igSeen.sent.length, before + 2, 'no keyword, no echo');
  // Instagram refusing: logged.
  igSeen.down = true;
  b = signed(dm('igsid-4', 'PLAN')); await igHook(b.raw, b.sig);
  await until(() => replies.log(w.id).some(x => x.from === undefined && !x.ok && /Instagram/.test(x.why)) || replies.log(w.id).some(x => !x.ok && /Instagram/.test(x.why)));
  igSeen.down = false;
  // Turned off, or switched off in Admin: nothing is sent.
  replies.setOn(w.id, false);
  b = signed(dm('igsid-5', 'PLAN')); await igHook(b.raw, b.sig);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(igSeen.sent.length, before + 2);
  assert.equal(store.getVideo(w.id, 'rl1').status, 'posted');
  assert.equal(replies.state(w.id).rules[0].sent, 2);
});

/* ---------------- 9d: A/B tests of openings ---------------- */

const fullSkip = !process.env.FULL_TEST ? 'renders two videos; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : false;

/* ---------------- Phase 9 review fixes ---------------- */

test('review fixes: keyword replies: limits counted apart from the log; the wording re-checked as it’s sent; bare links and quiet edits caught', async () => {
  const w = mkWs('Replies fixes');
  connectIg(w, { userId: '1791', scopes: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments' });
  const rule = replies.saveRule(w.id, { keyword: 'GUIDE', where: 'dm', text: 'Hi {name}! Here it is: {link}' }, { by: 'x', byName: 'Dana', approve: true });
  replies.setOn(w.id, true);
  const sent = [], send = async (ws, to, text) => { sent.push({ to, text }); };
  const wsRec = store.getWorkspace(w.id), ev = from => ({ igId: '1791', where: 'dm', from, text: 'GUIDE', mid: `m-${from}` });
  // The daily cap holds even when the log is full of refusals.
  paths.writeJSON(path.join(store.wsDir(w.id), 'replies-count.json'), { sends: Array.from({ length: replies.MAX_PER_DAY }, () => Date.now() - 1000) });
  for (let k = 0; k < 400; k++) paths.updateJSON(path.join(store.wsDir(w.id), 'replies-log.json'), [], l => [{ at: new Date().toISOString(), ok: false, why: 'x', from: `f${k}` }, ...l].slice(0, 300));
  assert.match((await replies.handle(wsRec, ev('igsid-50'), { send })).why, /100-a-day limit/);
  assert.equal(sent.length, 0);
  paths.writeJSON(path.join(store.wsDir(w.id), 'replies-count.json'), {});
  await replies.handle(wsRec, ev('igsid-50'), { send });
  assert.equal(sent.length, 1);
  assert.equal((await replies.handle(wsRec, ev('igsid-50'), { send })).why, 'Already answered today');
  // A never-use word added after approval: not sent, back to waiting for approval.
  const c = store.loadConfig(w.id); c.guardrails = { ...c.guardrails, neverUse: [...c.guardrails.neverUse, 'guide'] }; store.saveConfig(w.id, c);
  const r2 = replies.saveRule(w.id, { id: rule.id, keyword: 'GUIDE', where: 'dm', text: 'Hi {name}! Here is the checklist: {link}' }, { by: 'x', byName: 'Dana', approve: true });
  const c2 = store.loadConfig(w.id); c2.guardrails = { ...c2.guardrails, neverUse: [...c2.guardrails.neverUse, 'checklist'] }; store.saveConfig(w.id, c2);
  const out = await replies.handle(wsRec, ev('igsid-51'), { send });
  assert.match(out.why, /needs approving again/); assert.equal(sent.length, 1);
  assert.equal(replies.state(w.id).rules.find(x => x.id === r2.id).status, 'draft');
  // Links without https:// count; the booking link may be written out.
  const cfg = store.loadConfig(w.id);
  assert.ok(replies.problems('More at bit.ly/xyz', cfg).length); assert.ok(replies.problems('See example.com/page', cfg).length);
  assert.deepEqual(replies.problems('Pick a time: https://calendly.com/dana/15min', cfg), []);
  assert.ok(replies.problems('https://calendly.com/dana-other', cfg).length);
  // An assistant changing only the keyword: approved again by the agent.
  const r3 = replies.saveRule(w.id, { keyword: 'PLAN', where: 'dm', text: 'Hi {name}: {link}' }, { by: 'x', byName: 'Dana', approve: true });
  assert.equal(replies.saveRule(w.id, { id: r3.id, keyword: 'PLANS', where: 'dm', text: 'Hi {name}: {link}' }, { by: 'y', byName: 'Sam' }).status, 'draft');
});

test('review fixes: the export holds keyword replies; turning sign-off on tells the reviewer what’s waiting', async () => {
  const w = mkWs('Fix misc');
  store.createAccount({ email: 'fm@example.com', name: 'Dana Agent', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('fmpass123456') });
  const rv = store.createAccount({ email: 'fmr@example.com', name: 'Rev', role: 'agent', workspaceId: w.id, hash: 'x' });
  store.setMembership(rv.id, w.id, { role: 'reviewer' });
  const a = await login('fm@example.com', 'fmpass123456');
  replies.saveRule(w.id, { keyword: 'PLAN', where: 'both', text: 'Hi {name}: {link}' }, { by: 'x', byName: 'Dana', approve: true });
  const { exportWorkspace, exportCounts } = await import('../lib/data.js');
  const ex = exportWorkspace(w.id);
  assert.equal(ex.keywordReplies.rules[0].keyword, 'PLAN');
  assert.equal(exportCounts(ex).keywordReplies, 1);
  signoff.setOn(w.id, true, 'x');
  vid(w, 'wk1', { status: 'approved', approval: { at: new Date().toISOString() } });
  assert.equal(signoff.tellReviewers(w.id), 1, 'turning it on tells the reviewer what’s already waiting');
});

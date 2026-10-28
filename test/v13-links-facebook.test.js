// v13 Phase 5: a tracking link for every video (clicks counted, fed into what the app learns), and
// cross-posting to the agent's Facebook Page as Reels (against a fake Facebook).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();

/* ---------------- A fake Facebook (OAuth, Pages, Reels upload) ---------------- */
const fbSeen = { uploads: [], finishes: [], starts: 0, pages: 1, revoked: false, status: 'complete', finishFail: 0 };
const fbServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = ''; for await (const c of req) raw += c;
  const form = new URLSearchParams(raw), q = url.searchParams;
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const tok = q.get('access_token') || form.get('access_token') || String(req.headers.authorization || '').replace(/^OAuth /, '');
  if (fbSeen.revoked && tok && !url.pathname.includes('oauth')) return json(400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } });
  if (url.pathname === '/v25.0/oauth/access_token') {
    if (q.get('grant_type') === 'fb_exchange_token') return json(200, { access_token: 'user-long' });
    return q.get('code') === 'good' ? json(200, { access_token: 'user-short' }) : json(400, { error: { message: 'bad code' } });
  }
  if (url.pathname === '/v25.0/me/accounts') {
    const all = [{ id: '555', name: 'Melanie Insurance', access_token: 'page-token-555', tasks: ['CREATE_CONTENT', 'MANAGE'] }, { id: '666', name: 'Melanie Church Group', access_token: 'page-token-666', tasks: ['CREATE_CONTENT'] }, { id: '777', name: 'Can only read', access_token: 'page-token-777', tasks: ['ANALYZE'] }];
    return json(200, { data: fbSeen.pages === 1 ? [all[0], all[2]] : all });
  }
  if (/^\/v25\.0\/\d+\/video_reels$/.test(url.pathname)) {
    if (form.get('upload_phase') === 'start') { fbSeen.starts++; return json(200, { video_id: 'v' + fbSeen.starts, upload_url: 'ignored' }); }
    if (form.get('upload_phase') === 'finish' && fbSeen.finishFail > 0) { fbSeen.finishFail--; return json(503, { error: { message: 'Service temporarily unavailable' } }); }
    if (form.get('upload_phase') === 'finish') { fbSeen.finishes.push({ page: url.pathname.split('/')[2], video: form.get('video_id'), state: form.get('video_state'), description: form.get('description'), token: tok }); return json(200, { success: true }); }
  }
  if (url.pathname.startsWith('/video-upload/v25.0/')) {
    // Like Facebook, download the video from the signed link.
    const r = await fetch(req.headers.file_url);
    fbSeen.uploads.push({ status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength, auth: req.headers.authorization });
    return json(200, { success: true });
  }
  if (/^\/v25\.0\/v\d+$/.test(url.pathname)) return json(200, { status: { video_status: fbSeen.status === 'error' ? 'error' : 'ready', publishing_phase: { status: fbSeen.status } }, permalink_url: `/reel/${url.pathname.slice(-1)}00` });
  json(404, { error: { message: 'no stub ' + url.pathname } });
});
await new Promise(r => fbServer.listen(0, '127.0.0.1', r));
const fbBase = `http://127.0.0.1:${fbServer.address().port}`;
Object.assign(process.env, { FACEBOOK_APP_ID: '987', FACEBOOK_APP_SECRET: 'fb-secret', FACEBOOK_AUTH_BASE: fbBase, FACEBOOK_GRAPH_BASE: fbBase, FACEBOOK_UPLOAD_BASE: fbBase, INSTAGRAM_ALLOW_HTTP: '1' });

const store = await import('../lib/store.js');
const { readJSON, writeJSON } = await import('../lib/paths.js');
const auth = await import('../lib/auth.js');
const M = await import('../mixer-core.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const fb = await import('../lib/facebook.js');
const links = await import('../lib/links.js');
const posting = await import('../lib/posting.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;
test.after(() => { server.close(); stubs.close(); fbServer.close(); });

const ws = store.createWorkspace({ name: 'Melanie', comped: true });
const cfg = store.loadConfig(ws.id);
cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
cfg.look = { ...cfg.look, name: 'Melanie Banteah', disclaimer: 'Lic. #12345' };
store.saveConfig(ws.id, cfg);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'mel@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('melpass12345') });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
const c = client(port), admin = client(port);
await c.post('/api/login', { email: 'mel@example.com', password: 'melpass12345' });
await admin.post('/api/login', { email: 'boss@example.com', password: 'bosspass1234' });
const setLook = patch => { const x = store.loadConfig(ws.id); x.look = { ...x.look, ...patch }; store.saveConfig(ws.id, x); };

function fakeVideo(status = 'approved', extra = {}) {
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(store.videoPath(ws.id, `video_${id}.mp4`), Buffer.from('fake mp4 bytes ' + id));
  fs.writeFileSync(store.videoPath(ws.id, `cover_${id}.jpg`), Buffer.from('fake jpg'));
  return store.addVideo(ws.id, { id, file: `video_${id}.mp4`, cover: `cover_${id}.jpg`, status, createdAt: new Date().toISOString(), meta: { painPoint: 'Funeral costs', painId: 'fe_p1', format: 'question' }, scenes: [{ text: 'Hi' }], post: 'Planning ahead helps. Message me.\nLic. #12345', clips: [], preflight: [], ...(status === 'approved' ? { approval: { at: new Date().toISOString() } } : {}), ...extra });
}
const loggedIn = cl => ({ redirect: 'manual', headers: { cookie: cl.cookie } });
const hit = (code, { ua = 'Mozilla/5.0 (iPhone) Instagram 300', ip = '203.0.113.5', method = 'GET' } = {}) => fetch(`${process.env.PUBLIC_URL}/r/${code}`, { method, redirect: 'manual', headers: { 'user-agent': ua, 'x-forwarded-for': ip } });

/* ---------------- The rules ---------------- */
test('booking links: only plain https; the tracking line goes above the small print and passes the post checks', () => {
  assert.equal(M.okBookingUrl('https://calendly.com/melanie/15min'), true);
  ['http://calendly.com/x', 'https://calendly.com/a b', 'javascript:alert(1)', 'https://x', 'https://ok.com/"><script>', ''].forEach(u => assert.equal(M.okBookingUrl(u), false, u));
  assert.equal(M.migrate({ ...cfg, look: { ...cfg.look, bookingUrl: 'http://nope.com' } }).look.bookingUrl, '');
  assert.equal(M.migrate({ ...cfg, look: { ...cfg.look, bookingUrl: ' https://calendly.com/m ' } }).look.bookingUrl, 'https://calendly.com/m');
  const c1 = { ...cfg, look: { ...cfg.look, disclaimer: 'Lic. #12345' } };
  const out = M.withTrackingLink('Planning ahead helps. Message me.\nLic. #12345', c1, 'https://site.com/r/abc');
  assert.deepEqual(out.split('\n'), ['Planning ahead helps. Message me.', 'Pick a time to talk with me: https://site.com/r/abc', 'Lic. #12345']);
  assert.ok(M.validatePost(JSON.stringify({ caption: out }), c1).ok, JSON.stringify(M.validatePost(JSON.stringify({ caption: out }), c1).problems));
  assert.equal(M.withTrackingLink(out, c1, 'https://site.com/r/abc'), out, 'never twice');
  // Hashtags after the small print stay after it; the link still goes above the small print.
  assert.deepEqual(M.withTrackingLink('Plan ahead.\nLic. #12345\n#family', c1, 'https://s.co/r/x').split('\n'), ['Plan ahead.', 'Pick a time to talk with me: https://s.co/r/x', 'Lic. #12345', '#family']);
  // A failed post on a place the plan doesn't use doesn't hold a video back; one on a place it uses does.
  const ok = { status: 'approved', file: 'x' };
  assert.equal(M.planReady({ ...ok, fbpost: { status: 'failed' } }, ['instagram']), true);
  assert.equal(M.planReady({ ...ok, fbpost: { status: 'failed' } }, ['instagram', 'facebook']), false);
  assert.equal(M.planReady({ ...ok, autopost: { status: 'posted' } }, ['facebook']), true);
  // Posting plan places.
  assert.deepEqual(M.migrate({ ...cfg, schedule: { autopost: { platforms: ['facebook', 'tiktok', 'facebook'] } } }).schedule.autopost.platforms, ['facebook']);
  assert.deepEqual(M.migrate({ ...cfg, schedule: { autopost: { platforms: [] } } }).schedule.autopost.platforms, ['instagram']);
});

test('clicks count toward what works, at half a message each', () => {
  const v = (painId, messages, clicks) => ({ status: 'posted', meta: { painId, format: 'question' }, ...(messages != null ? { results: { views: 100, messages } } : {}), ...(clicks ? { clicks: { total: clicks } } : {}) });
  const b = M.boostsFrom([v('a', 0, 4), v('a', 0, 4), v('b', 0), v('b', 0)]);
  assert.ok(b.pains.a > 1.9, 'clicks alone lift a worry');
  assert.equal(b.pains.b, 1);
  assert.equal(M.resultValue({ results: { messages: 1 }, clicks: { total: 2 } }), 2);
});

/* ---------------- Tracking links ---------------- */
test('tracking links: each video gets a random code; clicks go to the booking page and are counted once per person', async () => {
  links._resetSeen();
  const v = fakeVideo('approved');
  const code = links.codeFor(ws.id, v.id);
  assert.match(code, /^[a-f0-9]{10}$/);
  assert.equal(links.codeFor(ws.id, v.id), code, 'the same code every time');
  assert.notEqual(code, v.id);
  // No booking link yet: (v15) the agent's page shows, with just the short form.
  let r = await hit(code);
  assert.equal(r.status, 200); assert.match(await r.text(), /Leave your number/);
  // With "go straight to my booking page" (v15: the page is the default), the link goes there.
  setLook({ bookingUrl: 'https://calendly.com/melanie', landing: 'direct' });
  r = await hit(code);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `https://calendly.com/melanie?utm_source=agentreels&utm_medium=video&utm_content=${code}`, '(v15 Phase 9) the code rides along');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  await hit(code);                                         // the same person again: not counted
  await hit(code, { ip: '198.51.100.7' });                 // someone else
  await hit(code, { ua: 'facebookexternalhit/1.1' });      // a link preview
  await hit(code, { ua: 'Slackbot-LinkExpanding 1.0' });
  await hit(code, { method: 'HEAD', ip: '198.51.100.8' });
  await hit(code, { ip: '203.0.113.5', ua: 'Mozilla/5.0 (Android) other browser' });   // the same address, another browser: still once
  links.flush();
  assert.equal(store.getVideo(ws.id, v.id).clicks.total, 2);
  // One address can't run up the count across links: at most 20 an hour.
  const many = Array.from({ length: 25 }, () => links.codeFor(ws.id, fakeVideo('approved').id));
  for (const k of many) await hit(k, { ip: '192.0.2.99' });
  links.flush();
  assert.equal(many.reduce((a, k) => a + (store.getVideo(ws.id, links.resolve(k).v).clicks?.total || 0), 0), 20);
  assert.equal((await hit('ffffffffff')).status, 404);
  assert.equal((await hit('../../etc')).status, 404);
  // Review shows the link and clicks; stats and Admin count them.
  const list = (await c.get('/api/videos')).data;
  const mine = list.videos.find(x => x.id === v.id);
  assert.equal(mine.trackUrl, `${process.env.PUBLIC_URL}/r/${code}`);
  assert.equal(mine.clicks.total, 2);
  assert.ok(list.stats.totals.clicksMonth >= 2);
  const o = (await admin.get('/api/admin/overview')).data.workspaces.find(w => w.id === ws.id);
  assert.ok(o.clicks >= 2);
  // A suspended workspace's links stop.
  store.updateWorkspace(ws.id, { suspended: true });
  assert.equal((await hit(code, { ip: '192.0.2.44' })).status, 404);
  store.updateWorkspace(ws.id, { suspended: false });
});

test('tracking links: older videos get theirs at startup; deleted videos and workspaces lose them', async () => {
  const old = fakeVideo('posted');
  assert.equal(store.getVideo(ws.id, old.id).link, undefined);
  links.backfill();
  const code = store.getVideo(ws.id, old.id).link;
  assert.ok(links.resolve(code));
  const p = fakeVideo('pending');
  const pc = links.codeFor(ws.id, p.id);
  assert.equal((await c.del(`/api/videos/${p.id}`)).status, 200);
  assert.equal(links.resolve(pc), null);
  const other = store.createWorkspace({ name: 'Gone' });
  const oc = (() => { const id = 'x' + Date.now(); store.addVideo(other.id, { id, status: 'approved', createdAt: new Date().toISOString() }); return links.codeFor(other.id, id); })();
  const data = await import('../lib/data.js');
  data.deleteWorkspace(other.id);
  assert.equal(links.resolve(oc), null);
});

/* ---------------- Facebook ---------------- */
test('Facebook: connect a Page (one Page connects straight away), token stored encrypted', async () => {
  const info = await c.get('/api/facebook');
  assert.deepEqual([info.data.enabled, info.data.ready, info.data.account.connected], [true, true, false]);
  const u = new URL((await c.post('/api/facebook/connect')).data.url);
  assert.equal(u.pathname, '/v25.0/dialog/oauth');
  assert.equal(u.searchParams.get('redirect_uri'), `${process.env.PUBLIC_URL}/api/facebook/callback`);
  assert.match(u.searchParams.get('scope'), /pages_manage_posts/);
  const state = u.searchParams.get('state');
  // Someone else (not logged in as the person who started it) can't finish the connection.
  const stolen = await fetch(`${process.env.PUBLIC_URL}/api/facebook/callback?code=good&state=${state}`, { redirect: 'manual' });
  assert.match(stolen.headers.get('location'), /fb=error&msg=Log%20in/);
  const state2 = new URL((await c.post('/api/facebook/connect')).data.url).searchParams.get('state');
  const cb = await fetch(`${process.env.PUBLIC_URL}/api/facebook/callback?code=good&state=${state2}`, loggedIn(c));
  assert.match(cb.headers.get('location'), /^\/#\/autopilot\?fb=connected&msg=Melanie%20Insurance/);
  const again = await fetch(`${process.env.PUBLIC_URL}/api/facebook/callback?code=good&state=${state2}`, loggedIn(c));
  assert.match(again.headers.get('location'), /fb=error/, 'a state works once');
  const saved = readJSON(path.join(store.wsDir(ws.id), 'facebook.json'));
  assert.notEqual(saved.token, 'page-token-555'); assert.equal(fb.unseal(saved.token), 'page-token-555');
  assert.deepEqual([(await c.get('/api/facebook')).data.account.pageName, (await c.get('/api/me')).data.facebook], ['Melanie Insurance', true]);
});

test('Facebook: several Pages are offered to pick from (only ones the agent can post to)', async () => {
  fbSeen.pages = 2;
  const other = store.createWorkspace({ name: 'Two pages', comped: true });
  store.createAccount({ email: 'two@example.com', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('twopass12345') });
  const c2 = client(port);
  await c2.post('/api/login', { email: 'two@example.com', password: 'twopass12345' });
  const state = new URL((await c2.post('/api/facebook/connect')).data.url).searchParams.get('state');
  const cb = await fetch(`${process.env.PUBLIC_URL}/api/facebook/callback?code=good&state=${state}`, loggedIn(c2));
  assert.match(cb.headers.get('location'), /fb=choose/);
  const acc = (await c2.get('/api/facebook')).data.account;
  assert.deepEqual(acc.choose.map(p => p.name), ['Melanie Insurance', 'Melanie Church Group']);
  assert.equal(JSON.stringify(acc).includes('token'), false, 'no tokens sent to the browser');
  assert.equal((await c2.post('/api/facebook/page', { pageId: '777' })).status, 409, 'not one it can post to');
  const picked = (await c2.post('/api/facebook/page', { pageId: '666' })).data.account;
  assert.deepEqual([picked.connected, picked.pageName], [true, 'Melanie Church Group']);
  assert.equal(fb.unseal(readJSON(path.join(store.wsDir(other.id), 'facebook.json')).token), 'page-token-666');
  fbSeen.pages = 1;
});

test('Facebook: an approved video posts as a Reel from the signed link, with its tracking link; then it’s posted', async () => {
  setLook({ bookingUrl: 'https://calendly.com/melanie' });
  const pending = fakeVideo('pending');
  assert.equal((await c.post(`/api/videos/${pending.id}/facebook`, { at: 'now' })).status, 409, 'only approved videos post');
  const v = fakeVideo('approved');
  const later = new Date(Date.now() + 3600000).toISOString();
  assert.equal((await c.post(`/api/videos/${v.id}/facebook`, { at: later })).data.video.fbpost.status, 'scheduled');
  assert.equal((await c.del(`/api/videos/${v.id}/facebook`)).status, 200);
  const preview = (await c.get(`/api/videos/${v.id}/facebook-text`)).data.text;
  assert.match(preview, /Pick a time to talk with me: http:\/\/127\.0\.0\.1:\d+\/r\/[a-f0-9]{10}\nLic\. #12345$/);
  assert.equal((await c.post(`/api/videos/${v.id}/facebook`, { at: 'now' })).status, 200);
  let r = await fb.tick();
  assert.deepEqual(r.filter(x => x.video === v.id).map(x => x.status), ['processing']);
  const up = fbSeen.uploads.at(-1), fin = fbSeen.finishes.at(-1);
  assert.deepEqual([up.status, up.type, up.auth], [200, 'video/mp4', 'OAuth page-token-555']);
  assert.deepEqual([fin.page, fin.state, fin.description], ['555', 'PUBLISHED', preview]);
  r = await fb.tick();
  assert.deepEqual(r.filter(x => x.video === v.id).map(x => x.status), ['posted']);
  const done = store.getVideo(ws.id, v.id);
  assert.deepEqual([done.status, done.posted.by, done.posted.auto, done.fbpost.url], ['posted', 'facebook', true, 'https://www.facebook.com/reel/100'.replace('100', done.fbpost.videoId.slice(1) + '00')]);
  assert.equal((await c.post(`/api/videos/${v.id}/facebook`, { at: 'now' })).status, 409, 'not twice');
});

test('Facebook: a publish that fails part-way is carried on with the same video, never started twice', async () => {
  const v = fakeVideo('approved');
  fbSeen.finishFail = 1;
  const before = fbSeen.starts;
  await c.post(`/api/videos/${v.id}/facebook`, { at: 'now' });
  await fb.tick();
  let fp = store.getVideo(ws.id, v.id).fbpost;
  assert.deepEqual([fp.status, fp.phase, fp.attempts || 0], ['processing', 'uploaded', 0], 'kept its place (Facebook not answering doesn’t use up a try, v15)');
  // While it's posting it can't be sent back to review.
  assert.equal((await c.post(`/api/videos/${v.id}/reopen`)).status, 409);
  await fb.tick();   // finish again, same video
  await fb.tick();   // published
  fp = store.getVideo(ws.id, v.id).fbpost;
  assert.equal(fp.status, 'posted');
  assert.equal(fbSeen.starts - before, 1, 'one start, one Reel');
});

test('Facebook: a failed or revoked post is reported; videos sent back to review don’t post', async () => {
  const alerts = await import('../lib/alerts.js');
  fbSeen.status = 'error';
  const v = fakeVideo('approved');
  await c.post(`/api/videos/${v.id}/facebook`, { at: 'now' });
  await fb.tick(); await fb.tick();
  assert.equal(store.getVideo(ws.id, v.id).fbpost.status, 'failed');
  fbSeen.status = 'complete';
  // Sent back to review while scheduled: the schedule is cleared.
  const v2 = fakeVideo('approved');
  await c.post(`/api/videos/${v2.id}/facebook`, { at: new Date(Date.now() + 3600000).toISOString() });
  await c.post(`/api/videos/${v2.id}/reopen`);
  assert.equal(store.getVideo(ws.id, v2.id).fbpost, null);
  // Revoked: the account needs reconnecting and you're alerted.
  fbSeen.revoked = true;
  const v3 = fakeVideo('approved');
  await c.post(`/api/videos/${v3.id}/facebook`, { at: 'now' });
  await fb.tick();
  assert.equal(fb.account(ws.id).problem, 'reconnect');
  assert.ok(alerts.listAlerts().some(a => a.kind === 'facebook' && /connected again/.test(a.title)));
  assert.equal((await c.post(`/api/videos/${fakeVideo('approved').id}/facebook`, { at: 'now' })).status, 409);
  fbSeen.revoked = false;
  const file = path.join(store.wsDir(ws.id), 'facebook.json');
  writeJSON(file, { ...readJSON(file), problem: '' });
});

test('the posting plan posts to the places chosen, once a day, skipping places that aren’t connected', async () => {
  const c1 = store.loadConfig(ws.id);
  c1.schedule.autopost = { on: true, time: '00:00', days: [0, 1, 2, 3, 4, 5, 6], platforms: ['instagram'] };
  store.saveConfig(ws.id, c1);
  store.updateWorkspace(ws.id, { autopostDay: '' });
  for (const x of store.readVideos(ws.id).filter(y => y.status === 'approved' && !y.fbpost)) store.updateVideo(ws.id, x.id, { status: 'rejected' });
  const older = fakeVideo('approved', { approval: { at: '2026-01-01T00:00:00Z' } });
  fakeVideo('approved', { approval: { at: '2026-02-01T00:00:00Z' } });
  // Instagram isn't set up on this server: nothing happens, and the day isn't used up.
  assert.deepEqual(posting.planPlaces(ws.id), []);
  assert.equal(posting.planNext(store.getWorkspace(ws.id)), null);
  assert.equal(store.getWorkspace(ws.id).autopostDay, '');
  c1.schedule.autopost.platforms = ['instagram', 'facebook'];
  store.saveConfig(ws.id, c1);
  await fb.tick();
  assert.equal(store.getVideo(ws.id, older.id).fbpost.status, 'processing', 'the oldest approved video, to Facebook');
  await fb.tick();
  assert.equal(store.getVideo(ws.id, older.id).fbpost.status, 'posted');
  assert.equal(store.readVideos(ws.id).filter(x => x.fbpost?.by === 'plan').length, 1, 'once a day');
  // Running low counts only videos not scheduled anywhere.
  assert.equal(M.runningLow(store.loadConfig(ws.id), [{ status: 'approved', file: 'x', fbpost: { status: 'scheduled' } }]).approved, 0);
  c1.schedule.autopost.on = false; store.saveConfig(ws.id, c1);
});

test('Facebook: disconnecting removes the Page and clears what was scheduled for it', async () => {
  const v = fakeVideo('approved'), busy = fakeVideo('approved', { fbpost: { status: 'processing', phase: 'finished', videoId: 'v9', startedAt: new Date().toISOString() } });
  await c.post(`/api/videos/${v.id}/facebook`, { at: new Date(Date.now() + 3600000).toISOString() });
  assert.equal((await c.del('/api/facebook')).data.account.connected, false);
  assert.equal(store.getVideo(ws.id, v.id).fbpost, null);
  assert.equal(store.getVideo(ws.id, busy.id).fbpost.status, 'failed', 'not left posting forever');
  assert.equal(readJSON(path.join(store.wsDir(ws.id), 'facebook.json'), null), null);
  const exp = (await import('../lib/data.js')).exportWorkspace(ws.id);
  assert.equal(exp.facebook.connected, false);
});

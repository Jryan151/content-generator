// Version 11: communication styles, the input workshop, word-by-word captions, the end-card logo,
// alerts, done-for-you tracking and Instagram auto-posting (against a fake Instagram).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();

/* ---------------- A fake Instagram (OAuth + Graph API) ---------------- */
const igSeen = { fetched: [], published: 0, refreshed: 0 };
const igServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = ''; for await (const c of req) raw += c;
  const form = new URLSearchParams(raw);
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/oauth/access_token') return form.get('code') === 'good' ? json(200, { data: [{ access_token: 'short', user_id: '17841', permissions: 'instagram_business_basic,instagram_business_content_publish' }] }) : json(400, { error_message: 'bad code' });
  if (url.pathname === '/access_token') return json(200, { access_token: 'long-token', token_type: 'bearer', expires_in: 5183944 });
  if (url.pathname === '/refresh_access_token') {
    if (igSeen.revoked) return json(400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } });
    igSeen.refreshed++; return json(200, { access_token: 'long-token-2', token_type: 'bearer', expires_in: 5183944 });
  }
  if (url.pathname === '/v25.0/me') return json(200, { user_id: '17841', username: 'melanie.agent', id: 'app1' });
  if (url.pathname === '/v25.0/17841/media') {
    // Like Instagram, download the video (and cover) from the signed link.
    for (const k of ['video_url', 'cover_url']) if (form.get(k)) { const r = await fetch(form.get(k)); igSeen.fetched.push({ k, status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }); }
    igSeen.caption = form.get('caption'); igSeen.mediaType = form.get('media_type');
    return json(200, { id: 'c' + igSeen.fetched.length });
  }
  if (/^\/v25\.0\/c\d+$/.test(url.pathname)) return json(200, { status_code: 'FINISHED' });
  if (url.pathname === '/v25.0/17841/media_publish') { igSeen.published++; return json(200, { id: 'm' + igSeen.published }); }
  if (/^\/v25\.0\/m\d+$/.test(url.pathname)) return json(200, { permalink: `https://www.instagram.com/reel/${url.pathname.slice(-2)}/` });
  json(404, { error: { message: 'no stub ' + url.pathname } });
});
await new Promise(r => igServer.listen(0, '127.0.0.1', r));
const igBase = `http://127.0.0.1:${igServer.address().port}`;
Object.assign(process.env, { INSTAGRAM_APP_ID: '123', INSTAGRAM_APP_SECRET: 'ig-secret', INSTAGRAM_AUTH_BASE: igBase, INSTAGRAM_OAUTH_BASE: igBase, INSTAGRAM_GRAPH_BASE: igBase, INSTAGRAM_ALLOW_HTTP: '1' });

const store = await import('../lib/store.js');
const { readJSON, writeJSON } = await import('../lib/paths.js');
const auth = await import('../lib/auth.js');
const core = { ...(await import('../mixer-core.js')), ...(await import('../lib/prompts.js')) };
const comms = await import('../comms-core.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const ig = await import('../lib/instagram.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;
test.after(() => { server.close(); stubs.close(); igServer.close(); });

const ws = store.createWorkspace({ name: 'Melanie', comped: true });
const cfg = store.loadConfig(ws.id);
cfg.story = { ...cfg.story, ...starterStory() };
cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
cfg.look.name = 'Melanie Banteah';
store.saveConfig(ws.id, cfg);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'mel@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('melpass12345') });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
const c = client(port), admin = client(port);
await c.post('/api/login', { email: 'mel@example.com', password: 'melpass12345' });
await admin.post('/api/login', { email: 'boss@example.com', password: 'bosspass1234' });

function fakeVideo(status = 'approved', extra = {}) {
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(store.videoPath(ws.id, `video_${id}.mp4`), Buffer.from('fake mp4 bytes ' + id));
  fs.writeFileSync(store.videoPath(ws.id, `cover_${id}.jpg`), Buffer.from('fake jpg'));
  return store.addVideo(ws.id, { id, file: `video_${id}.mp4`, cover: `cover_${id}.jpg`, status, createdAt: new Date().toISOString(), meta: { painPoint: 'Funeral costs', painId: 't_funeral', format: 'question' }, scenes: [{ text: 'Hi' }], post: 'Planning ahead helps. Message me.', clips: [], preflight: [], ...(status === 'approved' ? { approval: { at: new Date().toISOString() } } : {}), ...extra });
}

/* ---------------- Communication styles ---------------- */
test('styles normalize, label and describe themselves', () => {
  assert.equal(comms.normStyle('cs'), 'CS');
  assert.equal(comms.normStyle('SSDx'), 'SD');
  assert.equal(comms.normStyle('xyz'), '');
  assert.equal(comms.styleLabel('SC'), 'Steady + Careful');
  assert.match(comms.styleRules('S'), /^Steady: gentle/);
  assert.equal(comms.DRILL.length, 16);
  assert.ok(comms.DRILL.every(d => comms.STYLE_KEYS.includes(d.style)));
  assert.match(comms.playbookText(), /never assume a style from age/);
});

test('an audience’s style reaches the script and hook prompts, and is applied by the coach', () => {
  const c0 = core.migrate(cfg);
  assert.equal(c0.story.audiences[0].style, '', 'no style by default');
  assert.equal(core.migrate({ ...c0, story: { ...c0.story, audiences: [{ ...c0.story.audiences[0], style: 'zz' }] } }).story.audiences[0].style, '');
  const styled = core.applySuggestionTo(c0, { type: 'set_style', audienceId: 'aud', style: 'sc' });
  assert.equal(styled.story.audiences.find(a => a.id === 'aud').style, 'SC');
  const picks = core.roll(styled, Math.random, [], { painId: 't_budget', audienceId: 'aud' });
  assert.equal(picks.audience.id, 'aud');
  assert.match(core.buildPrompt(styled, picks).user, /How this audience likes to be spoken to \(Steady \+ Careful\): Steady: gentle/);
  assert.match(core.buildHookPrompt(styled, picks).user, /leans Steady \+ Careful/);
  assert.doesNotMatch(core.buildPrompt(c0, { ...picks, audience: c0.story.audiences[0] }).user, /likes to be spoken to/);
  assert.ok(core.analyze(c0).warnings.some(w => /communication style/.test(w.msg)));
});

test('new look and posting-plan settings get safe defaults', () => {
  const m = core.migrate({ ...cfg, look: { ...cfg.look, captionStyle: 'zoom', accentColor: 'neon', logo: 'yes' }, schedule: { keepReady: 2, autopost: { on: 1, time: '25:00', days: [1, 9, 3, 3] } } });
  assert.equal(m.look.captionStyle, 'line');
  assert.equal(m.look.accentColor, 'sand');
  assert.equal(m.look.logo, 'off');
  assert.deepEqual(m.schedule.autopost, { on: true, time: '09:00', days: [1, 3], platforms: ['instagram'] });
  assert.equal(m.schedule.keepReady, 2);
});

test('word-by-word captions hide each word until its turn; colors convert to ASS', async () => {
  const { captionMarkup, wordTimings, assColor } = await import('../stages/render.js');
  assert.equal(assColor('#EED2A8'), '&H00A8D2EE&');
  const t = wordTimings('Your kids deserve a plan', 2);
  assert.equal(t.length, 5);
  assert.ok(Math.abs(t.reduce((a, b) => a + b, 0) - 200) <= 3);
  const m = captionMarkup('Your kids deserve a plan', 'your kids', { color: assColor('#F6C453'), karaoke: t });
  assert.equal((m.text.match(/\\ko\d+/g) || []).length, 5);
  assert.match(m.text, /&H0053C4F6&/);
  assert.doesNotMatch(captionMarkup('Your kids deserve a plan', 'kids').text, /\\ko/);
});

/* ---------------- The communication coach and workshop ---------------- */
test('the communication coach suggests audience styles, and only valid ones get through', async () => {
  const r = await c.post('/api/coach', { mode: 'comms', messages: [{ role: 'user', content: 'How does my senior audience like to be spoken to?' }], focus: { audienceId: 'aud' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.reply, /Steady/);
  assert.deepEqual(r.data.suggestions.map(s => s.type), ['set_style', 'edit_worry']);
  assert.equal(r.data.suggestions[0].style, 'SC');
  assert.equal(r.data.suggestions[0].tryable, true);
});

test('the workshop scores an input and only returns rewrites that pass the checks', async () => {
  const w = await c.post('/api/comms/workshop', { kind: 'worry', text: 'I worry about funeral costs', audienceId: 'aud', style: 'S' });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.deepEqual(w.data.scores, { specific: 4, theirWords: 5, feeling: 2, oneIdea: 1, styleFit: 1 }, 'scores clamped to 1-5');
  assert.equal(w.data.read.style, 'C');
  assert.equal(w.data.versions.length, 2, 'the banned and duplicate versions are dropped');
  assert.ok(w.data.dropped >= 1);
  assert.equal(w.data.versions[0].apply.type, 'add_worry');
  assert.deepEqual(w.data.versions[0].apply.audienceIds, ['aud']);
  const e = await c.post('/api/comms/workshop', { kind: 'worry', text: 'old words', itemId: 't_funeral' });
  assert.equal(e.data.versions[0].apply.type, 'edit_worry');
  const f = await c.post('/api/comms/workshop', { kind: 'fact', text: 'Final expense helps.', painId: 't_health' });
  assert.deepEqual(f.data.versions.map(v => v.apply.type), ['add_fact', 'add_fact'], 'facts with absolute claims are dropped');
  const h = await c.post('/api/comms/workshop', { kind: 'hook', text: 'Have you thought about this?' });
  assert.equal(h.data.versions.length, 2);
  assert.ok(h.data.versions.every(v => !v.apply), 'hooks are practice only');
  assert.equal((await c.post('/api/comms/workshop', { kind: 'nope', text: 'x' })).status, 400);
  assert.equal((await c.post('/api/comms/workshop', { kind: 'worry', text: '' })).status, 400);
});

test('DM replies come with a read of the sender’s style', async () => {
  const r = await c.post('/api/coach/reply', { message: 'What exactly does the waiting period mean?' });
  assert.equal(r.status, 200);
  assert.equal(r.data.style, 'S');
  assert.match(r.data.read, /Polite/);
});

/* ---------------- Logo ---------------- */
test('a logo can be uploaded, served and removed; non-images are refused', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR, 'logo-'));
  const png = path.join(dir, 'l.png');
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=1200x400', '-frames:v', '1', png]);
  const r = await c.post('/api/brand/logo', { image: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await c.get('/api/brand/logo');
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', store.logoPath(ws.id)]).stdout.toString().trim();
  assert.equal(probe, '800,267', 'scaled to fit 800×800');
  assert.equal((await c.post('/api/brand/logo', { image: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') })).status, 400);
  assert.equal((await c.post('/api/brand/logo', { image: 'hello' })).status, 400);
  assert.equal((await c.del('/api/brand/logo')).status, 200);
  assert.equal((await c.get('/api/brand/logo')).status, 404);
});

/* ---------------- Alerts and done for you ---------------- */
test('alerts are kept, deduplicated, and sent in the right format', async () => {
  const alerts = await import('../lib/alerts.js');
  const got = [];
  const hook = http.createServer(async (req, res) => { let b = ''; for await (const x of req) b += x; got.push({ type: req.headers['content-type'], title: req.headers.title, body: b }); res.end('ok'); });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  try {
    assert.equal(alerts.webhookFormat('https://ntfy.sh/my-topic'), 'text');
    assert.equal(alerts.webhookFormat('https://hooks.slack.com/services/x'), 'slack');
    assert.equal(alerts.webhookFormat('https://example.com/hook'), 'json');
    const a = alerts.notify({ title: 'A video failed', text: 'Pixabay answered 500', ws: ws.id, workspaceName: 'Melanie' });
    assert.ok(a);
    assert.equal(alerts.notify({ title: 'A video failed', text: 'Pixabay answered 500', ws: ws.id }), null, 'same alert within the hour');
    await alerts.sendWebhook(a, `http://127.0.0.1:${hook.address().port}/ntfy.sh/topic`);
    assert.equal(got[0].type, 'text/plain; charset=utf-8');
    assert.match(got[0].title, /A video failed \(Melanie\)/);
    const o = await admin.get('/api/admin/overview');
    assert.ok(o.data.alerts.some(x => x.title === 'A video failed'));
    assert.ok(o.data.unread >= 1);
    await admin.post('/api/admin/alerts/read');
    assert.equal((await admin.get('/api/admin/overview')).data.unread, 0);
  } finally { hook.close(); }
});

test('a job that fails for good reaches the failed hook once; quiet failures do not', async () => {
  const queue = await import('../lib/queue.js');
  const seen = [];
  queue.startWorker(async job => { throw Object.assign(new Error(job.opts.msg), { permanent: true, quiet: job.opts.quiet }); }, { failed: (job, e) => { if (!e.quiet) seen.push(e.message); } });
  queue.enqueue({ ws: ws.id, kind: 'video', opts: { msg: 'Render broke' } });
  queue.enqueue({ ws: ws.id, kind: 'video', opts: { msg: 'No plan', quiet: true } });
  await queue.idle(5000);
  assert.deepEqual(seen, ['Render broke']);
});

/* ---------------- Instagram ---------------- */
test('Instagram: connect, schedule an approved video, and it posts from a signed link', async () => {
  const info = await c.get('/api/instagram');
  assert.deepEqual([info.data.enabled, info.data.ready, info.data.account.connected], [true, true, false]);
  const { data } = await c.post('/api/instagram/connect');
  const u = new URL(data.url);
  assert.equal(u.searchParams.get('client_id'), '123');
  assert.equal(u.searchParams.get('redirect_uri'), `${process.env.PUBLIC_URL}/api/instagram/callback`);
  assert.match(u.searchParams.get('scope'), /instagram_business_content_publish/);
  const state = u.searchParams.get('state');
  const cb = await fetch(`${process.env.PUBLIC_URL}/api/instagram/callback?code=good&state=${state}`, { redirect: 'manual', headers: { cookie: c.cookie } });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /^\/#\/autopilot\?ig=connected&msg=%40melanie\.agent/);
  const again = await fetch(`${process.env.PUBLIC_URL}/api/instagram/callback?code=good&state=${state}`, { redirect: 'manual', headers: { cookie: c.cookie } });
  assert.match(again.headers.get('location'), /ig=error/, 'a state works once');
  const saved = readJSON(path.join(store.wsDir(ws.id), 'instagram.json'));
  assert.notEqual(saved.token, 'long-token', 'the token is stored encrypted');
  assert.equal(ig.unseal(saved.token), 'long-token');
  assert.equal((await c.get('/api/instagram')).data.account.username, 'melanie.agent');

  const pending = fakeVideo('pending');
  assert.equal((await c.post(`/api/videos/${pending.id}/autopost`, { at: 'now' })).status, 409, 'only approved videos post');
  const v = fakeVideo('approved');
  const later = new Date(Date.now() + 3600000).toISOString();
  assert.equal((await c.post(`/api/videos/${v.id}/autopost`, { at: later })).data.video.autopost.status, 'scheduled');
  assert.equal((await c.del(`/api/videos/${v.id}/autopost`)).status, 200);
  assert.equal(store.getVideo(ws.id, v.id).autopost, null);
  assert.equal((await c.post(`/api/videos/${v.id}/autopost`, { at: '2001-01-01T00:00:00Z' })).status, 400);
  assert.equal((await c.post(`/api/videos/${v.id}/autopost`, { at: 'now' })).status, 200);

  let r = await ig.tick();
  assert.deepEqual(r.map(x => x.status), ['processing']);
  assert.equal(igSeen.mediaType, 'REELS');
  assert.equal(igSeen.caption, 'Planning ahead helps. Message me.');
  assert.deepEqual(igSeen.fetched.map(f => [f.k, f.status, f.type]), [['video_url', 200, 'video/mp4'], ['cover_url', 200, 'image/jpeg']]);
  r = await ig.tick();
  assert.deepEqual(r.map(x => x.status), ['posted']);
  const posted = store.getVideo(ws.id, v.id);
  assert.equal(posted.status, 'posted');
  assert.equal(posted.posted.url, 'https://www.instagram.com/reel/m1/');
  assert.equal(posted.autopost.status, 'posted');
});

test('Instagram: a video already on the agent’s Facebook Page can still go to Instagram; one posted by hand can’t', async () => {
  const both = fakeVideo('posted', { posted: { at: new Date().toISOString(), by: 'facebook', auto: true }, fbpost: { status: 'posted', url: 'https://www.facebook.com/reel/1' } });
  assert.equal((await c.post(`/api/videos/${both.id}/autopost`, { at: 'now' })).status, 200);
  await ig.tick(); await ig.tick();
  const done = store.getVideo(ws.id, both.id);
  assert.deepEqual([done.status, done.autopost.status, done.posted.by, done.fbpost.status], ['posted', 'posted', 'instagram', 'posted']);
  const byHand = fakeVideo('posted', { posted: { at: new Date().toISOString(), by: 'someone' } });
  assert.equal((await c.post(`/api/videos/${byHand.id}/autopost`, { at: 'now' })).status, 409);
});

test('signed links refuse tampering and expire', async () => {
  const v = fakeVideo('approved');
  const good = ig.signedUrl(ws.id, v.file);
  assert.equal((await fetch(good)).status, 200);
  assert.equal((await fetch(good.replace(/s=[^&]+/, 's=AAAA'))).status, 403);
  assert.equal((await fetch(good.replace(v.file, 'video_other.mp4'))).status, 403);
  assert.equal((await fetch(ig.signedUrl(ws.id, v.file, -10))).status, 403);
  assert.notEqual((await fetch(`${process.env.PUBLIC_URL}/pub/${ws.id}/..%2F..%2Fdata%2Faccounts.json?e=9999999999&s=x`)).status, 200, 'no path tricks');
});

test('the posting plan posts the oldest approved video once a day', async () => {
  const c1 = store.loadConfig(ws.id);
  c1.schedule.autopost = { on: true, time: '00:00', days: [0, 1, 2, 3, 4, 5, 6] };
  store.saveConfig(ws.id, c1);
  store.updateWorkspace(ws.id, { autopostDay: '' });
  for (const x of store.readVideos(ws.id).filter(y => y.status === 'approved' && !y.autopost)) store.updateVideo(ws.id, x.id, { status: 'rejected' });
  const older = fakeVideo('approved', { approval: { at: '2026-01-01T00:00:00Z' } });
  fakeVideo('approved', { approval: { at: '2026-02-01T00:00:00Z' } });
  const r = await ig.tick();
  assert.deepEqual(r.filter(x => x.status).map(x => [x.video, x.status]), [[older.id, 'processing']]);
  const r2 = await ig.tick();
  assert.deepEqual(r2.filter(x => x.status).map(x => [x.video, x.status]), [[older.id, 'posted']], 'not a second one the same day');
});

test('tokens refresh before they expire, revoked ones pause posting, and disconnecting removes the account', async () => {
  const alerts = await import('../lib/alerts.js');
  const file = path.join(store.wsDir(ws.id), 'instagram.json');
  const a = readJSON(file);
  writeJSON(file, ({ ...a, expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(), refreshedAt: new Date(Date.now() - 2 * 86400000).toISOString() }));
  const r = await ig.refreshDue();
  assert.deepEqual(r, [{ ws: ws.id, ok: true }]);
  assert.equal(ig.unseal(readJSON(file).token), 'long-token-2');
  // A revoked token (password changed, app removed) pauses posting and tells the admin once.
  const b = readJSON(file);
  writeJSON(file, ({ ...b, expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(), refreshedAt: new Date(Date.now() - 2 * 86400000).toISOString() }));
  igSeen.revoked = true;
  const before = alerts.listAlerts().filter(x => x.kind === 'instagram').length;
  assert.equal((await ig.refreshDue())[0].ok, false);
  assert.equal((await c.get('/api/instagram')).data.account.problem, 'reconnect');
  assert.equal(alerts.listAlerts().filter(x => x.kind === 'instagram').length, before + 1);
  await ig.refreshDue();
  assert.equal(alerts.listAlerts().filter(x => x.kind === 'instagram').length, before + 1);
  igSeen.revoked = false;
  assert.equal((await c.del('/api/instagram')).data.account.connected, false);
  assert.equal((await c.post(`/api/videos/${fakeVideo('approved').id}/autopost`, { at: 'now' })).status, 409);
});

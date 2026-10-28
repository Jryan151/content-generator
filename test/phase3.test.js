// Phase 3: seasonal topics, automatic Instagram results, yearly plans and referral credits, and the
// agent's own clips mixed into videos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client, hasFfmpeg } from './helpers.js';

tempEnv();
process.env.TWO_FACTOR = 'off';
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const M = await import('../mixer-core.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

async function agent(email, { comped = true } = {}) {
  const ws = store.createWorkspace({ name: email, comped });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.look.name = 'Jane Smith';
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  store.createAccount({ email, role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('agentpass123') });
  const c = client(port);
  assert.equal((await c.post('/api/login', { email, password: 'agentpass123' })).status, 200);
  return { c, ws: ws.id };
}
// A small fake HTTP API: routes map "METHOD /path" to a function returning [status, body].
async function fake(routes) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: b, headers: req.headers });
      const key = Object.keys(routes).find(k => { const [m, p] = k.split(' '); return m === req.method && new RegExp('^' + p.replace(/:\w+/g, '[^/]+') + '$').test(u.pathname); });
      const [code, obj] = key ? routes[key](u, b) : [404, { error: { message: 'no route ' + u.pathname } }];
      res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { calls, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

/* ---------------- 11. Seasonal topics ---------------- */
test('seasons: a worry tagged for this month comes up about 3× as often; untagged months are unchanged', () => {
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  const pains = M.usableRoutes(cfg).pains;
  const aud = cfg.story.audiences[0];
  const mine = pains.filter(p => p.links.includes(aud.id));
  assert.ok(mine.length >= 2, 'needs two worries for one audience');
  const target = mine[0];
  cfg.story.audiences = [aud];
  cfg.profile.timezone = 'America/Denver';
  const sept = Date.parse('2026-09-15T18:00:00Z');
  // Tags are cleaned: integers 1–12, sorted, no repeats.
  target.months = [9, '9', 13, 0, 2.5, 1];
  const m = M.migrate(cfg);
  assert.deepEqual(m.story.painPoints.find(p => p.id === target.id).months, [1, 9]);
  const count = (c, now) => { let n = 0; let s = 7; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; for (let i = 0; i < 4000; i++) if (M.roll(c, rng, [], {}, now).painPoint?.id === target.id) n++; return n / 4000; };
  const untagged = M.migrate({ ...cfg, story: { ...cfg.story, painPoints: cfg.story.painPoints.map(p => { const { months, ...r } = p; return r; }) } });
  const base = count(untagged, sept), boosted = count(m, sept), outOfSeason = count(m, Date.parse('2026-03-15T18:00:00Z'));
  assert.ok(boosted > base * 1.6, `in season: ${boosted} vs ${base}`);
  assert.ok(Math.abs(outOfSeason - base) < 0.04, `out of season: ${outOfSeason} vs ${base}`);
  assert.deepEqual(M.seasonBoosts(m, sept), { [target.id]: 3 });
  assert.equal(M.seasonsNow(m, sept)[0].label, 'Life Insurance Awareness Month');
  // Month is the agent's: 11pm Aug 31 in Denver is still August there.
  assert.equal(M.monthIn('America/Denver', Date.parse('2026-09-01T05:00:00Z')), 8);
});

/* ---------------- 12. Automatic Instagram results ---------------- */
test('insights: posted videos get views, reach and more from Instagram daily; messages are one tap', async () => {
  const ig = await import('../lib/instagram.js');
  const insights = await import('../lib/insights.js');
  const { c, ws } = await agent('insights@example.com');
  const graph = await fake({
    'GET /v25.0/m100/insights': () => [200, { data: [{ name: 'views', values: [{ value: 1520 }] }, { name: 'reach', values: [{ value: 980 }] }, { name: 'likes', total_value: { value: 41 } }, { name: 'shares', values: [{ value: 3 }] }, { name: 'saved', values: [{ value: 7 }] }, { name: 'comments', values: [{ value: 2 }] }] }],
    'GET /v25.0/m200/insights': () => [200, { data: [{ name: 'views', values: [{ value: 88 }] }] }],
    'GET /v25.0/u1/media': () => [200, { data: [{ id: 'm200', permalink: 'https://www.instagram.com/reel/HandPosted1/' }] }],
  });
  Object.assign(process.env, { INSTAGRAM_APP_ID: 'app', INSTAGRAM_APP_SECRET: 'secret', TOKEN_KEY: 'k'.repeat(64), INSTAGRAM_GRAPH_BASE: graph.base });
  try {
    const { writeJSON } = await import('../lib/paths.js');
    writeJSON(path.join(store.wsDir(ws), 'instagram.json'), { userId: 'u1', username: 'jane', token: ig.seal('tok'), expiresAt: new Date(Date.now() + 50 * 86400000).toISOString(), connectedAt: new Date().toISOString(), refreshedAt: new Date().toISOString(), problem: '', scopes: 'instagram_business_basic,instagram_business_content_publish' });
    const posted = (id, extra) => store.addVideo(ws, { id, status: 'posted', createdAt: new Date().toISOString(), posted: { at: new Date(Date.now() - 2 * 86400000).toISOString(), ...extra.posted }, autopost: extra.autopost, scenes: [], meta: { painId: 'p1', format: 'question' } });
    posted('auto1', { posted: { auto: true }, autopost: { mediaId: 'm100' } });
    posted('hand1', { posted: { url: 'https://instagram.com/reel/handposted1?igsh=xyz' } });
    posted('old1', { posted: {}, autopost: { mediaId: 'm100' } });
    store.updateVideo(ws, 'old1', { posted: { at: new Date(Date.now() - 40 * 86400000).toISOString() } });

    assert.deepEqual(await insights.refreshResults(), [], 'off until INSTAGRAM_INSIGHTS=1');
    process.env.INSTAGRAM_INSIGHTS = '1';
    assert.deepEqual(await insights.refreshResults(), [], 'connections without the results permission are skipped');
    assert.equal((await c.get('/api/instagram')).data.account.insights, false, 'Brand asks them to reconnect');
    process.env.PUBLIC_URL = 'https://reels.example.com';
    assert.match(ig.connectUrl(ws, 'u'), /instagram_business_manage_insights/, 'reconnecting asks for it');
    process.env.PUBLIC_URL = '';
    const { updateJSON } = await import('../lib/paths.js');
    updateJSON(path.join(store.wsDir(ws), 'instagram.json'), {}, a => ({ ...a, scopes: a.scopes + ',instagram_business_manage_insights' }));

    const r = await insights.refreshResults();
    assert.equal(r.length, 2, 'two videos in the last 30 days');
    const a = store.getVideo(ws, 'auto1').results;
    assert.deepEqual({ views: a.views, reach: a.reach, likes: a.likes, shares: a.shares, saved: a.saved, comments: a.comments, messages: a.messages }, { views: 1520, reach: 980, likes: 41, shares: 3, saved: 7, comments: 2, messages: 0 });
    assert.equal(store.getVideo(ws, 'hand1').results.views, 88, 'a video posted by hand is matched by its link');
    assert.equal(store.getVideo(ws, 'old1').results, undefined, 'older than 30 days: left alone');
    assert.deepEqual(await insights.refreshResults(), [], 'not again within 20 hours');

    // The one-tap message counter keeps Instagram's numbers.
    await c.post('/api/videos/auto1/message', { delta: 1 });
    const two = await c.post('/api/videos/auto1/message', { delta: 1 });
    assert.equal(two.data.video.results.messages, 2);
    assert.equal(two.data.video.results.views, 1520);
    assert.equal((await c.post('/api/videos/auto1/message', { delta: -1 })).data.video.results.messages, 1);
    assert.equal(M.boostsFrom(store.readVideos(ws)).pains.p1 > 1, true, 'messages feed the topic boosts');

    // Permission removed on Instagram's side: stop for this workspace and alert once.
    const { listAlerts } = await import('../lib/alerts.js');
    store.updateVideo(ws, 'auto1', x => ({ results: { ...x.results, auto: { at: '2020-01-01T00:00:00Z', mediaId: 'm100' } } }));
    graph.close();
    const denied = await fake({ 'GET /v25.0/m100/insights': () => [403, { error: { message: 'Application does not have permission for this action', code: 10 } }] });
    process.env.INSTAGRAM_GRAPH_BASE = denied.base;
    await insights.refreshResults();
    assert.equal((await c.get('/api/instagram')).data.account.insights, false);
    assert.ok(listAlerts().some(x => x.title === 'Instagram results need a reconnect'));
    denied.close();
  } finally { ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'TOKEN_KEY', 'INSTAGRAM_GRAPH_BASE', 'INSTAGRAM_INSIGHTS'].forEach(k => delete process.env[k]); graph.close(); }
});

/* ---------------- 13. Yearly plans and referral credits ---------------- */

/* ---------------- 14. The agent's own clips ---------------- */
test('own clips: upload (re-encoded), describe, plan which scenes use them, mix with stock, delete', { skip: !hasFfmpeg() && 'needs ffmpeg' }, async () => {
  const library = await import('../lib/library.js');
  const { findClips } = await import('../stages/broll.js');
  const { c, ws } = await agent('clips@example.com');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  const src = path.join(dir, 'phone.mov');
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-shortest', '-c:v', 'mpeg4', src]);
  const up = async (file, type = 'video/quicktime', d = '') => {
    const res = await fetch(`http://127.0.0.1:${port}/api/library?d=${encodeURIComponent(d)}`, { method: 'POST', headers: { 'Content-Type': type, cookie: c.cookie }, body: fs.readFileSync(file) });
    return { status: res.status, data: await res.json() };
  };
  assert.equal((await up(src, 'application/json')).status, 415, 'video files only');
  const notVideo = path.join(dir, 'x.mp4'); fs.writeFileSync(notVideo, 'hello');
  assert.equal((await up(notVideo, 'video/mp4')).status, 400);
  const a = await up(src, 'video/quicktime', 'me at my desk');
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.clip.description, 'me at my desk');
  assert.equal(a.data.clip.vertical, true);
  const stored = library.fileOf(ws, a.data.clip.id);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'csv=p=0', stored], { encoding: 'utf8' }).stdout;
  assert.match(probe, /h264,video/);
  assert.doesNotMatch(probe, /audio/, 're-encoded to H.264 without sound');
  assert.equal((await c.get(`/api/library/${a.data.clip.id}/thumb`)).status, 200);
  const b2 = await up(src, 'video/mp4', 'kitchen table with a client');
  assert.equal((await c.get('/api/library')).data.clips.length, 2);

  // Which scenes: "few" = last and first; descriptions win the scene whose search shares words.
  const scenes = [{ text: 'Hook', keyword: 'grandmother kitchen table' }, { text: 'A', keyword: 'family dinner' }, { text: 'B', keyword: 'couple' }, { text: 'C', keyword: 'senior' }, { text: 'D', keyword: 'home' }, { text: 'Message me', keyword: 'agent desk smiling' }];
  const cfg = store.loadConfig(ws);
  assert.deepEqual(library.planFor(ws, cfg, scenes), {}, 'off by default');
  cfg.output.ownClips = 'few';
  const plan = library.planFor(ws, cfg, scenes);
  assert.deepEqual(Object.keys(plan).sort(), ['0', '5']);
  assert.equal(plan[5].id, a.data.clip.id, '"me at my desk" goes to the scene searching for a desk');
  assert.equal(plan[0].id, b2.data.clip.id, '"kitchen table" goes to the kitchen-table scene');
  cfg.output.ownClips = 'many';
  assert.equal(Object.keys(library.planFor(ws, cfg, scenes)).length, 2, 'never more clips than the library has');

  // Mixed with stock footage: own clips in their scenes, Pixabay for the rest, in order.
  const own = Object.fromEntries(Object.entries(plan).map(([i, x]) => [i, { ...x, file: library.fileOf(ws, x.id) }]));
  const clips = await findClips(scenes, { log: () => {}, own });
  assert.equal(clips[5].id, `own:${a.data.clip.id}`);
  assert.equal(clips[5].file, library.fileOf(ws, a.data.clip.id));
  assert.ok(clips.slice(1, 5).every(x => /^\d+$/.test(String(x.id)) && fs.existsSync(x.file)), 'stock for the other scenes');
  library.markUsed(ws, [a.data.clip.id]);
  assert.equal(library.get(ws, a.data.clip.id).uses, 1);

  // Describe, delete; the data download lists them.
  await c.post(`/api/library/${a.data.clip.id}`, { description: 'me at my desk, smiling' });
  assert.equal(library.get(ws, a.data.clip.id).description, 'me at my desk, smiling');
  assert.equal((await c.get('/api/data/export')).data.ownClips.length, 2);
  assert.equal((await c.del(`/api/library/${a.data.clip.id}`)).data.clips.length, 1);
  assert.ok(!fs.existsSync(stored));
  assert.equal(M.migrate({ ...store.loadConfig(ws), output: { ...store.loadConfig(ws).output, ownClips: 'everything' } }).output.ownClips, 'off');
});

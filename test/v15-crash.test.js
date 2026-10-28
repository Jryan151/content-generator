// v15 Phase 4: crash tests. The app is killed (SIGKILL: no clean shutdown, like a power cut) at every
// step of posting, making and fixing a video, started again, and then checked:
//   - nothing was done twice (one post on Instagram or Facebook, one video record, one usage count);
//   - nothing was lost (the post goes out, the video is made, the fix is saved);
//   - nothing is left pointing at nothing (records and files match; saved stages are cleared).
// Posting runs in every check; making and fixing render real videos, so they run with npm run test:full.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { tempEnv, startStubs, hasFfmpeg, testFont } from './helpers.js';

tempEnv();
const font = testFont();
const stubs = await startStubs();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const queue = await import('../lib/queue.js');
const { CRASH_POINTS } = await import('../lib/faults.js');
const { starterStory } = await import('../templates.js');
test.after(() => stubs.close());
const here = path.dirname(new URL(import.meta.url).pathname);
const CHILD = path.join(here, 'fixtures', 'crash-child.mjs');
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = async req => { let b = ''; for await (const c of req) b += c; return b; };

// Runs the app once as its own process. Resolves { code, signal, err }.
function runChild(env) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [CHILD], { env: { ...process.env, NO_DOTENV: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.stdout.on('data', () => {});
    const t = setTimeout(() => p.kill('SIGKILL'), 280000);
    p.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, err }); });
  });
}
const covered = new Set();
// Kill at `point`, then run normally (a few times, like the minute ticks after a restart).
async function crashThenRecover(task, point, env = {}, again = 3) {
  const first = await runChild({ CRASH_TASK: task, CRASH_AT: point, ...env });
  assert.equal(first.signal, 'SIGKILL', `${point}: the crash point was reached (${first.err.slice(-300)})`);
  covered.add(point);
  for (let i = 0; i < again; i++) {
    const r = await runChild({ CRASH_TASK: task, ...env });
    assert.equal(r.code, 0, `${point}: the restarted app ran (${r.err.slice(-300)})`);
  }
}

/* ---------------- Posting ---------------- */
test('Instagram: killed at each step of posting, it posts exactly once', async () => {
  const st = { status: {}, caption: {}, media: [], created: 0, publishCalls: 0 };
  const igs = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x'), form = new URLSearchParams(await body(req));
    if (url.pathname === '/v25.0/17841/media' && req.method === 'POST') { const id = `c${++st.created}`; st.status[id] = 'FINISHED'; st.caption[id] = form.get('caption'); return json(res, 200, { id }); }
    if (url.pathname === '/v25.0/17841/media') return json(res, 200, { data: st.media });
    let m = /^\/v25\.0\/(c\d+)$/.exec(url.pathname);
    if (m) return json(res, 200, { status_code: st.status[m[1]] });
    if (url.pathname === '/v25.0/17841/media_publish') {
      st.publishCalls++;
      const c = form.get('creation_id');
      st.status[c] = 'PUBLISHED';
      const id = `m${st.media.length + 1}`;
      st.media.unshift({ id, caption: st.caption[c], timestamp: new Date().toISOString(), permalink: `https://www.instagram.com/reel/${id}/` });
      return json(res, 200, { id });
    }
    m = /^\/v25\.0\/(m\d+)$/.exec(url.pathname);
    if (m) return json(res, 200, { permalink: `https://www.instagram.com/reel/${m[1]}/` });
    json(res, 404, { error: { message: 'no stub ' + url.pathname } });
  });
  const env = { INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's', INSTAGRAM_GRAPH_BASE: `http://127.0.0.1:${igs.address().port}`, INSTAGRAM_ALLOW_HTTP: '1', PUBLIC_URL: 'http://127.0.0.1:1', INSTAGRAM_TIMEOUT_MS: '2000' };
  Object.assign(process.env, env);
  const ig = await import('../lib/instagram.js');
  try {
    const ws = store.createWorkspace({ name: 'Crash Poster', comped: true });
    paths.writeJSON(path.join(store.wsDir(ws.id), 'instagram.json'), { userId: '17841', username: 'agent', token: ig.seal('tok'), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), connectedAt: new Date().toISOString() });
    for (const [i, point] of ['ig:container', 'ig:publishing', 'ig:published'].entries()) {
      const id = `ic${i}`, before = st.publishCalls, mediaBefore = st.media.length;
      store.addVideo(ws.id, { id, status: 'approved', file: `video_${id}.mp4`, post: `Crash test post ${i} #planning`, createdAt: new Date().toISOString(), meta: { painPoint: 'Funeral costs' }, approval: { at: new Date().toISOString() } });
      ig.schedulePost(ws.id, id, 'now', 'me');
      await crashThenRecover('ig', point, env);
      const v = store.getVideo(ws.id, id);
      assert.equal(v.autopost.status, 'posted', `${point}: posted in the end (${JSON.stringify(v.autopost)})`);
      assert.equal(v.status, 'posted');
      assert.equal(st.publishCalls - before, 1, `${point}: published exactly once`);
      assert.equal(st.media.length - mediaBefore, 1, `${point}: one post on the account`);
    }
  } finally {
    igs.close();
    for (const k of Object.keys(env)) delete process.env[k];
    process.env.PUBLIC_URL = '';
  }
});

test('Facebook: killed at each step of posting, it posts exactly once', async () => {
  const st = { started: 0, finishCalls: 0, published: new Set(), uploads: 0 };
  const fbs = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x'), raw = await body(req), form = new URLSearchParams(raw);
    if (/\/video_reels$/.test(url.pathname) && req.method === 'POST') {
      const phase = form.get('upload_phase') || url.searchParams.get('upload_phase');
      if (phase === 'start') return json(res, 200, { video_id: `v${++st.started}` });
      if (phase === 'finish') { st.finishCalls++; const vid = form.get('video_id'); if (st.published.has(vid)) return json(res, 400, { error: { message: 'This video has already been published', code: 100 } }); st.published.add(vid); return json(res, 200, { success: true }); }
    }
    if (/\/video-upload\//.test(url.pathname)) { st.uploads++; return json(res, 200, { success: true }); }
    const m = /^\/v25\.0\/(v\d+)$/.exec(url.pathname);
    if (m) return json(res, 200, { status: st.published.has(m[1]) ? { video_status: 'ready', publishing_phase: { status: 'complete' } } : { video_status: 'upload_complete', publishing_phase: { status: 'not_started' } }, permalink_url: `/reel/${m[1]}` });
    json(res, 404, { error: { message: 'no stub ' + url.pathname } });
  });
  const base = `http://127.0.0.1:${fbs.address().port}`;
  const env = { FACEBOOK_APP_ID: '9', FACEBOOK_APP_SECRET: 'fb-secret', FACEBOOK_GRAPH_BASE: base, FACEBOOK_UPLOAD_BASE: base, INSTAGRAM_ALLOW_HTTP: '1', PUBLIC_URL: 'http://127.0.0.1:1' };
  Object.assign(process.env, env);
  const fb = await import('../lib/facebook.js');
  try {
    const ws = store.createWorkspace({ name: 'Crash Page', comped: true });
    paths.writeJSON(path.join(store.wsDir(ws.id), 'facebook.json'), { pageId: '555', pageName: 'Agent Page', token: fb.seal('page-tok'), connectedAt: new Date().toISOString() });
    for (const [i, point] of ['fb:started', 'fb:published'].entries()) {
      const id = `fc${i}`, before = st.published.size;
      store.addVideo(ws.id, { id, status: 'approved', file: `video_${id}.mp4`, post: `Facebook crash test ${i}`, createdAt: new Date().toISOString(), meta: { painPoint: 'Funeral costs' }, approval: { at: new Date().toISOString() } });
      fb.schedulePost(ws.id, id, 'now', 'me');
      await crashThenRecover('fb', point, env, 4);
      const v = store.getVideo(ws.id, id);
      assert.equal(v.fbpost.status, 'posted', `${point}: posted in the end (${JSON.stringify(v.fbpost)})`);
      assert.equal(st.published.size - before, 1, `${point}: one post on the Page`);
    }
    assert.equal(st.finishCalls, st.published.size, 'never asked to publish the same video twice');
  } finally {
    fbs.close();
    for (const k of Object.keys(env)) delete process.env[k];
    process.env.PUBLIC_URL = '';
  }
});

/* ---------------- Making and fixing ---------------- */
const skip = !process.env.FULL_TEST ? 'renders videos; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : !font ? 'No Poppins font' : false;
function setupWorkspace(name) {
  const ws = store.createWorkspace({ name, comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory() };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name, location: 'Gallup, NM', font };
  cfg.output = { ...cfg.output, mode: 'captions', scenes: 6 };
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  return ws;
}
// Records and files agree: every record's file exists, and every video file belongs to a record.
function filesMatch(wsId) {
  const vids = store.readVideos(wsId);
  const named = new Set(vids.flatMap(v => [v.file, v.cover]).filter(Boolean));
  for (const v of vids) assert.ok(fs.existsSync(store.videoPath(wsId, v.file)), `${v.id}: its file exists`);
  const dir = path.dirname(store.videoPath(wsId, 'x.mp4'));
  const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /\.(mp4|jpg)$/.test(n) && !named.has(n)) : [];
  assert.deepEqual(extra, [], 'no stray files');
}

test('making a video: killed at each step, it’s made exactly once', { skip, timeout: 1800000 }, async () => {
  const { monthUsage } = await import('../lib/usage.js');
  for (const point of ['make:script', 'make:media', 'make:render', 'make:saved']) {
    const ws = setupWorkspace(`Crash ${point}`);
    const job = queue.enqueue({ ws: ws.id, kind: 'video', source: 'manual' });
    await crashThenRecover('line', point, { JOB_ID: job.id }, 1);
    const j = queue.getJob(job.id);
    assert.equal(j.status, 'done', `${point}: the job finished (${j.error || ''} ${(j.log || []).slice(-3).join(' | ')})`);
    const vids = store.readVideos(ws.id);
    assert.equal(vids.length, 1, `${point}: one video`);
    assert.equal(j.result.videoId, vids[0].id);
    assert.equal(monthUsage(ws.id).videos, 1, `${point}: counted once`);
    filesMatch(ws.id);
    assert.ok(!fs.existsSync(path.join(paths.DIRS.work, `job-${job.id}`)), `${point}: saved stages cleared`);
  }
});

test('fixing a scene: killed after the render, the fix is saved exactly once', { skip, timeout: 1200000 }, async () => {
  const { makeVideo } = await import('../pipeline.js');
  const ws = setupWorkspace('Crash fix');
  const v = await makeVideo({ ws: ws.id, log: () => {} });
  const job = queue.enqueue({ ws: ws.id, kind: 'fix', opts: { videoId: v.id, edits: [{ i: 5, text: 'Message me and we can find your answer.', accent: 'your answer' }], swaps: [] } });
  await crashThenRecover('line', 'fix:render', { JOB_ID: job.id }, 1);
  const j = queue.getJob(job.id);
  assert.equal(j.status, 'done', (j.log || []).slice(-3).join(' | '));
  const fixed = store.getVideo(ws.id, v.id);
  assert.equal(fixed.version, 2, 'one new version');
  assert.equal(fixed.fixLog.length, 1, 'one fix recorded');
  assert.equal(fixed.scenes[5].text, 'Message me and we can find your answer.');
  filesMatch(ws.id);
});

test('every crash point is exercised by these tests', { skip }, () => {
  assert.deepEqual([...covered].sort(), Object.keys(CRASH_POINTS).sort());
});

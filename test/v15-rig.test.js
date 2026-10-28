// v15 Phase 4: the test rig's own checks (fault injection, the coverage floor) and the gauges
// (Engine bay, flight recorder, targets, service-manual alerts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client, hasFfmpeg, testFont } from './helpers.js';

const root = tempEnv();
process.env.RETRY_BASE_MS = '5';
const stubs = await startStubs();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const alerts = await import('../lib/alerts.js');
const queue = await import('../lib/queue.js');
const flight = await import('../lib/flight.js');
const gauges = await import('../lib/gauges.js');
const targets = await import('../lib/targets.js');
const faults = await import('../lib/faults.js');
const { runProc } = await import('../lib/proc.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const here = path.dirname(new URL(import.meta.url).pathname);

const ws = store.createWorkspace({ name: 'Rig Agent', comped: true });
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'rig@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('rigpass12345') });
store.createAccount({ email: 'chief@example.com', role: 'admin', hash: await auth.hashPassword('chiefpass1234') });
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };

/* ---------------- Alerts written like a service manual ---------------- */
// The object literal starting at `i` (a "{"), skipping strings and template literals.
function objectAt(src, i) {
  let depth = 0;
  const skipString = (j, q) => { for (j++; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = skipBlock(j + 1); continue; } if (src[j] === q) return j; } return j; };
  const skipBlock = j => { let d = 0; for (; j < src.length; j++) { const c = src[j]; if (c === '\'' || c === '"' || c === '`') { j = skipString(j, c); continue; } if (c === '{') d++; else if (c === '}') { d--; if (!d) return j; } } return j; };
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\'' || c === '"' || c === '`') { j = skipString(j, c); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
test('every warning and error alert says what the app already did (and what’s left)', () => {
  const files = ['server.js', 'pipeline.js', 'admin.js', ...fs.readdirSync(path.join(here, '..', 'lib')).map(f => `lib/${f}`), ...fs.readdirSync(path.join(here, '..', 'stages')).map(f => `stages/${f}`)].filter(f => f.endsWith('.js') && f !== 'lib/alerts.js');
  const missing = [];
  let seen = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(here, '..', f), 'utf8');
    for (const m of src.matchAll(/(?:notify|alertOnce\([^,]+,|alert\([^,]+,)\s*\(?\s*(?=\{)/g)) {
      const at = m.index + m[0].length;
      if (src[at] !== '{') continue;
      const obj = objectAt(src, at);
      if (!/level:\s*/.test(obj) && !/^alert\(/.test(m[0])) continue;   // not an alert object
      if (/level:\s*'info'/.test(obj)) continue;
      if (/\{\s*level:[^}]*\.\.\.[a-z]\s*\}$/i.test(obj.replace(/\s+/g, ' '))) continue;   // a helper passing on its caller's alert (checked at the caller)
      seen++;
      if (!/\bdid:/.test(obj)) missing.push(`${f}: ${obj.slice(0, 90).replace(/\s+/g, ' ')}…`);
    }
  }
  assert.ok(seen >= 30, `found ${seen} alerts`);
  assert.deepEqual(missing, []);
});

test('an alert carries what was done and what’s left, in Admin and in the phone push', async () => {
  const a = alerts.notify({ level: 'error', kind: 'server', title: 'Rig: test manual', text: 'Something broke.', did: 'Kept going.', run: 'node admin.js backup-now' });
  assert.equal(a.did, 'Kept going.'); assert.equal(a.run, 'node admin.js backup-now');
  assert.equal(alerts.manualText(a), 'Something broke.\nAlready done: Kept going.\nLeft for you: node admin.js backup-now');
  let body = '';
  const hook = await listen(async (req, res) => { for await (const c of req) body += c; res.end('ok'); });
  try { await alerts.sendWebhook(a, `http://127.0.0.1:${hook.address().port}/ntfy.sh/topic`); } finally { hook.close(); }
  assert.match(body, /Already done: Kept going\.\nLeft for you: node admin\.js backup-now/);
});

test('an alert that can’t be saved still reaches the phone, once (not on every repeat)', async () => {
  let hits = 0;
  const hook = await listen(async (req, res) => { for await (const _ of req); hits++; res.end('ok'); });
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${hook.address().port}/hook`;
  process.env.FAULTS = 'enospc:alerts';
  try {
    for (let i = 0; i < 4; i++) alerts.notify({ level: 'error', kind: 'server', title: 'Rig: unsaved', text: 'Same thing again.', did: 'x', run: '' });
    for (let i = 0; i < 50 && !hits; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 100));
  } finally { delete process.env.FAULTS; delete process.env.ALERT_WEBHOOK_URL; faults._resetFaults(); hook.close(); }
  assert.equal(hits, 1);
});

/* ---------------- Fault injection ---------------- */
test('a full disk: the save is refused cleanly, nothing is half-written, the agent gets a plain answer', async () => {
  const agent = await login('rig@example.com', 'rigpass12345');
  const file = path.join(store.wsDir(ws.id), 'coach-notes.json');
  assert.equal((await agent.post('/api/coach/notes', { text: 'Before Full' })).status, 200);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  // The alert can't be saved on a full disk either, so it goes straight to the admin's phone.
  let pushed = '';
  const hook = await listen(async (req, res) => { for await (const c of req) pushed += c; res.end('ok'); });
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${hook.address().port}/ntfy.sh/rig`;
  process.env.FAULTS = 'enospc';
  try {
    const r = await agent.post('/api/coach/notes', { text: 'During Full' });
    assert.equal(r.status, 507);
    assert.match(r.data.error, /out of disk space.*Nothing was changed/);
    for (let i = 0; i < 50 && !pushed; i++) await new Promise(r2 => setTimeout(r2, 20));
  } finally { delete process.env.FAULTS; delete process.env.ALERT_WEBHOOK_URL; faults._resetFaults(); hook.close(); }
  assert.match(pushed, /Refused the change[\s\S]*Left for you: df -h/);
  if (before !== null) assert.equal(fs.readFileSync(file, 'utf8'), before, 'the saved copy is untouched');
  const names = (paths.readJSON(file, []) || []).map(c => c.text);
  assert.ok(names.includes('Before Full') && !names.includes('During Full'));
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n => /\.tmp/.test(n)), [], 'no temp files left');
  assert.equal((await agent.post('/api/coach/notes', { text: 'After Full' })).status, 200, 'works again once there’s room');
});

test('a frozen FFmpeg is stopped at its time limit, and nothing is left running', async () => {
  const bin = path.join(root, 'frozen-ffmpeg');
  fs.writeFileSync(bin, '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 });
  process.env.PROC_GRACE_MS = '100';
  const t = Date.now();
  const e = await runProc(bin, ['-i', 'x'], { timeoutMs: 300, signal: null }).catch(x => x);
  assert.equal(e.timedOut, true);
  assert.match(e.message, /took longer than/);
  assert.ok(Date.now() - t < 5000);
  const ps = spawnSync('pgrep', ['-f', 'sleep 60']);
  assert.notEqual(ps.status, 0, 'the frozen program is gone');
});

test('services that are slow, down, cut off or talking nonsense: each gives a plain, correctly sorted error', async () => {
  const ai = await import('../lib/ai.js');
  const breaker = await import('../lib/breaker.js');
  const keep = { ...process.env };
  let mode = 'slow';
  const srv = await listen(async (req, res) => {
    for await (const _ of req);
    if (mode === 'slow') return setTimeout(() => { try { res.end('{}'); } catch {} }, 3000);
    if (mode === 'down') { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"overloaded"}}'); }
    if (mode === 'cut') return req.socket.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('<html>proxy error</html>');
  });
  Object.assign(process.env, { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: `http://127.0.0.1:${srv.address().port}/v1`, OPENAI_TIMEOUT_MS: '200', AI_LADDER_QUICK: 'gpt-4o-mini' });
  const ask = () => ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'quick' }).catch(e => e);
  try {
    for (const m of ['slow', 'down', 'cut']) {
      breaker._reset(); mode = m;
      const e = await ask();
      assert.equal(queue.isOutage(e), true, `${m}: waited out like an outage`);
      assert.equal(e.permanent, false, `${m}: not given up on`);
    }
    breaker._reset(); mode = 'nonsense';
    const e = await ask();
    assert.match(e.message, /empty reply/);
    assert.equal(queue.isOutage(e), false, 'nonsense is retried as a normal failure, not waited on');
    assert.equal(breaker.status().find(b => b.id === 'openai').state, 'closed', 'and it doesn’t open the breaker');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep); srv.close(); breaker._reset();
  }
});

test('a damaged file: repaired from its last good copy, with an alert that says so', async () => {
  const agent = await login('rig@example.com', 'rigpass12345');
  await agent.post('/api/coach/notes', { text: 'Kept Safe' });
  await agent.post('/api/coach/notes', { text: 'Kept Too' });
  if (paths.storageEngine() !== 'json') return;   // SQLite rows: covered in v15-engine
  const file = path.join(store.wsDir(ws.id), 'coach-notes.json');
  fs.writeFileSync(file, '{"broken": [1, 2');
  const names = (paths.readJSON(file, []) || []).map(c => c.text);
  assert.ok(names.includes('Kept Safe'));
  const a = alerts.listAlerts().find(x => x.title === 'A damaged data file was repaired');
  assert.ok(a && /Restored it from/.test(a.did));
});

/* ---------------- The flight recorder ---------------- */
test('the flight recorder keeps each job’s steps and the services it used', async () => {
  const ai = await import('../lib/ai.js');
  queue.startWorker(async (job, log) => {
    flight.step('script'); log('writing');
    await ai.chatJSON({ messages: [{ role: 'user', content: 'Write the weekly check-in.' }], job: 'quick' }).catch(() => null);
    flight.step('render');
    await runProc(process.execPath, ['-e', 'setTimeout(()=>{},120)'], {});
    return { ok: true };
  });
  try {
    const j = queue.enqueue({ ws: ws.id, kind: 'video', source: 'overnight' });
    await queue.idle(20000);
    const done = queue.getJob(j.id);
    assert.equal(done.status, 'done');
    assert.deepEqual(done.steps.map(s => s.name), ['script', 'render'], 'the job keeps its step times');
    assert.ok(done.steps[1].ms >= 100, 'the render step took the program’s time');
    assert.equal(done.timeline, undefined, 'the full timeline isn’t in the (often saved) line');
    const [tl] = flight.timelinesOf(j.id);
    assert.ok(tl.events.some(e => e.service === 'openai' && e.detail === 'quick: gpt-4o-mini'));
    assert.ok(tl.events.some(e => e.service === path.basename(process.execPath)));
    const sum = flight.runs().find(r => r.id === j.id);
    assert.equal(sum.status, 'done'); assert.equal(sum.source, 'overnight');
    assert.ok(sum.services.openai.calls >= 1);
    const st = flight.stats();
    assert.ok(st.done >= 1 && st.steps.render.p50 != null);
  } finally { queue.startWorker(null); }
});

test('a fix that was saved before a cut-off isn’t done again, even at the fix limit, and its old files go', async () => {
  const { fixVideo, MAX_FIXES } = await import('../pipeline.js');
  const { jobContext } = await import('../lib/proc.js');
  const dir = path.dirname(store.videoPath(ws.id, 'x.mp4'));
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['video_fx.mp4', 'cover_fx.jpg', 'video_fx_v6.mp4']) fs.writeFileSync(path.join(dir, f), 'x');
  store.addVideo(ws.id, { id: 'fx', status: 'pending', file: 'video_fx_v6.mp4', createdAt: new Date().toISOString(), fixes: MAX_FIXES, version: 6, scenes: [], fixLog: [{ at: new Date().toISOString(), by: 'me', edits: [1], swaps: [], job: 'j_fix1', oldFile: 'video_fx.mp4', oldCover: 'cover_fx.jpg' }] });
  const v = await jobContext.run({ jobId: 'j_fix1' }, () => fixVideo({ ws: ws.id, videoId: 'fx', edits: [{ i: 1, text: 'x' }], log: () => {} }));
  assert.equal(v.version, 6, 'returned as saved, not refused for the fix limit');
  assert.ok(!fs.existsSync(path.join(dir, 'video_fx.mp4')) && !fs.existsSync(path.join(dir, 'cover_fx.jpg')), 'the previous version’s files are removed');
  assert.ok(fs.existsSync(path.join(dir, 'video_fx_v6.mp4')), 'the new one stays');
  // Another job (not the one that saved it) is still held to the checks (the fix limit among them).
  const { checkFix } = await import('../pipeline.js');
  assert.match(checkFix(ws.id, 'fx', [{ i: 1, text: 'x' }]), /fixed 5 times|older version/);
  await assert.rejects(jobContext.run({ jobId: 'j_other' }, () => fixVideo({ ws: ws.id, videoId: 'fx', edits: [{ i: 1, text: 'x' }], log: () => {} })));
});

/* ---------------- Gauges ---------------- */
test('gauges: service answers by hour, process samples, and the disk trend', () => {
  gauges._reset();
  for (let i = 0; i < 3; i++) gauges.count('pixabay', true);
  gauges.count('pixabay', false);
  gauges.flush();
  const t = gauges.serviceTotals(24);
  assert.ok(t.pixabay.ok >= 3 && t.pixabay.failed >= 1);
  const peaks = gauges.processPeaks(24);
  assert.ok(peaks.server.rssMB > 0);
  const day = 86400000, now = Date.now();
  for (let d = 10; d >= 0; d--) gauges.noteDisk(50 - (10 - d) * 2, now - d * day);   // 2 GB a day
  const tr = gauges.diskTrend(1.5, now);
  assert.equal(tr.perDay, -2);
  assert.equal(tr.daysLeft, Math.round((30 - 1.5) / 2));
});


/* ---------------- Targets ---------------- */
test('targets: overnight videos by 7am, double posts, and the daily red-light alert', () => {
  const tz = 'America/Chicago';
  const cfg = store.loadConfig(ws.id); cfg.profile = { ...(cfg.profile || {}), timezone: tz }; store.saveConfig(ws.id, cfg);
  const file = path.join(paths.DIRS.data, 'flight.json');
  const at = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00-05:00`).toISOString();   // Chicago in October (CDT)
  const now = Date.parse('2026-10-15T18:00:00Z');
  const runs = [];
  for (let i = 0; i < 9; i++) runs.push({ id: `n${i}`, ws: ws.id, kind: 'video', source: 'overnight', status: 'done', queuedAt: at(`2026-10-0${i + 1}`, 2), startedAt: at(`2026-10-0${i + 1}`, 2), endedAt: at(`2026-10-0${i + 1}`, 3), ms: 3600000, steps: {}, services: {} });
  runs.push({ id: 'late', ws: ws.id, kind: 'video', source: 'overnight', status: 'done', queuedAt: at('2026-10-10', 2), startedAt: at('2026-10-10', 6), endedAt: at('2026-10-10', 8), ms: 7200000, steps: {}, services: {} });
  paths.writeJSON(file, runs);
  let t = targets.measure(now);
  const night = t.find(x => x.id === 'overnight');
  assert.equal(night.value, 90); assert.equal(night.light, 'red');
  assert.match(night.detail, /9 of 10/);
  assert.equal(t.find(x => x.id === 'doublePosts').light, 'green');
  // A post left "unsure": the double-post light goes red.
  const v = { id: 'vu1', status: 'approved', createdAt: new Date(now - 86400000).toISOString(), autopost: { status: 'unsure', unsureAt: new Date(now - 3600000).toISOString() } };
  paths.updateJSON(path.join(store.wsDir(ws.id), 'videos.json'), [], list => [...list, v]);
  t = targets.checkTargets(now);
  assert.equal(t.find(x => x.id === 'doublePosts').light, 'red');
  const sent = () => alerts.listAlerts().filter(a => a.title.startsWith('Target missed'));
  assert.ok(sent().some(a => a.title === 'Target missed: Double posts' && a.did && a.run));
  assert.ok(sent().some(a => a.title === 'Target missed: Overnight videos ready by 7am'));
  // Still red the next day at the same value: not repeated until a week has passed.
  const n = sent().length;
  targets.checkTargets(now + 86400000);
  assert.equal(sent().length, n);
  targets.checkTargets(now + 8 * 86400000);
  assert.ok(sent().length > n, 'a week later, reminded');
  paths.updateJSON(path.join(store.wsDir(ws.id), 'videos.json'), [], list => list.filter(x => x.id !== 'vu1'));
});

/* ---------------- The Engine bay ---------------- */
test('the Engine bay: one page for admins (not agents), with a job’s timeline on tap', async () => {
  const chief = await login('chief@example.com', 'chiefpass1234');
  const agent = await login('rig@example.com', 'rigpass12345');
  assert.equal((await agent.get('/api/admin/engine')).status, 403);
  const r = await chief.get('/api/admin/engine');
  assert.equal(r.status, 200);
  const E = r.data;
  for (const k of ['line', 'services', 'processes', 'disk', 'backups', 'targets', 'build', 'recent']) assert.ok(k in E, k);
  assert.ok(E.services.some(s => s.id === 'openai'));
  assert.equal(E.build.node, process.version);
  assert.ok(E.targets.length >= 7);
  const job = queue.listJobs().find(j => j.steps);
  const tl = await chief.get(`/api/admin/engine/job/${job.id}`);
  assert.equal(tl.status, 200); assert.ok(tl.data.timeline.steps.length); assert.equal(tl.data.runs.length, 1);
  assert.equal((await chief.get('/api/admin/engine/job/j_nope')).status, 404);
});

/* ---------------- Crash points ---------------- */
test('crash points are inert outside the checks, and each one is documented', () => {
  const env = { ...process.env, NODE_ENV: 'production', CRASH_AT: 'make:script', NO_DOTENV: '1' };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const f = await import(${JSON.stringify(path.join(here, '..', 'lib', 'faults.js'))}); f.crashPoint('make:script'); console.log('alive');`], { env, encoding: 'utf8' });
  assert.match(r.stdout, /alive/);
  // Every crash point used in the code is in the list (and the other way round).
  const used = new Set();
  for (const f of ['pipeline.js', 'lib/instagram.js', 'lib/facebook.js']) for (const m of fs.readFileSync(path.join(here, '..', f), 'utf8').matchAll(/crashPoint\('([^']+)'\)/g)) used.add(m[1]);
  assert.deepEqual([...used].sort(), Object.keys(faults.CRASH_POINTS).sort());
});

/* ---------------- The coverage floor ---------------- */
test('the coverage floor is set and only goes up', { skip: process.env.COVERAGE_RUN ? 'measuring it now' : false }, () => {
  const f = JSON.parse(fs.readFileSync(path.join(here, 'coverage-floor.json'), 'utf8'));
  for (const k of ['lines', 'branches', 'functions']) assert.ok(f[k] > 50 && f[k] <= 100, `${k}: ${f[k]}`);
  assert.match(fs.readFileSync(path.join(here, 'coverage.mjs'), 'utf8'), /can only go up/);
});

/* ---------------- The reference render ---------------- */
const font = testFont();
const skipRender = !process.env.FULL_TEST ? 'renders a video; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : !font ? 'No Poppins font' : false;

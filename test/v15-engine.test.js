// v15 Phase 1: the six critical fixes.
//   1. A damaged data file is repaired from its last good copy, and never saved over.
//   2. Every outside program has a time limit; a stuck job is stopped by the watchdog and retried.
//   3. Instagram posting: a lost answer is checked with Instagram, never reported as "didn't go out"
//      when it did, and never posted twice.
//   4. update.sh stops if its backup can't be made.
//   5. AI model ladders: a retired model steps down, an outage moves to another company, a refused
//      parameter is dropped, shutdown dates are watched, a second voice company times its own words.
//   6. Video jobs keep each finished stage: a retry resumes instead of paying twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { tempEnv, startStubs, testFont, hasFfmpeg } from './helpers.js';

tempEnv();
process.env.RETRY_BASE_MS = '5';
const stubs = await startStubs();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const alerts = await import('../lib/alerts.js');
const proc = await import('../lib/proc.js');
const queue = await import('../lib/queue.js');
const ai = await import('../lib/ai.js');
const { meter } = await import('../lib/usage.js');
const sqlite = paths.storageEngine() === 'sqlite';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test.after(() => stubs.close());

const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = async req => { let raw = ''; for await (const c of req) raw += c; return raw; };
const titles = () => alerts.listAlerts().map(a => a.title);

// Damages a document the way a bad hand edit or a disk fault would (and, with `prev`, its previous save too).
function damage(file, { prev = false } = {}) {
  if (sqlite) {
    const d = paths.openDb(paths.DB_FILE), key = paths.docKey(file);
    d.prepare('UPDATE docs SET body = ? WHERE key = ?').run('{"half": [1, 2', key);
    if (prev) d.prepare('UPDATE docs SET prev = ? WHERE key = ?').run('', key);
    d.close();
  } else {
    fs.writeFileSync(file, '{"half": [1, 2');
    if (prev) fs.writeFileSync(file + '.prev', '');
  }
}
const rawOf = file => {
  if (!sqlite) return fs.readFileSync(file, 'utf8');
  const d = paths.openDb(paths.DB_FILE), r = d.prepare('SELECT body FROM docs WHERE key = ?').get(paths.docKey(file)); d.close(); return r.body;
};

/* ---------------- 1. Damaged files ---------------- */
test('a damaged data file is repaired from its previous save, and alerted', () => {
  const seen = [];
  paths.onDamage(i => seen.push(i));
  const ws = store.createWorkspace({ name: 'Damage', comped: true });
  store.addVideo(ws.id, { id: 'v1', status: 'approved', approval: { at: '2026-10-01T00:00:00Z' } });
  store.addVideo(ws.id, { id: 'v2', status: 'pending' });   // the save before this one is kept
  const file = path.join(store.wsDir(ws.id), 'videos.json');
  damage(file);
  assert.deepEqual(store.readVideos(ws.id).map(v => v.id), ['v1'], 'its previous save came back');
  assert.equal(seen.length, 1);
  assert.match(seen[0].restored, /previous save/);
  assert.ok(fs.existsSync(path.join(paths.DIRS.data, seen[0].kept)), 'the damaged copy is kept');
  assert.equal(fs.readFileSync(path.join(paths.DIRS.data, seen[0].kept), 'utf8'), '{"half": [1, 2');
  assert.deepEqual(store.readVideos(ws.id).map(v => v.id), ['v1'], 'repaired for good');
  assert.equal(seen.length, 1, 'only one alert');
  paths.onDamage(null);
});

test('with no good copy anywhere, reading refuses and nothing is ever written over it', () => {
  const seen = [];
  paths.onDamage(i => seen.push(i));
  const ws = store.createWorkspace({ name: 'Damage 2', comped: true });
  store.addVideo(ws.id, { id: 'a1', status: 'approved' });
  store.addVideo(ws.id, { id: 'a2', status: 'approved' });
  const file = path.join(store.wsDir(ws.id), 'videos.json');
  damage(file, { prev: true });
  assert.throws(() => store.readVideos(ws.id), e => e.damaged && e.status === 503 && !/videos\.json/.test(e.message));
  assert.throws(() => store.addVideo(ws.id, { id: 'a3' }), e => e.damaged);
  assert.equal(rawOf(file), '{"half": [1, 2', 'never saved over');
  assert.equal(seen.at(-1).restored, '');
  // Reading it again doesn't copy, search the backups or alert again (once per damage).
  const kept = fs.readdirSync(paths.DAMAGED_DIR).length, alerted = seen.length;
  for (let i = 0; i < 5; i++) assert.throws(() => store.readVideos(ws.id), e => e.damaged);
  assert.equal(fs.readdirSync(paths.DAMAGED_DIR).length, kept);
  assert.equal(seen.length, alerted);
  // Disposable files (caches) still read as empty.
  fs.writeFileSync(path.join(paths.DIRS.cache, 'scratch.json'), '{oops');
  assert.deepEqual(paths.readJSON(path.join(paths.DIRS.cache, 'scratch.json'), { empty: true }), { empty: true });
  // A workspace damaged beyond repair is left out of loops; the others carry on.
  const other = store.createWorkspace({ name: 'Fine', comped: true });
  damage(path.join(store.wsDir(ws.id), 'workspace.json'), { prev: true });
  const ids = store.listWorkspaces().map(w => w.id);
  assert.ok(ids.includes(other.id) && !ids.includes(ws.id));
  // So is one that can't be read at all (here: a folder where its record should be).
  if (!sqlite) { fs.mkdirSync(path.join(paths.DIRS.workspaces, 'w0123456789ab', 'workspace.json'), { recursive: true }); assert.ok(store.listWorkspaces().some(w => w.id === other.id)); }
  paths.onDamage(null);
});

test('a damaged file is restored from the newest backup when its previous save is bad too', { skip: sqlite ? 'JSON files only (SQLite keeps its own previous copy)' : false }, async () => {
  const { backup } = await import('../lib/scheduler.js');
  const seen = [];
  paths.onDamage(i => seen.push(i));
  const ws = store.createWorkspace({ name: 'Backed up', comped: true });
  store.addVideo(ws.id, { id: 'b1', status: 'approved' });
  await backup();
  const file = path.join(store.wsDir(ws.id), 'videos.json');
  damage(file, { prev: true });
  assert.deepEqual(store.readVideos(ws.id).map(v => v.id), ['b1']);
  assert.match(seen.at(-1).restored, /backup data-/);
  paths.onDamage(null);
});

test('a save keeps a copy of the file it replaces only when that copy is good', { skip: sqlite ? 'JSON files only' : false }, () => {
  const f = path.join(paths.DIRS.data, 'v15-note.json');
  paths.writeJSON(f, { n: 1 });
  paths.writeJSON(f, { n: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.prev', 'utf8')), { n: 1 });
  fs.writeFileSync(f, 'garbage');   // changed outside the app, and broken
  paths.writeJSON(f, { n: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f + '.prev', 'utf8')), { n: 1 }, 'the broken copy didn’t replace the good one');
  paths.removeJSON(f);
  assert.ok(!fs.existsSync(f + '.prev'));
});

/* ---------------- 2. Time limits and the watchdog ---------------- */
test('every outside program has a time limit, capped output and an off switch', async () => {
  const t0 = Date.now();
  await assert.rejects(proc.runProc('sleep', ['30'], { timeoutMs: 200 }), e => e.timedOut && /took longer than/.test(e.message));
  assert.ok(Date.now() - t0 < 4000);
  const ctl = new AbortController();
  const p = proc.runProc('sleep', ['30'], { signal: ctl.signal });
  setTimeout(() => ctl.abort(new Error('stop now')), 100);
  await assert.rejects(p, /stop now/);
  const big = await proc.runProc('head', ['-c', '2000000', '/dev/zero'], { maxOutput: 1000, binary: true });
  assert.equal(big.stdout.length, 1000);
  assert.equal(proc.runningCount(), 0, 'nothing left running');
});

test('the watchdog stops a stuck job (and its programs), retries it once, then fails it', async () => {
  process.env.JOB_IDLE_MINUTES = '0.004';   // ~250ms without progress
  process.env.WATCHDOG_EVERY_MS = '50';
  const stuck = [], failed = [], runs = [];
  try {
    queue.startWorker(async job => {
      runs.push(job.attempts);
      if (job.attempts === 1) await new Promise(() => {});   // waits on something that never answers
      await proc.runProc('sleep', ['30'], { timeoutMs: 60000 });   // a frozen program
      return { ok: true };
    }, { stuck: (j, e) => stuck.push(e.message), failed: (j, e) => failed.push(e.message) });
    const job = queue.enqueue({ ws: 'w000000000001', kind: 'video' });
    await queue.idle(15000);
    assert.deepEqual(runs, [1, 2], 'tried twice');
    assert.equal(stuck.length, 2);
    assert.match(stuck[0], /got stuck \(nothing happened/);
    assert.equal(failed.length, 1);
    assert.equal(queue.getJob(job.id).status, 'failed');
    // Killing it is immediate, its exit is noticed a moment later (longer on a busy machine).
    for (let t = Date.now(); proc.runningCount() && Date.now() - t < 3000;) await new Promise(r => setTimeout(r, 25));
    assert.equal(proc.runningCount(), 0, 'the frozen program was killed');
  } finally { delete process.env.JOB_IDLE_MINUTES; delete process.env.WATCHDOG_EVERY_MS; queue.startWorker(null); }
});

test('a job that keeps showing progress is left alone', async () => {
  process.env.JOB_IDLE_MINUTES = '0.004';
  process.env.WATCHDOG_EVERY_MS = '50';
  try {
    let stopped = 0;
    queue.startWorker(async (job, log) => { for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 100)); log(`step ${i}`); } return { ok: true }; }, { stuck: () => stopped++ });
    const job = queue.enqueue({ ws: 'w000000000002', kind: 'video' });
    await queue.idle(15000);
    assert.equal(queue.getJob(job.id).status, 'done');
    assert.equal(stopped, 0);
  } finally { delete process.env.JOB_IDLE_MINUTES; delete process.env.WATCHDOG_EVERY_MS; queue.startWorker(null); }
});

/* ---------------- 3. Instagram: never wrongly "failed", never twice ---------------- */
test('Instagram: a publish whose answer was lost is confirmed with Instagram, not reported as failed', async () => {
  const st = { status: {}, caption: {}, media: [], created: 0, publishCalls: 0, hang: false, down: false };
  const igs = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x'), form = new URLSearchParams(await body(req));
    if (st.down) return json(res, 500, { error: { message: 'down' } });
    if (url.pathname === '/v25.0/17841/media' && req.method === 'POST') { const id = `c${++st.created}`; st.status[id] = 'IN_PROGRESS'; st.caption[id] = form.get('caption'); return json(res, 200, { id }); }
    if (url.pathname === '/v25.0/17841/media') return json(res, 200, { data: st.media });
    let m = /^\/v25\.0\/(c\d+)$/.exec(url.pathname);
    if (m) return json(res, 200, { status_code: st.status[m[1]] });
    if (url.pathname === '/v25.0/17841/media_publish') {
      st.publishCalls++;
      const c = form.get('creation_id');
      st.status[c] = 'PUBLISHED';
      const id = `m${st.media.length + 1}`;
      st.media.unshift({ id, caption: st.caption[c], timestamp: new Date().toISOString(), permalink: `https://www.instagram.com/reel/${id}/` });
      if (st.hang) return;   // published, but the answer never arrives
      return json(res, 200, { id });
    }
    m = /^\/v25\.0\/(m\d+)$/.exec(url.pathname);
    if (m) return json(res, 200, { permalink: `https://www.instagram.com/reel/${m[1]}/` });
    json(res, 404, { error: { message: 'no stub ' + url.pathname } });
  });
  Object.assign(process.env, { INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's', INSTAGRAM_GRAPH_BASE: `http://127.0.0.1:${igs.address().port}`, INSTAGRAM_ALLOW_HTTP: '1', PUBLIC_URL: 'http://127.0.0.1:1', INSTAGRAM_TIMEOUT_MS: '300' });
  const ig = await import('../lib/instagram.js');
  try {
    const ws = store.createWorkspace({ name: 'Poster', comped: true });
    paths.writeJSON(path.join(store.wsDir(ws.id), 'instagram.json'), { userId: '17841', username: 'agent', token: ig.seal('tok'), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), connectedAt: new Date().toISOString() });
    const mk = (id, post) => store.addVideo(ws.id, { id, status: 'approved', file: `video_${id}.mp4`, post, createdAt: new Date().toISOString(), meta: { painPoint: 'Funeral costs' }, approval: { at: new Date().toISOString() } });
    const mine = r => r.filter(x => x.ws === ws.id && x.video);

    // A: the answer to "publish" is lost; the next minute Instagram says it's PUBLISHED.
    mk('i1', 'Who pays for the funeral? #planning');
    ig.schedulePost(ws.id, 'i1', 'now', 'me');
    assert.deepEqual(mine(await ig.tick()).map(x => x.status), ['processing']);
    st.status.c1 = 'FINISHED'; st.hang = true;
    assert.deepEqual(mine(await ig.tick()).map(x => x.status), ['publishing']);
    assert.equal(store.getVideo(ws.id, 'i1').autopost.step, 'publishing', 'saved before publishing');
    st.hang = false;
    assert.deepEqual(mine(await ig.tick()).map(x => x.status), ['posted']);
    const v1 = store.getVideo(ws.id, 'i1');
    assert.equal(v1.status, 'posted');
    assert.equal(v1.posted.url, 'https://www.instagram.com/reel/m1/');
    assert.equal(st.publishCalls, 1, 'published once');
    assert.ok(!titles().some(t => /didn’t go out/.test(t)), 'never called a failure');

    // B: Instagram stops answering for half an hour mid-publish: "unsure", and posting again checks first.
    mk('i2', 'Three things to check before you buy. #tips');
    ig.schedulePost(ws.id, 'i2', 'now', 'me');
    await ig.tick();
    st.status.c2 = 'FINISHED'; st.hang = true;
    await ig.tick();
    st.hang = false; st.down = true;
    assert.deepEqual(mine(await ig.tick(Date.now() + 31 * 60000)).map(x => x.status), ['unsure']);
    assert.ok(titles().includes('An Instagram post may or may not have gone out'));
    st.down = false;
    // Scheduled again and canceled: the earlier try is still remembered.
    ig.schedulePost(ws.id, 'i2', new Date(Date.now() + 3600000).toISOString(), 'me');
    assert.equal(ig.cancelPost(ws.id, 'i2'), true);
    ig.schedulePost(ws.id, 'i2', 'now', 'me');
    const created = st.created;
    assert.deepEqual(mine(await ig.tick()).map(x => x.status), ['posted']);
    assert.equal(st.created, created, 'no second post was started');
    assert.match(store.getVideo(ws.id, 'i2').autopost.note, /already on Instagram/);
    assert.ok(titles().includes('A video was already on Instagram'));

    // C: Instagram itself says the video failed: then (and only then) it didn't go out.
    mk('i3', 'A third video. #x');
    ig.schedulePost(ws.id, 'i3', 'now', 'me');
    await ig.tick();
    st.status[`c${st.created}`] = 'ERROR';
    assert.deepEqual(mine(await ig.tick()).map(x => x.status), ['failed']);
    assert.match(store.getVideo(ws.id, 'i3').autopost.error, /It wasn’t posted/);
    assert.throws(() => ig.schedulePost(ws.id, 'i1', 'now', 'me'), /already on Instagram/);
  } finally {
    igs.close();
    for (const k of ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_GRAPH_BASE', 'INSTAGRAM_ALLOW_HTTP', 'INSTAGRAM_TIMEOUT_MS']) delete process.env[k];
    process.env.PUBLIC_URL = '';
  }
});

/* ---------------- 4. update.sh needs a good backup ---------------- */
test('update.sh changes nothing when its backup fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-update-'));
  const live = path.join(dir, 'app');
  fs.mkdirSync(path.join(live, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'update.sh'), path.join(live, 'update.sh'));
  fs.writeFileSync(path.join(live, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(live, 'app.js'), 'old');
  fs.writeFileSync(path.join(live, 'admin.js'), "// knows pre-update-backup\nconsole.error('disk full'); process.exit(1);\n");
  const pm2 = path.join(dir, 'pm2');
  fs.writeFileSync(pm2, `#!/usr/bin/env bash\necho "$@" >> "${dir}/pm2.log"\n`, { mode: 0o755 });
  const zipDir = path.join(dir, 'z');
  fs.mkdirSync(zipDir);
  fs.writeFileSync(path.join(zipDir, 'app.js'), 'new');
  await new Promise(r => spawn('zip', ['-q', '-r', path.join(dir, 'u.zip'), '.'], { cwd: zipDir }).on('close', r));
  const r = await new Promise(resolve => {
    const p = spawn('bash', ['update.sh', path.join(dir, 'u.zip')], { cwd: live, env: { ...process.env, PM2: pm2, TEST_CMD: 'true', HEALTH_TRIES: '1', ALLOW_NO_BUILD_SHEET: '1', REHEARSE: '0' } });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', status => resolve({ status, out }));
  });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /backup before the update didn't work/);
  assert.equal(fs.readFileSync(path.join(live, 'app.js'), 'utf8'), 'old', 'the code wasn’t touched');
  assert.ok(!fs.existsSync(path.join(dir, 'pm2.log')), 'nothing restarted');
});

/* ---------------- 5. AI ladders ---------------- */
test('AI: a retired model steps down, a refused parameter is dropped, an outage moves to another company', async () => {
  const seen = [];
  const oai = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
      const id = decodeURIComponent(url.pathname.slice(11));
      if (id === 'gone-model') return json(res, 404, { error: { message: 'not found' } });
      if (id === 'soon-model') return json(res, 200, { id, shutdown_date: Math.round((Date.now() + 45 * 86400000) / 1000) });
      return json(res, 200, { id });
    }
    const b = JSON.parse(await body(req) || '{}');
    seen.push({ path: url.pathname, model: b.model, temperature: b.temperature });
    if (url.pathname === '/v1/audio/speech') return json(res, 404, { error: { message: `The model \`${b.model}\` does not exist or you do not have access to it.`, code: 'model_not_found' } });
    if (b.model === 'gone-model') return json(res, 404, { error: { message: 'The model `gone-model` does not exist or you do not have access to it.', code: 'model_not_found' } });
    if (b.model === 'picky' && 'temperature' in b) return json(res, 400, { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error' } });
    if (b.model === 'down-model') return json(res, 503, { error: { message: 'overloaded' } });
    json(res, 200, { choices: [{ message: { content: `{"model":"${b.model}"}` } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  });
  const claude = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') return json(res, 200, { id: 'x' });
    const b = JSON.parse(await body(req));
    seen.push({ path: url.pathname, model: b.model, anthropic: true, system: b.system, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
    if (b.model === 'no-credit') return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });
    json(res, 200, { content: [{ type: 'text', text: 'Here you go: {"from":"claude"}' }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' });
  });
  const eleven = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v1/models') return json(res, 200, [{ model_id: 'eleven_multilingual_v2' }]);
    seen.push({ path: url.pathname, eleven: true, key: req.headers['xi-api-key'], body: JSON.parse(await body(req)) });
    const chars = [...'Hi there'];
    json(res, 200, { audio_base64: Buffer.from('ID3fakeaudio').toString('base64'), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) } });
  });
  const keep = { ...process.env };
  Object.assign(process.env, {
    OPENAI_BASE_URL: `http://127.0.0.1:${oai.address().port}/v1`, ANTHROPIC_API_KEY: 'ak', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.address().port}/v1`,
    ELEVENLABS_API_KEY: 'ek', ELEVENLABS_VOICE_ID: 'voice1', ELEVENLABS_BASE_URL: `http://127.0.0.1:${eleven.address().port}/v1`,
    AI_LADDER_HOOKS: 'down-model,anthropic:no-credit', AI_LADDER_WRITER: 'gone-model,gpt-6-luna', AI_LADDER_COACH: 'down-model,anthropic:claude-haiku-5-5', AI_LADDER_QUICK: 'soon-model', AI_LADDER_VOICE: 'gone-tts,elevenlabs:eleven_multilingual_v2',
  });
  try {
    // A retired model: stepped down at once, remembered, and you're told.
    assert.equal(await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'writer' }), '{"model":"gpt-6-luna"}');
    assert.equal(ai.health().rungs['openai:gone-model'].gone, true);
    assert.ok(titles().includes('OpenAI no longer offers gone-model'));
    const before = seen.filter(s => s.model === 'gone-model').length;
    await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'writer' });
    assert.equal(seen.filter(s => s.model === 'gone-model').length, before, 'not asked again today');
    assert.equal(ai.modelFor('writer'), 'gone-model', 'the first choice is still what .env says');

    // A parameter the model refuses is left out, from then on.
    assert.equal(await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], model: 'picky', job: 'quick' }), '{"model":"picky"}');
    assert.equal(seen.filter(s => s.model === 'picky').length, 2);
    await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], model: 'picky', job: 'quick' });
    assert.equal(seen.filter(s => s.model === 'picky').length, 3);
    assert.equal(seen.at(-1).temperature, undefined);

    // OpenAI down: the coach answers through Claude, costed, and you're told a backup was used.
    const m = meter();
    assert.equal(await ai.chatJSON({ messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hello' }], job: 'coach', meter: m }), '{"from":"claude"}');
    const asked = seen.find(s => s.anthropic);
    assert.equal(asked.model, 'claude-haiku-5-5'); assert.equal(asked.key, 'ak'); assert.equal(asked.version, '2023-06-01');
    assert.match(asked.system, /Be brief\.[\s\S]*JSON/);
    assert.ok(m.total > 0, 'metered');
    assert.ok(titles().includes('The coach used a backup model today'));

    // OpenAI down and the backup company out of credit: it's reported as the outage (the video waits it
    // out), not as a permanent failure.
    const e = await ai.chatJSON({ messages: [{ role: 'user', content: 'x' }], job: 'hooks' }).catch(x => x);
    assert.equal(e.outage, true); assert.equal(e.permanent, false);

    // Voice: the first choice is gone, ElevenLabs reads it and times its own words.
    const sp = await ai.speech({ input: 'Hi there', voice: 'coral' });
    assert.equal(sp.model, 'eleven_multilingual_v2');
    assert.deepEqual(sp.words.map(w => w.word), ['Hi', 'there']);
    assert.equal(seen.find(s => s.eleven).key, 'ek');

    // The daily check: shutdown dates and retired models, with a warning ahead of time.
    const report = await ai.checkModels();
    assert.ok(report.find(r => r.rung === 'openai:soon-model').shutdownDate);
    assert.ok(titles().some(t => /will remove soon-model on \d{4}-\d{2}-\d{2}/.test(t)));
    assert.ok(ai.overview().find(j => j.job === 'quick').rungs[0].shutdownDate);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
    oai.close(); claude.close(); eleven.close();
  }
});

test('AI: Claude’s replies are read for their JSON; ElevenLabs letters become timed words', async () => {
  const { jsonIn, toClaude } = await import('../lib/anthropic.js');
  const { wordsFrom } = await import('../lib/elevenlabs.js');
  assert.equal(jsonIn('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(jsonIn('Sure! {"a":{"b":2}} Hope that helps.'), '{"a":{"b":2}}');
  assert.equal(jsonIn('no json here'), '');
  const c = toClaude([{ role: 'system', content: 'S' }, { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'image_url', image_url: { url: 'https://x/y.jpg' } }] }, { role: 'user', content: 'and this' }]);
  assert.equal(c.system, 'S');
  assert.equal(c.messages.length, 1, 'turns are merged so they alternate');
  assert.deepEqual(c.messages[0].content.map(b => b.type), ['text', 'image', 'image', 'text']);
  assert.equal(c.messages[0].content[1].source.type, 'base64');
  assert.equal(c.messages[0].content[2].source.type, 'url');
  const w = wordsFrom({ characters: [...'Hi, you.'], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
  assert.deepEqual(w, [{ word: 'Hi,', start: 0, end: 0.3 }, { word: 'you.', start: 0.4, end: 0.8 }]);
});

/* ---------------- 6. Checkpoints ---------------- */
const font = testFont();
test('a video job keeps each finished stage, so a retry doesn’t pay again', { skip: !hasFfmpeg() ? 'FFmpeg not installed' : !font ? 'no Poppins font' : false, timeout: 600000 }, async () => {
  const { starterStory } = await import('../templates.js');
  const { makeVideo } = await import('../pipeline.js');
  const ws = store.createWorkspace({ name: 'Checkpoint Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.look = { ...cfg.look, name: 'Checkpoint Agent', font };
  cfg.output.mode = 'voiceover';
  store.saveConfig(ws.id, cfg);
  const dir = path.join(paths.DIRS.work, 'job-test1');
  const footage = process.env.PIXABAY_BASE_URL;
  process.env.PIXABAY_BASE_URL = 'http://127.0.0.1:9/pixabay/';   // footage is down this time
  const logs = [];
  try {
    await assert.rejects(makeVideo({ ws: ws.id, log: l => logs.push(l), checkpoint: dir }));
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.ok(state.id && state.script && state.voice?.length, 'the script and voice were kept');
    assert.ok(state.cost > 0);
    const chat = stubs.calls.chat, speech = stubs.calls.speech;
    await assert.rejects(makeVideo({ ws: ws.id, log: l => logs.push(l), checkpoint: dir }));
    assert.equal(stubs.calls.chat, chat, 'the script wasn’t written again');
    assert.equal(stubs.calls.speech, speech, 'the voice wasn’t recorded again');
    assert.ok(logs.includes('Using the script from the last try.'));
    if (!process.env.FULL_TEST) return;   // the render below is slow
    process.env.PIXABAY_BASE_URL = footage;
    const v = await makeVideo({ ws: ws.id, log: l => logs.push(l), checkpoint: dir });
    assert.equal(v.id, state.id, 'the same video, not a new one');
    assert.equal(v.tries, 3);
    assert.ok(v.cost >= state.cost, 'the cost includes the earlier tries');
    assert.ok(!fs.existsSync(dir), 'its saved stages are cleared once it’s done');
    assert.equal(stubs.calls.speech, speech);
    assert.equal(store.readVideos(ws.id).filter(x => x.id === v.id).length, 1);
    // A job that saved its video and then failed: running it again doesn't make a second one.
    fs.mkdirSync(dir, { recursive: true });
    paths.writeJSON(path.join(dir, 'state.json'), { id: v.id });
    assert.equal((await makeVideo({ ws: ws.id, log: () => {}, checkpoint: dir })).id, v.id);
    assert.equal(store.readVideos(ws.id).filter(x => x.id === v.id).length, 1);
  } finally { process.env.PIXABAY_BASE_URL = footage; }
});

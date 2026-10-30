// The team's lessons (lib/lessons.js, routes/reels.js): the leader uploads a video once; the server
// makes the transcript and a first draft; she edits and publishes; her agents learn it any time and
// tap "I tried it". Agents never see drafts, never change lessons, and other teams see nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const lessons = await import('../lib/lessons.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-'));
const clipWith = (name, args) => { const f = path.join(dir, name); spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, f]); return f; };
const talking = clipWith('talk.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=6', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-shortest', '-c:v', 'libx264', '-c:a', 'aac']);
const silent = clipWith('silent.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=6', '-c:v', 'libx264']);

const mkWs = (name) => { const ws = store.createWorkspace({ name }); store.updateWorkspace(ws.id, { onboarded: true }); return store.getWorkspace(ws.id); };
const team = mkWs('Melanie’s Team'), other = mkWs('Another Team');
store.createAccount({ email: 'mel@example.com', name: 'Melanie', role: 'agent', workspaceId: team.id, hash: await auth.hashPassword('melpass123456') });
store.createAccount({ email: 'ann@example.com', name: 'Ann', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('annpass123456') });
const login = async (email, password) => { const c = client(port); const r = await c.post('/api/login', { email, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const upload = (c, file, query = '') => fetch(`http://127.0.0.1:${port}/api/reels/lessons${query}`, { method: 'POST', headers: { cookie: c.cookie, 'Content-Type': 'video/mp4' }, body: fs.readFileSync(file) }).then(async (r) => ({ status: r.status, data: await r.json() }));
const waitReady = async (wsId, id) => { for (let i = 0; i < 200; i++) { const l = lessons.get(wsId, id); if (l.status !== 'processing') return l; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never ready'); };

let mel, jay, jayId, lessonId;

test('a leader uploads a video: a playable copy, the exact words, and a first draft come back', async () => {
  mel = await login('mel@example.com', 'melpass123456');
  const up = await upload(mel, talking);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.lesson.status, 'processing');
  lessonId = up.data.lesson.id;
  const l = await waitReady(team.id, lessonId);
  assert.equal(l.status, 'ready', l.error);
  assert.match(l.transcript, /think about it, ask what part/);
  assert.equal(l.title, 'When they need to think about it');
  assert.equal(l.step, 'close');
  assert.equal(l.doThis.length, 2);
  assert.equal(l.published, false, 'nothing reaches agents until she publishes');
  assert.ok(lessons.fileOf(team.id, lessonId) && lessons.fileOf(team.id, lessonId, 'thumb'));
  const v = await mel.get(`/api/reels/lessons/${lessonId}/video`);
  assert.equal(v.status, 200); assert.equal(v.headers.get('content-type'), 'video/mp4');
});

test('videos with nothing to say, or the wrong kind of file, are turned away with a plain reason', async () => {
  const quiet = await upload(mel, silent);
  assert.equal(quiet.status, 400); assert.match(quiet.data.error, /no sound/);
  const notVideo = await fetch(`http://127.0.0.1:${port}/api/reels/lessons`, { method: 'POST', headers: { cookie: mel.cookie, 'Content-Type': 'image/png' }, body: 'x' });
  assert.equal(notVideo.status, 415);
});

test('publishing needs the three things an agent acts on: a title, the point, something to do', async () => {
  const empty = await mel.put(`/api/reels/lessons/${lessonId}`, { point: '' , published: true });
  assert.equal(empty.status, 400); assert.match(empty.data.error, /the point/);
  const ok = await mel.put(`/api/reels/lessons/${lessonId}`, { point: 'It is usually the price. Ask which part, then show the smaller option.', doThis: ['Ask “which part?”', '', 'Have a smaller option ready', 'a', 'b'], published: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const l = ok.data.lessons.find((x) => x.id === lessonId);
  assert.equal(l.published, true);
  assert.deepEqual(l.doThis, ['Ask “which part?”', 'Have a smaller option ready', 'a'], 'blank lines dropped, three at most');
});

test('her agents see only published lessons, can watch them, and can’t change them', async () => {
  const inv = await mel.post('/api/reels/invite', { email: 'jay@example.com' });
  jay = client(port);
  const ok = await jay.post('/api/link/accept', { token: inv.data.link.split('/#/invite/')[1], kind: 'invite', name: 'Jay', password: 'jaypass123456', acceptTerms: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  jayId = (await jay.get('/api/me')).data.account?.id || store.findAccountByEmail('jay@example.com').id;
  const draft = await upload(mel, talking); await waitReady(team.id, draft.data.lesson.id);
  const seen = await jay.get('/api/reels/lessons');
  assert.equal(seen.data.role, 'agent');
  assert.deepEqual(seen.data.lessons.map((l) => l.id), [lessonId], 'the unpublished draft stays hidden');
  assert.ok(!('tried' in seen.data.lessons[0]) && !('status' in seen.data.lessons[0]));
  assert.equal((await jay.get(`/api/reels/lessons/${lessonId}/video`)).status, 200);
  assert.equal((await jay.get(`/api/reels/lessons/${draft.data.lesson.id}/video`)).status, 404, 'no peeking at drafts');
  assert.equal((await jay.put(`/api/reels/lessons/${lessonId}`, { title: 'x' })).status, 403);
  assert.equal((await jay.del(`/api/reels/lessons/${lessonId}`)).status, 403);
  assert.equal((await upload(jay, talking)).status, 403);
});

test('"I tried it" lands in the agent’s own log, and the leader sees who tried it', async () => {
  const me = (await jay.get('/api/reels/me')).data;
  const row = { agent_id: 'me', type: 'lesson_tried', occurred_at: new Date().toISOString(), meta: { lesson_id: lessonId } };
  const sync = await jay.post('/api/reels/sync', { rev: me.rev, acts: { base: 0, add: [row] }, client: 'dTESTPHONE' });
  assert.equal(sync.status, 200, JSON.stringify(sync.data));
  const view = (await mel.get('/api/reels/lessons')).data.lessons.find((l) => l.id === lessonId);
  assert.equal(view.tried, 1); assert.equal(view.teamSize, 1);
});

test('another team sees none of it', async () => {
  const ann = await login('ann@example.com', 'annpass123456');
  assert.deepEqual((await ann.get('/api/reels/lessons')).data.lessons, []);
  assert.equal((await ann.get(`/api/reels/lessons/${lessonId}/video`)).status, 404);
});

test('the leader orders the course and deletes a lesson with its video', async () => {
  const all = (await mel.get('/api/reels/lessons')).data.lessons;
  const second = all[1].id;
  const moved = await mel.post(`/api/reels/lessons/${second}/move`, { to: 0 });
  assert.deepEqual(moved.data.lessons.map((l) => l.id), [second, lessonId]);
  const file = lessons.fileOf(team.id, second);
  const gone = await mel.del(`/api/reels/lessons/${second}`);
  assert.deepEqual(gone.data.lessons.map((l) => l.id), [lessonId]);
  assert.ok(!fs.existsSync(file));
});

// Phone video is big (1080p at 60 fps is about 100 MB a minute), and Cloudflare's free plan refuses any
// single request over 100 MB. So big videos go up in pieces; a dropped signal only resends one piece.
test('a big video goes up in pieces: retries are fine, gaps are refused with where to carry on', async () => {
  const bytes = fs.readFileSync(talking);
  const put = (id, offset, body) => fetch(`http://127.0.0.1:${port}/api/reels/lessons/uploads/${id}?offset=${offset}`, { method: 'PUT', headers: { cookie: mel.cookie, 'Content-Type': 'application/octet-stream' }, body }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const start = await mel.post('/api/reels/lessons/uploads', { size: bytes.length, type: 'video/mp4' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.pieceMB, 32);
  const id = start.data.uploadId, third = Math.ceil(bytes.length / 3);
  const a = bytes.subarray(0, third), b = bytes.subarray(third, 2 * third), c = bytes.subarray(2 * third);
  assert.equal((await put(id, 0, a)).data.received, a.length);
  assert.equal((await put(id, 0, a)).data.received, a.length, 'the same piece twice (a retry) is fine');
  const gap = await put(id, 2 * third, c);
  assert.equal(gap.status, 409); assert.equal(gap.data.received, a.length, 'says where to carry on');
  assert.equal((await mel.post(`/api/reels/lessons/uploads/${id}/finish`, {})).status, 409, 'not before every piece is in');
  await put(id, third, b); await put(id, 2 * third, c);
  assert.equal((await mel.get(`/api/reels/lessons/uploads/${id}`)).data.received, bytes.length);
  const done = await mel.post(`/api/reels/lessons/uploads/${id}/finish`, { step: 'open' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const l = await waitReady(team.id, done.data.lesson.id);
  assert.equal(l.status, 'ready', l.error); assert.equal(l.step, 'open');
  assert.match(l.transcript, /think about it/);
  assert.equal((await mel.get(`/api/reels/lessons/uploads/${id}`)).status, 404, 'a finished upload is gone');
});

test('uploads in pieces: plain limits, and nobody else can touch one', async () => {
  const huge = await mel.post('/api/reels/lessons/uploads', { size: 5 * 1024 ** 3, type: 'video/mp4' });
  assert.equal(huge.status, 413); assert.match(huge.data.error, /1080p/);
  assert.equal((await mel.post('/api/reels/lessons/uploads', { size: 1000, type: 'image/png' })).status, 415);
  const start = await mel.post('/api/reels/lessons/uploads', { size: 1000, type: 'video/mp4' });
  assert.equal((await jay.post('/api/reels/lessons/uploads', { size: 1000, type: 'video/mp4' })).status, 403, 'agents don’t add lessons');
  const ann = await login('ann@example.com', 'annpass123456');
  assert.equal((await ann.get(`/api/reels/lessons/uploads/${start.data.uploadId}`)).status, 404, 'another team can’t see it');
  assert.equal((await mel.get('/api/reels/lessons/uploads/u0000000000000000')).status, 404);
});

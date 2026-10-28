// v15 Phase 7 (part 3): Fix a scene's clip picker (about ten scored clips per scene, Refresh limited, picked clips used exactly), and Fix a
// scene's refusals carrying one-tap fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client, hasFfmpeg } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const queue = await import('../lib/queue.js');
const M = await import('../mixer-core.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

const mk = name => {
  const ws = store.createWorkspace({ name, comped: true });
  const c = store.loadConfig(ws.id);
  c.story = { ...c.story, ...starterStory(['final_expense']) };
  c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, c);
  store.updateWorkspace(ws.id, { onboarded: true });
  return ws;
};
const wsA = mk('Rules A'), wsB = mk('Rules B');
store.createAccount({ email: 'a@example.com', role: 'agent', workspaceId: wsA.id, hash: await auth.hashPassword('apass1234567') });
store.createAccount({ email: 'root@example.com', role: 'admin', hash: await auth.hashPassword('rootpass1234') });
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const agent = await login('a@example.com', 'apass1234567');
const admin = await login('root@example.com', 'rootpass1234');

test('Fix a scene’s clip picker: about ten scored clips, unusable ones left out, Refresh limited; a refused fix carries its one-tap fix', async () => {
  const scenes = [{ text: 'Who pays for your funeral someday?', accent: 'funeral', keyword: 'older woman kitchen' }, { text: 'Final expense insurance is usually a small policy', accent: 'small', keyword: 'funeral test couple' }];
  store.addVideo(wsA.id, { id: 'cp1', file: 'video_cp1.mp4', status: 'pending', createdAt: new Date().toISOString(), mode: 'captions', meta: { painPoint: 'Funeral costs', visual: 'older adults' }, scenes, clips: [{ id: 1001, checked: true, score: 3 }, { id: 1002, checked: true, score: 3 }], post: 'p', preflight: [] });
  const { mkdirSync, writeFileSync } = await import('fs');
  const path = (await import('path')).default, paths = await import('../lib/paths.js');
  mkdirSync(path.join(paths.DIRS.assets, wsA.id, 'cp1'), { recursive: true });
  writeFileSync(path.join(paths.DIRS.assets, wsA.id, 'cp1', 'picks.json'), JSON.stringify({ insights: [store.loadConfig(wsA.id).story.insights[0]], format: 'question', structure: 'classic' }));
  let r = await agent.post('/api/videos/cp1/clips', { i: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.clips.length >= 8 && r.data.clips.length <= 10, String(r.data.clips.length));
  assert.ok(r.data.clips.every(c => c.score !== 1), 'unusable clips left out');
  assert.ok(r.data.clips.every(c => c.thumb && c.preview), 'each with a thumbnail and a preview');
  assert.equal(r.data.current, 1002); assert.equal(r.data.refreshesLeft, 5);
  const first = r.data.clips[0];
  let seen = r.data.clips.map(c => c.id);
  for (let k = 0; k < 5; k++) { r = await agent.post('/api/videos/cp1/clips', { i: 1, seen }); assert.equal(r.status, 200); assert.ok(r.data.clips.every(c => !seen.includes(c.id)), 'ten more, not the same'); seen = [...seen, ...r.data.clips.map(c => c.id)]; }
  assert.equal(r.data.refreshesLeft, 0);
  assert.equal((await agent.post('/api/videos/cp1/clips', { i: 1, seen })).status, 429, 'five refreshes per scene');
  assert.equal((await agent.post('/api/videos/cp1/clips', { i: 1 })).status, 429, 'starting the list over counts too');
  // A clip never offered for that scene can't be picked; a picked one goes with the score it was given
  // here, not one the browser sends; a bad id is ignored.
  assert.equal((await agent.post('/api/videos/cp1/fix', { picks: { 1: { id: 999999, score: 5 } } })).status, 409, 'never offered');
  const fix = await agent.post('/api/videos/cp1/fix', { picks: { 1: { id: first.id, query: 'x', score: 5, reason: 'forged' }, 0: { id: '../../x' } } });
  assert.equal(fix.status, 200, JSON.stringify(fix.data));
  const job = queue.listJobs(wsA.id).find(j => j.kind === 'fix' && j.opts.videoId === 'cp1');
  assert.deepEqual(job.opts.picks, { 1: { id: first.id, query: 'funeral test couple', score: first.score, reason: first.reason } });
  queue.cancel(wsA.id, job.id);
  assert.equal((await agent.post('/api/videos/cp1/clips', { i: 1, seen })).status, 200, 'a sent fix starts the refreshes afresh');
  // With the workspace's clip check off, the clips come unscored (no AI spent on them).
  const c0 = store.loadConfig(wsA.id); store.saveConfig(wsA.id, { ...c0, output: { ...c0.output, clipCheck: 'off' } });
  r = await agent.post('/api/videos/cp1/clips', { i: 0 });
  assert.equal(r.status, 200); assert.ok(r.data.clips.length && r.data.clips.every(c => c.score === null && c.reason === 'not checked'));
  store.saveConfig(wsA.id, c0);
  // A fix that would stop: the refusal carries the one-tap fix.
  const no = await agent.post('/api/videos/cp1/fix', { edits: [{ i: 1, text: 'Final expense insurance is a small policy' }] });
  assert.equal(no.status, 400);
  const q = no.data.findings.find(f => f.rule === 'qualifier');
  assert.equal(q.fix.label, 'Put “usually” back');
});

const skip = !process.env.FULL_TEST ? 'renders videos; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : false;
test('end to end: a picked clip is used exactly, and the review card says it was chosen (and scored)', { skip, timeout: 900000 }, async () => {
  const { makeVideo, fixVideo } = await import('../pipeline.js');
  const v = await makeVideo({ ws: wsA.id, log: () => {} });
  const r = await agent.post(`/api/videos/${v.id}/clips`, { i: 2 });
  assert.ok(r.data.clips.length && r.data.clips.every(c => !v.clips.some(x => String(x.id) === String(c.id))), 'never a clip this video already uses');
  const pick = r.data.clips[0];
  const fixed = await fixVideo({ ws: wsA.id, videoId: v.id, picks: { 2: { id: pick.id, query: r.data.keyword, score: pick.score, reason: pick.reason } }, log: () => {} });
  assert.equal(String(fixed.clips[2].id), String(pick.id));
  assert.equal(fixed.clips[2].chosen, true);
  assert.ok(fixed.preflight.some(p => /You chose the footage in scene 3 \(the clip check scored it too\)/.test(p.label)));
  assert.deepEqual(fixed.fixLog.at(-1).picked, [2]);
});

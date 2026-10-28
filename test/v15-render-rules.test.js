// v15 Phase 7 (part 3): Admin → Render rules (change the checks without new code: levels, settings and
// word lists, for everyone or one workspace, with Try it first and every change undoable), Fix a scene's
// clip picker (about ten scored clips per scene, Refresh limited, picked clips used exactly), and Fix a
// scene's refusals carrying one-tap fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client, hasFfmpeg } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const rules = await import('../lib/rules.js');
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

test('the rules store: only what can be set, everyone’s with a workspace’s on top, never saved with the config', async () => {
  const paths = await import('../lib/paths.js'), path = (await import('path')).default;
  const cleaned = rules.clean({ levels: { price: { draft: 'off' }, cliche: { draft: 'block', auto: 'nope' }, nope: { draft: 'off' } }, settings: { factMatch: 2, recentCount: '7', captionWords: '' }, lists: { cliches: { add: ['  Super Easy ', 'super easy'], remove: ['journey'] }, nope: { add: ['x'] } } });
  assert.deepEqual(cleaned, { levels: { cliche: { draft: 'block' } }, settings: { factMatch: 0.8, recentCount: 7, captionWords: null }, lists: { cliches: { add: ['super easy'], remove: ['journey'] } } }, 'locked rules and bad values dropped');
  rules.save('global', { levels: { cliche: { draft: 'block' } }, settings: { recentCount: 10 } }, { byName: 'Test' });
  rules.save(wsB.id, { levels: { cliche: { draft: 'off' } }, lists: { cliches: { add: ['super easy'] } } }, { byName: 'Test' });
  assert.equal(M.rulesOf(store.loadConfig(wsA.id)).level('cliche', 'draft'), 'block');
  assert.equal(M.rulesOf(store.loadConfig(wsB.id)).level('cliche', 'draft'), 'off', 'the workspace’s own wins');
  assert.equal(M.rulesOf(store.loadConfig(wsB.id)).setting('recentCount'), 10, 'and everyone’s still applies where it says nothing');
  assert.ok(M.rulesOf(store.loadConfig(wsB.id)).list('cliches').includes('super easy'));
  const saved = store.saveConfig(wsA.id, { ...store.loadConfig(wsA.id), rules: { levels: { cliche: { draft: 'off' } } } });
  assert.equal(saved.rules.levels.cliche.draft, 'block', 'the rules in force come back');
  assert.equal(paths.readJSON(path.join(store.wsDir(wsA.id), 'config.json'), {}).rules, undefined, 'never saved with the config');
  // History: who, what, and the way back.
  const h = rules.read().history;
  assert.equal(h[0].scope, wsB.id); assert.equal(h[1].scope, 'global');
  assert.deepEqual(rules.describe(h[1].before, h[1].after), ['Overused ad wording: drafts warn → block', 'Recent videos that count for “too close”: 30 → 10']);
  rules.restore(h[1].id, 'before');
  assert.equal(M.rulesOf(store.loadConfig(wsA.id)).level('cliche', 'draft'), 'warn', 'undone');
  rules.save(wsB.id, {});
  assert.equal(rules.read().workspaces[wsB.id], undefined, 'an empty override is removed');
});

test('Admin → Render rules over the API: admins only; try it first with the unsaved rules; save; every change listed with a way back', async () => {
  assert.equal((await agent.get('/api/admin/rules')).status, 403);
  const st = (await admin.get('/api/admin/rules')).data;
  assert.ok(st.rules.find(r => r.id === 'price').locked && st.rules.find(r => r.id === 'cliche').draft === 'warn');
  assert.ok(st.lists.find(l => l.id === 'cliches').base.includes('peace of mind'));
  const script = 'Who pays for your funeral someday?\nFinal expense can give you peace of mind.\nPlans can cost $30 a month';
  let t = (await admin.post('/api/admin/rules/try', { scope: 'global', rules: {}, script })).data;
  assert.equal(t.draft.find(f => f.rule === 'cliche').kind, 'warn'); assert.equal(t.auto.find(f => f.rule === 'cliche').kind, 'stop');
  assert.equal(t.draft.find(f => f.rule === 'price').kind, 'stop');
  t = (await admin.post('/api/admin/rules/try', { scope: 'global', rules: { levels: { cliche: { draft: 'block' } } }, script })).data;
  assert.equal(t.draft.find(f => f.rule === 'cliche').kind, 'stop', 'the unsaved rules are the ones tried');
  t = (await admin.post('/api/admin/rules/try', { scope: 'global', rules: { lists: { cliches: { remove: ['peace of mind'] } } }, script })).data;
  assert.ok(!t.draft.some(f => f.rule === 'cliche'), 'a word taken off the list');
  assert.equal((await admin.post('/api/admin/rules/try', { scope: 'global', script: '' })).status, 400);
  // Save for one workspace; it shows in the history, and in that workspace's Studio checks.
  const saved = (await admin.post('/api/admin/rules', { scope: wsA.id, rules: { levels: { factMatch: { draft: 'block' } } } })).data;
  assert.deepEqual(saved.workspace, { levels: { factMatch: { draft: 'block' } } });
  assert.match(saved.history[0].changes[0], /Teaching scenes say the fact: drafts warn → block/);
  assert.equal(saved.history[0].scopeName, 'Rules A');
  const d = (await agent.post('/api/studio', { brief: { painId: 'fe_p1', audienceId: 'fe_a1', scenes: 6 } })).data.draft;
  const off = ['Thinking about later?', 'Life can surprise every family', 'Planning brings families together', 'Ask me about a simple plan', 'What fits depends on your family.', 'Message me and we can talk'].map(x => ({ text: x, accent: '', keyword: 'older woman' }));
  const view = (await agent.put('/api/studio/' + d.id, { scenes: off })).data.draft;
  assert.equal(view.check.findings.find(f => f.rule === 'factMatch').kind, 'stop');
  const back = (await admin.post('/api/admin/rules/restore', { id: saved.history[0].id, which: 'before' })).data;
  assert.equal(back.workspace && Object.keys(back.workspace).length ? 'set' : 'none', 'none');
  assert.equal((await agent.get('/api/studio/' + d.id)).data.draft.check.findings.find(f => f.rule === 'factMatch').kind, 'warn');
  assert.ok((await admin.get('/api/admin/audit')).data.entries.some(e => /render rules for Rules A/.test(e.detail || '')));
});

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

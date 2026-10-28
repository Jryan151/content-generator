// Hook-first script writing and the coach, against the fake OpenAI server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Coach Test', comped: true });
const cfg = store.loadConfig(ws.id);
cfg.story = { ...cfg.story, ...starterStory() };
cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
cfg.look.name = 'Jane Smith';
store.saveConfig(ws.id, cfg);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'jane@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('janepass1234') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'jane@example.com', password: 'janepass1234' });

test('scripts open with the best hook from the hook step', async () => {
  const r = await c.post('/api/script', { format: 'myth' });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.meta.format, 'myth');
  assert.ok(r.data.hooks.length >= 1);
  assert.match(r.data.log.join('\n'), /Hooks: 9 written, 8 passed the rules/);
  assert.equal(r.data.scenes[0].text, r.data.drafts.find(d => d.n === r.data.chosen).hook);
});

test('the coach answers, and only safe, valid suggestions get through', async () => {
  const r = await c.post('/api/coach', { messages: [{ role: 'user', content: 'Help me with hooks' }], view: 'create' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.reply, /moment the worry/);
  assert.deepEqual(r.data.suggestions.map(s => s.type), ['add_worry', 'set_voice', 'add_note']);
  assert.deepEqual(r.data.suggestions[0].audienceIds, ['aud'], 'unknown ids are dropped');
  assert.equal(r.data.suggestions[1].energy, 'mid');
  assert.equal(r.data.suggestions[1].tone, undefined, 'invalid values are dropped');
  assert.equal(r.data.suggestions[1].tryable, true);
  assert.equal(r.data.suggestions[0].tryable, undefined);
  assert.equal(r.data.followups.length, 2);
  assert.notEqual((await c.post('/api/coach', { messages: [] })).status, 200, 'needs a question');
});

test('Try it writes the same idea with and without a change', async () => {
  const r = await c.post('/api/coach/try', { suggestion: { type: 'set_voice', energy: 'mid', label: 'More conversational' } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.ok(r.data.before.scenes.length && r.data.after.scenes.length);
  assert.equal(r.data.before.topic, r.data.after.topic, 'same topic on both sides');
  assert.equal(r.data.verdict.better, 'B');
  assert.equal((await c.post('/api/coach/try', { suggestion: { type: 'add_fact', text: 'Many policies usually help.' } })).status, 400);
});

test('rewrites of one caption only include versions that pass the checks', async () => {
  const { generateScript } = await import('../stages/script.js');
  const { DIRS } = await import('../lib/paths.js');
  const fs = await import('fs'); const path = await import('path');
  const s = await generateScript({ cfg: store.loadConfig(ws.id), log: () => {} });
  const id = 'v' + Date.now();
  store.addVideo(ws.id, { id, status: 'pending', createdAt: new Date().toISOString(), scenes: s.scenes, meta: s.meta, mode: 'captions', clips: s.scenes.map((_, i) => ({ id: 100 + i, alts: [] })), file: 'x.mp4' });
  const dir = path.join(DIRS.assets, ws.id, id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'picks.json'), JSON.stringify({ audience: s.picks.audience, painPoint: s.picks.painPoint, insight: s.picks.insight, insights: s.picks.insights, solution: s.picks.solution, solutions: s.picks.solutions, question: s.picks.question, format: s.picks.format }));
  const r = await c.post('/api/coach/rewrite', { videoId: id, i: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.options.length >= 1);
  assert.ok(!r.data.options.some(o => /guaranteed/i.test(o.text)), 'rule-breaking versions are dropped');
  assert.ok(r.data.dropped >= 1);
});

test('coach notes can be added, listed and removed', async () => {
  const a = await c.post('/api/coach/notes', { text: 'Prefers calm videos' });
  assert.equal(a.status, 200);
  await c.post('/api/coach/notes', { text: 'Applied: More conversational', kind: 'applied' });
  const l = await c.get('/api/coach/notes');
  assert.equal(l.data.notes.length, 2);
  const d = await c.del('/api/coach/notes/' + a.data.note.id);
  assert.deepEqual(d.data.notes.map(n => n.kind), ['applied']);
});

test('weekly check-in keeps only a valid plan, and approving it queues those videos', async () => {
  const r = await c.post('/api/coach/weekly', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.weekly.plan.length, 2, 'unknown worries and formats are dropped');
  assert.equal(r.data.weekly.change.type, 'set_voice');
  assert.equal((await c.get('/api/coach/weekly')).data.current, true);
  const q = await c.post('/api/coach/plan', { items: r.data.weekly.plan });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.equal(q.data.jobs.length, 2);
});

test('DM replies never include prices or promises', async () => {
  const r = await c.post('/api/coach/reply', { message: 'How much does this cost for a 70 year old?' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.replies.map(x => x.label), ['Warm', 'Short']);
  assert.equal((await c.post('/api/coach/reply', { message: '' })).status, 400);
});

// v15 Phase 7 (part 2): open drafting, then agent review. Submit for review renders a Studio draft into the
// agent's Review ("Waiting for you"); the draft stays editable, and the next submit is a new version of the
// same video, marked Updated, showing what changed. The agent can ask for changes (a checklist per scene,
// and the music) that go to the assistant's Desk; the assistant ticks them off in Studio and resubmits.
// Only the agent approves; the receipt records the locked checks, every version, and who changed what.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { tempEnv, startStubs, client, hasFfmpeg } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const queue = await import('../lib/queue.js');
const studio = await import('../lib/studio.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Review Agent', comped: true });
const cfg0 = store.loadConfig(ws.id);
cfg0.story = { ...cfg0.story, ...starterStory() };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
cfg0.look = { ...cfg0.look, name: 'Dana Agent', location: 'Gallup, NM' };
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true, limits: { assistantSeats: 1 } });
store.createAccount({ email: 'dana@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('danapass1234') });
const sam = store.createAccount({ email: 'sam@example.com', name: 'Sam Helper', role: 'agent', workspaceId: null, hash: await auth.hashPassword('sampass12345') });
store.setMembership(sam.id, ws.id, { role: 'assistant' });
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const agent = await login('dana@example.com', 'danapass1234');
const asst = await login('sam@example.com', 'sampass12345');
const FACT = cfg0.story.insights[0];
const brief = { painId: 't_funeral', audienceId: 'aud', insightIds: [FACT.id], scenes: 6, format: 'question', structure: 'classic' };
const sc = (text, accent) => ({ text, accent, keyword: 'older woman kitchen', say: '' });
const board = () => [sc('Who pays for your funeral someday?', 'funeral'), sc('Final expense insurance is usually a small policy', 'small'), sc('It is meant to cover funeral and end-of-life costs', 'funeral'),
  sc('Ask me about a simple plan for this', 'simple'), sc('What fits you depends on your family.', 'family'), sc(`${cfg0.story.ctaAction || 'Message me'} and we can talk it through`, 'talk')];
// A video as the Studio job saves it (the render itself is covered end to end under test:full).
const studioVideo = (id, draftId, extra = {}) => store.addVideo(ws.id, { id, file: `video_${id}.mp4`, cover: '', status: 'pending', source: 'studio', by: sam.id, createdAt: new Date().toISOString(), mode: 'captions', meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId, music: 'calm.mp3' }, scenes: board(), clips: board().map(() => ({ id: 1, checked: true })), post: 'Post', preflight: [{ ok: true, label: 'Checked' }], version: 1 , ...extra });

test('the receipt records the locked checks, the notes rendered past, and every version with who changed what', async () => {
  const id = 'rv2';
  studioVideo(id, 'sd_none', {
    status: 'approved', version: 2, approval: { at: new Date().toISOString(), byName: 'Dana Agent', checklist: ['Watched it'], sha256: 'ab', file: `video_${id}.mp4` },
    meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId: 'sd_none', notes: ['Uses overused ad wording ("peace of mind").'], locked: ['price', 'rates', 'qualifier'] },
    versions: [{ v: 1, at: '2026-10-01T10:00:00.000Z', byName: 'Sam Helper', changed: [] }, { v: 2, at: '2026-10-02T10:00:00.000Z', byName: 'Sam Helper', changed: [1], asked: { byName: 'Dana Agent', note: 'Warmer', items: [{ label: 'Scene 2: caption', done: true }, { label: 'Music', done: false }] } }],
  });
  const html = String((await agent.get(`/api/videos/${id}/receipt.html`)).data);
  assert.match(html, /Locked checks<\/dt><dd>Checked in code, and passed, on this version: Prices, percentages and price comparisons; Rate and urgency wording; Dropped qualifier\./);
  // A video made before v15 recorded which locked checks ran: none are claimed for it.
  studioVideo('rv0', 'sd_old', { status: 'approved', approval: { at: new Date().toISOString(), byName: 'Dana Agent', checklist: ['Watched it'], sha256: 'ab', file: 'video_rv0.mp4' } });
  assert.doesNotMatch(String((await agent.get('/api/videos/rv0/receipt.html')).data), /Locked checks/);
  assert.match(html, /Notes rendered past<\/dt><dd>Uses overused ad wording/);
  assert.match(html, /Version 2, .*submitted by Sam Helper: changed scene 2/);
});

const skip = !process.env.FULL_TEST ? 'renders videos; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : false;
test('end to end: a resubmitted draft becomes version 2 of the same video, marked Updated, with what changed', { skip, timeout: 900000 }, async () => {
  const { makeVideo } = await import('../pipeline.js');
  const d = studio.create(ws.id, store.loadConfig(ws.id), brief);
  studio.save(ws.id, d.id, { scenes: board() });
  const v1 = await makeVideo({ ws: ws.id, studio: studio.get(ws.id, d.id), source: 'studio', log: () => {}, by: sam.id });
  assert.equal(v1.version, 1); assert.equal(v1.meta.draftId, d.id); assert.equal(v1.by, sam.id);
  const edited = board(); edited[1] = sc('Final expense insurance is usually a small, plain policy', 'plain');
  studio.save(ws.id, d.id, { scenes: edited });
  const v2 = await makeVideo({ ws: ws.id, studio: studio.get(ws.id, d.id), source: 'studio', log: () => {}, replace: v1.id, by: sam.id });
  assert.equal(v2.id, v1.id, 'the same video');
  assert.equal(v2.version, 2); assert.equal(v2.updated, true);
  assert.ok(v1.meta.locked.includes('numbers') && v2.meta.locked.includes('price'), 'the locked checks that ran are recorded');
  assert.deepEqual(v2.versions.map(x => x.v), [1, 2]);
  const last = v2.versions[1];
  assert.deepEqual(last.changed, [1]); assert.equal(last.before[0].text, board()[1].text); assert.equal(last.byName, 'Sam Helper');
  assert.ok(!fs.existsSync(store.videoPath(ws.id, v1.file)), 'the old version’s file is gone');
  assert.ok(fs.existsSync(store.videoPath(ws.id, v2.file)));
  assert.equal(store.readVideos(ws.id).filter(v => v.id === v1.id).length, 1);
});

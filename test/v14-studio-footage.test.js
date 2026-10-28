// v14 Phase 1: Studio and footage. A shot plan for automatic videos (faces, close-ups, places,
// movement, light; never the same kind twice in a row), searches the agent types held to no footage
// rules, rewrites that know the Studio rules (and say why any were hidden), ✦ Ideas per scene, and a
// Studio mode for the coach that works on the draft on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const P = await import('../lib/prompts.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Footage Test', comped: true });
const cfg0 = store.loadConfig(ws.id);
cfg0.story = { ...cfg0.story, ...starterStory() };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
cfg0.look = { ...cfg0.look, name: 'Jane Smith', location: 'Gallup, NM' };
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'foot@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('footpass1234') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'foot@example.com', password: 'footpass1234' });
const cfg = () => store.loadConfig(ws.id);
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('shot plan: a person opens and closes, no kind twice in a row, at most twice a video, people in the mix’s share', () => {
  const human = k => M.SHOT_TYPES[k].human;
  for (const [mix, share] of [['people', 2 / 3], ['balanced', 1 / 2], ['scenery', 1 / 3]]) {
    for (let k = 0; k < 200; k++) {
      const n = 5 + (k % 4), plan = M.shotPlan(n, seeded(k + 1), { mix });
      assert.equal(plan.length, n);
      assert.ok(['closeup', 'people'].includes(plan[0]), `opening: ${plan}`);
      assert.ok(human(plan[n - 1]), `call to action: ${plan}`);
      plan.forEach((s, i) => { assert.ok(M.SHOT_TYPES[s]); if (i) assert.notEqual(s, plan[i - 1], `repeat: ${plan}`); });
      Object.keys(M.SHOT_TYPES).forEach(t => assert.ok(plan.filter(x => x === t).length <= 2, `more than twice: ${plan}`));
      assert.ok(plan.filter(human).length >= Math.ceil(n * share), `${mix}: ${plan}`);
    }
  }
  // Only the kinds that are on, and a different rhythm from the last video.
  const plan = M.shotPlan(6, seeded(3), { allowed: ['people', 'closeup', 'wide'] });
  assert.ok(plan.every(k => ['people', 'closeup', 'wide'].includes(k)));
  const last = M.shotPlan(6, seeded(9));
  for (let k = 0; k < 30; k++) assert.notDeepEqual(M.shotPlan(6, seeded(9), { recent: [{ shots: last }] }), last);
});

test('shot plan: every automatic video gets one, it’s in the prompt, and the seeded picks above it don’t change', () => {
  const c0 = cfg();
  const a = M.roll(c0, seeded(7)), b = M.roll(c0, seeded(7));
  assert.deepEqual(a.shots, b.shots);
  assert.equal(a.shots.length, c0.output.scenes);
  const { shots, ...rest } = a;
  const off = M.roll({ ...c0, output: { ...c0.output, shotTypes: ['people'] } }, seeded(7));
  assert.deepEqual(Object.keys(rest).map(k => JSON.stringify(rest[k])), Object.keys(rest).map(k => JSON.stringify(off[k])), 'the shot plan is picked last');
  const user = P.buildPrompt(c0, a).user;
  assert.match(user, /\[FOOTAGE PLAN\]/);
  a.shots.forEach((k, i) => assert.ok(user.includes(`- Scene ${i + 1}: ${M.SHOT_TYPES[k].label}`)));
  assert.match(user, /The other shots show a place, an object or light/);
  assert.doesNotMatch(P.buildPrompt(c0, { ...a, shots: undefined }).user, /FOOTAGE PLAN/, 'older picks are unchanged');
  // Settings: the mix and the kinds of shots, with people shots always on.
  const m = M.migrate({ ...c0, output: { ...c0.output, footageMix: 'loud', shotTypes: ['wide', 'nope'] } });
  assert.equal(m.output.footageMix, 'people');
  assert.deepEqual(m.output.shotTypes, ['people', 'wide']);
});

test('footage searches: written ones follow the shot; ones the agent types can be anything', () => {
  const c0 = { ...cfg(), output: { ...cfg().output, scenes: 2 } };
  const picks = M.roll(c0, seeded(1));
  const kw = (k1, k2) => JSON.stringify({ scenes: [{ text: 'Families plan for this', accent: 'Families', keyword: k1 }, { text: 'Message me to talk', accent: 'talk', keyword: k2 }] });
  const probs = (raw, p) => M.validateScript(raw, c0, p).problems.filter(x => /keyword/.test(x));
  // A place shot needs no person; a people shot does.
  assert.deepEqual(probs(kw('small town street wide shot', 'older couple porch'), { ...picks, shots: ['wide', 'people'] }), []);
  assert.equal(probs(kw('small town street wide shot', 'sunset over the porch'), { ...picks, shots: ['wide', 'people'] }).length, 1);
  // No plan (older videos): every search names a person, as before.
  assert.equal(probs(kw('small town street', 'older couple porch'), { ...picks, shots: undefined }).length, 1);
  // Typed by the agent: no person, longer, even abstract words.
  assert.deepEqual(probs(kw('small town street at sunset in the fall', 'security and peace'), { ...picks, manualFootage: true }), []);
  // The clip check only asks for a person when the shot needs one.
  const V = import('../stages/vision.js');
  return V.then(v => { assert.match(v.clipScale(true), /no person is visible/); assert.doesNotMatch(v.clipScale(false), /no person is visible|scenery with no people/); });
});

test('hidden reasons: short, and counted', () => {
  assert.equal(M.shortReason('Dropped the qualifier of the insight ("usually"). Without it…'), 'dropped “usually”');
  assert.equal(M.shortReason('Scene 4 has the number "50", which isn’t in your confirmed fact.'), 'added a number (50)');
  assert.equal(M.shortReason('The teaching scenes (scenes 2-3) don’t say your confirmed fact closely enough'), 'lost the fact’s key words');
  assert.equal(M.hiddenNote(['added a number (50)', 'implied they’d qualify', 'implied they’d qualify']), '3 hidden: one added a number (50), two implied they’d qualify.');
  assert.equal(M.hiddenNote([]), '');
});

const route = () => { const U = M.usableRoutes(cfg()), p = U.pains[0]; return { painId: p.id, audienceId: U.audiences.find(a => p.links.includes(a.id)).id, fact: U.insights.find(i => i.links.includes(p.id)) }; };
const filledDraft = async () => {
  const r = route();
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  const open = { text: 'Worried your kids will pay for this?', say: 'Worried your kids will pay for this?' };
  return (await c.post(`/api/studio/${d.id}/fill`, { scenes: [open, {}, {}, {}, {}, {}] })).data.draft;
};

test('studio ideas: lines that pass (and why the rest were hidden), footage searches and things to film', async () => {
  const d = await filledDraft();
  assert.ok(d.check.ok, JSON.stringify(d.check.problems));
  const r = await c.post(`/api/studio/${d.id}/ideas`, { i: 1, scenes: d.scenes });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.options.map(o => o.text), [d.scenes[1].text.split(' ').slice(1).join(' ')], 'only the line that keeps the rules');
  assert.equal(r.data.dropped, 2);
  assert.match(r.data.hidden, /^2 hidden: one .+, one .+\./);
  assert.ok(r.data.options[0].accent && r.data.options[0].text.toLowerCase().includes(r.data.options[0].accent.toLowerCase()), 'a highlight from its own line');
  assert.deepEqual(r.data.searches.map(x => x.keyword), ['small town street at sunset', 'coffee cup steam close up'], 'searches with no person are fine; government words are not');
  assert.equal(r.data.scenery.length, 2);
  assert.equal(r.data.beat, 'Insight');
  // Rewrites (the same rules) say why versions were hidden too.
  const rw = await c.post(`/api/studio/${d.id}/rewrite`, { i: 1, scenes: d.scenes });
  assert.ok(rw.data.dropped >= 2 && /hidden: /.test(rw.data.hidden), JSON.stringify(rw.data));
  // A filming note is kept on the scene.
  const saved = (await c.put('/api/studio/' + d.id, { scenes: d.scenes.map((x, i) => (i === 1 ? { ...x, note: r.data.scenery[0] } : x)) })).data.draft;
  assert.equal(saved.scenes[1].note, r.data.scenery[0]);
});

test('studio coach: it sees the board and offers changes that are checked first', async () => {
  const d = await filledDraft();
  const ask = q => c.post('/api/coach', { messages: [{ role: 'user', content: q }], view: 'studio', focus: { studio: { draftId: d.id, scenes: d.scenes } } });
  const r = await ask('3 options for scene 2');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.kind, 'studio');
  const types = r.data.suggestions.map(s => s.type);
  assert.deepEqual(types, ['studio_scene', 'studio_footage', 'studio_scenery'], 'the one that breaks a rule, and a review fix, are dropped');
  const sc = r.data.suggestions[0];
  assert.equal(sc.i, 1); assert.ok(d.scenes[1].text.toLowerCase().includes(sc.accent.toLowerCase()), 'its highlight is in its own line');
  assert.equal(r.data.suggestions[1].keyword, 'small town street at sunset');
  // Truths: a topic teaches one fact, so a new one goes in as a new topic for this worry, unchecked.
  const t = await ask('Find a truth for this worry');
  const add = t.data.suggestions.find(s => s.type === 'add_fact');
  assert.equal(t.data.suggestions.filter(s => s.type === 'use_fact').length, 0, 'no other checked fact for this topic');
  assert.ok(add.painIds.includes(d.brief.painId));
  // Without a Studio draft in focus, it's the usual coach.
  const plain = await c.post('/api/coach', { messages: [{ role: 'user', content: 'hi' }], view: 'create' });
  assert.notEqual(plain.data.kind, 'studio');
});

test('a line on a half-written board: it has to carry its share of the fact, and missing searches aren’t its fault', async () => {
  const c0 = cfg(), r = route();
  const picks = { ...M.studioPicks(c0, { painId: r.painId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' }), recent: [] };
  const cc = { ...c0, output: { ...c0.output, scenes: 6 } };
  const board = [{ text: 'Worried your kids will pay for this?', accent: 'kids', keyword: '' }, ...Array.from({ length: 5 }, () => ({ text: '', accent: '', keyword: '' }))];
  const words = r.fact.text.replace(/[.]$/, '').split(' ');
  const bad = M.lineProblems(board, 1, { text: 'Funeral costs get covered fast', accent: 'Funeral' }, cc, picks);
  assert.ok(bad.some(p => /qualifier|closely enough/.test(p)), JSON.stringify(bad));
  assert.ok(!bad.some(p => /keyword/.test(p)), 'an empty footage search isn’t the line’s fault');
  const good = M.lineProblems(board, 1, { text: words.slice(0, 10).join(' '), accent: M.suggestAccent(words.slice(0, 10).join(' '), cc) }, cc, picks);
  assert.deepEqual(good.filter(p => !/is \d+ words/.test(p)), [], JSON.stringify(good));
  // Ideas on that board: hidden lines say why, never "broke a rule" for a missing search.
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  const ideas = await c.post(`/api/studio/${d.id}/ideas`, { i: 1, scenes: board });
  assert.equal(ideas.status, 200);
  assert.ok(ideas.data.reasons.length && ideas.data.reasons.every(x => x !== 'broke a rule'), JSON.stringify(ideas.data.reasons));
});

test('studio coach on a new board, and openings held to the Studio rules; every change names its draft', async () => {
  const r = route();
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  assert.equal(d.scenes.length, 0);
  const ask = q => c.post('/api/coach', { messages: [{ role: 'user', content: q }], view: 'studio', focus: { studio: { draftId: d.id, scenes: [] } } });
  const a = await ask('Footage ideas for every scene');
  assert.ok(a.data.suggestions.some(s => s.type === 'studio_footage'), 'an empty board still gets suggestions');
  assert.ok(a.data.suggestions.filter(s => s.type.startsWith('studio_')).every(s => s.draftId === d.id && s.sceneCount === 6), JSON.stringify(a.data.suggestions));
  const h = await ask('Write me an opening');
  assert.deepEqual(h.data.suggestions.map(s => s.text), ['Who pays for your funeral someday?'], 'an age the fact doesn’t have is held back');
  // Another workspace's draft id is never found.
  const other = store.createWorkspace({ name: 'Other' });
  const od = (await import('../lib/studio.js')).create(other.id, cfg(), {});
  const x = await c.post('/api/coach', { messages: [{ role: 'user', content: 'hi' }], view: 'studio', focus: { studio: { draftId: od.id, scenes: [] } } });
  assert.notEqual(x.data.kind, 'studio');
});

// v14 Phase 3: the Mindset tab. Each book is a working tool (habits, a daily principle, relationship
// notes, the persuasion lens, an 80/20 audit, a mastery path, the hedgehog, a strategy board, closer
// check, worthy rival, weekly reflection), and the parts that matter shape what Create makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const MC = await import('../mindset-core.js');
const P = await import('../lib/prompts.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Mindset Test', comped: true });
const base = store.loadConfig(ws.id);
base.story = { ...base.story, ...starterStory(['final_expense', 'mortgage']) };
base.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
store.saveConfig(ws.id, base);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'mind@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('mindpass1234') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'mind@example.com', password: 'mindpass1234' });
const cfg = () => store.loadConfig(ws.id);
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('the library: a principle a day without repeating a book ten days running; streaks and never miss twice', () => {
  const days = Array.from({ length: 10 }, (_, k) => new Date(Date.UTC(2026, 9, 1 + k)).toISOString().slice(0, 10));
  const books = days.map(d => MC.principleFor(d).book);
  assert.equal(new Set(books).size, 10);
  assert.notEqual(MC.principleFor(days[0], 1).id, MC.principleFor(days[0]).id, 'Next principle moves on');
  assert.equal(MC.streak(['2026-10-13', '2026-10-14', '2026-10-15'], '2026-10-15'), 3);
  assert.equal(MC.streak(['2026-10-13', '2026-10-14'], '2026-10-15'), 2, 'today not done yet still counts yesterday’s streak');
  assert.equal(MC.missedOnce(['2026-10-13'], '2026-10-15'), true);
  assert.equal(MC.missedOnce(['2026-10-14'], '2026-10-15'), false);
  assert.equal(MC.weekOf('2026-10-16'), '2026-10-12');
  const vids = [{ posted: { at: '2026-10-13T15:00:00Z' } }, { posted: { at: '2026-10-14T15:00:00Z' } }, { posted: { at: '2026-10-05T15:00:00Z' } }];
  assert.deepEqual(MC.autoProgress({ auto: 'post', target: 3 }, vids, '2026-10-16', 'UTC'), { n: 2, target: 3, done: false });
  assert.equal(MC.skillLevel(12, 1), 3);
  const score = MC.growthScore({ habits: [{ id: 'a' }], checks: { a: days }, skills: {}, practice: [], reflections: [] }, [], { today: days[9] });
  assert.ok(score > 0 && score <= 100);
});

test('the profile shapes videos: sweet spot, objections as topics, give before asking, the why', () => {
  const c0 = M.migrate(cfg());
  const mp = c0.story.audiences.find(a => a.product === 'mortgage') || c0.story.audiences.at(-1);
  const count = cf => Array.from({ length: 300 }, (_, k) => M.roll(cf, seeded(k + 1)).audience?.id).filter(id => id === mp.id).length;
  const before = count(c0);
  const sweet = M.migrate({ ...c0, mindset: { ...c0.mindset, hedgehog: { audiences: [mp.id, 'nope'], products: ['mortgage', 'cars'] } } });
  assert.deepEqual([sweet.mindset.hedgehog.audiences, sweet.mindset.hedgehog.products], [[mp.id], ['mortgage']]);
  assert.ok(count(sweet) > before, `sweet spot comes up more (${count(sweet)} > ${before})`);
  // An objection marked as a topic opens "Question I get asked" videos.
  const pain = c0.story.painPoints[0];
  const ob = M.migrate({ ...c0, output: { ...c0.output, formats: ['asked'] }, mindset: { ...c0.mindset, objections: [{ text: 'I need to think about it.', answer: 'zqxanswer', links: [pain.id], topic: true }, { text: 'Not a topic', topic: false }] } });
  const p = M.roll(ob, seeded(3), [], { painId: pain.id, format: 'asked' });
  assert.equal(p.askQuestion?.text, 'I need to think about it.');
  assert.doesNotMatch(P.buildPrompt(ob, p).user, /zqxanswer/, 'the agent’s answer never goes into a video');
  // Three of the last five endings asked: lean toward giving.
  const asking = Array.from({ length: 5 }, () => ({ ctaStyle: 'specific' }));
  const gives = n => Array.from({ length: 200 }, (_, k) => M.roll(c0, seeded(k + 1), n ? asking : []).ctaStyle).filter(x => ['tie', 'gentle'].includes(x)).length;
  assert.ok(gives(true) > gives(false));
  const off = M.migrate({ ...c0, mindset: { ...c0.mindset, giveAsk: 'off' } });
  const tally = (cf, recent) => Array.from({ length: 200 }, (_, k) => M.roll(cf, seeded(k + 1), recent).ctaStyle).filter(x => ['tie', 'gentle'].includes(x)).length;
  assert.ok(tally(off, asking) < tally(c0, asking), 'turning it off removes the lean');
  // The why: a section in the script prompt and one opening angle; nothing when it's empty.
  const wy = M.migrate({ ...c0, mindset: { ...c0.mindset, why: { why: 'No family should be left wondering.', how: 'Plain talk.' } } });
  const pk = M.roll(wy, seeded(5));
  assert.match(P.buildPrompt(wy, pk).user, /'S WHY\]\nWhy .* does this work: "No family should be left wondering\."/);
  assert.match(P.buildHookPrompt(wy, pk).user, /open from why/);
  assert.doesNotMatch(P.buildPrompt(c0, M.roll(c0, seeded(5))).user, /'S WHY/);
});

test('the tab: habits, the principle, practice, audit, reflection, lens and relationship notes', async () => {
  let v = (await c.get('/api/mindset')).data;
  assert.ok(v.principle.text && v.principle.book.title);
  assert.equal(v.mindset.habits.length, 5);
  const daily = v.mindset.habits.find(h => !h.auto);
  v = (await c.post('/api/mindset/check', { habitId: daily.id })).data;
  assert.equal(v.streaks[daily.id].today, true); assert.equal(v.streaks[daily.id].streak, 1);
  v = (await c.post('/api/mindset/check', { habitId: daily.id })).data;
  assert.equal(v.streaks[daily.id].today, false, 'a second tap un-ticks it');
  assert.equal((await c.post('/api/mindset/check', { habitId: 'nope' })).status, 404);
  v = (await c.post('/api/mindset/principle', { act: 'done' })).data;
  assert.equal(v.principle.done, true);
  const first = v.principle.id;
  v = (await c.post('/api/mindset/principle', { act: 'next' })).data;
  assert.notEqual(v.principle.id, first);
  v = (await c.post('/api/mindset/practice', { skill: 'objections', what: 'Practiced “let me think about it”' })).data;
  assert.equal(v.mindset.practice.length, 1);
  assert.equal((await c.post('/api/mindset/practice', { skill: 'juggling', what: 'x' })).status, 400);
  v = (await c.post('/api/mindset/audit', { rows: [{ activity: 'Referral calls', hours: 4, appts: 3, deals: 2 }, { activity: 'Door knocking', hours: 10, appts: 1, deals: 0 }, { activity: '', hours: 1 }] })).data;
  assert.equal(v.mindset.audit[0].rows.length, 2);
  assert.match((await c.post('/api/mindset/audit/advice')).data.advice.keep, /Referral/);
  v = (await c.post('/api/mindset/reflection', { win: 'Two appointments from one video.', change: 'Call first thing.' })).data;
  assert.equal(v.mindset.reflections.length, 1);
  assert.equal((await c.post('/api/mindset/reflection', {})).status, 400);
  // Sections and the profile (which lives in the config).
  v = (await c.put('/api/mindset', { identity: 'never leaves a family hanging', strategy: { strengths: ['Patient'], weaknesses: [], competitors: [], shifts: [] }, profile: { why: { why: 'Families deserve plain answers.', how: '', what: '', show: 'on' }, objections: [{ text: 'It costs too much.', answer: 'Mine.', topic: true }] } })).data;
  assert.equal(v.mindset.identity, 'never leaves a family hanging');
  assert.equal(cfg().mindset.why.why, 'Families deserve plain answers.');
  assert.equal(cfg().mindset.objections[0].topic, true);
  // The persuasion lens: honest principles only, and pressure called out.
  const lens = (await c.post('/api/mindset/lens', { text: 'Here is one thing worth knowing about final expense.' })).data;
  assert.deepEqual(lens.principles.map(p => p.id), ['reciprocity', 'authority']); assert.equal(lens.honest, true);
  const pushy = (await c.post('/api/mindset/lens', { text: 'Only 2 spots left this week!' })).data;
  assert.equal(pushy.honest, false); assert.deepEqual(pushy.pressure, ['scarcity'], 'a flag quoting words the draft doesn’t have is dropped (v15)');
  assert.deepEqual(pushy.flags, [{ kind: 'scarcity', words: 'Only 2 spots left' }]);
  assert.doesNotMatch(pushy.advice, /success story|client/i, 'advice never suggests a testimonial');
  assert.equal(pushy.rewrite.principle, 'reciprocity');
  const gentle = (await c.post('/api/mindset/lens', { text: 'You don’t need to worry about being a burden. Policies can often fit tight budgets.' })).data;
  assert.equal(gentle.honest, true, 'naming a worry isn’t pressure'); assert.deepEqual(gentle.flags, [{ kind: 'fear', words: 'being a burden' }]);
  assert.ok(gentle.strengths.some(x => /qualifier “often”/.test(x)), 'credit for the qualifier kept');
  // Relationship notes: a client, who's due, and the one thing to ask about.
  const cl = (await c.post('/api/clients', { name: 'Rosa Begay', family: 'Granddaughter Mia graduates in May', next: '2020-01-01', ssn: 'never stored' })).data.client;
  assert.equal(cl.ssn, undefined);
  v = (await c.get('/api/mindset')).data;
  assert.deepEqual(v.due.map(d => [d.name, d.ask]), [['Rosa Begay', 'Ask about granddaughter Mia graduates in May.']]);
  assert.equal((await c.put('/api/clients/' + cl.id, { name: '' })).status, 400);
  assert.equal((await c.put('/api/clients/' + cl.id, { interests: 'Gardening' })).data.client.interests, 'Gardening');
  const exp = (await import('../lib/data.js')).exportWorkspace(ws.id);
  assert.equal(exp.clients[0].name, 'Rosa Begay'); assert.ok(exp.mindset.habits);
  assert.equal((await c.del('/api/clients/' + cl.id)).status, 200);
});

test('review fixes: a config save never wipes Mindset, explicit habit ticks, reached out, odd input, early warnings', async () => {
  await c.put('/api/mindset', { profile: { why: { why: 'Families deserve plain answers.', how: '', what: '', show: 'off' } } });
  const stale = cfg(); stale.mindset = { ...stale.mindset, why: { why: '', how: '', what: '', show: 'off' } };
  const saved = (await c.put('/api/config', { config: stale })).data.config;
  assert.equal(saved.mindset.why.why, 'Families deserve plain answers.', 'a stale portal can’t erase it');
  const v0 = (await c.get('/api/mindset')).data, h = v0.mindset.habits.find(x => !x.auto);
  await c.post('/api/mindset/check', { habitId: h.id, done: true });
  const v1 = (await c.post('/api/mindset/check', { habitId: h.id, done: true })).data;
  assert.equal(v1.streaks[h.id].today, true, 'ticking twice keeps it ticked');
  const cl = (await c.post('/api/clients', { name: 'Ed', next: '2020-02-02' })).data.client;
  const r = (await c.post(`/api/clients/${cl.id}/reached`)).data.client;
  assert.equal(r.next, ''); assert.match(r.last, /^\d{4}-\d{2}-\d{2}$/);
  // Inherited names aren't kinds of habits or skills.
  const v2 = (await c.put('/api/mindset', { habits: [{ text: 'x', auto: 'toString' }] })).data;
  assert.equal(v2.mindset.habits[0].auto, undefined);
  assert.equal((await c.post('/api/mindset/practice', { skill: 'constructor', what: 'x' })).status, 400);
  // A why with a price is pointed out straight away.
  const w = (await c.put('/api/mindset', { profile: { why: { why: 'Plans from $9 a month for everyone.', how: '', what: '', show: 'off' } } })).data;
  assert.ok(w.warnings.length && /price/.test(w.warnings[0]));
  // Objections that aren't topics stay out of openings.
  const c0 = M.migrate({ ...cfg(), mindset: { ...cfg().mindset, objections: [{ text: 'zqx not a topic', topic: false }] } });
  assert.doesNotMatch(P.buildHookPrompt(c0, M.roll(c0, seeded(2))).user, /zqx/);
});

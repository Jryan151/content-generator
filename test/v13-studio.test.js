// v13 Phase 4: Studio. Drafts built by hand from a brief (only confirmed facts), openings, "write the
// rest", rewrites, footage, a voice preview and render, with the same checks as every video plus two
// for hand-written scripts (the teaching scenes must say the fact; no numbers the fact doesn't have).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client, testFont, hasFfmpeg } from './helpers.js';

tempEnv();
const font = testFont();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const queue = await import('../lib/queue.js');
const studio = await import('../lib/studio.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Studio Test', comped: true });
const cfg0 = store.loadConfig(ws.id);
cfg0.story = { ...cfg0.story, ...starterStory(['final_expense']) };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
cfg0.look = { ...cfg0.look, name: 'Jane Smith', location: 'Gallup, NM', ...(font ? { font } : {}) };
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'studio@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('studiopass123') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'studio@example.com', password: 'studiopass123' });
const cfg = () => store.loadConfig(ws.id);
const U = () => M.usableRoutes(cfg());
const routeWithFact = () => { const p = U().pains[0]; return { painId: p.id, audienceId: U().audiences.find(a => p.links.includes(a.id)).id, fact: U().insights.find(i => i.links.includes(p.id)) }; };

test('studio picks: only confirmed facts linked to the worry, and the format’s needs', () => {
  const c0 = cfg();
  assert.match(M.studioPicks(c0, {}).problems[0], /Pick a worry/);
  const r = routeWithFact();
  const p = M.studioPicks(c0, { painId: r.painId, insightIds: [r.fact.id] });
  assert.deepEqual(p.problems, []); assert.equal(p.insight.id, r.fact.id);
  assert.equal(M.studioPicks(c0, { painId: r.painId }).insight.id, r.fact.id, 'no fact picked yet: the first one');
  // A fact the draft was built on that's gone is never swapped for another one.
  const gone = M.studioPicks(c0, { painId: r.painId, insightIds: ['nope', r.fact.id] });
  assert.match(gone.problems.join(' '), /no longer confirmed/);
  const unconfirmed = { ...c0, story: { ...c0.story, insights: c0.story.insights.map(i => ({ ...i, confirmed: false })) } };
  assert.ok(M.studioPicks(unconfirmed, { painId: r.painId }).problems.length, 'nothing confirmed, nothing to teach');
  const one = U().pains.find(x => U().insights.filter(i => i.links.includes(x.id)).length === 1);
  if (one) assert.match(M.studioPicks(c0, { painId: one.id, format: 'list' }).problems.join(' '), /needs 2 confirmed facts/);
  const ser = M.studioPicks(c0, { painId: r.painId, seriesId: 'fe101', part: 2 });
  assert.deepEqual([ser.series.label, ser.series.part, ser.series.of], ['Final Expense 101', 3, 5]);
  assert.equal(M.studioPicks(c0, { painId: r.painId, structure: 'objection', scenes: 6 }).structure, 'classic', 'too few scenes for it');
});

test('studio checks: the teaching scenes must say the fact, and no new numbers', () => {
  const c0 = cfg(), r = routeWithFact();
  const picks = M.studioPicks(c0, { painId: r.painId, insightIds: [r.fact.id], scenes: 6, structure: 'classic', format: 'question' });
  const factWords = r.fact.text.replace(/[.]$/, '').split(' ');
  const half = Math.ceil(factWords.length / 2);
  const scene = (t, kw = 'older woman kitchen') => ({ text: t.split(' ').slice(0, 10).join(' '), accent: t.split(' ').find(w => w.length > 5)?.replace(/[^\w’']/g, '') || '', keyword: kw });
  const good = ['Ever wonder about the bills later?', factWords.slice(0, half).join(' '), factWords.slice(half).join(' '), 'Ask me about a simple plan for this', 'What fits you depends on your family.', 'Message me and we can talk it through'].map(t => scene(t));
  const bad = [good[0], scene('Life can surprise every family out there'), scene('Planning ahead brings families together'), good[3], good[4], good[5]];
  // (v15: in a person's draft, the fact match is a note by default, never a block; Admin → Render rules can make it one.)
  const fact = r => r.soft.some(p => /don’t say your confirmed fact/.test(p));
  assert.equal(fact(M.studioChecks(bad, c0, picks)), true);
  assert.ok(!M.studioChecks(bad, c0, picks).problems.some(p => /don’t say your confirmed fact/.test(p)), 'a note, not a stop');
  assert.equal(M.studioChecks(bad, c0, picks).findings.find(f => f.rule === 'factMatch').kind, 'warn');
  assert.equal(fact(M.studioChecks(bad, { ...c0, rules: { levels: { factMatch: { draft: 'block' } } } }, picks)), false, 'set to block, it stops it instead');
  assert.ok(M.studioChecks(bad, { ...c0, rules: { levels: { factMatch: { draft: 'block' } } } }, picks).problems.some(p => /don’t say your confirmed fact/.test(p)));
  assert.equal(fact(M.studioChecks(good, c0, picks)), false, JSON.stringify(M.studioChecks(good, c0, picks).problems));
  const nums = good.map((x, i) => (i === 3 ? scene('Ask me about plans from age 50') : x));
  assert.ok(M.studioChecks(nums, c0, picks).problems.some(p => /number "50"/.test(p)));
  // Spelled-out numbers and prices count too; a list's own count is fine.
  const words = good.map((x, i) => (i === 3 ? scene('Plans can start around thirty a month') : x));
  const w = M.studioChecks(words, c0, picks).problems.join(' ');
  assert.match(w, /number "thirty"/); assert.match(w, /talks about price \("thirty a month"\)/);
  // Captions mode: a stale spoken line can't pass or fail anything.
  const stale = good.map((x, i) => (i === 3 ? { ...x, say: 'It costs 9 dollars' } : x));
  assert.equal(c0.output.mode === 'voiceover', false);
  assert.ok(!M.studioChecks(stale, c0, picks).problems.some(p => /Scene 4/.test(p)));
  assert.ok(M.studioChecks(stale, { ...c0, output: { ...c0.output, mode: 'voiceover' } }, picks).problems.some(p => /Scene 4 has the number "9"/.test(p)));
  assert.equal(M.suggestAccent('Worried your kids will pay for this?', c0), 'Worried', 'a strong word, not filler');
  assert.equal(M.suggestAccent('It is so', c0), '');
});

test('studio drafts: create, save the brief and cards, list, delete; at most 20', async () => {
  const r = routeWithFact();
  const made = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, scenes: 6 } })).data.draft;
  assert.ok(made.id && made.brief.bridgeStyle && made.brief.ctaStyle, 'ending styles picked once');
  assert.equal(made.picks.painPoint.id, r.painId);
  const saved = (await c.put('/api/studio/' + made.id, { brief: { format: 'myth' }, scenes: [{ text: 'Hi <b>there</b>', keyword: 'older woman', clip: { id: 'px12', thumb: 'javascript:alert(1)' } }, { text: 'x', clip: { id: '../../etc' } }] })).data.draft;
  assert.equal(saved.brief.format, 'myth');
  assert.equal(saved.scenes[0].clip.id, 'px12'); assert.equal(saved.scenes[0].clip.thumb, '', 'unsafe thumbnails dropped');
  assert.equal(saved.scenes[1].clip, undefined, 'bad clip ids dropped');
  assert.ok((await c.get('/api/studio')).data.drafts.some(d => d.id === made.id));
  const { exportWorkspace } = await import('../lib/data.js');
  assert.ok(exportWorkspace(ws.id).studioDrafts.some(d => d.id === made.id), 'in the data download');
  assert.equal((await c.del('/api/studio/' + made.id)).status, 200);
  assert.equal((await c.get('/api/studio/' + made.id)).status, 404);
  const other = store.createWorkspace({ name: 'Full' });
  for (let k = 0; k < studio.MAX_DRAFTS; k++) studio.create(other.id, cfg(), {});
  assert.throws(() => studio.create(other.id, cfg(), {}), /20 Studio drafts/);
});

test('studio helpers: openings, write the rest (keeping your opening), rewrites, footage, voice', async () => {
  const r = routeWithFact();
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  const h = await c.post(`/api/studio/${d.id}/hooks`);
  assert.equal(h.status, 200, JSON.stringify(h.data));
  assert.ok(h.data.draft.hooks.length >= 1 && h.data.draft.hooks.every(x => !/guaranteed/i.test(x.text)), 'only openings that pass the rules');
  const mine = 'Worried your kids will pay for this?';
  const f = await c.post(`/api/studio/${d.id}/fill`, { scenes: [{ text: mine, say: mine }, {}, {}, {}, {}, {}] });
  assert.equal(f.status, 200, JSON.stringify(f.data).slice(0, 400));
  const sc = f.data.draft.scenes;
  assert.equal(sc.length, 6); assert.equal(sc[0].text, mine, 'your opening is kept');
  assert.ok(sc.every(x => x.text && x.keyword));
  assert.ok(f.data.draft.check, 'checks come back with the draft');
  // Rewrites: the stand-in offers one that breaks the rules ("Everyone qualifies, guaranteed!"); it's dropped.
  const rw = await c.post(`/api/studio/${d.id}/rewrite`, { i: 1 });
  assert.equal(rw.status, 200, JSON.stringify(rw.data));
  assert.ok(rw.data.options.every(o => !/guaranteed/i.test(o.text)) && rw.data.dropped >= 1);
  const ft = await c.post(`/api/studio/${d.id}/footage`, { keyword: 'older woman kitchen', caption: 'x' });
  assert.equal(ft.status, 200); assert.ok(ft.data.results.length >= 1 && ft.data.results.length <= 6); assert.ok(Array.isArray(ft.data.own));
  const v = await c.post(`/api/studio/${d.id}/voice`, { text: 'Hello there' });
  assert.equal(v.status, 200); assert.match(v.headers.get('content-type'), /audio\/mpeg/);
});

test('studio render: refused until it passes, then queued as a studio video; a canceled render goes back to draft', async () => {
  const r = routeWithFact();
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  // A board with a price can't render (a locked rule), and the refusal carries the one-tap fix. (v15: a board
  // that only misses the fact's wording renders with a note instead.)
  const off = ['Thinking about later?', 'Life can surprise every family', 'Plans can cost $30 a month', 'Ask me about a simple plan', 'What fits depends on your family.', 'Message me and we can talk'].map(t => ({ text: t, accent: t.split(' ').find(w => w.length > 5)?.replace(/[^\w]/g, '') || '', keyword: 'older woman kitchen' }));
  await c.put('/api/studio/' + d.id, { scenes: off });
  const no = await c.post(`/api/studio/${d.id}/render`);
  assert.equal(no.status, 400); assert.ok(no.data.problems.some(p => /price or percentage/.test(p)));
  const priceFix = no.data.findings.find(f => f.rule === 'price' && f.kind === 'stop');
  assert.deepEqual(priceFix.fix, { label: 'Rewrite this line for me', rewrite: 2 }, 'taking the price out would leave “Plans can cost”, so it’s rewritten (v15)');
  assert.ok(no.data.findings.some(f => f.rule === 'factMatch' && f.kind === 'warn'), 'the missing fact wording is a note');
  // Filled by the writer (after the agent's own opening; the stand-in's openings carry numbers) it passes, and renders as a studio job.
  const open = { text: 'Worried your kids will pay for this?', say: 'Worried your kids will pay for this?' };
  const filled = (await c.post(`/api/studio/${d.id}/fill`, { scenes: [open, {}, {}, {}, {}, {}] })).data.draft;
  assert.ok(filled.check.ok, JSON.stringify(filled.check.problems));
  const yes = await c.post(`/api/studio/${d.id}/render`);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(yes.data.draft.status, 'rendering');
  const job = queue.listJobs(ws.id).find(j => j.kind === 'studio');
  assert.equal(job.opts.draftId, d.id);
  assert.equal((await c.put('/api/studio/' + d.id, { scenes: filled.scenes })).status, 409, 'locked while rendering');
  assert.equal((await c.del('/api/jobs/' + job.id)).status, 200);
  const back = (await c.get('/api/studio/' + d.id)).data.draft;
  assert.equal(back.status, 'draft'); assert.match(back.error, /canceled/);
});

const skip = !process.env.FULL_TEST ? 'renders a video; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : !font ? 'No Poppins font' : false;
test('studio render, end to end: the script and the chosen clip are used as built', { skip, timeout: 600000 }, async () => {
  const r = routeWithFact();
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic', seriesId: 'fe101', part: 0 } })).data.draft;
  const open = { text: 'Worried your kids will pay for this?', say: 'Worried your kids will pay for this?' };
  const filled = (await c.post(`/api/studio/${d.id}/fill`, { scenes: [open, {}, {}, {}, {}, {}] })).data.draft;
  const scenes = filled.scenes.map((x, i) => (i === 2 ? { ...x, clip: { id: 4242, query: 'picked' } } : x));
  await c.put('/api/studio/' + d.id, { scenes });
  const { makeVideo } = await import('../pipeline.js');
  const v = await makeVideo({ ws: ws.id, studio: studio.get(ws.id, d.id), source: 'studio', log: () => {} });
  assert.equal(v.meta.madeIn, 'studio');
  assert.deepEqual(v.scenes.map(x => x.text), scenes.map(x => x.text), 'the script as built');
  assert.equal(v.clips[2].id, 4242); assert.equal(v.clips[2].query, 'chosen in Studio');
  assert.equal(v.meta.series.label, 'Final Expense 101');
  assert.ok(!v.post || v.post.startsWith('Final Expense 101 · Part 1 of 5'));
  assert.equal(v.status, 'pending', 'into Review like any video');
});

test('studio footage: a chosen clip is kept for its own scene, never taken by an earlier one', async () => {
  const { findClips } = await import('../stages/broll.js');
  const kw = { text: 'x', keyword: 'grandmother kitchen' };
  const [first] = await findClips([kw], { log: () => {} });
  const out = await findClips([kw, kw], { chosen: { 1: first.id }, log: () => {} });
  assert.notEqual(out[0].id, first.id, 'scene 1 searched around it');
  assert.equal(out[1].id, first.id);
  assert.equal(out[1].chosen, true); assert.equal(out[1].checked, false, 'not claimed as AI-checked');
});

test('studio safety: setup first, series set the format, and a retried render stays locked and renders what was checked', async () => {
  const r = routeWithFact();
  // A series part sets its format.
  assert.equal(M.studioPicks(cfg(), { painId: r.painId, seriesId: 'fe101', part: 1, format: 'question' }).format, 'myth');
  // Setup not finished: no helpers, no render.
  const raw = store.createWorkspace({ name: 'Not set up', comped: true });
  const c1 = store.loadConfig(raw.id); c1.story = cfg().story; store.saveConfig(raw.id, c1);
  store.createAccount({ email: 'raw@example.com', role: 'agent', workspaceId: raw.id, hash: await auth.hashPassword('rawpass12345') });
  const c2 = client(server.address().port);
  await c2.post('/api/login', { email: 'raw@example.com', password: 'rawpass12345' });
  const d0 = (await c2.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id] } })).data.draft;
  assert.equal((await c2.post(`/api/studio/${d0.id}/fill`, { scenes: [] })).status, 409);
  assert.equal((await c2.post(`/api/studio/${d0.id}/render`)).status, 409);

  // A queued render takes a copy of what was checked; fill is locked meanwhile.
  const d = (await c.post('/api/studio', { brief: { painId: r.painId, audienceId: r.audienceId, insightIds: [r.fact.id], scenes: 6, format: 'question', structure: 'classic' } })).data.draft;
  const open = { text: 'Who pays for the funeral someday?', say: 'Who pays for the funeral someday?' };  // not the end-to-end test's opening (that one's now a recent video)
  const f = await c.post(`/api/studio/${d.id}/fill`, { scenes: [open, {}, {}, {}, {}, {}] });
  assert.equal(f.status, 200, JSON.stringify(f.data));
  const filled = f.data.draft;
  const yes = await c.post(`/api/studio/${d.id}/render`);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  const job = queue.listJobs(ws.id).find(j => j.kind === 'studio' && j.opts.draftId === d.id);
  assert.deepEqual(job.opts.scenes.map(x => x.text), filled.scenes.map(x => x.text));
  assert.equal((await c.post(`/api/studio/${d.id}/fill`, { scenes: [] })).status, 409, 'fill is locked while rendering');
  // A first failure that will be retried (footage search down) keeps the draft locked; the last one frees it.
  const pix = process.env.PIXABAY_BASE_URL;
  process.env.PIXABAY_BASE_URL = 'http://127.0.0.1:9/pixabay/';
  studio.save(ws.id, d.id, { scenes: [] });   // edited behind its back: the job still has its copy
  try {
    await assert.rejects(S.runJob({ ...job, attempts: 1 }, () => {}), e => !e.permanent);
    assert.equal(studio.get(ws.id, d.id).status, 'rendering', 'a retry is coming, so still locked');
    // The footage site being down is an outage: the job waits it out (v14), so the draft stays locked…
    await assert.rejects(S.runJob({ ...job, attempts: 2 }, () => {}));
    assert.equal(studio.get(ws.id, d.id).status, 'rendering', 'an outage waits instead of failing');
    // …until the waits run out: then the last try frees it.
    await assert.rejects(S.runJob({ ...job, attempts: 2, waits: queue.MAX_OUTAGE_WAITS }, () => {}));
    assert.equal(studio.get(ws.id, d.id).status, 'draft', 'the last try frees it');
  } finally { process.env.PIXABAY_BASE_URL = pix; }
  await c.del('/api/jobs/' + job.id);
});

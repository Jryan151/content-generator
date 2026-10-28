// v15 Phase 7 review fixes: the locked number and price rules in every video (automatic, Fix a scene,
// Studio), approvals that name the version watched, the clip picker's scores kept on the server, spelling
// that's fast and doesn't flag good copy, a new version not "too close" to the one it replaces, render
// the coach's Use all checked as a whole, a limit on versions,
// changes requests that close themselves, and the lens's quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const queue = await import('../lib/queue.js');
const studio = await import('../lib/studio.js');
const spell = await import('../lib/spell.js');
const lens = await import('../lib/lens.js');
const paths = await import('../lib/paths.js');
const { checkSuggestions } = await import('../lib/coach.js');
const { MAX_VERSIONS } = await import('../routes/studio.js');
const M = await import('../mixer-core.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

const mk = name => {
  const ws = store.createWorkspace({ name, comped: true });
  const c = store.loadConfig(ws.id);
  c.story = { ...c.story, ...starterStory() };
  c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  store.saveConfig(ws.id, c);
  store.updateWorkspace(ws.id, { onboarded: true, limits: { assistantSeats: 1 } });
  return ws;
};
const ws = mk('Fixes A'), wsB = mk('Fixes B');
store.createAccount({ email: 'fa@example.com', name: 'Fay Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('fapass123456') });
const sam = store.createAccount({ email: 'fs@example.com', name: 'Sam Helper', role: 'agent', workspaceId: null, hash: await auth.hashPassword('fspass123456') });
store.setMembership(sam.id, ws.id, { role: 'assistant' });
store.createAccount({ email: 'froot@example.com', role: 'admin', hash: await auth.hashPassword('frootpass1234') });
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const agent = await login('fa@example.com', 'fapass123456');
const asst = await login('fs@example.com', 'fspass123456');
const admin = await login('froot@example.com', 'frootpass1234');
const cfg = () => store.loadConfig(ws.id);
const FACT = cfg().story.insights[0];
const brief = { painId: 't_funeral', audienceId: 'aud', insightIds: [FACT.id], scenes: 6, format: 'question', structure: 'classic' };
const picks = () => M.studioPicks(cfg(), brief);
const sc = (text, accent = '') => ({ text, accent, keyword: 'older woman kitchen', say: '' });
const good = () => [sc('Who pays for your funeral someday?', 'funeral'), sc('Final expense insurance is usually a small policy', 'small'), sc('It is meant to cover funeral and end-of-life costs', 'funeral'),
  sc('Ask me about a simple plan for this', 'simple'), sc('What fits you depends on your family.', 'family'), sc(`${cfg().story.ctaAction || 'Message me'} and we can talk it through`, 'talk')];
const video = (id, extra = {}) => {
  store.addVideo(ws.id, { id, file: `video_${id}.mp4`, cover: '', status: 'pending', createdAt: new Date().toISOString(), mode: 'captions', meta: { painPoint: 'Funeral costs', visual: 'older adults' }, scenes: good(), clips: good().map((_, i) => ({ id: 3000 + i, checked: true, score: 3 })), post: 'Post', preflight: [{ ok: true, label: 'Checked' }], version: 1, ...extra });
  fs.mkdirSync(path.join(paths.DIRS.assets, ws.id, id), { recursive: true });
  fs.writeFileSync(path.join(paths.DIRS.assets, ws.id, id, 'picks.json'), JSON.stringify({ insights: [FACT], format: 'question', structure: 'classic' }));
  fs.writeFileSync(store.videoPath(ws.id, `video_${id}.mp4`), 'x');
};

test('numbers and price words are locked in every video: automatic, Fix a scene and Studio', async () => {
  const c6 = { ...cfg(), output: { ...cfg().output, scenes: 6 } };
  const stops = (line, ctx) => { const s = good(); s[3] = sc(line); const p = { ...picks(), recent: [] }; const r = ctx === 'studio' ? M.studioChecks(s, cfg(), p) : M.validateScript({ scenes: s }, c6, ctx === 'draft' ? { ...p, person: true, manualFootage: true } : p); return r.findings.filter(f => f.scene === 3 && f.kind === 'stop').map(f => f.rule); };
  for (const [line, rule] of [['Plans can start at a few dollars a month', 'price'], ['Coverage for a couple bucks a week', 'price'], ['Coverage after 65 is simple', 'numbers'], ['Most people over sixty can get a plan', 'numbers'], ['Small monthly payments can fit', 'price']])
    for (const ctx of ['auto', 'draft', 'studio']) assert.ok(stops(line, ctx).includes(rule), `${line} (${ctx})`);
  for (const line of ['Review your plan once a year', 'Review your coverage just once a year', 'It only takes a day to set up', 'Hear from me once a week', 'Starting a plan takes about a day', 'You pay your mortgage each month', 'The two of you can plan this'])
    for (const ctx of ['auto', 'draft', 'studio']) assert.ok(!stops(line, ctx).some(r => ['price', 'numbers'].includes(r)), `not a price or a number: ${line} (${ctx})`);
  for (const ctx of ['auto', 'studio']) { assert.ok(stops('It costs less each month than you think', ctx).includes('price')); assert.ok(stops('Half of families wait too long', ctx).includes('numbers')); }
  // Affordability claims with no amount are price claims too; plain "easier than you think" isn't.
  for (const line of ['It costs less than you think', 'It is cheaper than you think', 'Plans cost just pennies', 'Small payments each month', 'Only pocket change each month', 'Costs about the same as lunch'])
    for (const ctx of ['auto', 'draft', 'studio']) assert.ok(stops(line, ctx).includes('price'), `${line} (${ctx})`);
  for (const line of ['Planning is easier than you think', 'Life is shorter than you think', 'Change can be hard']) assert.ok(!stops(line, 'auto').includes('price'), line);
  assert.equal(stops('Plans can start at a few dollars a month', 'studio').filter(r => r === 'price').length, 1, 'said once');
  // The agent's own numbers are fine: their story's, their call to action's.
  const own = { ...picks(), recent: [], story: { text: 'My mom passed at 62 with no plan.' } };
  const s = good(); s[3] = sc('My mom was 62 and had no plan');
  assert.ok(!M.validateScript({ scenes: s }, c6, own).findings.some(f => f.rule === 'numbers'));
  // Through Fix a scene: refused, with the way out.
  video('nf1');
  const r = await agent.post('/api/videos/nf1/fix', { edits: [{ i: 3, text: 'Plans can start at a few dollars a month' }] });
  assert.equal(r.status, 400); assert.ok(r.data.findings.some(f => f.rule === 'price' && f.fix?.rewrite === 3));
});

test('one-tap fixes never leave a line garbled: a cut phrase, or "see if you qualify" mid-sentence, is rewritten instead', () => {
  const fixOf = (line, rule) => { const s = good(); s[3] = sc(line); return M.studioChecks(s, cfg(), picks()).findings.find(f => f.rule === rule && f.scene === 3)?.fix; };
  assert.equal(fixOf('Plans run 5% of what you think', 'price').rewrite, 3);
  assert.equal(fixOf('With this you will qualify easily', 'qualify').rewrite, 3);
  assert.equal(fixOf('You will qualify for this', 'qualify').edits[0].value, 'See if you qualify for this');
});

test('approving names the version watched: a newer one, or one being made, is watched first', async () => {
  video('ap1', { source: 'studio', meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId: 'sd_x' } });
  const checklist = (await agent.get('/api/me')).data.checklist.map(([k]) => k);
  store.updateVideo(ws.id, 'ap1', { version: 2, file: 'video_ap1.mp4' });
  let r = await agent.post('/api/videos/ap1/approve', { checklist, version: 1 });
  assert.equal(r.status, 409); assert.match(r.data.error, /new version/);
  r = await agent.post('/api/videos/ap1/approve', { checklist, version: 2, file: 'video_ap1_v1.mp4' });
  assert.equal(r.status, 409, 'a different file is a different version');
  // While a new version is being made from its draft, it waits (and doesn't count as a new video).
  const job = queue.enqueue({ ws: ws.id, kind: 'studio', opts: { draftId: 'sd_x', replace: 'ap1', scenes: good(), brief }, by: sam.id, source: 'studio' });
  r = await agent.post('/api/videos/ap1/approve', { checklist, version: 2 });
  assert.equal(r.status, 409); assert.match(r.data.error, /being fixed/);
  const list = (await agent.get('/api/videos')).data;
  assert.ok(list.fixing.includes('ap1')); assert.equal(list.making, 0);
  queue.cancel(ws.id, job.id);
  r = await agent.post('/api/videos/ap1/approve', { checklist, version: 2, file: 'video_ap1.mp4' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('spelling: quick on junk, quiet on good copy, and its fix changes only that word', () => {
  for (const t of ['Make sure their will is up to date', 'Your right to choose', 'Talk it over with your in-laws', 'Keep your on-time payments', 'A preneed plan', 'Ok, let’s talk', 'At its best, it is simple.', 'It is your doing'])
    assert.deepEqual(spell.checkSpelling(t), [], t);
  assert.equal(spell.checkSpelling('Its never too late to plan').length, 1, 'one note for one slip');
  const [m] = spell.checkSpelling('He visits a doctor, its a plan.');
  assert.equal(M.spellFixed('He visits a doctor, its a plan.', m), 'He visits a doctor, it’s a plan.', 'not “visit’s”');
  assert.equal(M.spellFixed('Rewritten since', m), null, 'a caption changed since is left alone');
  assert.ok(spell.checkSpelling('qwzrtplk xvbnmqwe zzkqpwlr yyqqzzpp kkwwqqxx mmnnbbvv ppooiiuu').length <= 6, 'six notes a caption at most');
  const t0 = Date.now(), budget = spell.newBudget();
  for (let k = 0; k < 40; k++) spell.checkSpelling(`zq${k}qwzrtplk xvbnmqwe${k} zzkqpwlr `.repeat(12).replace(/\d/g, d => 'abcdefghij'[d]), new Set(), budget);
  assert.ok(Date.now() - t0 < 2000, `a request full of junk is quick (${Date.now() - t0} ms)`);
});

test('a new version isn’t “too close” to the one it replaces; it replaces its recent entry too', async () => {
  const c = cfg(); store.saveConfig(ws.id, c);
  const d = (await asst.post('/api/studio', { brief })).data.draft;
  await asst.put('/api/studio/' + d.id, { scenes: good() });
  video('rc1', { source: 'studio', by: sam.id, meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId: d.id } });
  studio.save(ws.id, d.id, { status: 'done', videoId: 'rc1' });
  store.addRecent(ws.id, { hook: good()[0].text, videoId: 'rc1' });
  store.addRecent(ws.id, { hook: good()[0].text, videoId: 'rc1' });
  assert.equal(store.readRecent(ws.id).filter(r => r.videoId === 'rc1').length, 1, 'one entry per video');
  const r = await asst.post(`/api/studio/${d.id}/render`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const job = queue.listJobs(ws.id).find(j => j.kind === 'studio' && j.opts.draftId === d.id);
  assert.equal(job.opts.replace, 'rc1');
  // …and while that version is being made, a fix (or another submit) waits.
  assert.equal((await agent.post('/api/videos/rc1/fix', { swaps: [1] })).status, 409);
  queue.cancel(ws.id, job.id);
});

test('a video has at most MAX_VERSIONS versions', async () => {
  const d = (await asst.post('/api/studio', { brief })).data.draft;
  await asst.put('/api/studio/' + d.id, { scenes: good() });
  // Fixes raise the version number too, but only resubmits count toward the limit.
  video('mv1', { source: 'studio', by: sam.id, version: MAX_VERSIONS + 2, fixes: 3, versions: [{ v: 1, at: new Date().toISOString(), changed: [] }], meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId: d.id } });
  studio.save(ws.id, d.id, { status: 'done', videoId: 'mv1' });
  const ok = await asst.post(`/api/studio/${d.id}/render`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  queue.cancel(ws.id, queue.listJobs(ws.id).find(j => j.kind === 'studio' && j.opts.draftId === d.id).id);
  store.updateVideo(ws.id, 'mv1', { versions: Array.from({ length: MAX_VERSIONS }, (_, k) => ({ v: k + 1, at: new Date().toISOString(), changed: [] })) });
  studio.save(ws.id, d.id, { status: 'done', videoId: 'mv1' });
  const r = await asst.post(`/api/studio/${d.id}/render`);
  assert.equal(r.status, 409); assert.match(r.data.error, new RegExp(`${MAX_VERSIONS} versions`));
});

test('the coach’s Use all: lines checked together, a line that only works alone is marked so', () => {
  // Both teaching scenes say "usually": each line drops it from one; fine alone, not together.
  const scenes = good(); scenes[2] = sc('It is usually meant to cover funeral and end-of-life costs', 'funeral');
  const st = { draft: { id: 'sd_t' }, scenes, picks: picks(), cfg: { ...cfg(), output: { ...cfg().output, scenes: 6 } }, voice: false };
  const out = checkSuggestions(cfg(), [{ type: 'studio_scene', i: 1, text: 'Final expense insurance is a small policy', accent: 'small' }, { type: 'studio_scene', i: 2, text: 'It is meant to cover funeral and end-of-life costs', accent: 'funeral' }], { studio: st, held: [] });
  assert.equal(out.length, 2, 'both shown');
  assert.ok(!out[0].alone && out[0].together, 'Use all puts this one in'); assert.match(out[1].alone, /usually/); assert.ok(!out[1].together);
  // A scene's second line goes in only if its first can't.
  const two = checkSuggestions(cfg(), [{ type: 'studio_scene', i: 3, text: 'Ask me about a simple plan for you', accent: 'simple' }, { type: 'studio_scene', i: 3, text: 'Ask me about a plain plan for this', accent: 'plain' }], { studio: st, held: [] });
  assert.deepEqual(two.map(x => !!x.together), [true, false]);
});

test('the lens: a flag counts when its words are in the draft, whatever the punctuation, and shortened with “…”', () => {
  const body = 'Only 2 spots left this week! Act now, before Friday.';
  assert.ok(lens.quotes(body, 'act now.')); assert.ok(lens.quotes(body, 'Only 2 spots…before Friday'));
  assert.ok(!lens.quotes(body, 'Friday… only 2 spots'), 'in order'); assert.ok(!lens.quotes(body, 'ct no'), 'whole words');
});

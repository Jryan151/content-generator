// v15 Phase 7 (part 1): Studio warns, doesn't block. Every check is one of three kinds: locked compliance
// rules stop a render (each with a one-tap fix), style and craft are notes, and some things the app fixes
// itself. The same kinds in Studio, Fix a scene, ✦ Ideas and the coach. Plus the spelling check, the
// Studio fixes from the October 16 recording, and the coach that never comes back empty-handed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const spell = await import('../lib/spell.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Rules Test', comped: true });
const cfg0 = store.loadConfig(ws.id);
cfg0.story = { ...cfg0.story, ...starterStory() };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
cfg0.look = { ...cfg0.look, name: 'Jane Smith', location: 'Gallup, NM' };
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'rules@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('rulespass1234') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'rules@example.com', password: 'rulespass1234' });
const cfg = () => store.loadConfig(ws.id);
const FACT = cfg0.story.insights[0];   // "Final expense insurance is usually a small whole life policy…" (t_funeral)
const brief = { painId: 't_funeral', audienceId: 'aud', insightIds: [FACT.id], scenes: 6, format: 'question', structure: 'classic' };
const picks = () => M.studioPicks(cfg(), brief);
const scene = (text, extra = {}) => ({ text, accent: '', keyword: 'older woman kitchen', ...extra });
// A board that passes everything: the fact in the teaching scenes, with its "usually" on screen.
const good = () => [scene('Who pays for your funeral someday?', { accent: 'funeral' }), scene('Final expense insurance is usually a small policy', { accent: 'small' }),
  scene('It is meant to cover funeral and end-of-life costs', { accent: 'end-of-life' }), scene('Ask me about a simple plan for this', { accent: 'simple' }),
  scene('What fits you depends on your family.', { accent: 'family' }), scene(`${cfg0.story.ctaAction || 'Message me'} and we can talk it through`, { accent: 'talk' })];
const kinds = (r, rule) => r.findings.filter(f => f.rule === rule).map(f => f.kind);

test('the rules: locked compliance rules always stop; style and craft have levels Admin can change; settings and lists too', () => {
  const R = M.rulesOf(cfg());
  for (const id of ['price', 'rates', 'numbers', 'qualify', 'government', 'absolute', 'qualifier', 'banned', 'required', 'facts']) {
    assert.equal(M.RULES[id].locked, true, id);
    assert.equal(M.rulesOf({ ...cfg(), rules: { levels: { [id]: { draft: 'off', auto: 'off' } } } }).level(id, 'draft'), 'block', `${id} can’t be turned down`);
  }
  assert.equal(R.level('cliche', 'draft'), 'warn'); assert.equal(R.level('cliche', 'auto'), 'block');
  const custom = M.rulesOf({ ...cfg(), rules: { levels: { cliche: { draft: 'block', auto: 'off' } }, settings: { factMatch: 0.95, recentCount: 5, captionWords: '' }, lists: { cliches: { add: ['Super Easy'], remove: ['journey'] } } } });
  assert.equal(custom.level('cliche', 'draft'), 'block'); assert.equal(custom.level('cliche', 'auto'), 'off');
  assert.equal(custom.setting('factMatch'), 0.8, 'held to the safe range');
  assert.equal(custom.setting('recentCount'), 5); assert.equal(custom.setting('captionWords'), null, 'blank: the workspace’s own setting');
  assert.ok(custom.list('cliches').includes('super easy') && !custom.list('cliches').includes('journey'));
  assert.equal(M.rulesOf(cfg()).setting('recentCount'), 30, 'as many recent videos as before by default');
});

test('three kinds in a person’s draft: overused wording is a note with a plainer word; the same in an automatic video still stops it', () => {
  const sc = good(); sc[3] = scene('Ask me how to get peace of mind', { accent: 'Ask' });
  const r = M.studioChecks(sc, cfg(), picks());
  assert.ok(r.ok, JSON.stringify(r.problems));
  const f = r.findings.find(x => x.rule === 'cliche');
  assert.equal(f.kind, 'warn'); assert.equal(f.scene, 3);
  assert.deepEqual(f.fix.edits, [{ i: 3, field: 'text', value: 'Ask me how to get less to worry about' }]);
  const auto = M.validateScript({ scenes: sc }, { ...cfg(), output: { ...cfg().output, scenes: 6 } }, { ...picks(), manualFootage: true });
  assert.ok(auto.findings.some(x => x.rule === 'cliche' && x.kind === 'stop'), 'automatic videos keep their bar');
  // Admin can make it a block in drafts too.
  assert.equal(M.studioChecks(sc, { ...cfg(), rules: { levels: { cliche: { draft: 'block' } } } }, picks()).ok, false);
});

test('hard stops, each with a one-tap fix: prices, price comparisons, rates, qualifying, absolutes, banned words, a dropped qualifier', () => {
  const check = (i, text, extra) => { const sc = good(); sc[i] = scene(text, extra); return M.studioChecks(sc, cfg(), picks()); };
  // Prices come out; comparisons and rates are rewritten.
  let r = check(3, 'Simple plans, $30 a month, are out there');
  let f = r.findings.find(x => x.rule === 'price'); assert.equal(f.kind, 'stop'); assert.deepEqual(f.fix.edits, [{ i: 3, field: 'text', value: 'Simple plans are out there' }], 'the commas around it go too');
  f = check(3, 'Simple plans for $30 a month are out there').findings.find(x => x.rule === 'price'); assert.equal(f.fix.rewrite, 3, '“for are” would cut the phrase in two');
  // Taking it out would leave the line hanging ("Plans can cost"): rewritten instead.
  f = check(3, 'Plans can cost $30 a month').findings.find(x => x.rule === 'price'); assert.equal(f.fix.rewrite, 3);
  f = check(3, 'Your plan can be simple, about $30').findings.find(x => x.rule === 'price'); assert.equal(f.fix.rewrite, 3, 'ends on “about”');
  f = check(3, 'Most plans are simple. $30 a month.').findings.find(x => x.rule === 'price'); assert.deepEqual(f.fix.edits, [{ i: 3, field: 'text', value: 'Most plans are simple.' }]);
  r = check(3, 'A simple plan can literally cost less than your monthly coffee habit');
  f = r.findings.find(x => x.rule === 'price' && /everyday expense/.test(x.text)); assert.equal(f.kind, 'stop'); assert.match(f.text, /“less than your monthly coffee”/); assert.equal(f.fix.rewrite, 3);
  assert.ok(check(3, 'It can be pennies a day').findings.some(x => x.rule === 'price' && x.kind === 'stop'));
  r = check(3, 'Lock in your low rates before they go up');
  assert.ok(r.findings.some(x => x.rule === 'rates' && x.kind === 'stop' && /Lock in your low rates/.test(x.text)));
  assert.ok(check(3, 'Rates are going up next year').findings.some(x => x.rule === 'rates'));
  // "You'll qualify" becomes "see if you qualify".
  f = check(3, 'You will qualify for this').findings.find(x => x.rule === 'qualify');
  assert.match(f.text, /“You will qualify”/); assert.equal(f.fix.edits[0].value, 'See if you qualify for this');
  // An absolute softened; a banned phrase taken out.
  f = check(3, 'This always works for families').findings.find(x => x.rule === 'absolute');
  assert.equal(f.fix.edits[0].value, 'This often works for families'); assert.equal(f.fix.label, 'Say “often”');
  f = check(3, 'Get guaranteed coverage for your family').findings.find(x => x.rule === 'banned');
  assert.equal(f.fix.edits[0].value, 'Get coverage for your family');
  // A dropped qualifier: "Put 'usually' back", into the scene that says the fact.
  r = check(1, 'Final expense insurance is a small policy', { accent: 'small' });
  f = r.findings.find(x => x.rule === 'qualifier');
  assert.equal(f.kind, 'stop'); assert.equal(f.fix.label, 'Put “usually” back');
  assert.equal(f.fix.edits.length, 1); assert.equal(f.fix.edits[0].field, 'text');
  assert.equal(f.scene, 1, 'the scene that says the words around “usually” in the fact, not the one that says the most of it');
  assert.equal(f.fix.edits[0].value, 'Final expense insurance is usually a small policy');
  const fixed = good(); fixed[1] = { ...fixed[1], text: 'Final expense insurance is a small policy' };
  fixed[f.fix.edits[0].i] = { ...fixed[f.fix.edits[0].i], text: f.fix.edits[0].value };
  assert.ok(!M.studioChecks(fixed, cfg(), picks()).findings.some(x => x.rule === 'qualifier'), 'the fix fixes it');
  // Numbers the facts don't have: rewritten.
  f = check(3, 'Plans from age 50').findings.find(x => x.rule === 'numbers'); assert.equal(f.kind, 'stop'); assert.equal(f.fix.rewrite, 3);
});

test('fixed for you: a highlight that differs in capitals just matches; a missing or mismatched one is picked; a missing footage search is filled', () => {
  const sc = good();
  sc[1] = { ...sc[1], accent: 'SMALL' };
  assert.ok(!M.studioChecks(sc, cfg(), picks()).findings.some(x => x.rule === 'accent' && x.scene === 1), 'capitals don’t matter');
  sc[2] = { ...sc[2], accent: 'Affordable' };   // the recording: a highlight not in the caption
  sc[4] = { ...sc[4], accent: '', keyword: '' };
  const r = M.studioChecks(sc, cfg(), picks());
  assert.ok(r.ok, JSON.stringify(r.problems));
  const acc = r.findings.find(x => x.rule === 'accent' && x.scene === 2);
  assert.equal(acc.kind, 'fix'); assert.match(acc.text, /isn’t in the caption/);
  const kw = r.findings.find(x => x.rule === 'footage' && x.scene === 4);
  assert.equal(kw.kind, 'fix');
  const auto = M.applyAutoFixes(sc, r.findings);
  assert.ok(sc[2].text.toLowerCase().includes(auto[2].accent.toLowerCase()) && auto[2].accent);
  assert.ok(auto[4].accent && auto[4].keyword);
});

test('the call to action is named whole, questions become statements, calm energy loses its exclamation marks', () => {
  const c1 = { ...cfg(), story: { ...cfg().story, ctaAction: 'Let’s sit down and talk' }, voice: { ...cfg().voice, energy: 'low' } };
  const sc = good(); sc[5] = scene('Thanks for watching!'); sc[3] = scene('Want a simple plan for this?');
  const r = M.studioChecks(sc, c1, picks());
  const cta = r.findings.find(x => x.rule === 'cta');
  assert.match(cta.text, /your call to action \(“Let’s sit down and talk”\)/); assert.doesNotMatch(cta.text, /"let's sit"/i);
  assert.deepEqual(cta.fix.edits, [{ i: 5, field: 'text', value: 'Let’s sit down and talk' }]);
  assert.equal(r.findings.find(x => x.rule === 'questions').fix.edits[0].value, 'Want a simple plan for this.');
  assert.equal(r.findings.find(x => x.rule === 'energy').fix.edits[0].value, 'Thanks for watching.');
  assert.ok(r.ok, 'all notes');
});

test('another product: a term policy in a final expense video gets a note; the writer is told the product', () => {
  const sc = good(); sc[3] = scene('A simple term policy can protect you in early adulthood');
  const f = M.studioChecks(sc, cfg(), picks()).findings.find(x => x.rule === 'product');
  assert.equal(f.kind, 'warn'); assert.match(f.text, /family protection.*final expense/i);
  assert.match(picks().productLine, /^Final expense/);
});

test('a video that teaches no specific fact: any worry, no fact checks, and every number is held back', () => {
  const p = M.studioPicks(cfg(), { ...brief, insightIds: [], noFact: true });
  assert.equal(p.noFact, true); assert.equal(p.insights.length, 0); assert.deepEqual(p.problems, []);
  const sc = good(); sc[1] = scene('Planning ahead can help your family'); sc[2] = scene('It is worth a quiet talk at home');
  const r = M.studioChecks(sc, cfg(), p);
  assert.ok(!r.findings.some(x => ['factMatch', 'qualifier'].includes(x.rule)));
  sc[3] = scene('Most people start at 60');
  assert.ok(M.studioChecks(sc, cfg(), p).findings.some(x => x.rule === 'numbers' && x.kind === 'stop'));
  assert.ok(M.studioPicks(cfg(), { ...brief, noFact: true, format: 'list' }).problems.length, 'a list still needs facts');
});

test('lines for one card: only what would stop a render holds a line back; notes travel with it', () => {
  const sc = good(), p = picks(), c1 = { ...cfg(), output: { ...cfg().output, scenes: 6 } };
  const withNote = M.lineFindings(sc, 3, { text: 'Ask me how to get peace of mind' }, c1, p);
  assert.ok(withNote.some(f => f.kind === 'warn' && f.rule === 'cliche'));
  assert.deepEqual(M.lineProblems(sc, 3, { text: 'Ask me how to get peace of mind' }, c1, p), [], 'offered');
  assert.ok(M.lineProblems(sc, 3, { text: 'Plans cost $30 a month' }, c1, p).length, 'held back');
});

test('spelling: misspellings with a correction, mix-ups like “its” for “it’s”; names and the agent’s own words are left alone', () => {
  const own = spell.ownWords(cfg());
  const out = t => spell.checkSpelling(t, own).map(({ word, suggestion }) => ({ word, suggestion }));   // (each also says where it is: `at`)
  assert.deepEqual(out('Final expense can be afforadable'), [{ word: 'afforadable', suggestion: 'affordable' }]);
  assert.deepEqual(out('Its never too early to plan'), [{ word: 'Its never', suggestion: 'It’s never' }]);
  assert.deepEqual(out('Your welcome to call'), [{ word: 'Your welcome', suggestion: 'You’re welcome' }]);
  assert.deepEqual(out('Planning could of helped alot'), [{ word: 'could of', suggestion: 'could have' }, { word: 'alot', suggestion: 'a lot' }]);
  assert.deepEqual(out('Talk with Sarah in Gallup about it. Teh plan matters'), [{ word: 'Teh', suggestion: 'The' }]);
  assert.deepEqual(out('It’s yours, and your family’s, at 9am with @janesmith #plan https://x.co/a'), []);
  for (const [w, s] of [['recieve', 'receive'], ['insurence', 'insurance'], ['benificiary', 'beneficiary'], ['morgage', 'mortgage'], ['definately', 'definitely']]) assert.equal(spell.suggest(w), s);
});

test('Studio over the API: spelling notes, render with notes (onto the job and the review card), refusals carry the fixes', async () => {
  const sp = await c.post('/api/spell', { texts: ['This is afforadable', 'All good here'] });
  assert.equal(sp.status, 200);
  assert.deepEqual(sp.data.results, [[{ word: 'afforadable', at: 8, suggestion: 'affordable' }], []]);
  const d = (await c.post('/api/studio', { brief })).data.draft;
  const sc = good(); sc[3] = scene('Ask me how to get peace of mind and it is afforadable', { accent: 'Ask' });
  await c.put('/api/studio/' + d.id, { scenes: sc });
  const view = (await c.get('/api/studio/' + d.id)).data.draft;
  assert.equal(view.check.ok, true);
  assert.ok(view.check.findings.some(f => f.rule === 'cliche' && f.kind === 'warn'));
  const r = await c.post(`/api/studio/${d.id}/render`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const queue = await import('../lib/queue.js');
  const job = queue.listJobs(ws.id).find(j => j.kind === 'studio' && j.opts.draftId === d.id);
  assert.ok(job.opts.notes.some(n => /afforadable.*affordable/.test(n)), 'spelling goes with the job');
  queue.cancel(ws.id, job.id);
  // The review card shows the notes rendered past.
  const { preflight } = await import('../pipeline.js');
  const items = preflight({ cfg: cfg(), meta: { notes: ['Uses overused ad wording ("peace of mind").'] }, scenes: [], clips: [], out: { duration: 20, lines: [] }, post: 'x' });
  assert.ok(items.some(i => !i.ok && /You rendered past a note: Uses overused ad wording/.test(i.label)));
});

test('the coach never comes back empty-handed: lines that would stop a render are retried once, told why; the reply matches what’s shown', async () => {
  const d = (await c.post('/api/studio', { brief })).data.draft;
  await c.put('/api/studio/' + d.id, { scenes: good() });
  const ask = q => c.post('/api/coach', { messages: [{ role: 'user', content: q }], view: 'studio', focus: { studio: { draftId: d.id, scenes: good() } } });
  const r = await ask('Give me lines for scenes 2 and 3');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const lines = r.data.suggestions.filter(s => s.type === 'studio_scene');
  assert.equal(lines.length, 2, 'the retry’s clean lines, one per scene');
  assert.deepEqual(lines.map(s => s.i), [1, 2]);
  assert.match(r.data.reply, /without the price/);
  // Every try fails: it says so plainly, and why, instead of promising lines.
  const bad = await ask('Write only bad lines for scenes 2 and 3');
  assert.equal(bad.data.suggestions.filter(s => s.type === 'studio_scene').length, 0);
  assert.match(bad.data.reply, /^None of the lines I wrote passed the checks \(.*mentioned a price/);
  assert.doesNotMatch(bad.data.reply, /Here are some revised lines/);
  const { heldWhy } = await import('../lib/coach.js');
  assert.equal(heldWhy([{ reason: 'dropped “often”' }, { reason: 'dropped “often”' }]), '2 that dropped “often”');
});

// v14 Phase 2: a smarter Content tab. New items link themselves in every direction, every link gets
// a fit check (weak links warn; mismatches, and facts or solutions from different product lines,
// are left out of videos until fixed or overridden), Link everything proposes what's missing, and
// ✦ Generate writes checked options for each kind of item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const audit = await import('../lib/audit.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Content Test', comped: true });
const base = store.loadConfig(ws.id);
base.story = { ...base.story, ...starterStory(['final_expense', 'mortgage']) };
base.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
store.saveConfig(ws.id, base);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'content@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('contentpass1') });
const c = client(server.address().port);
await c.post('/api/login', { email: 'content@example.com', password: 'contentpass1' });
const cfg = () => store.loadConfig(ws.id);
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('link checks: a product mismatch is blocked without AI; verdicts warn or block; overrides and stale verdicts', () => {
  const c0 = M.migrate(cfg());
  const fe = c0.story.insights.find(i => i.product === 'final_expense'), mp = c0.story.painPoints.find(p => p.product === 'mortgage');
  fe.links.push(mp.id);   // a final expense fact answering a mortgage worry
  let checks = M.linkChecks(c0);
  const clash = checks.find(l => l.key === `${fe.id}>${mp.id}`);
  assert.equal(clash.state, 'blocked'); assert.match(clash.reason, /Different product lines/);
  assert.ok(!M.usableRoutes(c0).insights.find(i => i.id === fe.id).links.includes(mp.id), 'videos never use it');
  for (let k = 0; k < 50; k++) { const p = M.roll(c0, seeded(k + 1)); if (p.painPoint?.id === mp.id) assert.notEqual(p.insight?.id, fe.id); }
  assert.ok(M.analyze(c0).warnings.some(w => /doesn’t fit/.test(w.msg)));
  // An AI verdict: 2 or less blocks, 3 warns; a changed text makes it stale (unchecked).
  const f2 = c0.story.insights.find(i => i.product === 'final_expense' && i.id !== fe.id), p2 = c0.story.painPoints.find(p => f2.links.includes(p.id));
  const key = M.linkKey(f2.id, p2.id);
  c0.story.fit[key] = { s: 2, r: 'Not about this worry.', k: M.textKey(f2.text, p2.text) };
  assert.equal(M.linkChecks(c0).find(l => l.key === key).state, 'blocked');
  c0.story.fit[key].s = 3;
  assert.equal(M.linkChecks(c0).find(l => l.key === key).state, 'weak');
  assert.ok(M.usableRoutes(c0).insights.find(i => i.id === f2.id).links.includes(p2.id), 'weak links are still used');
  c0.story.fit[key].s = 2; f2.text += ' Often.';
  assert.equal(M.linkChecks(c0).find(l => l.key === key).state, 'unchecked', 'a changed text needs a new check');
  // An override with a reason puts a blocked link back into use.
  c0.story.fit[M.linkKey(fe.id, mp.id)] = { s: 3, r: '', k: M.textKey(fe.text, mp.text), o: 'This fact is true for my mortgage clients too.' };
  assert.ok(M.usableRoutes(c0).insights.find(i => i.id === fe.id).links.includes(mp.id));
  // Saved shapes only.
  const m = M.migrate({ ...c0, story: { ...c0.story, fit: { 'a>b': { s: 9 }, [key]: { s: 'x', r: 5, o: '' }, junk: 1 }, insights: c0.story.insights.map((i, k) => (k ? i : { ...i, product: 'cars' })) } });
  assert.deepEqual(Object.keys(m.story.fit), [key]); assert.equal(m.story.fit[key].s, 3);
  assert.equal(m.story.insights[0].product, undefined);
});

test('a new item links itself in every direction, already checked', async () => {
  const c0 = cfg();
  const item = { id: 'i_new1', text: 'Many families usually compare a few plans before choosing one.', links: [], confirmed: false, confirmedAt: '', source: '', ai: false };
  c0.story.insights.unshift(item);
  const r = await c.post('/api/content/autolink', { kind: 'insights', id: 'i_new1', config: c0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.parents.length, 1, 'only clear fits (4+), only real ids');
  assert.equal(r.data.children.length, 1);
  assert.equal(r.data.product, 'final_expense');
  assert.ok(Object.values(r.data.fit).every(v => v.s >= 4 && v.k));
  assert.equal((await c.post('/api/content/autolink', { kind: 'insights', id: 'nope', config: c0 })).status, 400);
});

test('the fit check judges new links once, saves the verdicts, and a stale portal can’t erase them', async () => {
  const stale = cfg();
  const r = await c.post('/api/content/relevance', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.judged > 0);
  const saved = cfg();
  assert.ok(Object.keys(saved.story.fit).length >= r.data.judged - 0, 'verdicts are on the saved config');
  assert.ok(Object.values(saved.story.fit).some(v => v.s === 3), 'a loose one');
  const again = await c.post('/api/content/relevance', {});
  assert.equal(again.data.judged, 0, 'nothing to judge twice');
  // A save from a portal loaded before the check keeps the verdicts.
  const put = await c.put('/api/config', { config: stale });
  assert.equal(Object.keys(put.data.config.story.fit).length, Object.keys(saved.story.fit).length);
  // An override is recorded.
  const k = Object.keys(saved.story.fit)[0];
  const withO = cfg(); withO.story.fit[k] = { ...withO.story.fit[k], o: 'I know my clients.' };
  await c.put('/api/config', { config: withO });
  assert.ok(audit.list({ ws: ws.id, limit: 50 }).some(e => e.action === 'facts.override' && e.target === k));
});

test('Link everything proposes only real, missing, right-way-round links', async () => {
  const c0 = cfg();
  c0.story.insights.unshift({ id: 'i_lone', text: 'Many people usually review their coverage after a big life change.', links: [], confirmed: true, confirmedAt: new Date().toISOString(), source: '', ai: false });
  const r = await c.post('/api/content/link-all', { config: c0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.add.length, 1, JSON.stringify(r.data.add));
  assert.deepEqual([r.data.add[0].list, r.data.add[0].id], ['insights', 'i_lone']);
  assert.ok(r.data.add[0].fit.k && r.data.add[0].fit.s >= 4);
});

test('✦ Generate: checked options for each kind; facts come back for confirmation', async () => {
  const c0 = cfg(), pain = c0.story.painPoints[0], aud = c0.story.audiences[0], fact = c0.story.insights[0];
  const gen = body => c.post('/api/content/generate', body);
  const f = await gen({ kind: 'insights', painId: pain.id });
  assert.deepEqual(f.data.options.map(o => o.text), ['Many families usually compare a few plans before choosing one.'], 'no unqualified or duplicate facts');
  assert.deepEqual(f.data.options[0].links, [pain.id]);
  assert.equal((await gen({ kind: 'insights' })).status, 400, 'facts need their worry');
  assert.deepEqual((await gen({ kind: 'painPoints', audienceId: aud.id })).data.options.map(o => [o.text, o.question]), [['I don’t know where to even start with this.', 'where to start for your family']]);
  assert.deepEqual((await gen({ kind: 'audiences' })).data.options.map(o => o.text), ['Widows managing money alone'], 'no government words');
  assert.deepEqual((await gen({ kind: 'solutions', factId: fact.id })).data.options.map(o => o.text), ['Small whole life plan']);
  assert.deepEqual((await gen({ kind: 'cta', audienceId: aud.id })).data.options.map(o => o.text), ['Message me anytime', 'Send me a quick note'], 'no pressure');
});

test('a blocked solution is never the random pick; old verdicts don’t pile up', () => {
  const c0 = M.migrate(cfg());
  const f = c0.story.insights.find(i => c0.story.solutions.filter(x => x.links.includes(i.id)).length === 1);
  const sol = c0.story.solutions.find(x => x.links.includes(f.id));
  c0.story.fit[M.linkKey(sol.id, f.id)] = { s: 1, r: 'Different topic.', k: M.textKey(sol.text, f.text) };
  for (let k = 0; k < 60; k++) { const p = M.roll(c0, seeded(k + 1), [], { insightId: f.id, painId: c0.story.painPoints.find(x => f.links.includes(x.id)).id }); if (p.insight?.id === f.id) assert.notEqual(p.solution?.id, sol.id); }
  const m = M.migrate({ ...c0, story: { ...c0.story, fit: { ...c0.story.fit, [M.linkKey(sol.id, 'fe_i8')]: { s: 5, r: '', k: 'x' } } } });
  assert.equal(m.story.fit[M.linkKey(sol.id, 'fe_i8')] === undefined || sol.links.includes('fe_i8'), true, 'only links that exist keep a verdict');
});

test('a verdict edited in the browser isn’t trusted; an override is', async () => {
  // A verdict the server made, then the same link "fixed" by hand without an override.
  await c.post('/api/content/relevance', { manual: true });
  const c0 = cfg();
  const fe = c0.story.insights.find(i => i.product === 'final_expense'), mp = c0.story.painPoints.find(p => p.product === 'mortgage');
  fe.links.push(mp.id);
  const key = M.linkKey(fe.id, mp.id);
  c0.story.fit[key] = { s: 5, r: 'trust me', k: M.textKey(fe.text, mp.text) };
  const saved = (await c.put('/api/config', { config: c0 })).data.config;
  assert.equal(saved.story.fit[key], undefined, 'a made-up verdict is dropped');
  assert.equal(M.linkChecks(saved).find(l => l.key === key).state, 'blocked');
  // The same link with an override is used, and the override is what's kept.
  c0.story.fit[key] = { s: 5, r: 'trust me', k: M.textKey(fe.text, mp.text), o: 'Some of my final expense clients still have a mortgage.' };
  const s2 = (await c.put('/api/config', { config: c0 })).data.config;
  assert.equal(s2.story.fit[key].u, 1); assert.ok(s2.story.fit[key].o);
  assert.ok(M.usableRoutes(s2).insights.find(i => i.id === fe.id).links.includes(mp.id));
  // A signed verdict survives a round trip through the browser.
  const signed = Object.entries(s2.story.fit).find(([, v]) => v.g);
  assert.ok(signed, 'verdicts from the check are signed');
  const s3 = (await c.put('/api/config', { config: s2 })).data.config;
  assert.deepEqual(s3.story.fit[signed[0]], signed[1]);
  // New verdicts only, from the check.
  const r = await c.post('/api/content/relevance', { manual: true });
  assert.ok(Object.values(r.data.fit).every(v => v.g));
});

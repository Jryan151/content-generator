// v13 Phase 1: writing quality. Structures and rotating endings, per-scene style guidance and
// style checks, message-based style calibration, a model per job, structured outputs, one draft
// overnight, and the golden set.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tempEnv, startStubs, client } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const P = await import('../lib/prompts.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });

const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function setup(scenes = 7, style = '') {
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.story.audiences.forEach(a => { a.style = style; });
  cfg.look.name = 'Jane Smith'; cfg.output.scenes = scenes;
  return cfg;
}

test('structures: scene plans keep the hook first and the call to action last', () => {
  for (const n of [5, 6, 7, 10]) {
    for (const st of Object.keys(M.STRUCTURES)) {
      const plan = M.beatPlan(n, 'question', 1, st);
      assert.equal(plan[0].beat, 'Hook');
      assert.equal(plan.at(-1).beat, 'CTA'); assert.equal(plan.at(-1).from, n);
      // Every scene belongs to exactly one beat.
      const covered = plan.flatMap(b => Array.from({ length: b.to - b.from + 1 }, (_, i) => b.from + i));
      assert.deepEqual(covered, Array.from({ length: n }, (_, i) => i + 1), `${st} at ${n} scenes`);
    }
  }
  assert.deepEqual(M.beatPlan(6, 'question', 1), M.beatPlan(6, 'question', 1, 'classic'), 'classic is the old plan');
  assert.ok(!M.beatPlan(7, 'question', 1, 'nobridge').some(b => b.beat === 'Bridge'));
  assert.equal(M.beatPlan(7, 'question', 1, 'objection')[2].beat, 'Common doubt');
  assert.equal(M.beatPlan(6, 'question', 1, 'objection').some(b => b.beat === 'Common doubt'), false, 'too few scenes: classic');
  assert.equal(M.beatPlan(7, 'list', 2, 'answer').some(b => b.beat === 'Bottom line'), false, 'lists keep the classic shape');
});

test('structures: roll rotates them, only where they fit, and old configs get them all', () => {
  const cfg = setup(7);
  const seen = new Set();
  for (let k = 0; k < 120; k++) {
    const p = M.roll(cfg, seeded(k + 1));
    assert.ok(M.structureFits(p.structure, 7, p.format), `${p.structure} fits ${p.format}`);
    assert.ok(M.BRIDGE_STYLES[p.bridgeStyle] && M.CTA_STYLES[p.ctaStyle]);
    seen.add(p.structure);
  }
  assert.ok(seen.size >= 4, 'several structures come up: ' + [...seen]);
  // Five scenes: only classic and "straight to you" fit.
  const small = setup(5);
  for (let k = 0; k < 40; k++) assert.ok(['classic', 'nobridge'].includes(M.roll(small, seeded(k + 1)).structure));
  // Turning structures off leaves Classic, and a recent structure is less likely next time.
  const off = setup(7); off.output.structures = [];
  assert.deepEqual(M.migrate(off).output.structures, ['classic']);
  const old = { ...setup(7), version: 9 }; delete old.output.structures;
  assert.deepEqual(M.migrate(old).output.structures, Object.keys(M.STRUCTURES));
  // Adding structures picks them last: everything else stays the same for the same seed.
  const a = M.roll(cfg, seeded(42)), b = M.roll({ ...cfg, output: { ...cfg.output, structures: ['classic'] } }, seeded(42));
  assert.deepEqual([a.painPoint.id, a.insight.id, a.format], [b.painPoint.id, b.insight.id, b.format]);
  assert.equal(b.structure, 'classic');
});

test('structures: the prompt describes each one, and the checks follow the plan', () => {
  const cfg = setup(7);
  const at = st => { const p = M.roll(cfg, seeded(3), [], { structure: st, format: 'question' }); assert.equal(p.structure, st); return p; };
  const u = st => P.buildPrompt(cfg, at(st)).user;
  assert.match(u('objection'), /Common doubt \(Scene 4\)/);
  assert.match(u('recap'), /Remember this \(Scene 4\)/);
  assert.match(u('answer'), /Bottom line \(Scene 2\)/);
  const nb = u('nobridge');
  assert.doesNotMatch(nb, /Bridge \(/);
  assert.match(nb, /no bridge scene, so the CTA also says their own answer depends on their situation and raises their open question/);
  assert.match(nb, /Only the hook \(Scene 1\) may be a question/);
  // A question in the second-to-last scene is fine with a bridge, not without one.
  const scenes = ['Worried about the bills later?', 'Many policies may skip the exam', 'Most ask a few health questions', 'That helps many families plan', 'Ask me about options', 'What would yours look like?', 'Message me and we can talk']
    .map(t => ({ text: t, accent: t.split(' ').find(w => w.length > 5) || t.split(' ')[0], keyword: 'older woman kitchen' }));
  const qs = r => r.problems.filter(x => /question/.test(x) && /Scene 6/.test(x));
  assert.equal(qs(M.validateScript({ scenes }, cfg, at('classic'))).length, 0);
  assert.equal(qs(M.validateScript({ scenes }, cfg, at('nobridge'))).length, 1);
});

test('every structure and ending still says their answer depends on their situation', () => {
  // This line carries the platform rule "make clear that coverage depends on qualifying".
  const cfg = setup(7);
  for (const st of Object.keys(M.STRUCTURES)) for (const b of Object.keys(M.BRIDGE_STYLES)) {
    const p = M.roll(cfg, seeded(3), [], { structure: st, format: 'question' });
    assert.match(P.buildPrompt(cfg, { ...p, bridgeStyle: b }).user, /answer depends on their situation/, `${st} + ${b}`);
  }
  assert.doesNotMatch(Object.values(P.CTA_LINES).join(' '), /\bpromise the\b/i);
  assert.match(P.CTA_LINES.specific, /never a promise of coverage/);
  assert.match(P.buildPrompt(cfg, M.roll(cfg, seeded(3), [], { structure: 'objection', format: 'question' })).user, /Never say or imply they will qualify/);
  const ans = P.buildPrompt(cfg, M.roll(cfg, seeded(3), [], { structure: 'answer', format: 'mistake' })).user;
  assert.match(ans, /No fear, no urgency, no worst-case stories/);
});

test('endings rotate: bridge and call-to-action wording follow the picked style', () => {
  const cfg = setup(6);
  const p = M.roll(cfg, seeded(5), [], { structure: 'classic' });
  for (const [k, line] of Object.entries(P.BRIDGE_LINES)) assert.ok(P.buildPrompt(cfg, { ...p, bridgeStyle: k }).user.includes(line), k);
  for (const [k, line] of Object.entries(P.CTA_LINES)) assert.ok(P.buildPrompt(cfg, { ...p, ctaStyle: k }).user.includes(line), k);
  // A Steady audience leans toward the no-pressure ending.
  const steady = setup(6, 'S'), gentle = Array.from({ length: 200 }, (_, k) => M.roll(steady, seeded(k + 9)).ctaStyle).filter(x => x === 'gentle').length;
  assert.ok(gentle > 60, `gentle came up ${gentle}/200`);
});

test('DISC: the main style shapes the opening and the CTA, the second style the middle', async () => {
  const { styleGuide, STYLES } = await import('../comms-core.js');
  const g = styleGuide('SC');
  assert.equal(g.hook, STYLES.S.video.hook); assert.equal(g.cta, STYLES.S.video.cta); assert.equal(g.middle, STYLES.C.video.middle);
  assert.ok(g.land.includes('no pressure') && g.land.includes('the details'));
  assert.ok(g.lose.includes('limited time'), 'quote marks are cleaned up');
  assert.equal(styleGuide(''), null);
  const cfg = setup(6, 'SC');
  const user = P.buildPrompt(cfg, M.roll(cfg, seeded(2))).user;
  assert.ok(user.includes(`This audience leans Steady + Careful: ${STYLES.S.video.hook}`));
  assert.ok(user.includes(`This audience leans Steady + Careful: ${STYLES.C.video.middle}`));
  assert.match(user, /Words that tend to land with them: .*"no pressure"/);
  assert.doesNotMatch(P.buildPrompt(setup(6), M.roll(setup(6), seeded(2))).user, /This audience leans/, 'no style, no style lines');
  // The critic scores freshness always, and style fit when a style is set.
  const picks = M.roll(cfg, seeded(2), [{ hook: 'An old opening', bridge: 'An old bridge', cta: 'An old ending' }]);
  const cp = P.buildCriticPrompt(cfg, picks, [{ scenes: [{ text: 'a' }] }]).user;
  assert.match(cp, /- fresh:/); assert.match(cp, /- styleFit:/); assert.match(cp, /An old opening/);
  assert.doesNotMatch(P.buildCriticPrompt(setup(6), M.roll(setup(6), seeded(2)), [{ scenes: [] }]).user, /styleFit/);
  assert.ok(P.criticSchema(picks).schema.items === undefined && P.criticSchema(picks).schema.properties.scores.items.required.includes('styleFit'));
});

test('DISC: style checks are soft notes, never blocks', () => {
  const S = M.styleNotes(['Act now before it’s too late', 'Hurry, limited time'], [{ text: 'a' }], 'S');
  assert.equal(S.length, 1); assert.match(S[0], /Steady/);
  assert.match(M.styleNotes(['This is amazing news'], [{ text: 'a' }], 'CS')[0], /Careful/);
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
  assert.match(M.styleNotes([long], [{ say: long, text: 'short' }], 'D')[0], /Direct.*scene 1/);
  assert.deepEqual(M.styleNotes(['Hurry'], [{ text: 'x' }], ''), []);
  // In a full check they land in `soft`, so the script still passes.
  const cfg = setup(6, 'S');
  const picks = M.roll(cfg, seeded(1), [], { structure: 'classic', format: 'question' });
  const scenes = ['Thinking about the bills later?', 'Many policies may skip the exam', 'Most ask a few health questions instead', 'Ask me about a simple option', 'What fits you depends on your family?', 'Message me right now and we can talk']
    .map(t => ({ text: t, accent: t.split(' ').find(w => w.length > 5), keyword: 'older woman kitchen' }));
  const r = M.validateScript({ scenes }, cfg, picks);
  assert.ok(r.soft.some(x => /Steady/.test(x)), JSON.stringify(r.problems));
  assert.ok(!r.problems.filter(x => !r.soft.includes(x)).some(x => /Steady/.test(x)));
});

test('DISC: real messages calibrate an audience’s style once there are enough', () => {
  const auds = [{ id: 'a1', style: 'C' }, { id: 'a2', style: 'S' }, { id: 'a3', style: '' }];
  const reads = [...Array(8).fill({ audienceId: 'a1', style: 'S' }), ...Array(2).fill({ audienceId: 'a1', style: 'C' }), ...Array(10).fill({ audienceId: 'a2', style: 'S' }), ...Array(4).fill({ audienceId: 'a3', style: 'D' }), { audienceId: 'a3', style: 'X' }];
  const [one, two, three] = M.styleCalibration(auds, reads);
  assert.deepEqual([one.total, one.top, one.share, one.suggest], [10, 'S', 80, 'S']);
  assert.equal(two.suggest, '', 'already right');
  assert.deepEqual([three.total, three.suggest], [4, ''], 'not enough yet; bad letters ignored');
  const split = M.styleCalibration([{ id: 'a', style: 'D' }], [...Array(5).fill({ audienceId: 'a', style: 'S' }), ...Array(5).fill({ audienceId: 'a', style: 'C' })])[0];
  assert.equal(split.suggest, '', 'no clear leader, no suggestion');
});

test('DISC: the reply helper logs which style each audience writes in', async () => {
  const ws = store.createWorkspace({ name: 'Calibrate', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.look.name = 'Jane Smith';
  store.saveConfig(ws.id, cfg); store.updateWorkspace(ws.id, { onboarded: true });
  store.createAccount({ email: 'cal@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('calpass12345') });
  const c = client(server.address().port);
  await c.post('/api/login', { email: 'cal@example.com', password: 'calpass12345' });
  const aud = cfg.story.audiences[0].id;
  const r = await c.post('/api/coach/reply', { message: 'Can you tell me how the waiting period works?', audienceId: aud });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.logged, true);
  assert.equal((await c.post('/api/coach/reply', { message: 'Hi there', audienceId: 'nope' })).data.logged, false);
  assert.equal((await c.post('/api/coach/reply', { message: 'Hi there' })).data.logged, false);
  assert.deepEqual(store.readStyleReads(ws.id).map(x => [x.audienceId, x.style]), [[aud, 'S']]);
  const cal = (await c.get('/api/comms/calibration')).data.calibration.find(x => x.audienceId === aud);
  assert.deepEqual([cal.total, cal.counts.S], [1, 1]);
  const exp = (await c.get('/api/data/export')).data;
  assert.equal((Buffer.isBuffer(exp) ? JSON.parse(exp.toString()) : exp).messageStyleReads.length, 1, 'in the data download');
});

test('voice: the audience’s style adds pacing to the agent’s own voice setting', async () => {
  const { voiceInstructions } = await import('../stages/voice.js');
  const cfg = setup(6);
  assert.equal(voiceInstructions(cfg, ''), cfg.voice.ttsStyle);
  assert.match(voiceInstructions(cfg, 'SC'), /Slow, gentle and reassuring/);
  assert.ok(voiceInstructions(cfg, 'D').startsWith(cfg.voice.ttsStyle));
});

test('models: each job can use its own model, falling back to OPENAI_MODEL', async () => {
  const { modelFor, DEFAULT_MODEL } = await import('../lib/ai.js');
  const keep = { ...process.env };
  try {
    delete process.env.OPENAI_MODEL; delete process.env.OPENAI_HOOK_MODEL; delete process.env.OPENAI_CRITIC_MODEL;
    assert.equal(modelFor('critic'), DEFAULT_MODEL);
    process.env.OPENAI_MODEL = 'writer-x';
    assert.deepEqual([modelFor('writer'), modelFor('hooks'), modelFor('critic')], ['writer-x', 'writer-x', 'writer-x']);
    process.env.OPENAI_CRITIC_MODEL = 'critic-y'; process.env.OPENAI_HOOK_MODEL = 'hooks-z';
    assert.deepEqual([modelFor('writer'), modelFor('hooks'), modelFor('critic')], ['writer-x', 'hooks-z', 'critic-y']);
  } finally { Object.assign(process.env, keep); for (const k of ['OPENAI_MODEL', 'OPENAI_HOOK_MODEL', 'OPENAI_CRITIC_MODEL']) if (!(k in keep)) delete process.env[k]; }
});

test('structured outputs: a schema is sent, and a model without support falls back to JSON mode once', async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const ch of req) raw += ch;
    const body = JSON.parse(raw); seen.push({ model: body.model, type: body.response_format.type, name: body.response_format.json_schema?.name, strict: body.response_format.json_schema?.strict });
    if (body.model === 'old-model' && body.response_format.type === 'json_schema') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model." } })); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '{"caption":"ok"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    const { chatJSON } = await import('../lib/ai.js');
    const msgs = [{ role: 'user', content: 'x' }];
    assert.equal(await chatJSON({ messages: msgs, model: 'new-model', schema: P.postSchema() }), '{"caption":"ok"}');
    assert.deepEqual(seen.at(-1), { model: 'new-model', type: 'json_schema', name: 'post', strict: true });
    await chatJSON({ messages: msgs, model: 'old-model', schema: P.postSchema() });
    assert.deepEqual(seen.slice(-2).map(x => x.type), ['json_schema', 'json_object'], 'tried, then fell back');
    await chatJSON({ messages: msgs, model: 'old-model', schema: P.postSchema() });
    assert.equal(seen.at(-1).type, 'json_object', 'remembered: no second failed try');
    await chatJSON({ messages: msgs, model: 'new-model' });
    assert.equal(seen.at(-1).type, 'json_object', 'no schema, plain JSON mode');
    process.env.OPENAI_STRUCTURED = 'off';
    await chatJSON({ messages: msgs, model: 'new-model', schema: P.postSchema() });
    assert.equal(seen.at(-1).type, 'json_object', 'OPENAI_STRUCTURED=off');
  } finally { delete process.env.OPENAI_STRUCTURED; process.env.OPENAI_BASE_URL = base; srv.close(); }
  // An invalid schema is a bug to report, not a reason to quietly drop structured outputs.
  const bad = http.createServer(async (req, res) => { for await (const _ of req); res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: "Invalid schema for response_format 'post': required is missing." } })); });
  await new Promise(r => bad.listen(0, '127.0.0.1', r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${bad.address().port}/v1`;
  try {
    const { chatJSON } = await import('../lib/ai.js');
    await assert.rejects(chatJSON({ messages: [{ role: 'user', content: 'x' }], model: 'third-model', schema: P.postSchema() }), /Invalid schema/);
  } finally { process.env.OPENAI_BASE_URL = base; bad.close(); }
  // Strict schemas: every field required, nothing extra allowed.
  const strictOk = s => s.type !== 'object' || (s.additionalProperties === false && Object.keys(s.properties).every(k => s.required.includes(k)) && Object.values(s.properties).every(v => strictOk(v.type === 'array' ? v.items : v)));
  const cfg = setup(6); cfg.output.mode = 'voiceover';
  for (const sc of [P.scriptSchema(cfg), P.hookSchema(cfg), P.hookCriticSchema(), P.criticSchema({}), P.postSchema()]) assert.ok(strictOk(sc.schema), sc.name);
  assert.ok(P.scriptSchema(cfg).schema.properties.scenes.items.required.includes('say'));
  assert.ok(!P.scriptSchema(setup(6)).schema.properties.scenes.items.required.includes('say'));
});

test('script writing: each step goes to its job’s model with its reply shape', async () => {
  const { generateScript } = await import('../stages/script.js');
  const cfg = setup(6);
  const calls = [];
  const real = (await import('../stages/script.js')).makeAsk(null);
  const ask = async (messages, t, opts = {}) => { calls.push([opts.job, opts.schema?.name]); return real(messages, t, opts); };
  const r = await generateScript({ cfg, ask, log: () => {} });
  assert.ok(r.scenes.length === 6);
  const jobs = new Set(calls.map(c => c.join(':')));
  for (const j of ['hooks:hooks', 'critic:hook_ranking', 'writer:script', 'critic:draft_scores', 'writer:post']) assert.ok(jobs.has(j), j + ' in ' + [...jobs]);
  assert.ok(['classic', ...Object.keys(M.STRUCTURES)].includes(r.meta.structure));
  assert.ok(r.remember.structure && r.remember.bridgeStyle && r.remember.ctaStyle);
  // "Straight to you" has no bridge, so nothing is remembered as one.
  const nb = await generateScript({ cfg: setup(7), ask, log: () => {}, picks: M.roll(setup(7), seeded(8), [], { structure: 'nobridge', format: 'question' }), withPost: false });
  assert.equal(nb.remember.bridge, '');
  assert.equal(nb.meta.structure, 'nobridge');
});

test('overnight videos write one draft unless OVERNIGHT_DRAFTS says otherwise', async () => {
  const { overnightDrafts } = await import('../pipeline.js');
  assert.equal(overnightDrafts(), 1);
  process.env.OVERNIGHT_DRAFTS = '2'; assert.equal(overnightDrafts(), 2);
  process.env.OVERNIGHT_DRAFTS = '9'; assert.equal(overnightDrafts(), 3);
  delete process.env.OVERNIGHT_DRAFTS;
  const src = fs.readFileSync(path.join(ROOT, 'pipeline.js'), 'utf8');
  assert.match(src, /source === 'overnight'\) cfg\.output\.drafts = Math\.min\(cfg\.output\.drafts, overnightDrafts\(\)\)/);
});

test('golden set: fixed cases, saved runs, and a side-by-side page', async () => {
  const G = await import('../lib/golden.js');
  const cfg = setup(6);
  const a = G.goldenCases(cfg, 6), b = G.goldenCases(cfg, 6);
  assert.deepEqual(a.map(c => [c.picks.insight.id, c.picks.format, c.picks.structure]), b.map(c => [c.picks.insight.id, c.picks.format, c.picks.structure]), 'same cases every time');
  let n = 0;
  const generate = async ({ picks }) => { if (n++ === 2) throw new Error('No draft passed the checks.'); return { scenes: [{ text: `Line for ${picks.format}` }], scores: [{ draft: 1, hook: 4, flow: 5, fresh: 3 }], chosen: 1 }; };
  const one = await G.runGolden({ cfg, generate, count: 6, label: 'before', log: () => {} });
  assert.ok(fs.existsSync(one.file));
  const { docKey } = await import('../lib/paths.js');
  assert.equal(docKey(one.file), null, 'golden runs stay plain files, even with SQLite');
  assert.equal(one.run.cases.filter(c => c.ok).length, 5);
  assert.equal(one.run.cases[2].ok, false);
  process.env.OPENAI_MODEL = 'model-b';
  const two = await G.runGolden({ cfg, generate, count: 6, label: 'after', log: () => {}, now: new Date(Date.now() + 60000) });
  delete process.env.OPENAI_MODEL;
  assert.equal(two.run.models.writer, 'model-b');
  const html = G.compareHtml(one.run, two.run);
  assert.match(html, /Case 1/); assert.match(html, /Didn’t pass the checks/); assert.match(html, /model-b/); assert.match(html, /hook 4\.0, flow 5\.0, fresh 3\.0/);
  // The terminal command writes the page next to the second file.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), 'golden-compare', one.file, two.file], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(two.file.replace(/\.json$/, '-compare.html')));
  assert.notEqual(spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), 'golden', 'nope'], { env: process.env, encoding: 'utf8' }).status, 0);
});

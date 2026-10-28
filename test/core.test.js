// The engine: compliance checks, confirmed-facts gate, templates, migration and the post text rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, PLATFORM_GUARDRAILS, QUALIFIER_GROUPS, migrate, roll, validateScript, validatePost,
  checkInsightText, insightStatus, countMixes, guardrailsFor, roleFor, analyze,
} from '../mixer-core.js';
import { buildPrompt } from '../lib/prompts.js';
import { STARTER_TOPICS, starterStory } from '../templates.js';

const now = new Date().toISOString();
function cfgWith(products = ['final_expense'], confirm = true) {
  const c = migrate(DEFAULT_CONFIG);
  c.story = { ...c.story, ...starterStory(products) };
  if (confirm) c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = now; });
  c.look.name = 'Jane Smith'; c.look.location = 'Gallup, NM';
  return c;
}
const picksFor = (c, insightId) => {
  const insight = c.story.insights.find(i => i.id === insightId);
  const solution = c.story.solutions.find(s => s.links.includes(insightId));
  return { insight, solution, recent: [] };
};
// A script that passes every rule for t_health_f ("Many final expense policies ask a few health questions…").
const good = () => ({ scenes: [
  { text: 'Worried your health will get you turned down?', accent: 'health', keyword: 'older woman kitchen table' },
  { text: 'Many final expense policies ask a few health questions', accent: 'health questions', keyword: 'senior man reading letter' },
  { text: 'instead of requiring a medical exam.', accent: 'medical exam', keyword: 'older couple at home' },
  { text: 'A final expense policy that may skip the exam.', accent: 'skip', keyword: 'grandmother smiling' },
  { text: 'What fits you depends on your own situation?', accent: 'your own', keyword: 'senior woman thinking' },
  { text: 'Message me and we can look at your options.', accent: 'your options', keyword: 'woman on phone' },
] });

test('a clean script passes', () => {
  const c = cfgWith();
  const r = validateScript(good(), c, picksFor(c, 't_health_f'));
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test('scripts are blocked for compliance problems', () => {
  const c = cfgWith(), p = picksFor(c, 't_health_f');
  const cases = [
    [2, 'Everyone qualifies with no medical exam.', /banned phrase "everyone qualifies"|absolute claim/],
    [2, 'It works with your Medicare benefits.', /government-backed/],
    [2, 'One of my clients saved a lot this way.', /banned phrase/],
    [2, 'Only $9 a month for most people.', /price or percentage/],
    [2, 'You will qualify, guaranteed.', /qualify|guaranteed/],
    [2, 'Policies ask a few health questions!', /exclamation/],
  ];
  for (const [i, text, re] of cases) {
    const s = good(); s.scenes[i] = { ...s.scenes[i], text, accent: text.split(' ')[1] };
    const r = validateScript(s, c, p);
    assert.equal(r.ok, false, text);
    assert.match(r.problems.join(' '), re, text);
  }
});

test('the insight’s qualifier must stay, on screen', () => {
  const c = cfgWith(), p = picksFor(c, 't_health_f');
  const s = good();
  s.scenes[1] = { ...s.scenes[1], text: 'Final expense policies ask a few health questions', accent: 'health questions' };
  assert.match(validateScript(s, c, p).problems.join(' '), /qualifier/);
});

test('a required disclosure must be said (waiting period)', () => {
  const c = cfgWith(), p = picksFor(c, 't_turned_f');
  assert.equal(p.solution.mustMention, 'waiting period');
  const s = good();
  s.scenes[1] = { text: 'Policies that accept almost anyone usually', accent: 'almost anyone', keyword: 'older man at home' };
  s.scenes[2] = { text: 'pay the full benefit later.', accent: 'later', keyword: 'senior couple porch' };
  assert.match(validateScript(s, c, p).problems.join(' '), /must be named with "waiting period"/);
  s.scenes[3] = { text: 'There is a waiting period with this one.', accent: 'waiting', keyword: 'grandmother smiling' };
  assert.doesNotMatch(validateScript(s, c, p).problems.join(' '), /waiting period/);
});

test('questions only in the hook and the bridge', () => {
  const c = cfgWith(), s = good();
  s.scenes[3] = { ...s.scenes[3], text: 'Is a smaller policy the answer?', accent: 'smaller' };
  assert.match(validateScript(s, c, picksFor(c, 't_health_f')).problems.join(' '), /Scene 4 is a question/);
});

test('every starter topic passes the platform rules and has one qualifier group', () => {
  for (const t of STARTER_TOPICS) {
    assert.deepEqual(checkInsightText(t.fact), [], t.id);
    const words = t.fact.toLowerCase().match(/[a-z’']+/g);
    assert.equal(QUALIFIER_GROUPS.filter(g => g.some(q => words.includes(q))).length, 1, `${t.id} qualifier`);
    assert.equal(t.confirmed, false, 'starter topics start unchecked');
    assert.ok(t.worry && t.question && t.offer, t.id);
  }
  const all = cfgWith();
  assert.equal(countMixes(all), STARTER_TOPICS.length);
  assert.deepEqual(analyze(all).warnings.filter(w => ['route', 'clash'].includes(w.kind)), []);
});

test('only confirmed facts reach a video', () => {
  const c = cfgWith(['final_expense'], false);
  assert.equal(countMixes(c), 0);
  assert.ok(!roll(c).insight);
  assert.match(roll(c).breaks.join(' '), /No confirmed topics/);
  const one = c.story.insights.find(i => i.id === 't_same_f');
  one.confirmed = true; one.confirmedAt = now;
  for (let k = 0; k < 20; k++) assert.equal(roll(c).insight.id, 't_same_f');
  one.confirmedAt = '';
  assert.equal(insightStatus(one), 'unconfirmed', 'ticked but not saved yet');
  assert.equal(countMixes(c), 0);
});

test('a chosen topic is honored', () => {
  const c = cfgWith();
  for (let k = 0; k < 10; k++) assert.equal(roll(c, Math.random, [], { painId: 't_health' }).painPoint.id, 't_health');
});

test('the local format needs a city', () => {
  const c = cfgWith(); c.output.formats = ['local']; c.look.location = '';
  assert.notEqual(roll(c).format, 'local');
  c.look.location = 'Gallup, NM';
  assert.equal(roll(c).format, 'local');
  assert.match(buildPrompt(c, roll(c)).user, /Here in Gallup/);
});

test('a v6 single-agent config upgrades without losing content', () => {
  const v6 = { version: 6, story: { audiences: [{ id: 'a1', text: 'Seniors', visual: 'older adults' }], painPoints: [{ id: 'p1', text: 'Worry', links: ['a1'], question: 'q' }],
    insights: [{ id: 'i1', text: 'Policies that accept almost anyone usually have a waiting period before the full benefit is paid.', links: ['p1'] }],
    solutions: [{ id: 's3', text: 'Guaranteed acceptance', plain: 'a policy that accepts almost anyone, with a waiting period', links: ['i1'] }], ctaAction: 'Message me, your local licensed agent' },
    guardrails: { mustUse: ['licensed agent'], neverUse: ['guaranteed', 'cheapest', 'my own rule'], mustDo: ['Make clear that coverage depends on qualifying', 'Speak as Jane'], neverDo: [] },
    look: { name: 'Jane Smith', title: 'Licensed Agent', location: 'Gallup, NM' }, output: { scenes: 6 }, voice: { role: 'Custom role' } };
  const c = migrate(v6);
  assert.equal(c.version, 14);
  assert.equal(c.story.insights[0].confirmed, false, 'facts need confirming once');
  assert.equal(c.story.solutions[0].mustMention, 'waiting period');
  assert.deepEqual(c.guardrails.neverUse, ['my own rule'], 'platform rules no longer duplicated');
  assert.deepEqual(c.guardrails.mustDo, ['Speak as Jane']);
  assert.ok(guardrailsFor(c).neverUse.includes('guaranteed'), 'platform rules still apply');
  assert.equal(c.voice.role, 'Custom role');
  assert.equal(migrate({ version: 3, strategy: {} }).version, 14);
});

test('the role line reads well with and without details', () => {
  assert.match(roleFor({ name: 'Jane Smith', title: 'Licensed Agent', location: 'Gallup, NM', about: 'a mom running my own business', clients: 'retirees' }), /Jane Smith, a licensed agent who sells life insurance in Gallup, NM\. In Jane’s own words/);
  assert.doesNotMatch(roleFor({}), /undefined|  /);
});

test('post text: first line length, banned words, disclaimer', () => {
  const c = cfgWith();
  const p = picksFor(c, 't_health_f');
  assert.equal(validatePost(JSON.stringify({ caption: 'Health questions instead of an exam?\nMany policies work this way. Message me.\n#GallupNM #LifeInsurance' }), c, p).ok, true);
  assert.match(validatePost(JSON.stringify({ caption: 'x'.repeat(130) + '\nMore.' }), c, p).problems.join(' '), /first line/);
  assert.match(validatePost(JSON.stringify({ caption: 'A state-approved burial benefit.' }), c, p).problems.join(' '), /government-backed/);
  c.look.disclaimer = 'Licensed in NM.';
  assert.match(validatePost(JSON.stringify({ caption: 'Hello there.' }), c, p).problems.join(' '), /Licensed in NM/);
});

test('platform rules are in every prompt', () => {
  const c = cfgWith();
  c.guardrails = { mustUse: [], neverUse: [], mustDo: [], neverDo: [] };
  const u = buildPrompt(c, roll(c)).user;
  PLATFORM_GUARDRAILS.neverUse.forEach(w => assert.ok(u.includes(`"${w}"`), w));
  assert.match(u, /government connection/);
});

test('formats pick the facts and material they need', () => {
  const c = cfgWith();
  // A topic teaches one fact, so formats that need two facts aren't picked; no confirmed story, no mini-story.
  for (let k = 0; k < 10; k++) assert.notEqual(roll(c, Math.random, [], { format: 'list', painId: 't_work' }).format, 'list');
  assert.notEqual(roll(c, Math.random, [], { format: 'story' }).format, 'story');
  c.bank.stories = [{ id: 'st1', text: 'When my dad passed, we had no plan for the funeral.', confirmed: false, links: [] }];
  assert.notEqual(roll(c, Math.random, [], { format: 'story' }).format, 'story', 'unconfirmed stories are never used');
  c.bank.stories[0].confirmed = true;
  const st = roll(c, Math.random, [], { format: 'story' });
  assert.equal(st.format, 'story'); assert.equal(st.story.id, 'st1');
  assert.match(buildPrompt(c, st).user, /true story/);
});

test('hooks and scripts are checked for overused wording and the chosen opening', async () => {
  const { validateHook, clicheHits } = await import('../mixer-core.js');
  const c = cfgWith(), p = picksFor(c, 't_health_f');
  assert.deepEqual(clicheHits('Get peace of mind and don’t wait'), ['peace of mind', "don't wait"]);
  assert.deepEqual(validateHook({ text: 'Worried your health will get you turned down?' }, c, p), []);
  assert.ok(validateHook({ text: 'Everyone qualifies with no exam' }, c, p).length);
  assert.ok(validateHook({ text: 'Find peace of mind today' }, c, p).length);
  const s = good();
  assert.equal(validateScript(s, c, { ...p, hook: { text: s.scenes[0].text } }).ok, true);
  assert.match(validateScript(s, c, { ...p, hook: { text: 'A different opening.' } }).problems.join(' '), /chosen opening/);
  s.scenes[3] = { ...s.scenes[3], text: 'It gives you peace of mind.', accent: 'peace' };
  assert.match(validateScript(s, c, p).problems.join(' '), /overused ad wording/);
});

test('posted results gently boost topics and formats', async () => {
  const { boostsFrom } = await import('../mixer-core.js');
  const v = (painId, format, messages) => ({ status: 'posted', meta: { painId, format }, results: { views: 100, messages } });
  const b = boostsFrom([v('p1', 'myth', 4), v('p1', 'myth', 2), v('p2', 'list', 0), v('p2', 'list', 0), v('p3', 'story', 9)]);
  assert.ok(b.pains.p1 > 1 && b.pains.p1 <= 2.5);
  assert.equal(b.pains.p2, 1);
  assert.equal(b.pains.p3, undefined, 'one video is not enough to count');
});

test('a v8 config gains the new formats and an empty voice bank', () => {
  const c = migrate({ version: 8, output: { formats: ['question', 'myth'] }, story: {}, bank: { stories: [{ text: 'x', confirmed: 1 }, null] } });
  assert.deepEqual(c.output.formats, ['question', 'myth', 'list', 'mistake', 'compare', 'story']);
  assert.equal(c.bank.stories.length, 1); assert.equal(c.bank.stories[0].confirmed, true); assert.ok(c.bank.stories[0].id);
  assert.deepEqual(c.bank.samples, []);
});

test('says exactly why no video can be made yet', async () => {
  const { whyNoVideos } = await import('../mixer-core.js');
  const c = cfgWith();
  assert.equal(whyNoVideos(c), null);
  assert.match(whyNoVideos(migrate(cfgWith([], false))).msg, /None of your topics are checked/);
  assert.match(whyNoVideos(migrate(DEFAULT_CONFIG)).msg, /Add a topic/);
});

test('facts that read as promises get a gentle note, not a block', async () => {
  const { factNotes } = await import('../mixer-core.js');
  assert.equal(factNotes('Final expense covers basic funeral costs').length, 1);
  assert.deepEqual(factNotes('Final expense usually covers basic funeral costs'), []);
  assert.deepEqual(factNotes('Rates are $5 a month'), [], 'hard problems are reported elsewhere');
});

test('applying coach suggestions changes a copy of the config', async () => {
  const { applySuggestionTo } = await import('../mixer-core.js');
  const c = cfgWith();
  const f = c.story.insights[0];
  const e = applySuggestionTo(c, { type: 'edit_fact', id: f.id, text: f.text + ' Many people find this helps.' });
  assert.equal(c.story.insights[0].confirmed, true, 'the input is untouched');
  assert.equal(e.story.insights[0].confirmed, false, 'reworded facts need confirming again');
  // A fact for another worry is a new topic: that worry with this fact, to check again.
  const l = applySuggestionTo(c, { type: 'link_fact', id: f.id, painIds: ['t_work'] });
  assert.equal(l.topics[0].fact, f.text); assert.equal(l.topics[0].worry, c.story.painPoints.find(p => p.id === 't_work').text); assert.equal(l.topics[0].confirmed, false);
  const s = applySuggestionTo(c, { type: 'add_search', audienceId: c.story.audiences[0].id, text: 'older woman garden' });
  assert.deepEqual(s.story.audiences[0].searches, ['older woman garden']);
  assert.match(buildPrompt(s, { ...picksFor(s, 't_health_f'), audience: s.story.audiences[0] }).user, /older woman garden/);
  assert.throws(() => applySuggestionTo(c, { type: 'nope' }));
});

test('openings that brought messages guide new hooks', async () => {
  const { winnersFrom } = await import('../mixer-core.js');
  const { buildHookPrompt } = await import('../lib/prompts.js');
  const vids = [
    { status: 'posted', scenes: [{ text: 'Mom never talked about it.' }], results: { messages: 3, views: 200 } },
    { status: 'posted', scenes: [{ text: 'No messages here.' }], results: { messages: 0, views: 9000 } },
    { status: 'approved', scenes: [{ text: 'Not posted.' }] },
  ];
  const w = winnersFrom(vids);
  assert.deepEqual(w.map(x => x.hook), ['Mom never talked about it.']);
  const c = cfgWith();
  assert.match(buildHookPrompt(c, { ...picksFor(c, 't_health_f'), winners: w }).user, /OPENINGS THAT WORKED FOR JANE: THEY BROUGHT MESSAGES OR WON A TEST[\s\S]*Mom never talked about it\."\s\(3 messages\)/);
});

test('the example scripts pass the checks they teach: short, plain, no numbers, banned words or ad phrases', async () => {
  const { EXAMPLES, exampleFor } = await import('../lib/prompts.js');
  const { clicheHits, countWords } = await import('../mixer-core.js');
  const banned = guardrailsFor(migrate(DEFAULT_CONFIG)).neverUse;
  for (const e of EXAMPLES) {
    assert.equal(e.scenes.length, 6, e.id);
    e.scenes.forEach((l, i) => {
      assert.ok(countWords(l) <= 10, `${e.id} ${i + 1}: ${countWords(l)} words`);
      assert.deepEqual(clicheHits(l), [], `${e.id} ${i + 1}`);
      assert.ok(!/\d|\$|%/.test(l), `${e.id} ${i + 1}: no numbers`);
      assert.ok(!banned.some(b => l.toLowerCase().includes(b)), `${e.id} ${i + 1}: banned word`);
      if (i > 0 && i < 4) assert.ok(!l.endsWith('?'), `${e.id} ${i + 1}: only the hook asks`);
    });
  }
  // The example is on another subject than the video.
  assert.notEqual(exampleFor({ painPoint: { text: 'I have coverage through work.' } }).id, 'work');
  assert.notEqual(exampleFor({ insight: { text: 'Many policies ask a few health questions.' } }).id, 'health');
});

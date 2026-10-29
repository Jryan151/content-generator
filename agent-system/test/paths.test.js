import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePath, actionsFor, redList, weekStatus, PATHS, PARKED_PATHS } from '../src/paths.js';
import { todoFor, planDown, productionRed } from '../src/routines.js';
import { buildActivities, TZ, LEADER, DEVON, TASHA, MARCUS } from '../seed/sample.js';

const acts = buildActivities();
const team = [
  { id: DEVON, name: 'Devon', startedOn: '2026-05-01', coach: 'Devon' },
  { id: TASHA, name: 'Tasha', startedOn: '2026-07-15', coach: 'Devon' },
  { id: MARCUS, name: 'Marcus', startedOn: '2026-10-05', coach: 'Devon' },
];
const plan = { daily: { dials: 15, posts: 1 }, weekly: { appts: 3 } };

test('one yes/no answer picks exactly one of the two paths', () => {
  assert.equal(choosePath({ hasAgents: false }), 'producer');
  assert.equal(choosePath({ hasAgents: true }), 'coach');
  assert.equal(choosePath({ hasAgents: true, hasCoach: true }), 'coach', 'Director is parked: never chosen at setup');
  assert.throws(() => choosePath({ hasAgents: 'maybe' }), /yes or no/);
  assert.deepEqual(Object.keys(PATHS), ['producer', 'coach']);
  assert.deepEqual(Object.keys(PARKED_PATHS), ['director']);
});

test('every path has a full day, and the days are different', () => {
  const p = planDown({ yearlyPremium: 96_000 });
  const ids = {};
  for (const path of [...Object.keys(PATHS), ...Object.keys(PARKED_PATHS)]) {
    const list = todoFor('2026-10-28', { role: 'builder', path, plan: p });
    assert.ok(list.length >= 5, `${path} has ${list.length} items`);
    assert.deepEqual(list.map((t) => t.at), [...list.map((t) => t.at)].sort(), `${path} is in time order`);
    ids[path] = list.map((t) => t.id);
  }
  assert.ok(ids.producer.includes('p-dials') && ids.coach.includes('c-dials'));
  assert.ok(ids.producer.includes('p-names') && ids.coach.includes('c-recruit'), 'each path has one recruiting step');
  assert.ok(!ids.director.some((id) => id.includes('dials')), 'directors have no dial block');
  assert.ok(ids.coach.includes('c-coach') && !ids.coach.includes('c-noon'), 'the Team ranking replaced the noon check');
});

test('a leader without a path is told to pick one', () => {
  assert.throws(() => todoFor('2026-10-28', { role: 'builder' }), /needs a path/);
});

test('coach at noon: the agent with zero dials gets named', () => {
  const out = actionsFor({ path: 'coach', dayKey: '2026-10-14', now: '12:05', selfId: LEADER, team, plan, activities: acts, tz: TZ });
  const noon = out.filter((a) => a.rule === 'noon-zero');
  assert.deepEqual(noon.map((a) => a.who), ['Marcus']);
  assert.equal(noon.at(0).text, 'Send Marcus the noon message. Zero dials so far.');
});

test('director at noon: the same problem is routed to the coach, not handled personally', () => {
  const out = actionsFor({ path: 'director', dayKey: '2026-10-14', now: '12:05', selfId: LEADER, team, plan, activities: acts, tz: TZ });
  assert.equal(out.find((a) => a.rule === 'noon-zero').text, 'Tell Devon to call Marcus. Zero dials at noon.');
  assert.ok(!out.some((a) => a.rule === 'add-dial-block' || a.rule === 'post-now'), 'directors get no production rules');
});

test('before noon, nothing fires for the team', () => {
  const out = actionsFor({ path: 'coach', dayKey: '2026-10-14', now: '09:30', selfId: LEADER, team, plan, activities: acts, tz: TZ });
  assert.ok(!out.some((a) => a.rule === 'noon-zero'));
});

test('producer gets only rules about their own day; the post reminder is opt-in', () => {
  const quiet = [{ agent_id: LEADER, type: 'dial', occurred_at: '2026-10-14T16:00:00Z' }];
  const out = actionsFor({ path: 'producer', dayKey: '2026-10-14', now: '12:30', selfId: LEADER, team, plan, activities: quiet, tz: TZ });
  assert.deepEqual(out.map((a) => a.rule), ['add-dial-block']);
  assert.match(out.find((a) => a.rule === 'add-dial-block').text, /14 dials left/);
  const withContent = actionsFor({ path: 'producer', dayKey: '2026-10-14', now: '12:30', selfId: LEADER, team, plan, activities: quiet, tz: TZ, thresholds: { postBy: '10:00' } });
  assert.deepEqual(withContent.map((a) => a.rule).sort(), ['add-dial-block', 'post-now']);
});

test('production comes first: red dials hide the day’s recruiting step', () => {
  const p = planDown({ yearlyPremium: 96_000 }); // 22 dials a day
  const dials = (n) => Array.from({ length: n }, (_, i) => ({ agent_id: LEADER, type: 'dial', occurred_at: `2026-10-14T17:${String(i).padStart(2, '0')}:00Z` }));
  const ids = (acts, now) => todoFor('2026-10-14', { role: 'builder', path: 'coach', plan: p, activities: acts, agentId: LEADER, tz: TZ, now }).map((t) => t.id);
  assert.ok(ids(dials(5), '10:00').includes('c-recruit'), 'before the dial block ends, nothing is red yet');
  assert.ok(!ids(dials(5), '10:45').includes('c-recruit'), '5 of 22 after the block: recruiting waits');
  assert.ok(ids(dials(16), '10:45').includes('c-recruit'), '16 of 22 is at least 70%: green');
  assert.equal(productionRed({ path: 'producer', plan: p, dialsDone: 10, now: '11:00' }), true);
  assert.equal(productionRed({ path: 'producer', plan: p, dialsDone: 10, now: '10:59' }), false);
});

test('Friday: a red week means a 1:1; red two weeks running means a decision', () => {
  const out = actionsFor({ path: 'coach', dayKey: '2026-10-16', now: '15:00', selfId: LEADER, team, plan, activities: acts, tz: TZ });
  const marcus = out.filter((a) => a.who === 'Marcus');
  assert.ok(marcus.some((a) => a.rule === 'week-red'), JSON.stringify(marcus));

  const ts = (d) => `2026-10-${d}T17:00:00Z`;
  const goodEarlier = [5, 6, 7].map((d) => ({ agent_id: TASHA, type: 'appt_set', occurred_at: ts(String(d).padStart(2, '0')) }));
  const twoWeeksRed = actionsFor({ path: 'coach', dayKey: '2026-10-23', now: '15:00', selfId: LEADER, team: [team[1]], plan, activities: goodEarlier, tz: TZ });
  assert.equal(twoWeeksRed.at(0).rule, 'red-two-weeks');
  assert.equal(twoWeeksRed.at(0).priority, 0);
});

test('new agent who skipped training gets a call; veterans do not', () => {
  const out = actionsFor({ path: 'coach', dayKey: '2026-10-20', now: '16:45', selfId: LEADER, team, plan, activities: acts, tz: TZ });
  const skipped = out.filter((a) => a.rule === 'training-skipped').map((a) => a.who);
  assert.deepEqual(skipped, ['Marcus']);
});

test('weekends are quiet', () => {
  assert.deepEqual(actionsFor({ path: 'coach', dayKey: '2026-10-17', now: '12:30', selfId: LEADER, team, plan, activities: acts, tz: TZ }), []);
});

test('red list shows only agents under pace, nobody green', () => {
  const red = redList({ team, dayKey: '2026-10-16', tz: TZ, plan, activities: acts });
  assert.ok(red.every((a) => a.status === 'red'));
  assert.ok(red.some((a) => a.name === 'Marcus'));
  const wk = weekStatus(acts, { agentId: MARCUS, dayKey: '2026-10-16', tz: TZ, weeklyAppts: 3 });
  assert.equal(wk.weekKey, 'W:2026-10-12');
  assert.equal(wk.appts, 0);
});

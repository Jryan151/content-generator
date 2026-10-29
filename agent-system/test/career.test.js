import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOnLadder, weeksWithASale, routineFor, isUnlocked, STAGES, FOCUS_TOP } from '../src/career.js';
import { todoFor, planDown } from '../src/routines.js';
import { buildActivities, TZ, LEADER, DEVON, TASHA, MARCUS } from '../seed/sample.js';

const ME = '00000000-0000-4000-8000-0000000000aa';
const DAY = '2026-10-28'; // Wednesday; completed weeks before it start Oct 19, Oct 12, …
const MONDAYS = ['2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31'];
const salesIn = (n, who = ME, list = MONDAYS) => list.slice(0, n).map((d) => ({ agent_id: who, type: 'app_written', value: 600, occurred_at: `${d}T18:00:00Z` }));
const plan = planDown({ yearlyPremium: 96_000 });

test('one ladder, and every stage says why', () => {
  assert.deepEqual(STAGES.map((s) => s.id), ['starting', 'selling', 'producer', 'coach', 'director', 'upline']);
  assert.ok(STAGES.every((s) => s.why.length > 20));
  assert.equal(STAGES[2].focus, 'Make your selling copyable.');
});

test('no sale yet → Starting, with a daily training block', () => {
  const r = placeOnLadder({ person: { id: ME }, activities: [{ agent_id: ME, type: 'dial', occurred_at: '2026-10-27T17:00:00Z' }], dayKey: DAY, tz: TZ });
  assert.equal(r.stage, 'starting');
  assert.ok(todoFor(DAY, { ...routineFor(r.stage), plan }).some((t) => t.id === 'a-training'));
});

test('some weeks with a sale → Selling, with the exact gap', () => {
  const r = placeOnLadder({ person: { id: ME }, activities: salesIn(2), dayKey: DAY, tz: TZ });
  assert.equal(r.stage, 'selling');
  assert.equal(r.nextAction, 'Sell in 2 more weeks to reach Producer.');
});

test('trying to build before selling steadily → building waits, and it says why', () => {
  const r = placeOnLadder({ person: { id: ME }, team: [{ id: 'recruit-1' }], activities: salesIn(2), dayKey: DAY, tz: TZ });
  assert.equal(r.stage, 'selling');
  assert.equal(r.slipped, true);
  assert.match(r.nextAction, /building waits/);
});

test('steady sales → Producer: make it copyable; recruiting is still locked', () => {
  const r = placeOnLadder({ person: { id: ME }, activities: salesIn(5), dayKey: DAY, tz: TZ });
  assert.equal(r.stage, 'producer');
  assert.equal(r.gate.to, 'Coach');
  assert.match(r.nextAction, /Keep selling every week: 5 of the last 8/);
  assert.equal(isUnlocked('producer', 'Recruiting pipeline'), false);
  assert.equal(isUnlocked('producer', 'Names list'), true);
  assert.equal(isUnlocked('coach', 'Recruiting pipeline'), true);
});

test('steady for 8 weeks but no Playbook → still Producer, told to write it', () => {
  const r = placeOnLadder({ person: { id: ME }, activities: salesIn(7), dayKey: DAY, tz: TZ });
  assert.equal(r.stage, 'producer');
  assert.match(r.nextAction, /Finish your Playbook/);
});

test('steady + Playbook → Coach, even before the first recruit', () => {
  const r = placeOnLadder({ person: { id: ME }, activities: salesIn(7), dayKey: DAY, tz: TZ, playbookReady: true });
  assert.equal(r.stage, 'coach');
  assert.equal(r.nextAction, 'Get 3 more agents to steady weekly sales. Start with whoever is closest on the red list.');
  assert.deepEqual(routineFor(r.stage), { role: 'builder', path: 'coach', starting: false });
});

const team = [{ id: DEVON, name: 'Devon' }, { id: TASHA, name: 'Tasha' }, { id: MARCUS, name: 'Marcus' }];
const NOV2 = '2026-11-02';

test('a leader is measured by the people under them (sample team)', () => {
  const withBook = placeOnLadder({ person: { id: LEADER }, team, activities: buildActivities(), dayKey: NOV2, tz: TZ, playbookReady: true, topStage: 'upline' });
  assert.equal(withBook.stage, 'director', 'three agents selling steadily, one at Producer or above');
  assert.equal(withBook.gate.to, 'Upline');
  const noBook = placeOnLadder({ person: { id: LEADER }, team, activities: buildActivities(), dayKey: NOV2, tz: TZ });
  assert.equal(noBook.stage, 'producer', 'a strong team still needs her selling written down before she builds more');
});

test('while Director is parked, the same leader stays at Coach with a plain next action', () => {
  const r = placeOnLadder({ person: { id: LEADER }, team, activities: buildActivities(), dayKey: NOV2, tz: TZ, playbookReady: true });
  assert.equal(FOCUS_TOP, 'coach');
  assert.equal(r.stage, 'coach');
  assert.equal(r.gate.to, 'Director');
  assert.equal(r.gate.parked, true);
  assert.match(r.nextAction, /Director is parked/);
  assert.deepEqual(routineFor(r.stage), { role: 'builder', path: 'coach', starting: false });
});

test('a coach is counted when someone under you becomes one', () => {
  const nested = [{ id: DEVON, name: 'Devon', playbookReady: true, team: [{ id: TASHA, name: 'Tasha' }, { id: MARCUS, name: 'Marcus' }, { id: 'x-agent', name: 'X' }] }];
  const extra = salesIn(8, 'x-agent', ['2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07']);
  const r = placeOnLadder({ person: { id: LEADER }, team: nested, activities: [...buildActivities(), ...extra], dayKey: NOV2, tz: TZ, playbookReady: true });
  assert.equal(r.metrics.coachesBuilt, 1);
});

test('a leader whose own selling drops below the hold line steps back to Selling focus', () => {
  const others = buildActivities().filter((a) => !(a.agent_id === LEADER && a.type === 'app_written'));
  const two = salesIn(2, LEADER, ['2026-10-19', '2026-10-12']);
  const r = placeOnLadder({ person: { id: LEADER }, team, activities: [...others, ...two], dayKey: NOV2, tz: TZ, playbookReady: true });
  assert.equal(r.stage, 'selling');
  assert.equal(r.slipped, true);
  assert.match(r.nextAction, /Your own selling slipped/);
});

test('a dip that stays above the hold line keeps a leader’s stage', () => {
  const others = buildActivities().filter((a) => !(a.agent_id === LEADER && a.type === 'app_written'));
  const three = salesIn(3, LEADER, ['2026-10-26', '2026-10-19', '2026-10-05']);
  const r = placeOnLadder({ person: { id: LEADER }, team, activities: [...others, ...three], dayKey: NOV2, tz: TZ, playbookReady: true, topStage: 'upline' });
  assert.equal(r.stage, 'director');
  const focused = placeOnLadder({ person: { id: LEADER }, team, activities: [...others, ...three], dayKey: NOV2, tz: TZ, playbookReady: true });
  assert.equal(focused.stage, 'coach');
});

test('only completed weeks count', () => {
  const thisWeek = [{ agent_id: ME, type: 'app_written', value: 600, occurred_at: '2026-10-27T18:00:00Z' }];
  assert.equal(weeksWithASale(thisWeek, { personId: ME, dayKey: DAY, tz: TZ, outOf: 6 }).count, 0);
});

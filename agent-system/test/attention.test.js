import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whoNeedsYou, teamSummary, quietWorkdays, weeklyLines } from '../src/attention.js';
import { daysInStage, dropRecruit, addRecruit, moveRecruit } from '../src/pipeline.js';

const TZ = 'America/Phoenix';
const DAY = '2026-10-29'; // a Thursday
const at = (d, t = '10:00') => new Date(`${d}T${t}:00-07:00`).toISOString();
const rows = (id, d, type, n = 1, extra = {}) => Array.from({ length: n }, () => ({ agent_id: id, type, occurred_at: at(d), ...extra }));

// The simulated day's team: Jay works, Kim went quiet Monday, Rosa books meetings that don't show,
// Ana has studied for 23 days with no exam, Dev is studying steadily.
const members = [
  { id: 'jay', name: 'Jay', startedOn: '2026-08-03', activities: [...rows('jay', '2026-10-28', 'dial', 40), ...rows('jay', DAY, 'dial', 30)] },
  { id: 'kim', name: 'Kim', startedOn: '2026-09-14', activities: rows('kim', '2026-10-23', 'dial', 35) },
  { id: 'rosa', name: 'Rosa', startedOn: '2026-09-28', activities: [
    ...rows('rosa', '2026-10-20', 'appt_set', 5, { meta: { meeting_on: '2026-10-21' } }), ...rows('rosa', '2026-10-21', 'appt_held', 1), ...rows('rosa', DAY, 'dial', 20)] },
  { id: 'ana', name: 'Ana', licensed: false, startedOn: '2026-10-06', activities: [...rows('ana', '2026-10-28', 'study_session', 1, { value: 30 }), ...rows('ana', '2026-10-27', 'practice_test', 1, { value: 71 })] },
  { id: 'dev', name: 'Dev', licensed: false, startedOn: '2026-10-19', activities: [...rows('dev', '2026-10-28', 'study_session', 1, { value: 30 }), ...rows('dev', DAY, 'study_session', 1, { value: 30 })] },
];

test('silence comes first, and needs no targets', () => {
  const r = whoNeedsYou({ members, dayKey: DAY, now: '15:00', tz: TZ, plan: null });
  assert.equal(r[0].id, 'kim');
  assert.equal(r[0].level, 'urgent');
  assert.match(r[0].reason, /Nothing logged for 4 workdays/);
  assert.match(r[0].action, /Call Kim today/);
});

test('each person gets the action that fits their actual problem', () => {
  const r = Object.fromEntries(whoNeedsYou({ members, dayKey: DAY, now: '15:00', tz: TZ }).map((x) => [x.id, x]));
  assert.match(r.rosa.action, /confirm every meeting the day before/);
  assert.match(r.ana.reason, /Studying 23 days, no exam booked/);
  assert.match(r.ana.action, /practice scores \(last 71\)\. Agree on an exam date/);
  assert.equal(r.dev.level, 'ok');
  assert.equal(r.jay.level, 'ok');
  assert.notEqual(r.jay.action, r.rosa.action, 'not the same advice for everyone');
});

test('quiet days skip weekends, and today counts only after noon', () => {
  assert.equal(quietWorkdays({ lastDay: '2026-10-23', dayKey: '2026-10-26', now: '09:00' }), 0, 'Friday to Monday morning: nothing missed yet');
  assert.equal(quietWorkdays({ lastDay: '2026-10-23', dayKey: '2026-10-26', now: '13:00' }), 1);
  assert.equal(quietWorkdays({ lastDay: null, dayKey: DAY, fallbackDay: '2026-10-26', now: '09:00' }), 2, 'never logged: counted from the day they joined');
});

test('a lapse outranks a no-show problem, and pace only counts with real targets', () => {
  const lapsed = { id: 'x', name: 'X', activities: [...rows('x', DAY, 'dial', 10), ...rows('x', '2026-10-20', 'chargeback', 1)] };
  assert.match(whoNeedsYou({ members: [lapsed], dayKey: DAY, now: '15:00', tz: TZ })[0].action, /four checks really done/);
});

test('the team summary: one ranking, stages, counts and a top', () => {
  const s = teamSummary({ members, dayKey: DAY, now: '15:00', tz: TZ });
  assert.equal(s.top.id, 'kim');
  assert.deepEqual(s.counts, { urgent: 1, watch: 2, ok: 2, resting: 0 });
  assert.equal(s.people.find((p) => p.id === 'ana').stage, 'licensing');
  assert.equal(s.stages.length, 5);
  assert.match(weeklyLines(s)[0], /5 people on your team: 1 need you now, 2 to watch, 2 on track/);
});

test('recruits know how long they have been in a stage, and can leave without being deleted', () => {
  const r = addRecruit({ id: 'r1', name: 'Ana' }, { builderId: 'B', at: '2026-10-06T17:00:00.000Z' }).recruit;
  const lic = moveRecruit(r, 'licensing', { builderId: 'B', at: '2026-10-06T17:00:00.000Z' }).recruit;
  assert.deepEqual(daysInStage(lic, DAY), { days: 23, stuck: true });
  assert.deepEqual(daysInStage({ ...lic, since: '2026-10-25T17:00:00.000Z' }, DAY), { days: 4, stuck: false });
  const gone = dropRecruit(lic, { builderId: 'B', at: '2026-10-29T17:00:00.000Z' });
  assert.equal(gone.recruit.stage, 'dropped');
  assert.equal(gone.recruit.droppedFrom, 'licensing');
  assert.equal(daysInStage(gone.recruit, DAY).stuck, false);
});

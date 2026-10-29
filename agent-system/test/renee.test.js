// The fixes from the six-month "Renee" stress test: a top producer who can't step away,
// with 5 licensed agents and 2 studying. Each test is one finding from that run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whoNeedsYou, teamSummary, applyCheckins, checkinRow, ownProduction, builderMeasure, logsAtNight } from '../src/attention.js';
import { logCall, logMeeting, approvePolicy, logCareCall, queueFor, addWorkdays } from '../src/calls.js';
import { placeOnLadder } from '../src/career.js';
import { todoFor } from '../src/routines.js';

const TZ = 'America/Phoenix';
const at = (d, t = '10:00') => new Date(`${d}T${t}:00-07:00`).toISOString();
const rows = (id, d, type, n = 1, extra = {}, t = '10:00') => Array.from({ length: n }, () => ({ agent_id: id, type, occurred_at: at(d, t), ...extra }));
const workdays = (from, to) => { const out = []; for (let k = from; k <= to; k = addWorkdays(k, 1)) out.push(k); return out; };
const daily = (id, from, to, type, n, extra = {}, t = '10:00') => workdays(from, to).flatMap((d) => rows(id, d, type, n, extra, t));

test('weekends are off: follow-ups, welcome and pre-draft calls land on workdays', () => {
  const FRI = '2026-10-30';
  const lead = { id: 'L', agent_id: 'me', name: 'A', stage: 'new' };
  assert.equal(logCall(lead, 'talked', { agentId: 'me', at: at(FRI), today: FRI }).lead.nextOn, '2026-11-03', 'two workdays after Friday is Tuesday');
  assert.equal(logCall(lead, 'no_answer', { agentId: 'me', at: at(FRI), today: FRI }).lead.nextOn, '2026-11-02');
  const appt = { ...lead, stage: 'appointment', meetingOn: FRI };
  assert.equal(logMeeting(appt, 'no_show', { at: at(FRI), today: FRI }).lead.nextOn, '2026-11-02');
  const app = { ...lead, stage: 'application', premium: 600 };
  const ok = approvePolicy(app, { at: at(FRI), today: FRI, draftOn: '2026-11-10' }).lead;
  assert.equal(ok.care.welcome, '2026-11-02');
  assert.equal(ok.care.pre_draft, '2026-11-06', 'three days before a Tuesday draft is Saturday: moved to Friday, still before the draft');
  assert.equal(logCareCall(ok, 'welcome', 'no_answer', { at: at(FRI), today: FRI }).lead.care.welcome, '2026-11-02');
});

test('Saturday shows only what can’t wait; Monday holds the rest', () => {
  const SAT = '2026-10-31';
  const leads = [
    { id: 'a', stage: 'new' },
    { id: 'b', stage: 'contacted', nextOn: '2026-10-30' },
    { id: 'c', stage: 'contacted', nextOn: SAT, callbackAt: '11:00' },
    { id: 'd', stage: 'lapse_risk', care: { save: '2026-10-29' }, graceEndsOn: '2026-11-01' },
    { id: 'e', stage: 'lapse_risk', care: { save: '2026-10-29' }, graceEndsOn: '2026-11-20' },
    { id: 'f', stage: 'issued', care: { welcome: '2026-10-30' } },
    { id: 'g', stage: 'appointment', meetingOn: SAT },
  ];
  const q = queueFor(leads, SAT);
  assert.equal(q.weekend, true);
  assert.deepEqual(q.calls.map((l) => l.id), ['c'], 'only a call-back she set for Saturday at a time');
  assert.deepEqual(q.saves.map((l) => l.id), ['d'], 'only the save whose grace runs out before Monday');
  assert.deepEqual(q.meetings.map((l) => l.id), ['g']);
  assert.equal(q.care.length, 0);
  assert.equal(q.waiting, 4);
  assert.equal(queueFor(leads, SAT, { weekendCalls: true }).calls.length, 3, 'she can still choose to work');
});

const DAY = '2026-11-19'; // a Thursday
// Five licensed agents, built like the stress test's team.
const team = () => [
  { id: 'keisha', name: 'Keisha', startedOn: '2026-08-03', activities: [...daily('keisha', '2026-09-14', '2026-11-19', 'dial', 40), ...daily('keisha', '2026-09-14', '2026-11-19', 'app_written', 1, { value: 600 }).filter((_, i) => i % 3 === 0)] },
  { id: 'jordan', name: 'Jordan', startedOn: '2026-08-03', activities: daily('jordan', '2026-10-01', '2026-11-19', 'dial', 30) },
  { id: 'priya', name: 'Priya', startedOn: '2026-09-28', activities: daily('priya', '2026-10-01', '2026-11-19', 'dial', 1) },
  { id: 'dante', name: 'Dante', startedOn: '2026-08-03', activities: daily('dante', '2026-10-01', '2026-11-18', 'dial', 35, {}, '21:00') },
  { id: 'troy', name: 'Troy', startedOn: '2026-08-03', activities: daily('troy', '2026-10-01', '2026-11-03', 'dial', 30) },
];

test('someone who logs at night is not flagged at noon', () => {
  const t = team();
  assert.equal(logsAtNight(t[3].activities, { dayKey: DAY, tz: TZ }), true);
  const r = Object.fromEntries(whoNeedsYou({ members: t, dayKey: DAY, now: '13:00', tz: TZ }).map((x) => [x.id, x]));
  assert.equal(r.dante.level, 'ok', 'Dante logs at 9 PM: zero calls at noon means nothing');
});

test('very low activity is flagged against the team, not a made-up number', () => {
  const r = Object.fromEntries(whoNeedsYou({ members: team(), dayKey: DAY, now: '15:00', tz: TZ }).map((x) => [x.id, x]));
  assert.equal(r.priya.level, 'watch');
  assert.match(r.priya.reason, /10 calls in 2 weeks; the team’s typical is \d+/);
  assert.match(r.priya.action, /agree on a daily call number together/);
  assert.equal(r.troy.level, 'urgent', 'silence still comes first');
});

test('a lapse always outranks studying, however long; a booked exam is on track', () => {
  const lapse = { id: 'jo', name: 'Jo', startedOn: '2026-08-03', activities: [...daily('jo', '2026-11-10', DAY, 'dial', 20), ...rows('jo', '2026-11-12', 'chargeback')] };
  const ben = { id: 'ben', name: 'Ben', licensed: false, startedOn: '2026-08-03', activities: [...daily('ben', '2026-11-10', DAY, 'study_session', 1, { value: 30 }), ...rows('ben', '2026-11-16', 'practice_test', 1, { value: 64 }), ...rows('ben', '2026-11-18', 'practice_test', 1, { value: 61 })] };
  const ana = { id: 'ana', name: 'Ana', licensed: false, startedOn: '2026-10-01', activities: [...daily('ana', '2026-11-10', DAY, 'study_session', 1, { value: 30 }), ...rows('ana', '2026-11-12', 'exam_booked', 1, { meta: { exam_on: '2026-11-25' } })] };
  const r = whoNeedsYou({ members: [ben, lapse, ana], dayKey: DAY, now: '15:00', tz: TZ });
  assert.deepEqual(r.map((x) => x.id), ['jo', 'ben', 'ana']);
  assert.match(r[1].action, /last 61, going down\)\. Agree on an exam date they can hit/);
  assert.equal(r[2].level, 'ok'); assert.match(r[2].reason, /Exam booked for Wed, Nov 25/);
  const anaLater = { ...ana, activities: [...ana.activities, ...daily('ana', '2026-11-20', '2026-11-27', 'study_session', 1, { value: 30 })] };
  const past = whoNeedsYou({ members: [anaLater], dayKey: '2026-11-27', now: '15:00', tz: TZ })[0];
  assert.equal(past.level, 'watch'); assert.match(past.action, /how the exam went/);
});

test('“I talked to them” rests the top card for 3 workdays, then it comes back', () => {
  const s = teamSummary({ members: team(), dayKey: DAY, now: '15:00', tz: TZ });
  assert.equal(s.top.id, 'troy');
  const mine = [checkinRow({ me: 'me', personId: 'troy', at: at(DAY, '15:05') })];
  const rested = applyCheckins(s, mine, { dayKey: DAY, tz: TZ });
  assert.equal(rested.top.id, 'priya', 'the next person moves up');
  assert.equal(rested.counts.resting, 1);
  const troy = rested.people.find((p) => p.id === 'troy');
  assert.equal(troy.restingUntil, '2026-11-24');
  const back = applyCheckins(teamSummary({ members: team(), dayKey: '2026-11-24', now: '15:00', tz: TZ }), mine, { dayKey: '2026-11-24', tz: TZ });
  assert.equal(back.top.id, 'troy', 'still silent three workdays later: back on top');
});

test('her own calls: a real drop is named; a new user gets no made-up warning', () => {
  const steady = daily('me', '2026-09-21', '2026-11-04', 'dial', 45);
  const slipping = daily('me', '2026-11-05', '2026-11-18', 'dial', 25);
  const p = ownProduction([...steady, ...slipping], { me: 'me', dayKey: DAY, tz: TZ });
  assert.deepEqual(p, { down: true, recentPerDay: 25, priorPerDay: 45 });
  assert.equal(ownProduction(slipping, { me: 'me', dayKey: DAY, tz: TZ }).down, false);
  const plan = { daily: { dials: 40 } };
  const hidden = todoFor(DAY, { role: 'builder', path: 'coach', plan, tz: TZ, hold: true });
  assert.ok(!hidden.some((x) => x.id === 'c-recruit'), 'recruiting waits while her own calls are down');
  assert.ok(todoFor(DAY, { role: 'builder', path: 'coach', plan: null, tz: TZ }).every((x) => x.id !== 'c-1on1' && x.id !== 'c-noon'), 'no target blocks without targets, no noon check');
});

test('building is measured by who she developed, and it changes over time', () => {
  // Sam joined slow, then sold every week: developed on her team. Keisha arrived selling every week.
  const sam = { id: 'sam', name: 'Sam', startedOn: '2026-08-03', activities: [...daily('sam', '2026-08-03', DAY, 'dial', 30), ...['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].flatMap((d) => rows('sam', d, 'app_written', 1, { value: 700 }))] };
  const keisha = { id: 'keisha', name: 'Keisha', startedOn: '2026-08-03', activities: workdays('2026-08-03', DAY).filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 2).flatMap((d) => [...rows('keisha', d, 'dial', 40), ...rows('keisha', d, 'app_written', 1, { value: 600 })]) };
  const b = builderMeasure({ members: [sam, keisha], dayKey: DAY, tz: TZ });
  assert.deepEqual(b.steady, { now: 2, before: 2 });
  assert.deepEqual(b.developed, { now: 1, before: 1 });
  const early = builderMeasure({ members: [sam, keisha], dayKey: '2026-10-01', tz: TZ });
  assert.equal(early.developed.now, 0, 'before Sam’s steady weeks, nothing developed yet');
  const s = teamSummary({ members: [sam, keisha], dayKey: DAY, now: '15:00', tz: TZ });
  const L = placeOnLadder({ person: { id: 'me' }, teamStages: s.stages, activities: daily('me', '2026-09-01', DAY, 'app_written', 1, { value: 600 }), dayKey: DAY, tz: TZ, topStage: 'upline' });
  const dev = L.gate.requirements.find((q) => /developed/.test(q.label));
  assert.deepEqual([dev.have, dev.met], ['1', true]);
});

test('the strongest agent gets a trainer step with the person who needs selling help', () => {
  const t = team();
  t.push({ id: 'rosa', name: 'Rosa', startedOn: '2026-08-03', activities: [...daily('rosa', '2026-11-10', DAY, 'dial', 30), ...rows('rosa', '2026-11-12', 'chargeback')] });
  const s = teamSummary({ members: t, dayKey: DAY, now: '15:00', tz: TZ });
  assert.equal(s.trainer.trainerName, 'Keisha');
  assert.equal(s.trainer.learnerName, 'Rosa');
  assert.match(s.trainer.action, /Have Keisha walk Rosa through how they do the kitchen-table check/);
});
